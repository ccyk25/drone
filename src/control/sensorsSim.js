// Simulated sensors for the demo and the simulation. Owner: P3. Pure functions.
//   • Thermal: SIMULATED (we have no thermal camera). Detects a survivor only with line of sight:
//     blocked by roofs, hidden by water, weaker on hot afternoons (CONFIG.sensors.thermal).
//   • Audio callouts: survivors call out now and then. Used for the people layer and the simulation;
//     on stage, real phones replace this.
// survivors: [{ id, x, y }] in local metres (convert lat/lng with the map's projection).
import { CONFIG } from '../shared/config.js';
import { sensorPod, cellAt, bearingTo } from './search.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function mulberry32(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng) {
  return Math.sqrt(-2 * Math.log(rng() + 1e-12)) * Math.cos(2 * Math.PI * rng());
}

/** Thermal hotspots seen this tick: [{ sensor:'thermal', id, xy, confidence }] */
export function simulateThermal(grid, droneXY, survivors, { hotDay = false, dtS = 1, rng = Math.random } = {}, config = CONFIG) {
  const out = [];
  for (const s of survivors) {
    if (s.found) continue;
    const i = cellAt(grid, s.x, s.y);
    const pod1 = sensorPod('thermal', { distanceM: dist(droneXY, s), cover: grid.cover[i] ?? 'open', hotDay }, config);
    if (pod1 > 0 && rng() < 1 - (1 - pod1) ** dtS) {
      out.push({ sensor: 'thermal', id: s.id, xy: { x: s.x + 5 * gauss(rng), y: s.y + 5 * gauss(rng) }, confidence: 0.8 });
    }
  }
  return out;
}

/** Survivors calling out, heard by the drone's ears: [{ sensor:'audio', id, absBearingDeg, confidence, distanceM }] */
export function simulateCallouts(grid, droneXY, survivors, { noiseDb, bearingErrDeg = 12, dtS = 1, rng = Math.random } = {}, config = CONFIG) {
  const out = [];
  for (const s of survivors) {
    if (s.found) continue;
    const i = cellAt(grid, s.x, s.y);
    const d = dist(droneXY, s);
    const pod1 = sensorPod('audio', { distanceM: d, noiseDb, cover: grid.cover[i] ?? 'open' }, config);   // includes the call probability
    if (pod1 > 0 && rng() < 1 - (1 - pod1) ** dtS) {
      out.push({ sensor: 'audio', id: s.id, absBearingDeg: (bearingTo(droneXY, s) + bearingErrDeg * gauss(rng) + 360) % 360, confidence: 0.8, distanceM: d });
    }
  }
  return out;
}
