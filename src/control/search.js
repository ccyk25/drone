// GEMA trust-map engine: Bayesian search grid fed by any sensor (audio, thermal, camera).
// Owner: P3 (built by P1/Claude). Pure functions only: no DOM, unit-tested.
//
// Coordinates: local metres, origin at the grid centre, x = east, y = north.
// Bearings: degrees clockwise from north (0 = N, 90 = E), same as the drone's heading.
// Cells: index i = row * cols + col, row 0 = north.
//
// Core idea: each cell holds p = probability a survivor is there. When a sensor scans a cell and
// finds nothing, p drops only by that sensor's probability of detection (POD) there. POD depends on
// distance, noise, and what covers the cell: thermal can't see under roofs; ears can hear through gaps.
// So silence in a noisy or covered cell barely lowers p, and the cell stays "NOT CLEARED".
import { CONFIG } from '../shared/config.js';
import { COVER } from '../shared/cover.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const angDiff = (a, b) => ((a - b + 540) % 360) - 180;
export const bearingTo = (from, to) => (Math.atan2(to.x - from.x, to.y - from.y) * 180 / Math.PI + 360) % 360;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function createGrid(config = CONFIG, cover = COVER) {
  const { cols, rows, cellMeters } = config.grid;
  const n = cols * rows;
  const p = new Float64Array(n).fill(1 / n);
  const centers = Array.from({ length: n }, (_, i) => ({
    x: ((i % cols) + 0.5 - cols / 2) * cellMeters, y: (rows / 2 - Math.floor(i / cols) - 0.5) * cellMeters
  }));
  return {
    cols, rows, cell: cellMeters, n, p, centers,
    cumPod: new Float64Array(n),                                   // combined "how well was this cell checked"
    cumBySensor: { audio: new Float64Array(n), thermal: new Float64Array(n), camera: new Float64Array(n) },
    cover: Array.from({ length: n }, (_, i) => cover?.[i] ?? 'open')
  };
}

export function cellCenter(grid, i) {
  if (grid.centers) return grid.centers[i];
  const col = i % grid.cols, row = Math.floor(i / grid.cols);
  return { x: (col + 0.5 - grid.cols / 2) * grid.cell, y: (grid.rows / 2 - row - 0.5) * grid.cell };
}

export function cellAt(grid, x, y) {
  const col = Math.floor(x / grid.cell + grid.cols / 2), row = Math.floor(grid.rows / 2 - y / grid.cell);
  return col < 0 || row < 0 || col >= grid.cols || row >= grid.rows ? -1 : row * grid.cols + col;
}

/** Audio POD vs distance and noise (per second of listening). */
export function podFor(distanceM, noiseDb, config = CONFIG) {
  const c = config.pod;
  if (distanceM > c.hearingRadiusM) return 0;
  const noise = noiseDb ?? c.noiseRefDb;
  return c.max * Math.exp(-distanceM / c.falloffM) * clamp(1 - c.noisePenaltyPerDb * (noise - c.noiseRefDb), 0.05, 1);
}

/** POD for one sensor in one cell (per second). ctx: { distanceM, noiseDb, cover, hotDay } */
export function sensorPod(sensor, { distanceM, noiseDb, cover = 'open', hotDay = false }, config = CONFIG) {
  const s = config.sensors[sensor];
  if (!s) return 0;
  const coverF = s.cover[cover] ?? 1;
  if (sensor === 'audio') return podFor(distanceM, noiseDb, config) * coverF * (s.callProb ?? 1);
  if (distanceM > s.radiusM) return 0;
  const heat = sensor === 'thermal' && hotDay ? s.hotDayFactor : 1;
  return s.max * coverF * heat;
}

function normalise(grid) {
  let sum = 0;
  for (let i = 0; i < grid.n; i++) sum += grid.p[i];
  if (sum <= 0) { grid.p.fill(1 / grid.n); return; }
  for (let i = 0; i < grid.n; i++) grid.p[i] /= sum;
}

/**
 * Nothing detected during the last dtS seconds. sensors: { audio: { noiseDb }, thermal: { hotDay }, camera: {} }
 * (or a number = audio noiseDb, for backward compatibility). Call every tick with the tick length.
 */
export function applyNegativeScan(grid, droneXY, sensors, config = CONFIG, dtS = 1) {
  if (typeof sensors === 'number' || sensors == null) sensors = { audio: { noiseDb: sensors ?? undefined } };
  const list = Object.entries(sensors).filter(([, o]) => o);
  const reach = Math.max(...list.map(([name]) => (name === 'audio' ? config.pod.hearingRadiusM : config.sensors[name]?.radiusM ?? 0)));
  for (let i = 0; i < grid.n; i++) {
    const d = dist(droneXY, cellCenter(grid, i));
    if (d > reach) continue;                                   // no sensor reaches this cell
    let miss = 1;
    for (const [name, opts] of list) {
      const pod1 = sensorPod(name, { distanceM: d, noiseDb: opts.noiseDb, cover: grid.cover[i], hotDay: opts.hotDay }, config);
      const pod = 1 - (1 - pod1) ** dtS;                       // per-second POD scaled to the tick
      if (pod <= 0) continue;
      miss *= 1 - pod;
      grid.cumBySensor[name][i] = 1 - (1 - grid.cumBySensor[name][i]) * (1 - pod);
    }
    const pod = 1 - miss;
    if (pod <= 0) continue;
    grid.p[i] *= 1 - pod;
    grid.cumPod[i] = 1 - (1 - grid.cumPod[i]) * (1 - pod);
  }
  normalise(grid);
}

/** A sound came from absBearingDeg (audio): raise cells along that direction within hearing range. */
export function applyDetection(grid, droneXY, absBearingDeg, confidence, config = CONFIG) {
  const { detectionBoost, bearingSpreadDeg } = config.search;
  for (let i = 0; i < grid.n; i++) {
    const c = cellCenter(grid, i);
    const d = dist(droneXY, c);
    if (d > config.pod.hearingRadiusM + grid.cell) continue;
    const gap = d < grid.cell / 2 ? 0 : angDiff(bearingTo(droneXY, c), absBearingDeg);
    const g = Math.exp(-(gap * gap) / (2 * bearingSpreadDeg ** 2));
    grid.p[i] *= 1 + detectionBoost * confidence * g;
  }
  normalise(grid);
}

/** A sensor saw someone at a position (thermal hotspot or camera): raise cells near that point. */
export function applyPointDetection(grid, xy, confidence, config = CONFIG) {
  const r = config.search.pointDetectionRadiusM;
  for (let i = 0; i < grid.n; i++) {
    const d = dist(xy, cellCenter(grid, i));
    grid.p[i] *= 1 + 3 * config.search.detectionBoost * confidence * Math.exp(-(d * d) / (2 * r * r));
  }
  normalise(grid);
}

/** A family says "last seen here". */
export function applyFamilyReport(grid, i, config = CONFIG) {
  if (i < 0 || i >= grid.n) return;
  grid.p[i] *= config.search.familyReportBoost;
  normalise(grid);
}

/** Best next cell: high probability, not too far. Ties → the less-checked cell. */
export function nextWaypoint(grid, droneXY) {
  let best = 0, bestScore = -Infinity;
  for (let i = 0; i < grid.n; i++) {
    const score = grid.p[i] / (1 + dist(droneXY, cellCenter(grid, i)) / 300) - 1e-9 * grid.cumPod[i];
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}

/** 'cleared' (checked well) · 'uncertain' (looked at, not enough to rule out) · 'unsearched' */
export function trustClass(grid, i, config = CONFIG) {
  const c = grid.cumPod[i];
  if (c >= config.trust.clearedAt) return 'cleared';
  if (c >= 0.05) return 'uncertain';
  return 'unsearched';
}

export function clearedPercent(grid, config = CONFIG) {
  let n = 0;
  for (let i = 0; i < grid.n; i++) if (trustClass(grid, i, config) === 'cleared') n++;
  return (100 * n) / grid.n;
}
