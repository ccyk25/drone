import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/shared/config.js';
import { createScreamDetector, createFloorTracker } from '../src/ear/detector.js';
import { computeFeatures } from '../src/ear/audio.js';
import { validate } from '../src/shared/protocol.js';

const STEP = CONFIG.ear.analysisMs;

function feed(frames) {
  const d = createScreamDetector(CONFIG.scream);
  const events = [];
  frames.forEach((f, i) => {
    const { event } = d.update({ floorDb: -60, ...f }, i * STEP);
    if (event) events.push({ at: i * STEP, ...event });
  });
  return events;
}
const repeat = (n, f) => Array.from({ length: n }, () => ({ ...f }));
const quiet = { db: -60, bandRatio: 0.2 };
const screamF = { db: -20, bandRatio: 0.6 };

describe('scream detector', () => {
  it('fires exactly once for a sustained scream', () => {
    const ev = feed([...repeat(10, quiet), ...repeat(30, screamF), ...repeat(10, quiet)]);
    expect(ev).toHaveLength(1);
    expect(ev[0].durationMs).toBeGreaterThanOrEqual(CONFIG.scream.minDurationMs);
    expect(ev[0].confidence).toBeGreaterThan(0.5);
  });

  it('ignores a short clap', () => {
    const ev = feed([...repeat(10, quiet), ...repeat(2, { db: -10, bandRatio: 0.6 }), ...repeat(10, quiet)]);
    expect(ev).toHaveLength(0);
  });

  it('ignores loud low-pitched talking', () => {
    const ev = feed([...repeat(10, quiet), ...repeat(40, { db: -30, bandRatio: 0.25 }), ...repeat(10, quiet)]);
    expect(ev).toHaveLength(0);
  });

  it('bridges a one-frame dropout', () => {
    const ev = feed([...repeat(4, screamF), quiet, ...repeat(4, screamF), ...repeat(10, quiet)]);
    expect(ev).toHaveLength(1);
  });

  it('respects the cooldown between screams', () => {
    const gap = repeat(5, quiet); // 250 ms < 1500 ms cooldown
    const ev = feed([...repeat(10, screamF), ...gap, ...repeat(10, screamF)]);
    expect(ev).toHaveLength(1);
  });
});

describe('floor tracker', () => {
  it('ignores short loud bursts', () => {
    const f = createFloorTracker({ windowS: 5, percentile: 0.2, analysisMs: STEP });
    for (let i = 0; i < 80; i++) f.push(-60);
    for (let i = 0; i < 10; i++) f.push(-15);
    expect(f.value()).toBe(-60);
  });
});

describe('features', () => {
  it('measures a 2 kHz tone as high band ratio and correct level', () => {
    const sr = 48000, n = 2048;
    const time = Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 2000 * i) / sr));
    const freq = new Float32Array(n / 2).fill(-140);
    freq[Math.round(2000 / (sr / n))] = -10;
    const { db, bandRatio } = computeFeatures(time, freq, sr, n);
    expect(db).toBeCloseTo(20 * Math.log10(0.5 / Math.SQRT2), 1);
    expect(bandRatio).toBeGreaterThan(0.9);
  });
});

describe('protocol', () => {
  it('validates good and rejects bad messages', () => {
    expect(validate({ type: 'level', ear: 'L', t: 1, db: -20, floorDb: -60, bandRatio: 0.5, screamScore: 0.1 })).toBe(true);
    expect(validate({ type: 'level', ear: 'X', t: 1, db: -20, floorDb: -60, bandRatio: 0.5, screamScore: 0.1 })).toBe(false);
    expect(validate({ type: 'scream', ear: 'R', t: 1, peakDb: -10, durationMs: 300, confidence: NaN })).toBe(false);
    expect(validate({ type: 'calibrate', phase: 'done', gains: { L: 1.2 } })).toBe(true);
    expect(validate({ type: 'calibration', ear: 'C', floorDb: -60, clapPeakDb: -8 })).toBe(true);
    expect(validate({ type: 'nope' })).toBe(false);
  });
});
