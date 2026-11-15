import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/shared/config.js';
import { createScreamDetector, createFloorTracker, createNoiseProfile, screamConfigFor } from '../src/ear/detector.js';
import { computeFeatures } from '../src/ear/audio.js';
import { validate } from '../src/shared/protocol.js';

const STEP = CONFIG.ear.analysisMs;

function feed(frames, opts) {
  const d = createScreamDetector(CONFIG.scream, CONFIG.muffled, opts);
  const events = [];
  frames.forEach((f, i) => {
    const { event } = d.update({ db: -30, ...f }, i * STEP);
    if (event) events.push({ at: i * STEP, ...event });
  });
  return events;
}
const repeat = (n, f) => Array.from({ length: n }, () => ({ ...f }));
const quiet = { noveltyBrightDb: 1, noveltyVoiceDb: 1, clarity: 0.1, pitchHz: 300 };
const screamF = { noveltyBrightDb: 20, noveltyVoiceDb: 18, clarity: 0.9, pitchHz: 900 };
const rainBurst = { noveltyBrightDb: 18, noveltyVoiceDb: 18, clarity: 0.35, pitchHz: 700 };   // loud but unpitched
const callF = { noveltyBrightDb: 4, noveltyVoiceDb: 25, clarity: 0.75, pitchHz: 220 };       // muffled "help"

describe('scream detector', () => {
  it('fires exactly once for a sustained scream', () => {
    const ev = feed([...repeat(10, quiet), ...repeat(20, screamF), ...repeat(10, quiet)]);   // 1 s scream; longer screams re-report after the cooldown
    expect(ev).toHaveLength(1);
    expect(ev[0].kind).toBe('scream');
    expect(ev[0].confidence).toBeGreaterThan(0.5);
  });

  it('ignores a short clap-length burst', () => {
    expect(feed([...repeat(10, quiet), ...repeat(2, screamF), ...repeat(10, quiet)])).toHaveLength(0);
  });

  it('ignores loud unpitched rain bursts', () => {
    expect(feed([...repeat(10, quiet), ...repeat(40, rainBurst), ...repeat(10, quiet)])).toHaveLength(0);
  });

  it('still fires when scream frames flicker in noise', () => {
    const flicker = [];
    for (let i = 0; i < 14; i++) flicker.push(i % 3 === 2 ? quiet : screamF);
    expect(feed([...repeat(10, quiet), ...flicker, ...repeat(10, quiet)])).toHaveLength(1);
  });

  it('respects the cooldown between screams', () => {
    const ev = feed([...repeat(10, screamF), ...repeat(5, quiet), ...repeat(10, screamF)]);
    expect(ev).toHaveLength(1);
  });

  it('muffled calls need muffled mode and at least two separate calls', () => {
    const twoCalls = [...repeat(10, quiet), ...repeat(3, callF), ...repeat(6, quiet), ...repeat(3, callF), ...repeat(10, quiet)];
    const oneLong = [...repeat(10, quiet), ...repeat(8, callF), ...repeat(20, quiet)];
    expect(feed(twoCalls, { muffled: false })).toHaveLength(0);
    const ev = feed(twoCalls, { muffled: true });
    expect(ev).toHaveLength(1);
    expect(ev[0].kind).toBe('muffled');
    expect(feed(oneLong, { muffled: true })).toHaveLength(0);   // a single gurgle/chirp isn't a call
  });
});

describe('noise profile', () => {
  it('learns a steady background and reports a rise above it', () => {
    const p = createNoiseProfile(CONFIG.noiseProfile);
    const bins = 1024, binHz = 48000 / 2048;
    const bg = new Float32Array(bins).fill(-80);
    let last;
    for (let i = 0; i < 100; i++) last = p.update(bg, binHz);
    expect(Math.abs(last.noveltyBrightDb)).toBeLessThan(1);
    const loud = Float32Array.from(bg, (v, i) => (i * binHz > 1000 && i * binHz < 4000 ? -60 : v));
    expect(p.update(loud, binHz).noveltyBrightDb).toBeGreaterThan(15);
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
    expect(validate({ type: 'scream', ear: 'R', t: 1, peakDb: -10, durationMs: 300, confidence: 0.6, kind: 'muffled' })).toBe(true);
    expect(validate({ type: 'calibrate', phase: 'done', gains: { L: 1.2 } })).toBe(true);
    expect(validate({ type: 'calibration', ear: 'C', floorDb: -60, clapPeakDb: -8 })).toBe(true);
    expect(validate({ type: 'nope' })).toBe(false);
  });
});

describe('demo sensitivity (room full of people)', () => {
  const run = (frame, sens) => {
    const d = createScreamDetector(screamConfigFor(sens), CONFIG.muffled);
    let n = 0;
    for (let i = 0; i < 40; i++) if (d.update(frame, i * STEP).event) n++;
    return n;
  };
  // the exact numbers from the phone screenshot that kept triggering: -30 dB level, floor -34, +11 dB, pitch 706 Hz
  const talking = { db: -30, floorDb: -34, noveltyBrightDb: 11, noveltyVoiceDb: 11, clarity: 0.8, pitchHz: 706 };
  const shout = { db: -14, floorDb: -34, noveltyBrightDb: 26, noveltyVoiceDb: 24, clarity: 0.9, pitchHz: 820 };
  it('normal talking does NOT trigger in demo mode', () => expect(run(talking, 'demo')).toBe(0));
  it('a loud sustained shout still triggers in demo mode', () => expect(run(shout, 'demo')).toBeGreaterThanOrEqual(1));
  it('field mode stays sensitive (lab-validated)', () => expect(run(talking, 'field')).toBeGreaterThanOrEqual(1));
});
