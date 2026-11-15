// Noise-floor tracking and human-sound detection. Owner: P1. Pure logic, unit-tested.
//
// Two detection paths share one cooldown:
//   'scream'  clear scream: loud (>= floor + 15 dB), bright (1–4 kHz share), not flat
//   'muffled' muffled voice behind rubble/walls: quieter (>= floor + 8 dB), high frequencies
//             lost, but still periodic (voiced, 120–1000 Hz pitch) and not flat
// Flood noise (rushing water, rain, wind) is broadband: high flatness, no pitch → rejected by both.
import { CONFIG } from '../shared/config.js';

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Rolling percentile of recent levels. The 20th percentile ignores short loud events like screams. */
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

/** 0..1 "how human-like is this frame" for the UI bar and level messages. */
export function screamScore({ db, floorDb, bandRatio, flatness = 0, clarity = 0 }, cfg = CONFIG.scream) {
  const loud = clamp01((db - floorDb - 5) / 20);
  const bright = clamp01((bandRatio - cfg.minBandRatio + 0.2) / 0.4);
  const voiced = clamp01((clarity - 0.4) / 0.4);
  const notFlat = clamp01((0.6 - flatness) / 0.4);
  return loud * Math.max(bright, voiced) * notFlat;
}

export function isClearScream(f, cfg = CONFIG.scream) {
  return f.db > f.floorDb + cfg.minAboveFloorDb
    && f.bandRatio > cfg.minBandRatio
    && (f.flatness ?? 0) < cfg.maxFlatness;
}

export function isMuffledVoice(f, cfg = CONFIG.muffled) {
  return f.clarity !== undefined
    && f.db > f.floorDb + cfg.minAboveFloorDb
    && f.clarity >= cfg.minClarity
    && f.pitchHz >= cfg.minPitchHz && f.pitchHz <= cfg.maxPitchHz
    && (f.flatness ?? 1) < cfg.maxFlatness;
}

/** Tracks one sustained-sound condition with dropout bridging. */
function createRun(minDurationMs, gapToleranceMs) {
  let activeSince = null, lastTrue = -Infinity, peak = -Infinity, scoreSum = 0, n = 0, fired = false;
  return {
    update(ok, f, score, at) {
      if (ok) {
        if (activeSince === null) { activeSince = at; peak = -Infinity; scoreSum = 0; n = 0; fired = false; }
        lastTrue = at; peak = Math.max(peak, f.db); scoreSum += score; n += 1;
      } else if (activeSince !== null && at - lastTrue > gapToleranceMs) {
        activeSince = null;
      }
      const durationMs = activeSince === null ? 0 : lastTrue - activeSince;
      return { ready: activeSince !== null && !fired && durationMs >= minDurationMs, durationMs, peak, meanScore: n ? scoreSum / n : 0 };
    },
    markFired() { fired = true; }
  };
}

/**
 * Muffled-voice detection is OFF by default: it also fires on normal talking near the phone,
 * which would cause false alarms while we pitch. Turn it on for the "voice behind rubble" demo.
 */
export function createScreamDetector(cfg = CONFIG.scream, muffledCfg = CONFIG.muffled, { muffled: muffledOn = false } = {}) {
  const clear = createRun(cfg.minDurationMs, cfg.gapToleranceMs);
  const muffled = createRun(muffledCfg.minDurationMs, cfg.gapToleranceMs);
  let lastFire = -Infinity;
  let useMuffled = muffledOn;

  return {
    setMuffled(on) { useMuffled = Boolean(on); },
    get muffledOn() { return useMuffled; },
    update(frame, at) {
      const score = screamScore(frame, cfg);
      const c = clear.update(isClearScream(frame, cfg), frame, score, at);
      const m = muffled.update(useMuffled && isMuffledVoice(frame, muffledCfg), frame, score, at);
      const cooled = at - lastFire >= cfg.cooldownMs;

      if (c.ready && cooled) {
        clear.markFired(); muffled.markFired(); lastFire = at;
        return { score, event: { kind: 'scream', peakDb: c.peak, durationMs: c.durationMs, confidence: clamp01(0.5 + 0.5 * c.meanScore) } };
      }
      if (m.ready && cooled) {
        muffled.markFired(); lastFire = at;
        const confidence = clamp01((0.4 + 0.6 * clamp01((frame.clarity - muffledCfg.minClarity) / 0.3)) * muffledCfg.confidenceScale + 0.1);
        return { score, event: { kind: 'muffled', peakDb: m.peak, durationMs: m.durationMs, confidence } };
      }
      return { score, event: null };
    }
  };
}
