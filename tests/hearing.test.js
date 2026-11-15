// Synthetic-signal tests: can the ear tell flood noise from people, and hear muffled voices?
import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/shared/config.js';
import { computeFeatures } from '../src/ear/audio.js';
import { isClearScream, isMuffledVoice, createScreamDetector } from '../src/ear/detector.js';

const SR = 48000;
const N = 2048;

// Seeded random so tests are stable
function rng(seed = 7) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296) * 2 - 1;
}

/** Naive DFT → dB power per bin (like AnalyserNode.getFloatFrequencyData), Hann-windowed. */
function spectrumDb(x) {
  const out = new Float32Array(N / 2);
  for (let k = 0; k < N / 2; k++) {
    let re = 0, im = 0;
    for (let n = 0; n < N; n++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (N - 1));
      const a = (2 * Math.PI * k * n) / N;
      re += x[n] * w * Math.cos(a);
      im -= x[n] * w * Math.sin(a);
    }
    out[k] = 10 * Math.log10((re * re + im * im) / N + 1e-20);
  }
  return out;
}

function harmonic(f0, amps, gain) {
  return Float32Array.from({ length: N }, (_, n) =>
    gain * amps.reduce((s, a, h) => s + a * Math.sin((2 * Math.PI * f0 * (h + 1) * n) / SR), 0));
}
function noise(gain, seed) {
  const r = rng(seed);
  return Float32Array.from({ length: N }, () => gain * r());
}
const mix = (a, b) => a.map((v, i) => v + b[i]);
const features = (x, floorDb = -60) => ({ ...computeFeatures(x, spectrumDb(x), SR, N), floorDb });

// Signals
const floodNoise = noise(0.3, 11);                                            // loud broadband rushing water / rain
const muffledVoice = harmonic(300, [1, 0.6, 0.3], 0.03);                      // voice behind rubble: low, high harmonics lost
const clearScream = harmonic(900, [1, 0.8, 0.7, 0.5], 0.2);                   // bright scream with strong 1–4 kHz energy
const voiceInWater = mix(harmonic(300, [1, 0.6, 0.3], 0.05), noise(0.01, 3)); // voice audible over moderate water noise

describe('hearing in a flood', () => {
  it('flood noise is flat and unpitched → not a person', () => {
    const f = features(floodNoise);
    expect(f.flatness).toBeGreaterThan(0.5);
    expect(f.clarity).toBeLessThan(0.5);
    expect(isClearScream(f)).toBe(false);
    expect(isMuffledVoice(f)).toBe(false);
  });

  it('muffled voice is quiet and dull but voiced → muffled voice', () => {
    const f = features(muffledVoice);
    expect(f.clarity).toBeGreaterThan(0.6);
    expect(f.pitchHz).toBeGreaterThan(280);
    expect(f.pitchHz).toBeLessThan(320);
    expect(isClearScream(f)).toBe(false);   // too dull for the scream path
    expect(isMuffledVoice(f)).toBe(true);
  });

  it('clear scream is bright and not flat → scream', () => {
    const f = features(clearScream);
    expect(f.bandRatio).toBeGreaterThan(CONFIG.scream.minBandRatio);
    expect(isClearScream(f)).toBe(true);
  });

  it('a voice over moderate water noise is still heard', () => {
    const f = features(voiceInWater);
    expect(isMuffledVoice(f)).toBe(true);
  });

  it('detector reports kind "muffled" only when muffled mode is on', () => {
    const f = features(muffledVoice);
    const run = (on) => {
      const d = createScreamDetector(CONFIG.scream, CONFIG.muffled, { muffled: on });
      const events = [];
      for (let i = 0; i < 20; i++) {
        const { event } = d.update(f, i * CONFIG.ear.analysisMs);
        if (event) events.push(event);
      }
      return events;
    };
    expect(run(false)).toHaveLength(0);
    const ev = run(true);
    expect(ev).toHaveLength(1);
    expect(ev[0].kind).toBe('muffled');
    expect(ev[0].confidence).toBeLessThan(0.9);   // muffled is weaker evidence than a clear scream
  });

  it('flood noise never fires the detector, even in muffled mode', () => {
    const f = features(floodNoise);
    const d = createScreamDetector(CONFIG.scream, CONFIG.muffled, { muffled: true });
    let fired = 0;
    for (let i = 0; i < 40; i++) if (d.update(f, i * CONFIG.ear.analysisMs).event) fired++;
    expect(fired).toBe(0);
  });
});
