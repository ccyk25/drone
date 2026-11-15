// Phone-side calibration. Owner: P1.
// Flow (driven by the control screen):
//   calibrate:start → each ear measures its noise floor (median dB over floorMs)
//   calibrate:clap  → someone claps once at the centre; each ear records its peak over clapListenMs
//                     and replies { type: 'calibration', ear, floorDb, clapPeakDb }
//   calibrate:done  → control sends gains (from fusion.computeGains); ears just show "calibrated"
import { CONFIG } from '../shared/config.js';

export function createCalibrator(cfg = CONFIG.calibration) {
  let phase = 'idle';           // idle | floor | clap
  let until = 0;
  let floorSamples = [];
  let floorDb = null;
  let clapPeakDb = -Infinity;

  return {
    get phase() { return phase; },
    get floorDb() { return floorDb; },
    startFloor(at) { phase = 'floor'; until = at + cfg.floorMs; floorSamples = []; },
    startClap(at) { phase = 'clap'; until = at + cfg.clapListenMs; clapPeakDb = -Infinity; },
    /** Feed every frame; returns a result object when a phase completes. */
    update(db, at) {
      if (phase === 'floor') {
        floorSamples.push(db);
        if (at >= until) {
          const s = [...floorSamples].sort((a, b) => a - b);
          floorDb = s[Math.floor(s.length / 2)] ?? db;
          phase = 'idle';
          return { done: 'floor', floorDb };
        }
      } else if (phase === 'clap') {
        clapPeakDb = Math.max(clapPeakDb, db);
        if (at >= until) {
          phase = 'idle';
          return { done: 'clap', floorDb: floorDb ?? -90, clapPeakDb };
        }
      }
      return null;
    }
  };
}
