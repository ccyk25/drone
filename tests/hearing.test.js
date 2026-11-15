// Synthetic end-to-end hearing tests through the real pipeline (features → noise profile → detector).
// Real-recording tests (flooded river, rain, real screams, muffled "help") run in /lab.html.
import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/shared/config.js';
import { computeFeatures, voicing } from '../src/ear/audio.js';
import { createNoiseProfile, createScreamDetector } from '../src/ear/detector.js';

const SR = 48000;
const N = 2048;
const HOP = Math.round((CONFIG.ear.analysisMs / 1000) * SR);

function rng(seed = 7) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296) * 2 - 1;
}

// Radix-2 FFT → dB spectrum (Hann), like AnalyserNode
const hann = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
function spectrumDb(frame) {
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = frame[i] * hann[i];
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < N; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
        const a = i + k, b = a + len / 2;
        const vr = re[b] * wr - im[b] * wi, vi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - vr; im[b] = im[a] - vi; re[a] += vr; im[a] += vi;
      }
    }
  }
  return Float32Array.from({ length: N / 2 }, (_, k) => 10 * Math.log10((re[k] ** 2 + im[k] ** 2) / N + 1e-20));
}

// "Flood": brown-ish noise (low-frequency heavy, like rushing water). Voices: harmonic series.
function brownNoise(len, gain, seed) {
  // two cascaded low-pass poles: a deep roar with little hiss, like the real river recording
  const r = rng(seed); let y1 = 0, y2 = 0;
  return Float32Array.from({ length: len }, () => { y1 = 0.97 * y1 + r(); y2 = 0.97 * y2 + 0.03 * y1; return y2 * gain; });
}
function harmonic(len, f0, amps, gain) {
  return Float32Array.from({ length: len }, (_, n) => gain * amps.reduce((s, a, h) => s + a * Math.sin((2 * Math.PI * f0 * (h + 1) * n) / SR), 0));
}
/** Short repeated calls: on for onS, off for offS. */
function gated(x, onS, offS) {
  const period = Math.round((onS + offS) * SR), on = Math.round(onS * SR);
  return x.map((v, i) => ((i % period) < on ? v : 0));
}
const rmsOf = (x) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);
/** Scale a sound so its loudness (while sounding) is snrDb above the background. */
const atSnr = (x, bg, snrDb) => {
  const on = x.filter((v) => v !== 0);
  const g = (rmsOf(bg) * 10 ** (snrDb / 20)) / rmsOf(on);
  return x.map((v) => v * g);
};
const mix = (bg, ev, at) => { const o = bg.slice(); for (let i = 0; i < ev.length; i++) o[at + i] += ev[i]; return o; };

function detect(samples, muffled) {
  const profile = createNoiseProfile(CONFIG.noiseProfile);
  const det = createScreamDetector(CONFIG.scream, CONFIG.muffled, { muffled });
  const events = [];
  for (let s = 0, k = 0; s + N <= samples.length; s += HOP, k++) {
    const frame = samples.subarray(s, s + N);
    const f = computeFeatures(frame, spectrumDb(frame), SR, N);
    const nov = profile.update(f.freqDb, f.binHz);
    const { event } = det.update({ ...f, ...nov, floorDb: -60 }, k * CONFIG.ear.analysisMs);
    if (event) events.push(event);
  }
  return events;
}

const LEAD = 3 * SR;
const flood = brownNoise(LEAD + 2 * SR, 0.1, 11);   // loud low-frequency roar, voices at roughly 0 dB broadband SNR

describe('hearing in a flood (synthetic end-to-end)', () => {
  it('flood noise alone never fires, even in muffled mode', () => {
    expect(detect(flood, true)).toHaveLength(0);
  });

  it('pre-emphasis stops flood rumble from looking pitched', () => {
    expect(voicing(flood.subarray(SR, SR + N), SR).clarity).toBeLessThan(0.5);
  });

  it('a clear scream over the flood is detected', () => {
    const scream = atSnr(harmonic(SR, 900, [1, 0.8, 0.6, 0.4], 1), flood, 0);
    const ev = detect(mix(flood, scream, LEAD), false);
    expect(ev.length).toBeGreaterThanOrEqual(1);
    expect(ev[0].kind).toBe('scream');
  });

  it('repeated muffled calls over the flood are detected in muffled mode only', () => {
    // same condition the real-recordings lab validates: repeated calls +6 dB over the flood
    const calls = atSnr(gated(harmonic(Math.round(1.6 * SR), 220, [1, 0.5, 0.2], 1), 0.25, 0.3), flood, 6);
    const scene = mix(flood, calls, LEAD);
    expect(detect(scene, false).filter((e) => e.kind === 'muffled')).toHaveLength(0);
    const ev = detect(scene, true);
    expect(ev.some((e) => e.kind === 'muffled' || e.kind === 'scream')).toBe(true);
  });
});
