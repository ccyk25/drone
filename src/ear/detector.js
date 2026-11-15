// Noise-floor tracking, learned background spectrum, and human-sound detection. Owner: P1.
//
// Tested on real recordings in /lab.html (flooded river, heavy rain, real screams, a muffled "help").
// Lessons from that test that shaped this design:
//   • Real flood/rain noise is NOT spectrally flat, so flatness can't separate it from voices.
//   • A loud flood raises the overall floor, so "X dB above the floor" misses screams.
//   → Learn the background's spectrum and measure energy that rises ABOVE it in the scream band
//     (novelty), and require a PITCH, because water and rain aren't periodic.
//
// Two paths, one shared cooldown:
//   'scream'  bright-band novelty >= 10 dB, voiced, sustained >= 300 ms
//   'muffled' voice-band novelty >= 6 dB, clearly voiced, >= 450 ms of voiced frames within 2.5 s
//             (calls like "help… help…" are short syllables, not one long sound)
import { CONFIG } from '../shared/config.js';

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Rolling percentile of recent levels (dB). Used for the UI and for POD noise. */
export function createFloorTracker({ windowS, percentile, analysisMs } = {
  windowS: CONFIG.ear.floorWindowS, percentile: CONFIG.ear.floorPercentile, analysisMs: CONFIG.ear.analysisMs
}) {
  const size = Math.max(5, Math.round((windowS * 1000) / analysisMs));
  const buf = [];
  return {
    push(db) {
      buf.push(db);
      if (buf.length > size) buf.shift();
      return this.value();
    },
    value() {
      if (!buf.length) return -90;
      const sorted = [...buf].sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.floor(percentile * sorted.length))];
    }
  };
}

/**
 * Learned background spectrum, per frequency bin. update(freqDb, binHz) returns how far the
 * current frame rises above the background in two bands (dB). Adapts fast when the sound gets
 * quieter, slowly when louder, and almost not at all while a sound event is happening.
 */
export function createNoiseProfile(cfg = CONFIG.noiseProfile) {
  let noise = null;
  const bandNovelty = (p, binHz, [lo, hi]) => {
    let sp = 0, sn = 0;
    const a = Math.max(1, Math.floor(lo / binHz)), b = Math.min(p.length - 1, Math.ceil(hi / binHz));
    for (let i = a; i <= b; i++) { sp += p[i]; sn += noise[i]; }
    return 10 * Math.log10((sp + 1e-20) / (sn + 1e-20));
  };
  return {
    update(freqDb, binHz) {
      const p = new Float64Array(freqDb.length);
      for (let i = 0; i < p.length; i++) p[i] = Number.isFinite(freqDb[i]) ? 10 ** (freqDb[i] / 10) : 0;
      if (!noise) noise = Float64Array.from(p);
      const noveltyBrightDb = bandNovelty(p, binHz, cfg.brightBand);
      const noveltyVoiceDb = bandNovelty(p, binHz, cfg.voiceBand);
      const active = Math.max(noveltyBrightDb, noveltyVoiceDb) > cfg.activeNoveltyDb;
      const up = active ? cfg.alphaUpActive : cfg.alphaUpQuiet;
      for (let i = 0; i < p.length; i++) {
        const a = p[i] < noise[i] ? cfg.alphaDown : up;
        noise[i] += a * (p[i] - noise[i]);
      }
      return { noveltyBrightDb, noveltyVoiceDb };
    }
  };
}

/** 0..1 "how human-like is this frame", for the UI bar and level messages. */
export function screamScore({ noveltyBrightDb = 0, noveltyVoiceDb = 0, clarity = 0 }) {
  const rise = clamp01((Math.max(noveltyBrightDb, noveltyVoiceDb) - 3) / 12);
  const voiced = clamp01((clarity - 0.3) / 0.4);
  return rise * voiced;
}

const inPitch = (f, cfg) => f.pitchHz >= cfg.minPitchHz && f.pitchHz <= cfg.maxPitchHz;

export function isClearScream(f, cfg = CONFIG.scream) {
  return (f.noveltyBrightDb ?? -Infinity) >= cfg.minNoveltyDb && (f.clarity ?? 0) >= cfg.minClarity && inPitch(f, cfg);
}

export function isMuffledVoice(f, cfg = CONFIG.muffled) {
  return (f.noveltyVoiceDb ?? -Infinity) >= cfg.minNoveltyDb && (f.clarity ?? 0) >= cfg.minClarity && inPitch(f, cfg);
}

/** Voiced time accumulated within a sliding window (for syllabic calls). */
function createWindowCounter(windowMs, frameMs) {
  let hits = [];
  return {
    update(ok, f, at) {
      hits = hits.filter((h) => at - h.at <= windowMs);
      if (ok) hits.push({ at, db: f.db, clarity: f.clarity });
      // bursts = separate calls (gaps longer than 150 ms between voiced frames)
      let bursts = hits.length ? 1 : 0;
      for (let i = 1; i < hits.length; i++) if (hits[i].at - hits[i - 1].at > 150) bursts++;
      return {
        voicedMs: hits.length * frameMs,
        bursts,
        peak: hits.reduce((m, h) => Math.max(m, h.db), -Infinity),
        clarity: hits.length ? hits.reduce((s, h) => s + h.clarity, 0) / hits.length : 0,
        spanMs: hits.length ? at - hits[0].at : 0
      };
    },
    reset() { hits = []; }
  };
}

/**
 * Muffled-voice detection is OFF by default: it also fires on normal talking near the phone,
 * which would cause false alarms while we pitch. Turn it on for the "voice behind rubble" demo.
 */
export function createScreamDetector(cfg = CONFIG.scream, muffledCfg = CONFIG.muffled, { muffled: muffledOn = false } = {}) {
  const clear = createWindowCounter(cfg.windowMs, CONFIG.ear.analysisMs);
  const muffled = createWindowCounter(muffledCfg.windowMs, CONFIG.ear.analysisMs);
  let lastFire = -Infinity;
  let useMuffled = muffledOn;
  let scoreSum = 0, scoreN = 0;

  return {
    setMuffled(on) { useMuffled = Boolean(on); muffled.reset(); },
    get muffledOn() { return useMuffled; },
    update(frame, at) {
      const score = screamScore(frame);
      const isScream = isClearScream(frame, cfg);
      if (isScream) { scoreSum += score; scoreN += 1; }
      const c = clear.update(isScream, frame, at);
      const m = muffled.update(useMuffled && isMuffledVoice(frame, muffledCfg), frame, at);
      const cooled = at - lastFire >= cfg.cooldownMs;

      if (c.voicedMs >= cfg.minVoicedMs && cooled) {
        const meanScore = scoreN ? scoreSum / scoreN : 0;
        clear.reset(); muffled.reset(); lastFire = at; scoreSum = 0; scoreN = 0;
        return { score, event: { kind: 'scream', peakDb: c.peak, durationMs: c.spanMs, confidence: clamp01(0.5 + 0.5 * meanScore) } };
      }
      if (!isScream && c.voicedMs === 0) { scoreSum = 0; scoreN = 0; }
      // Survivors call repeatedly; a single gurgle or bird chirp doesn't (seen on a real river recording).
      if (useMuffled && m.voicedMs >= muffledCfg.minVoicedMs && m.bursts >= muffledCfg.minBursts && cooled) {
        muffled.reset(); lastFire = at;
        const confidence = clamp01((0.4 + 0.6 * clamp01((m.clarity - muffledCfg.minClarity) / 0.3)) * muffledCfg.confidenceScale + 0.1);
        return { score, event: { kind: 'muffled', peakDb: m.peak, durationMs: m.spanMs, confidence } };
      }
      return { score, event: null };
    }
  };
}
