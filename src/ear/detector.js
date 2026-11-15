// Noise-floor tracking and scream detection. Owner: P1. Pure logic, unit-tested.
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

/** 0..1 "how scream-like is this frame": loudness above floor × high-pitch share. */
export function screamScore({ db, floorDb, bandRatio }, cfg = CONFIG.scream) {
  const loud = clamp01((db - floorDb - cfg.minAboveFloorDb + 10) / 20);
  const pitch = clamp01((bandRatio - cfg.minBandRatio + 0.2) / 0.4);
  return loud * pitch;
}

/**
 * A frame qualifies when it's loud (db > floor + minAboveFloorDb) AND high-pitched
 * (bandRatio > minBandRatio). A scream fires once qualifying frames have lasted
 * minDurationMs (short dropouts up to gapToleranceMs are bridged). Claps are too short;
 * talking is too low-pitched and usually not loud enough. After firing, wait cooldownMs.
 */
export function createScreamDetector(cfg = CONFIG.scream) {
  let activeSince = null;
  let lastTrue = -Infinity;
  let peak = -Infinity;
  let scoreSum = 0, scoreN = 0;
  let firedThisRun = false;
  let lastFire = -Infinity;

  return {
    update(frame, at) {
      const score = screamScore(frame, cfg);
      const qualifies = frame.db > frame.floorDb + cfg.minAboveFloorDb && frame.bandRatio > cfg.minBandRatio;

      if (qualifies) {
        if (activeSince === null) {
          activeSince = at; peak = -Infinity; scoreSum = 0; scoreN = 0; firedThisRun = false;
        }
        lastTrue = at;
        peak = Math.max(peak, frame.db);
        scoreSum += score; scoreN += 1;
      } else if (activeSince !== null && at - lastTrue > cfg.gapToleranceMs) {
        activeSince = null;
      }

      if (activeSince !== null && !firedThisRun) {
        const durationMs = lastTrue - activeSince;
        if (durationMs >= cfg.minDurationMs && at - lastFire >= cfg.cooldownMs) {
          firedThisRun = true;
          lastFire = at;
          const meanScore = scoreSum / scoreN;
          const confidence = clamp01(0.5 + 0.5 * meanScore);
          return { score, event: { peakDb: peak, durationMs, confidence } };
        }
      }
      return { score, event: null };
    }
  };
}
