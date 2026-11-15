import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/shared/config.js';
import { createFusion, computeGains, bearingFromLevels } from '../src/control/fusion.js';

function scream(fusion, levels, at, firing = Object.keys(levels)) {
  for (const [ear, db] of Object.entries(levels)) {
    fusion.ingest({ type: 'level', ear, t: 0, db, floorDb: -60, bandRatio: 0.6, screamScore: 0.9 }, at);
  }
  for (const ear of firing) {
    fusion.ingest({ type: 'scream', ear, t: 0, peakDb: levels[ear], durationMs: 350, confidence: 0.9 }, at + 10);
  }
}

function run(levels, firing) {
  const out = [];
  const f = createFusion(CONFIG, { onDetection: (d) => out.push(d), autoFlush: false });
  scream(f, levels, 1000, firing);
  f.flush(1000 + CONFIG.fusion.windowMs + 50);
  return out;
}

describe('fusion', () => {
  it('louder on L gives a bearing below -20°', () => {
    const [d] = run({ L: -20, C: -24, R: -28 });
    expect(d.relBearingDeg).toBeLessThan(-20);
  });

  it('louder on R gives a bearing above +20°', () => {
    const [d] = run({ L: -28, C: -24, R: -20 });
    expect(d.relBearingDeg).toBeGreaterThan(20);
  });

  it('equal L and R gives about 0°', () => {
    const [d] = run({ L: -22, C: -30, R: -22 });
    expect(Math.abs(d.relBearingDeg)).toBeLessThan(1);
  });

  it('uses levels from ears that did not fire', () => {
    const [d] = run({ L: -20, C: -24, R: -28 }, ['L']);
    expect(d.relBearingDeg).toBeLessThan(-20);
  });

  it('one ear only gives 0° at half confidence', () => {
    const [d] = run({ C: -20 });
    expect(d.relBearingDeg).toBe(0);
    expect(d.confidence).toBeCloseTo(0.45, 5);
  });

  it('groups screams within the window into one detection', () => {
    const out = [];
    const f = createFusion(CONFIG, { onDetection: (d) => out.push(d), autoFlush: false });
    scream(f, { L: -20, C: -24 }, 1000);
    f.flush(1100);                 // window not over yet
    expect(out).toHaveLength(0);
    f.flush(2000);
    expect(out).toHaveLength(1);
  });

  it('gains correct for a quieter microphone', () => {
    const gains = computeGains({ L: -10, C: -10, R: -16 }); // R mic reads 6 dB low
    const f = createFusion(CONFIG, { onDetection: () => {}, autoFlush: false });
    f.setGains(gains);
    expect(20 * Math.log10(gains.R)).toBeCloseTo(4, 5);    // ref = mean(-12) → R +4 dB
    expect(20 * Math.log10(gains.L)).toBeCloseTo(-2, 5);
  });

  it('bearingFromLevels stays within ear angles', () => {
    const b = bearingFromLevels({ L: -10, C: -50, R: -50 });
    expect(b).toBeGreaterThanOrEqual(-45);
    expect(b).toBeLessThan(-40);
  });

  it('reports connected ears and drops stale ones', () => {
    const f = createFusion(CONFIG, { autoFlush: false });
    f.ingest({ type: 'hello', ear: 'L' }, 0);
    f.ingest({ type: 'hello', ear: 'R' }, 2500);
    expect(f.connectedEars(3000)).toEqual(['L', 'R']);
    expect(f.connectedEars(4000)).toEqual(['R']);
  });

  it('demo setup: L and R listen, C is camera-only → a scream near L turns left, near R turns right', () => {
    for (const [near, sign] of [['L', -1], ['R', 1]]) {
      const out = [];
      const f = createFusion(CONFIG, { onDetection: (d) => out.push(d), autoFlush: false });
      f.ingest({ type: 'hello', ear: 'C' }, 900);                       // camera phone connected, no mic levels
      f.ingest({ type: 'sighting', ear: 'C', t: 0, confidence: 0.8, offset: 0 }, 950);
      out.length = 0;                                                    // ignore the camera detection
      const levels = near === 'L' ? { L: -20, R: -27 } : { L: -27, R: -20 };
      for (const [ear, db] of Object.entries(levels)) f.ingest({ type: 'level', ear, t: 0, db, floorDb: -60, bandRatio: 0.6, screamScore: 0.9 }, 1000);
      f.ingest({ type: 'scream', ear: near, t: 0, peakDb: -20, durationMs: 350, confidence: 0.9 }, 1010);
      f.flush(2000);
      expect(out).toHaveLength(1);
      expect(Math.sign(out[0].relBearingDeg)).toBe(sign);
      expect(Math.abs(out[0].relBearingDeg)).toBeGreaterThan(30);
    }
  });

  it('phones with very different mics (L floor -51, R floor -36): picks the phone that rose most above its own background', () => {
    const run = (lvl, fired) => {
      const out = [];
      const f = createFusion(CONFIG, { onDetection: (d) => out.push(d), autoFlush: false });
      for (const [ear, db, floorDb] of lvl) f.ingest({ type: 'level', ear, t: 0, db, floorDb, bandRatio: 0.5, screamScore: 0.5 }, 1000);
      f.ingest({ type: 'scream', ear: fired, t: 0, peakDb: lvl.find((l) => l[0] === fired)[1], durationMs: 300, confidence: 0.9 }, 1010);
      f.flush(2000);
      return out[0].relBearingDeg;
    };
    // scream near L: raw L -32 is QUIETER than R -30, but L rose 19 dB over its background vs R only 6 dB → left
    expect(run([['L', -32, -51], ['R', -30, -36]], 'L')).toBeLessThan(0);
    // scream near R → right
    expect(run([['L', -45, -51], ['R', -15, -36]], 'R')).toBeGreaterThan(0);
  });
});
