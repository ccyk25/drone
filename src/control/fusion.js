// Turns ear messages into direction-of-arrival detections. Owner: P1.
// Used by the control screen (P2): createFusion(CONFIG, { onDetection }), then call
// fusion.ingest(msg) for every realtime message. It emits
//   { type: 'detection', t, relBearingDeg, confidence, ears }
// relBearingDeg is relative to the drone's heading (negative = left).
import { CONFIG } from '../shared/config.js';
import { EARS, MSG } from '../shared/protocol.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Gains so every phone reads the same clap equally. clapPeaks: { L: dB, C: dB, R: dB } → linear gains. */
export function computeGains(clapPeaks) {
  const entries = Object.entries(clapPeaks).filter(([, v]) => Number.isFinite(v));
  if (!entries.length) return {};
  const ref = entries.reduce((s, [, v]) => s + v, 0) / entries.length;
  return Object.fromEntries(entries.map(([ear, db]) => [ear, 10 ** ((ref - db) / 20)]));
}

/**
 * Weighted direction from per-ear levels (dB, already gain-adjusted).
 * Weight = 10^(sharpness · dB / 20); sharpness > 1 lets the loudest ear dominate,
 * which matches inverse-square loudness differences of a few dB across ~1 m spacing.
 */
export function bearingFromLevels(levelsDb, config = CONFIG) {
  const ears = Object.keys(levelsDb).filter((e) => Number.isFinite(levelsDb[e]));
  if (!ears.length) return 0;
  const maxDb = Math.max(...ears.map((e) => levelsDb[e]));
  let wSum = 0, aSum = 0;
  for (const e of ears) {
    const w = 10 ** ((config.fusion.sharpness * (levelsDb[e] - maxDb)) / 20);
    wSum += w;
    aSum += w * config.ears[e];
  }
  return aSum / wSum;
}

export function createFusion(config = CONFIG, { onDetection, autoFlush = true } = {}) {
  const { windowMs, staleMs, levelLookbackMs } = config.fusion;
  const lastSeen = {};                // ear → time last heard from
  const levels = {};                  // ear → [{ at, db }]
  let gains = {};                     // ear → linear gain
  let group = null;                   // { start, screams: { ear: msg } }
  let timer = null;

  const gainDb = (ear) => 20 * Math.log10(gains[ear] ?? 1);

  function connectedEars(at = now()) {
    return EARS.filter((e) => lastSeen[e] !== undefined && at - lastSeen[e] <= staleMs);
  }

  function peakLevel(ear, from, to) {
    let best = -Infinity;
    for (const s of levels[ear] ?? []) if (s.at >= from && s.at <= to) best = Math.max(best, s.db);
    return best;
  }

  function finalize(at) {
    if (!group) return;
    const g = group;
    group = null;
    if (timer) { clearTimeout(timer); timer = null; }

    const ears = connectedEars(at);
    for (const e of Object.keys(g.screams)) if (!ears.includes(e)) ears.push(e);

    const adjusted = {};
    for (const e of ears) {
      const screamDb = g.screams[e]?.peakDb ?? -Infinity;
      const levelDb = peakLevel(e, g.start - levelLookbackMs, at);
      const raw = Math.max(screamDb, levelDb);
      if (Number.isFinite(raw)) adjusted[e] = raw + gainDb(e);
    }

    const baseConf = Math.max(...Object.values(g.screams).map((s) => s.confidence));
    let relBearingDeg;
    let confidence;
    const heard = Object.keys(adjusted);
    if (heard.length <= 1) {
      relBearingDeg = 0;
      confidence = baseConf / 2;
    } else {
      relBearingDeg = bearingFromLevels(adjusted, config);
      const sorted = heard.map((e) => adjusted[e]).sort((a, b) => b - a);
      confidence = baseConf * clamp((sorted[0] - sorted[1]) / 10, 0.3, 1);
    }

    onDetection?.({
      type: 'detection',
      t: at,
      relBearingDeg,
      confidence: clamp(confidence, 0, 1),
      ears: Object.keys(g.screams)
    });
  }

  function ingest(msg, at = now()) {
    if (!msg || !EARS.includes(msg.ear)) return;
    lastSeen[msg.ear] = at;

    if (msg.type === MSG.LEVEL) {
      const buf = (levels[msg.ear] ??= []);
      buf.push({ at, db: msg.db });
      while (buf.length && at - buf[0].at > 5000) buf.shift();
    }

    if (msg.type === MSG.SCREAM) {
      if (group && at - group.start > windowMs) finalize(at);
      if (!group) {
        group = { start: at, screams: {} };
        if (autoFlush && typeof setTimeout !== 'undefined') timer = setTimeout(() => finalize(now()), windowMs);
      }
      const prev = group.screams[msg.ear];
      if (!prev || msg.peakDb > prev.peakDb) group.screams[msg.ear] = msg;
    }
  }

  /** Finalise a pending group whose window has passed (for manual ticking/tests). */
  function flush(at = now()) {
    if (group && at - group.start >= windowMs) finalize(at);
  }

  return {
    ingest,
    flush,
    connectedEars,
    setGains(g) { gains = { ...g }; },
    getGains() { return { ...gains }; }
  };
}
