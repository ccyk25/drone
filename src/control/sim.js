// Simulation: does GEMA find more survivors, and is it honest about what it missed? Owner: P3.
// Compares, over many random flooded-neighbourhood scenarios:
//   1. Thermal drone, standard grid pattern (today's common practice)
//   2. Ears + thermal, standard grid pattern (effect of adding microphones)
//   3. GEMA: ears + thermal, guided by the trust map (effect of guidance)
// Assumptions (stated on the slide): 4 survivors per run, placed under roofs 50%, in/near water 20%,
// open 20%, trees 10%; survivors call out 30% of seconds; background noise -55..-35 dB; half the runs
// are hot afternoons; 15-minute battery; 15 m/s. Sensor PODs come from CONFIG.sensors / CONFIG.pod.
import { CONFIG } from '../shared/config.js';
import { COVER } from '../shared/cover.js';
import { createGrid, cellCenter, nextWaypoint, applyNegativeScan, applyDetection, applyPointDetection, trustClass } from './search.js';
import { simulateThermal, simulateCallouts, mulberry32 } from './sensorsSim.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const COVER_WEIGHTS = [['roof', 0.5], ['water', 0.2], ['open', 0.2], ['trees', 0.1]];

function placeSurvivors(grid, rng, n) {
  const out = [];
  for (let k = 0; k < n; k++) {
    let r = rng(), type = 'open';
    for (const [t, w] of COVER_WEIGHTS) { if ((r -= w) <= 0) { type = t; break; } }
    let cells = [];
    for (let i = 0; i < grid.n; i++) if (grid.cover[i] === type) cells.push(i);
    if (!cells.length) cells = [...Array(grid.n).keys()];
    const i = cells[Math.floor(rng() * cells.length)];
    const c = cellCenter(grid, i);
    out.push({ id: k, x: c.x + (rng() - 0.5) * grid.cell * 0.8, y: c.y + (rng() - 0.5) * grid.cell * 0.8, cell: i, found: false });
  }
  return out;
}

function lawnmower(grid) {
  const pts = [];
  for (let row = grid.rows - 1; row >= 0; row--) {
    const cols = [...Array(grid.cols).keys()];
    if ((grid.rows - 1 - row) % 2) cols.reverse();
    for (const col of cols) pts.push(cellCenter(grid, row * grid.cols + col));
  }
  return pts;
}

function runOne(strategy, seed, config) {
  const rng = mulberry32(seed);
  const grid = createGrid(config, COVER);
  const survivors = placeSurvivors(grid, rng, 4);
  const noiseDb = -55 + 20 * rng();
  const hotDay = rng() < 0.5;
  const speed = config.drone.speedMps, battery = 900, locateM = 60;
  const ears = strategy !== 'thermal-grid';
  const guided = strategy === 'gema';
  const path = lawnmower(grid);
  let pathIdx = 0;
  let drone = { x: -grid.cols * grid.cell / 2, y: -grid.rows * grid.cell / 2 };
  let target = guided ? cellCenter(grid, nextWaypoint(grid, drone)) : path[0];
  const flownOver = new Set();
  let firstFind = null;
  const srng = mulberry32(seed * 7 + 3);   // sensor randomness (same survivors across strategies)

  for (let t = 1; t <= battery; t++) {
    // move
    const d = dist(drone, target);
    if (d <= speed) {
      drone = { ...target };
      if (guided) target = cellCenter(grid, nextWaypoint(grid, drone));
      else { pathIdx = (pathIdx + 1) % path.length; target = path[pathIdx]; }
    } else {
      drone = { x: drone.x + (target.x - drone.x) * speed / d, y: drone.y + (target.y - drone.y) * speed / d };
    }
    for (let i = 0; i < grid.n; i++) if (dist(drone, cellCenter(grid, i)) <= 25) flownOver.add(i);

    // sense
    const sensors = { thermal: { hotDay } };
    if (ears) sensors.audio = { noiseDb };
    const thermal = simulateThermal(grid, drone, survivors, { hotDay, rng: srng }, config);
    const audio = ears ? simulateCallouts(grid, drone, survivors, { noiseDb, rng: srng }, config) : [];
    applyNegativeScan(grid, drone, sensors, config, 1);
    for (const h of thermal) {
      survivors[h.id].found = true; firstFind ??= t;
      applyPointDetection(grid, h.xy, h.confidence, config);
    }
    for (const a of audio) {
      if (a.distanceM <= locateM) { survivors[a.id].found = true; firstFind ??= t; }
      else if (guided) {
        applyDetection(grid, drone, a.absBearingDeg, a.confidence, config);
        const r = Math.min(a.distanceM, 120);   // fly toward the sound
        target = { x: drone.x + r * Math.sin(a.absBearingDeg * Math.PI / 180), y: drone.y + r * Math.cos(a.absBearingDeg * Math.PI / 180) };
      }
    }
    if (survivors.every((s) => s.found)) break;
  }

  const missed = survivors.filter((s) => !s.found);
  return {
    found: survivors.length - missed.length,
    total: survivors.length,
    firstFind: firstFind ?? battery,
    missed: missed.length,
    missedInFlownOver: missed.filter((s) => flownOver.has(s.cell)).length,            // a naive map would call these "searched"
    missedMarkedCleared: missed.filter((s) => trustClass(grid, s.cell, config) === 'cleared').length  // GEMA's trust map
  };
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

export function runComparison({ runs = 300, seed = 42, config = CONFIG } = {}) {
  const strategies = [
    ['thermal-grid', 'Thermal drone, standard grid'],
    ['ears-grid', 'Ears + thermal, standard grid'],
    ['gema', 'GEMA: ears + thermal, trust-map guided']
  ];
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const results = strategies.map(([key, name]) => {
    const rs = Array.from({ length: runs }, (_, k) => runOne(key, seed + k, config));
    const sum = (f) => rs.reduce((s, r) => s + f(r), 0);
    const missed = sum((r) => r.missed);
    return {
      key, name,
      foundPct: (100 * sum((r) => r.found)) / sum((r) => r.total),
      medianFirstFindS: median(rs.map((r) => r.firstFind)),
      missedFlownOverPct: missed ? (100 * sum((r) => r.missedInFlownOver)) / missed : 0,
      missedMarkedClearedPct: missed ? (100 * sum((r) => r.missedMarkedCleared)) / missed : 0
    };
  });
  const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return { runs, ms: Math.round(ms), results };
}

/** Small bar chart (no library). */
export function renderComparison(el, result) {
  const max = 100;
  el.innerHTML = `<div style="font:14px system-ui;color:#e8eef5">
    <div style="color:#8a96a3;margin-bottom:8px">${result.runs} simulated flood searches per strategy · 4 survivors each · 15-min battery</div>
    ${result.results.map((r) => `
      <div style="margin:10px 0">
        <div style="display:flex;justify-content:space-between"><b>${r.name}</b><span>${r.foundPct.toFixed(0)}% found · first find ${Math.round(r.medianFirstFindS)} s</span></div>
        <div style="height:14px;background:#1b2430;border-radius:7px;overflow:hidden"><i style="display:block;height:100%;width:${(r.foundPct / max) * 100}%;background:${r.key === 'gema' ? '#7c5cff' : '#5b6675'}"></i></div>
        <div style="color:#8a96a3;font-size:12px;margin-top:3px">Of the survivors it missed: ${r.missedFlownOverPct.toFixed(0)}% were in areas it flew over (a naive map says "searched") · trust map marks only ${r.missedMarkedClearedPct.toFixed(0)}% as cleared</div>
      </div>`).join('')}
  </div>`;
}
