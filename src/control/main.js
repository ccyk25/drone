// main.js (P2): control-screen loop. Wires map, drone, noise, UI to P1's channel/fusion and P3's search engine.
//
// MOCKS=true  → use the tiny local mocks below for channel / fusion / search / scenario.
// MOCKS=false → use the real modules (src/realtime/channel.js, src/control/fusion.js, src/control/search.js, ...).
//               Any module or function that is missing still falls back to its mock, so the page never dies.
// URL override: ?mocks=0 or ?mocks=1
//
// Frame used everywhere: x = metres east, y = metres north (the engine's frame; whatever origin
// search.js uses, the grid is centred on CONFIG.map.center). headingDeg 0 = north, clockwise.

import { createMap, setOrigin, xyToLatLng, latLngToXY } from './map.js';
import { createDrone, bearingTo, wrapDeg } from './drone.js';
import { startRotorNoise, stopRotorNoise, setRotorVolume } from './noise.js';
import { createUI } from './ui.js';
import { createOps } from './ops.js';
import { createResponder } from './response.js';
import { createConnect } from './connect.js';   // P1: Connect-the-drone sheet + live Drone camera window   // P1: camera → heat → voice → confirm → speaker + flag

const urlParams = new URLSearchParams(location.search);
export const MOCKS = urlParams.has('mocks') ? urlParams.get('mocks') !== '0' : false;   // real modules have landed; ?mocks=1 to force mocks

// ---- timing knobs (P2-only; not in config.js) ----
const SCAN_EVERY_MS = 1000;   // negative scan = one "listen" per simulated second
const CALL_EVERY_MS = 1000;   // every hidden survivor gets a chance to call each simulated second (matches the engine's callProb)   // a hidden survivor tries to call out this often
const PIN_MERGE_MS = 1500;    // detections closer together than this re-use the investigation
const EST_RANGE_FRAC = 0.5;   // pin placed at this fraction of hearing radius along the bearing
const FOUND_PIN_M = 50, FOUND_PASS_M = 30;

// ---------------------------------------------------------------------------------------------
// Module loading: Vite's import.meta.glob returns {} for files that don't exist yet (no build error).
// Outside Vite (plain static server) the call throws and we fall back to mocks.
function tryGlob(fn) { try { return Object.values(fn())[0] || null; } catch { return null; } }
const realConfig = tryGlob(() => import.meta.glob('../shared/config.js', { eager: true }));
const realProtocol = tryGlob(() => import.meta.glob('../shared/protocol.js', { eager: true }));
const realChannel = tryGlob(() => import.meta.glob('../realtime/channel.js', { eager: true }));
const realFusion = tryGlob(() => import.meta.glob('./fusion.js', { eager: true }));
const realSearch = tryGlob(() => import.meta.glob('./search.js', { eager: true }));
const realScenario = tryGlob(() => import.meta.glob('../shared/scenario.js', { eager: true }));
const realCalib = tryGlob(() => import.meta.glob('../ear/calibrate.js', { eager: true }));

const FALLBACK_CONFIG = {
  map: { center: [3.0190, 101.5370], zoom: 17 },
  grid: { cols: 12, rows: 8, cellMeters: 50 },
  roomToMapScale: 25,
  ears: { L: -45, C: 0, R: 45 },
  audio: { frameSize: 2048, bandLowHz: 1000, bandHighHz: 4000 },
  scream: { minAboveFloorDb: 15, minBandRatio: 0.45, minDurationMs: 300, cooldownMs: 1500 },
  fusion: { windowMs: 600 },
  pod: { max: 0.9, hearingRadiusM: 150, falloffM: 60, noiseRefDb: -50, noisePenaltyPerDb: 0.03 },
  search: { detectionBoost: 6, bearingSpreadDeg: 25, familyReportBoost: 4 },
  drone: { speedMps: 15, turnRateDegPerS: 90, tickMs: 100 },
  trust: { clearedAt: 0.8, uncertainAt: 0.3 },
};
const BASE_CONFIG = realConfig?.CONFIG || realConfig?.default || FALLBACK_CONFIG;

// ---- disaster scenarios (P2 sim layer) ----
// Each scenario has one or more REAL post-disaster sites (aerial/satellite imagery taken days after the event).
// Survivors are simulated ground truth, placed as fractions (fx, fy in -0.5..0.5) of the search area,
// so they stay inside whatever area the operator draws. Acoustic overrides go onto a COPY of the shared config.
const NOAA = 'Post-event imagery: <a href="https://storms.ngs.noaa.gov/">NOAA NGS Emergency Response</a>';
const MAXAR = 'Post-event imagery: <a href="https://www.maxar.com/open-data">Maxar Open Data</a> via <a href="https://openaerialmap.org/">OpenAerialMap</a> (CC BY-NC 4.0)';
const SCENARIOS = {
  flood: {
    ambientDb: -54,                 // rain + moving water when no phone reports a floor
    pod: { hearingRadiusM: 150 },   // voices carry over open water
    sites: [
      { id: 'grandisle', name: 'Grand Isle, Louisiana', event: 'Hurricane Ida · 31 Aug 2021', center: [29.2365, -89.9990],
        imagery: { url: 'https://stormscdn.ngs.noaa.gov/20210831a-rgb/{z}/{x}/{y}', attribution: NOAA, maxNativeZoom: 19 } },
    ],
    survivors: [
      { id: 'f1', label: 'Family on raised camp house', fx: -0.35, fy: 0.3 },
      { id: 'f2', label: 'Man in attic, cut through roof', fx: 0.27, fy: 0.35 },
      { id: 'f3', label: 'Child on pickup roof', fx: 0.4, fy: -0.38 },
      { id: 'f4', label: 'Elderly woman, 2nd floor', fx: -0.1, fy: -0.42 },
      { id: 'f5', label: 'Teen on water tank', fx: 0.07, fy: 0.08 },
    ],
  },
  collapse: {
    ambientDb: -62,                                      // streets go quiet after the shaking
    pod: { hearingRadiusM: 100, max: 0.85, falloffM: 35 }, // debris muffles trapped voices: only close passes can clear a cell
    sites: [
      { id: 'antakya', name: 'Antakya, Türkiye', event: 'Earthquake · imaged 8 Feb 2023', center: [36.2045, 36.1585],
        imagery: { url: 'https://tiles.openaerialmap.org/63ec9ccaca43600005f4d968/0/63ec9ccaca43600005f4d969/{z}/{x}/{y}', attribution: MAXAR, maxNativeZoom: 18 } },
      { id: 'fortmyers', name: 'Fort Myers Beach, Florida', event: 'Hurricane Ian · 30 Sep 2022', center: [26.4505, -81.9470],
        imagery: { url: 'https://stormscdn.ngs.noaa.gov/20220930d-rgb/{z}/{x}/{y}', attribution: NOAA, maxNativeZoom: 19 } },
    ],
    survivors: [
      { id: 'c1', label: 'Shopkeeper under slab', fx: -0.3, fy: 0.22 },
      { id: 'c2', label: 'Mother & baby (stairwell void)', fx: 0.2, fy: 0.4 },
      { id: 'c3', label: 'Student in collapsed classroom', fx: 0.37, fy: -0.3 },
      { id: 'c4', label: 'Elderly woman (kitchen void)', fx: -0.15, fy: -0.37 },
      { id: 'c5', label: 'Worker pinned by beam', fx: 0.05, fy: 0.05 },
    ],
  },
};
const siteOf = (scn, siteId) => SCENARIOS[scn].sites.find(s => s.id === siteId) || SCENARIOS[scn].sites[0];
let scenarioId = SCENARIOS[urlParams.get('scenario')] ? urlParams.get('scenario') : 'flood';
let site = siteOf(scenarioId, urlParams.get('site'));
const withScenario = (id, st) => {
  const c = JSON.parse(JSON.stringify(BASE_CONFIG));
  Object.assign(c.pod, SCENARIOS[id].pod);
  c.map.center = st.center.slice();
  return c;
};
let CONFIG = withScenario(scenarioId, site);
const ALTITUDE_M = 60;   // simulated flight altitude, display only

// ---- the swarm: 5 drones share one probability map, each searches its own operating area ----
// Fleet mode: 'single' (default, for the live demo) or 'swarm' (5 drones). Toggle on the map or ?fleet=swarm.
let fleetMode = new URLSearchParams(location.search).get('fleet') === 'swarm' ? 'swarm' : 'single';
const SWARM = [
  { id: 'D1', color: '#5fd0ff' }, { id: 'D2', color: '#ff7ad9' }, { id: 'D3', color: '#ffd84a' },
  { id: 'D4', color: '#a98bff' }, { id: 'D5', color: '#ff8a3d' },
];
const FLEET = () => (fleetMode === 'swarm' ? SWARM : SWARM.slice(0, 1));

// =============================================================================================
// MOCKS: tiny stand-ins, same interfaces as HANDOVER §8.3. Delete once the real modules land.
// =============================================================================================
const mock = {};

mock.search = (() => {
  function createGrid(config) {
    const { cols, rows, cellMeters } = config.grid;
    const n = cols * rows, centers = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++)
      centers.push({ x: (c - cols / 2 + 0.5) * cellMeters, y: (rows / 2 - r - 0.5) * cellMeters });
    return { cols, rows, cellMeters, centers, p: new Array(n).fill(1 / n), cumPod: new Array(n).fill(0) };
  }
  const cellCenter = (grid, i) => grid.centers[i];
  function podFor(d, noiseDb, config) {
    const { max, hearingRadiusM, falloffM, noiseRefDb, noisePenaltyPerDb } = config.pod;
    if (d > hearingRadiusM) return 0;
    const dist = max * Math.exp(-Math.max(0, d - 25) / (falloffM * 1.5));
    const noise = Math.max(0, 1 - noisePenaltyPerDb * Math.max(0, noiseDb - noiseRefDb));
    return Math.max(0, Math.min(1, dist * noise));
  }
  const normalise = g => { const s = g.p.reduce((a, b) => a + b, 0) || 1; g.p = g.p.map(v => v / s); };
  function applyNegativeScan(grid, xy, noiseDb, config) {
    grid.centers.forEach((c, i) => {
      const pod = podFor(Math.hypot(c.x - xy.x, c.y - xy.y), noiseDb, config);
      if (pod <= 0) return;
      // repeated looks under the same conditions are correlated, so coverage = best single look
      // (10 noisy passes must NOT add up to "cleared")
      const old = grid.cumPod[i], neu = Math.max(old, pod);
      if (neu <= old) return;
      grid.p[i] *= (1 - neu) / (1 - old);
      grid.cumPod[i] = neu;
    });
    normalise(grid);
  }
  function applyDetection(grid, xy, absBearingDeg, confidence, config) {
    const { detectionBoost, bearingSpreadDeg } = config.search;
    grid.centers.forEach((c, i) => {
      const d = Math.hypot(c.x - xy.x, c.y - xy.y);
      if (d > config.pod.hearingRadiusM * 1.4) return;
      const off = Math.abs(((Math.atan2(c.x - xy.x, c.y - xy.y) * 180 / Math.PI - absBearingDeg + 540) % 360) - 180);
      const w = Math.exp(-0.5 * (off / bearingSpreadDeg) ** 2);
      grid.p[i] *= 1 + (detectionBoost - 1) * confidence * w;
      if (w > 0.3) grid.cumPod[i] = Math.min(grid.cumPod[i], config.trust.uncertainAt); // heard voice → not cleared
    });
    normalise(grid);
  }
  function applyFamilyReport(grid, i, config) { grid.p[i] *= config.search.familyReportBoost; grid.cumPod[i] = 0; normalise(grid); }
  function nextWaypoint(grid, xy) {
    let best = 0, bestScore = -1;
    grid.centers.forEach((c, i) => {
      const s = grid.p[i] / (1 + Math.hypot(c.x - xy.x, c.y - xy.y) / 300);
      if (s > bestScore) { bestScore = s; best = i; }
    });
    return best;
  }
  function trustClass(grid, i, config) {
    const q = grid.cumPod[i];
    return q >= config.trust.clearedAt ? 'cleared' : q >= config.trust.uncertainAt ? 'uncertain' : 'unsearched';
  }
  return { createGrid, cellCenter, podFor, applyNegativeScan, applyDetection, applyFamilyReport, nextWaypoint, trustClass };
})();

mock.channel = {
  joinRoom(room, { onMessage }) {
    let bc = null, status = 'local';
    try { bc = new BroadcastChannel(`gema-room-${room}`); bc.onmessage = e => onMessage(e.data); } catch { status = 'none'; }
    return { send: msg => bc?.postMessage(msg), close: () => bc?.close(), status: () => status };
  },
};

mock.fusion = {
  createFusion(config, { onDetection }) {
    let buf = [], timer = null;
    const connected = new Set();
    function flush() {
      timer = null;
      const byEar = {};
      for (const m of buf) if (!byEar[m.ear] || m.peakDb > byEar[m.ear].peakDb) byEar[m.ear] = m;
      buf = [];
      const heard = Object.values(byEar).sort((a, b) => b.peakDb - a.peakDb);
      if (!heard.length) return;
      const maxConf = Math.max(...heard.map(h => h.confidence ?? 0.7));
      let rel = 0, conf;
      if (connected.size <= 1) { conf = maxConf / 2; }
      else {
        let sw = 0;
        for (const h of heard) { const a = 10 ** (h.peakDb / 20); rel += (config.ears[h.ear] ?? 0) * a; sw += a; }
        rel /= sw || 1;
        const gap = heard.length > 1 ? heard[0].peakDb - heard[1].peakDb : 10;
        conf = maxConf * Math.max(0.3, Math.min(1, gap / 10));
      }
      onDetection({ type: 'detection', t: Date.now(), relBearingDeg: rel, confidence: conf, ears: heard.map(h => h.ear) });
    }
    return {
      ingest(msg) {
        if (msg.ear) connected.add(msg.ear);
        if (msg.type !== 'scream') return;
        buf.push(msg);
        if (!timer) timer = setTimeout(flush, config.fusion.windowMs);
      },
    };
  },
};

mock.computeGains = peaks => { // dB to add to each ear so all read the clap equally
  const vals = Object.values(peaks); const ref = Math.max(...vals);
  return Object.fromEntries(Object.entries(peaks).map(([e, v]) => [e, +(ref - v).toFixed(1)]));
};

// ---- pick real vs mock ----
const pickFns = (real, mk, names) => {
  if (MOCKS || !real) return mk;
  const out = {};
  for (const n of names) out[n] = typeof real[n] === 'function' ? real[n] : (console.warn(`[gema] ${n} missing → mock`), mk[n]);
  return out;
};
const S = pickFns(realSearch, mock.search,
  ['createGrid', 'cellCenter', 'podFor', 'applyNegativeScan', 'applyDetection', 'applyFamilyReport', 'nextWaypoint', 'trustClass']);
const CH = pickFns(realChannel, mock.channel, ['joinRoom']);
const FU = pickFns(realFusion, mock.fusion, ['createFusion']);
const computeGains = (!MOCKS && (realCalib?.computeGains || realFusion?.computeGains)) || mock.computeGains;
const validate = realProtocol?.validate || (m => !!m && typeof m === 'object' && typeof m.type === 'string');
const scenarioList = (!MOCKS && [realScenario?.SURVIVORS, realScenario?.default].find((l) => Array.isArray(l) && l.length)) || null;   // empty list → keep P2's scenario people

// ---- small adapters (tolerate slightly different return shapes from search.js) ----
const toXY = v => Array.isArray(v) ? { x: v[0], y: v[1] } : { x: v.x, y: v.y };
// ---- one search grid per drone ----
// Each drone owns its own engine grid (its operating area), which can sit anywhere on the map.
// Local frame: (0,0) = centre of the mission area. Engine grids use their own origin, so each area keeps
// an offset: local = engine + off.
const MAX_CELLS_SIDE = 40;
const DEFAULT_BOX_M = 250;     // a plain click (no drag) drops a square this size
function makeArea(b) {          // b = { x0, y0, x1, y1 } in local metres
  const wM = b.x1 - b.x0, hM = b.y1 - b.y0, base = BASE_CONFIG.grid.cellMeters;
  const cell = Math.max(base, Math.ceil(Math.max(wM, hM) / MAX_CELLS_SIDE / 10) * 10);
  const cols = Math.max(2, Math.round(wM / cell)), rows = Math.max(2, Math.round(hM / cell));
  const cfg = { ...CONFIG, grid: { ...CONFIG.grid, cols, rows, cellMeters: cell } };
  const grid = S.createGrid(cfg, null), n = cols * rows;   // null cover: the shared cover map only fits the default grid
  const ec = Array.from({ length: n }, (_, i) => toXY(S.cellCenter(grid, i)));
  const mx = ec.reduce((a, c) => a + c.x, 0) / n, my = ec.reduce((a, c) => a + c.y, 0) / n;
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, off = { x: cx - mx, y: cy - my };
  return {
    cfg, grid, n, cell, off, centers: ec.map(c => ({ x: c.x + off.x, y: c.y + off.y })),
    bounds: { x0: cx - (cols * cell) / 2, x1: cx + (cols * cell) / 2, y0: cy - (rows * cell) / 2, y1: cy + (rows * cell) / 2 },
  };
}
const toEngine = (a, xy) => ({ x: xy.x - a.off.x, y: xy.y - a.off.y });
function probsOf(a) {
  const g = a.grid, arr = g.p || g.probs || g.prob || (g.cells && g.cells.map(c => c.p));
  return arr ? Array.from(arr) : new Array(a.n).fill(1 / a.n);
}
const trustOf = a => Array.from({ length: a.n }, (_, i) => S.trustClass(a.grid, i, a.cfg));
// what one drone hears (or doesn't) counts for every grid it is near, so overlapping areas stay in sync
function scanAll(xy, noiseDb) { for (const d of fleet) S.applyNegativeScan(d.area.grid, toEngine(d.area, xy), noiseDb, d.area.cfg); }
function detectAll(xy, absDeg, conf) { for (const d of fleet) S.applyDetection(d.area.grid, toEngine(d.area, xy), absDeg, conf, d.area.cfg); }

// Next waypoint for one drone: the most promising cell of ITS OWN area (probability discounted by distance),
// skipping cells it just visited. Same scoring as the engine's nextWaypoint, limited to the drone's area.
function waypointFor(d) {
  const a = d.area, p = probsOf(a), xy = d.drone.state;
  const pickFrom = strict => {
    let best = -1, bs = -1;
    for (let i = 0; i < a.n; i++) {
      const c = a.centers[i], dist = Math.hypot(c.x - xy.x, c.y - xy.y);
      if (dist < 10 || (strict && d.recent.includes(i))) continue;
      const s = p[i] / (1 + dist / 300);
      if (s > bs) { bs = s; best = i; }
    }
    return best;
  };
  let best = pickFrom(true);
  if (best < 0) best = pickFrom(false);
  if (best < 0) return null;
  d.recent.push(best); if (d.recent.length > 4) d.recent.shift();
  return { i: best, ...a.centers[best], p: p[best] };
}

// Default areas: the selected mission area is tiled into compact, near-square sectors, one per drone
// (e.g. 5 drones on a wide area → 3 sectors on top, 2 below), snapped to whole cells so every sector
// stays inside the area the operator drew and no two sectors overlap. Single mode: one drone, whole area.
function defaultAreas() {
  const { cols, rows, cellMeters: cell } = CONFIG.grid, K = FLEET().length;
  const W = cols * cell, H = rows * cell;
  if (K === 1) return [makeArea({ x0: -W / 2, y0: -H / 2, x1: W / 2, y1: H / 2 })];
  // pick the number of sector rows that makes sectors closest to square (each sector ≥ 2×2 cells if possible)
  let best = null;
  for (let r = 1; r <= Math.min(K, rows); r++) {
    const per = Array.from({ length: r }, (_, i) => Math.floor(K / r) + (i < K % r ? 1 : 0));
    const th = H / r;
    const worst = Math.max(...per.map(c => { const tw = W / c; return Math.max(tw / th, th / tw); }));
    const fits = per.every(c => cols / c >= 2) && rows / r >= 2;
    const score = worst + (fits ? 0 : 100);
    if (!best || score < best.score) best = { r, per, score };
  }
  const areas = [];
  const rowCut = i => Math.round((i * rows) / best.r);            // sector rows, in cells, top → bottom
  for (let i = 0; i < best.r; i++) {
    const ya = rowCut(i), yb = rowCut(i + 1), c = best.per[i];
    for (let j = 0; j < c; j++) {
      const xa = Math.round((j * cols) / c), xb = Math.round(((j + 1) * cols) / c);
      areas.push(makeArea({ x0: -W / 2 + xa * cell, x1: -W / 2 + xb * cell, y1: H / 2 - ya * cell, y0: H / 2 - yb * cell }));
    }
  }
  return areas;
}

// =============================================================================================
// Setup
// =============================================================================================
const ROOM = (urlParams.get('room') || Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.random() * 24 | 0]).join('')).toUpperCase();
if (!urlParams.get('room')) { urlParams.set('room', ROOM); history.replaceState(null, '', `${location.pathname}?${urlParams}`); }

const view = createMap('map', CONFIG);
const ui = createUI(document.getElementById('hud'), {
  room: ROOM,
  scenario: scenarioId,
  site: site.id,
  sites: Object.fromEntries(Object.entries(SCENARIOS).map(([k, v]) => [k, v.sites.map(({ id, name, event }) => ({ id, name, event }))])),
  earUrl: ear => new URL(`ear.html?room=${ROOM}&ear=${ear}${ear === 'C' ? '&mode=eyes' : ''}`, location.href).href,   // C = camera phone (eyes mode)
  handlers: {
    onStart: () => { running = !running; ui.setStarted(running); if (running && t0Sim == null) t0Sim = simMs; ui.log(running ? 'Search started' : 'Paused'); },
    onReset: () => reset(),
    onSimScream: ear => {
      ui.log(`Simulated scream on <b>${sel().id}</b> ear <b>${ear}</b>`, 'sim');
      handleDetection({ type: 'detection', t: Date.now(), relBearingDeg: CONFIG.ears[ear] ?? 0, confidence: ear === 'C' ? 0.7 : 0.8, ears: [ear], source: 'sim' });
    },
    onRotor: on => {
      rotorOn = on;
      on ? startRotorNoise() : stopRotorNoise();
      redrawGrid();
      ui.log(on ? 'Rotor noise <b>ON</b>: silence now proves less' : 'Rotor noise OFF', on ? 'warn' : '');
    },
    onVolume: v => setRotorVolume(v),
    onHeatmap: on => { view.setHeatmap(on); redrawGrid(); },
    onFollow: on => view.setFollow(on),
    onReveal: on => { reveal = on; view.updateSurvivors(survivors, reveal); },
    onSpeed: x => { speed = x; },
    onFamilyMode: on => { familyMode = on; if (on) ui.log('Click the map where the person was last seen'); },
    onCalibrate: () => calibrate(),
    onScenario: (id, siteId) => {
      scenarioId = id;
      site = siteOf(id, siteId);
      CONFIG = withScenario(id, site);
      urlParams.set('scenario', id); urlParams.set('site', site.id);
      history.replaceState(null, '', `${location.pathname}?${urlParams}`);
      applySite();
      reset();
      ui.log(`Scenario: <b>${id === 'flood' ? 'Flood' : 'Collapsed buildings'}</b> · ${site.name} (${site.event}) · hearing radius ${CONFIG.pod.hearingRadiusM} m`, 'warn');
    },
    onTab: tab => setTab(tab),
    onSelectArea: on => {
      cancelSelect?.(); cancelSelect = null;
      if (!on) return;
      if (familyMode) { familyMode = false; ui.setFamilyMode(false); }
      ui.log('Drag a rectangle on the map to set the search area (resets all drone areas)', 'warn');
      cancelSelect = view.startAreaSelect(bounds => { cancelSelect = null; ui.setSelecting(false); setSearchArea(bounds); });
    },
    // ---- swarm ----
    onSelectDrone: id => selectDrone(id),
    onDroneArea: on => {
      cancelSelect?.(); cancelSelect = null; placeQueue = [];
      if (!on) return;
      if (familyMode) { familyMode = false; ui.setFamilyMode(false); }
      askArea(sel());
    },
    onPlaceAll: () => {
      cancelSelect?.(); cancelSelect = null;
      if (familyMode) { familyMode = false; ui.setFamilyMode(false); }
      placeQueue = fleet.map(d => d.id);
      ui.log('Place all 5: click (or drag a box) where each drone should search, D1 → D5. Esc to stop.', 'warn');
      nextPlacement();
    },
    onDroneHold: () => toggleHold(sel()),
    onDroneLand: () => toggleLand(sel()),
  },
});

let running = false, rotorOn = false, reveal = false, familyMode = false, speed = 2;
let simMs = 0, t0Sim = null, firstDetMs = null, scanAcc = 0, callAcc = 0, lastDetAt = -1e9;
let survivors = [], cancelSelect = null, placeQueue = [], mission = null, basePad = null;
// each drone: { id, color, drone, slot (landing spot), area (its own grid), current, recent, status, speedKmh, lastPos }
// status: 'active' (searching / investigating) · 'hold' (hovering, still listening) · 'rtb' (returning to land) · 'landed'
let fleet = [], selId = SWARM[0].id;
const sel = () => fleet.find(d => d.id === selId) || fleet[0];
const ears = {}; // ear → { db, floorDb, last, screamUntil }

function applySite() {
  ui.setScenario(scenarioId, site.id);
  view.setImagery(site.imagery);
  ui.setSite(site);
}

// Operator-drawn mission area -> grid size, cell size and centre (then split into 5 drone areas).
function setSearchArea(bounds) {
  const c = bounds.getCenter();
  const k = 111320 * Math.cos(c.lat * Math.PI / 180);
  const wM = (bounds.getEast() - bounds.getWest()) * k, hM = (bounds.getNorth() - bounds.getSouth()) * 111320;
  if (wM < 60 || hM < 60) { ui.log('Area too small: drag at least 60 m × 60 m', 'warn'); return; }
  const base = BASE_CONFIG.grid.cellMeters;
  const cell = Math.max(base, Math.ceil(Math.max(wM, hM) / MAX_CELLS_SIDE / 10) * 10);
  CONFIG.grid = { ...CONFIG.grid, cellMeters: cell, cols: Math.max(2, Math.round(wM / cell)), rows: Math.max(2, Math.round(hM / cell)) };
  CONFIG.map.center = [c.lat, c.lng];
  reset();
  const km2 = (CONFIG.grid.cols * CONFIG.grid.rows * cell * cell) / 1e6;
  ui.log(`Search area set: ${(CONFIG.grid.cols * cell / 1000).toFixed(2)} × ${(CONFIG.grid.rows * cell / 1000).toFixed(2)} km (${km2.toFixed(2)} km²) · ${cell} m cells`, 'family');
}

function reset() {
  setOrigin(CONFIG.map.center);                                       // local (0,0) = centre of the mission area
  const W = CONFIG.grid.cols * CONFIG.grid.cellMeters, H = CONFIG.grid.rows * CONFIG.grid.cellMeters;
  mission = { x0: -W / 2, y0: -H / 2, x1: W / 2, y1: H / 2 };
  basePad = { x: 0, y: -H / 2 - CONFIG.grid.cellMeters };             // launch & landing pad, just south of the mission
  const areas = defaultAreas();
  fleet = FLEET().map((s, k) => {
    const slot = { x: basePad.x + (k - (FLEET().length - 1) / 2) * 16, y: basePad.y };
    return { ...s, slot, drone: createDrone(CONFIG, { ...slot, headingDeg: 0 }), area: areas[k], current: null, recent: [],
      status: 'active', speedKmh: 0, lastPos: null };
  });
  view.setFleet(fleet.map(({ id, color }) => ({ id, color })));
  view.setBase(basePad);
  resetLifter();
  view.setMission(mission);
  rebuildGrids();
  view.fitToHud(view.boundsOf(mission));
  survivors = (scenarioList || SCENARIOS[scenarioId].survivors).map((s, k) => {
    const xy = s.lat != null ? latLngToXY([s.lat, s.lng]) : s.fx != null ? { x: s.fx * W, y: s.fy * H }
      : s.dx != null ? { x: s.dx, y: s.dy } : { x: s.x, y: s.y };
    return { id: s.id || `s${k + 1}`, label: s.label || s.name || `Survivor ${k + 1}`, ...xy, found: false, rescued: false };
  });
  simMs = 0; t0Sim = null; firstDetMs = null; scanAcc = 0; callAcc = 0; lastDetAt = -1e9;
  findQueue = []; lastFoundAt = -1e9;
  running = false; ui.setStarted(false);
  view.resetTrail();
  view.updateSurvivors(survivors, reveal);
  redrawGrid(); redrawDrones();
  ui.setArea({ cols: CONFIG.grid.cols, rows: CONFIG.grid.rows, cellM: CONFIG.grid.cellMeters });
  ui.log(`Mission ${CONFIG.grid.cols}×${CONFIG.grid.rows} cells · ${fleet.length} search drones + rescue drone R1 · room ${ROOM} · ${MOCKS ? 'MOCK engine' : 'live engine'}`);
}

// ---- swarm controls ----
function rebuildGrids() {
  view.buildGrids(fleet.map(d => ({ key: d.id, color: d.color, centers: d.area.centers, cellMeters: d.area.cell })));
  drawSectors();
}
function drawSectors() { view.setSectors(fleet.map(d => ({ id: d.id, color: d.color, ...d.area.bounds })), selId); }

function selectDrone(id) {
  if (!fleet.some(d => d.id === id)) return;
  selId = id;
  drawSectors(); redrawDrones(); pushSwarmUi();
}

function askArea(d) {
  ui.setDroneSelecting(true);
  ui.log(`<b>${d.id}</b>: click the map for a ${DEFAULT_BOX_M} m square, or drag a box of any size`, 'warn');
  cancelSelect = view.startAreaSelect(bounds => {
    cancelSelect = null; ui.setDroneSelecting(false);
    setDroneArea(d, bounds);
    nextPlacement();
  });
}
// "Place all 5": select each drone in turn and ask for its box
function nextPlacement() {
  const id = placeQueue.shift();
  if (!id) return;
  selectDrone(id);
  askArea(sel());
}

// operator clicks / drags a box anywhere: that drone gets its own new grid there
function setDroneArea(d, bounds) {
  const sw = latLngToXY(bounds.getSouthWest()), ne = latLngToXY(bounds.getNorthEast());
  let b = { x0: sw.x, y0: sw.y, x1: ne.x, y1: ne.y };
  if (b.x1 - b.x0 < 40 && b.y1 - b.y0 < 40) {                       // a click, not a drag: square centred on it
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, h = DEFAULT_BOX_M / 2;
    b = { x0: cx - h, y0: cy - h, x1: cx + h, y1: cy + h };
  }
  d.area = makeArea(b);
  d.recent.length = 0;
  if (fleet.length === 1) { placeSurvivors(d.area.bounds); ui.log('Simulated survivors placed inside the new search area', 'muted'); }
  if (d.status === 'active' && d.drone.state.mode !== 'investigate') { d.current = null; d.drone.setTarget(null); }
  rebuildGrids(); redrawGrid();
  const { cols, rows, cellMeters } = d.area.cfg.grid;
  ui.log(`<b>${d.id}</b> area set: ${cols * cellMeters} × ${rows * cellMeters} m (${cols * rows} cells)`, 'area');
}

function toggleHold(d) {
  if (d.status === 'landed' || d.status === 'rtb') return ui.log(`<b>${d.id}</b> is landing: launch it first`, 'warn');
  if (d.status === 'hold') { d.status = 'active'; d.current = null; ui.log(`<b>${d.id}</b> resumed searching`); }
  else { d.status = 'hold'; d.current = null; d.drone.setTarget(null); ui.log(`<b>${d.id}</b> holding position · still listening`, 'warn'); }
  pushSwarmUi(); redrawDrones();
}

function toggleLand(d) {
  if (d.status === 'landed' || d.status === 'rtb') {
    d.status = 'active'; d.current = null; d.drone.setTarget(null);
    ui.log(`<b>${d.id}</b> launched · back to its area`);
  } else {
    d.status = 'rtb'; d.current = null; d.drone.setTarget(d.slot, 'rtb');
    ui.log(`<b>${d.id}</b> returning to base to land`, 'warn');
    if (!running) ui.log('Press Start search to fly it home', 'muted');
  }
  pushSwarmUi(); redrawDrones();
}

function statusText(d) {
  if (d.status === 'landed') return 'Landed';
  if (d.status === 'rtb') return 'Returning';
  if (d.status === 'hold') return 'Holding';
  return d.drone.state.mode === 'investigate' ? 'Investigating' : running ? 'Searching' : 'Ready';
}
function pushSwarmUi() {
  const s = sel();
  ui.setSwarm(fleet.map(d => ({
    id: d.id, color: d.color, status: d.status, label: statusText(d), clearedPct: d.clearedPct || 0,
  })), selId, { hold: s.status === 'hold', grounded: s.status === 'landed' || s.status === 'rtb' }, lifterUi());
}

// ---- survivors live inside the area being searched; drones only detect inside their own area ----
function placeSurvivors(b) {                       // b = { x0, y0, x1, y1 } local metres
  const w = b.x1 - b.x0, h = b.y1 - b.y0, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  survivors = (scenarioList || SCENARIOS[scenarioId].survivors).map((s, k) => {
    const xy = s.lat != null ? latLngToXY([s.lat, s.lng]) : s.fx != null ? { x: cx + s.fx * w, y: cy + s.fy * h }
      : s.dx != null ? { x: cx + s.dx, y: cy + s.dy } : { x: s.x, y: s.y };
    return { id: s.id || `s${k + 1}`, label: s.label || s.name || `Survivor ${k + 1}`, ...xy, found: false, rescued: false };
  });
  findQueue = []; lastFoundAt = -1e9;
  view.updateSurvivors(survivors, reveal);
}
function inOwnArea(d, xy, margin = 25) {
  const b = d.area?.bounds;
  return !!b && xy.x >= b.x0 - margin && xy.x <= b.x1 + margin && xy.y >= b.y0 - margin && xy.y <= b.y1 + margin;
}

// ---- noise floor the engine should assume ----
function currentNoiseDb() {
  const now = Date.now();
  const live = Object.values(ears).filter(e => now - e.last < 3000 && e.floorDb != null);
  if (live.length) return live.reduce((a, e) => a + e.floorDb, 0) / live.length;
  return rotorOn ? -35 : SCENARIOS[scenarioId].ambientDb;
}

// ---- detections ----
// det comes from drone d (default: the selected drone, which carries the phone ears / sim buttons)
function handleDetection(det, d = sel()) {
  if (det.source !== 'survivor') {                     // real phones (camera / mic) and the simulate buttons → P1's live response
    if (!responder.busy()) respD = sel();              // the selected drone flies the response
    d = respD;
    if (d.status === 'landed' || d.status === 'rtb') { ui.log(`<b>${d.id}</b> is on the ground: select a flying drone to respond`, 'warn'); return; }
    if (!running) { running = true; ui.setStarted(true); if (t0Sim == null) t0Sim = simMs; }
    if (firstDetMs == null && t0Sim != null) firstDetMs = simMs - t0Sim;
    responder.onDetection(det, performance.now());
    redrawGrid();
    return;
  }
  if (d.status === 'landed' || d.status === 'rtb') return;
  const drone = d.drone;
  const xy = { x: drone.state.x, y: drone.state.y };
  const abs = wrapDeg(drone.state.headingDeg + det.relBearingDeg);
  detectAll(xy, abs, det.confidence);
  const R = CONFIG.pod.hearingRadiusM, r = abs * Math.PI / 180;
  const pinXY = { x: xy.x + Math.sin(r) * R * EST_RANGE_FRAC, y: xy.y + Math.cos(r) * R * EST_RANGE_FRAC };
  view.addPin(pinXY, det.confidence, `${d.id} · ${det.sensor === 'camera' ? 'Person seen · camera' : 'Scream (simulated survivor)'}`);
  view.showBearing(xy, abs, R);
  if (firstDetMs == null && t0Sim != null) firstDetMs = simMs - t0Sim;
  ui.log(`${det.sensor === 'camera' ? '📷' : '🔴'} <b>${d.id}</b> detection · bearing ${det.relBearingDeg >= 0 ? '+' : ''}${det.relBearingDeg.toFixed(0)}° rel (${abs.toFixed(0)}° abs) · conf ${(det.confidence * 100).toFixed(0)}%`, 'det');
  // mark survivors found by a pin landing near them (simulated button screams aren't a real voice, so they never "find" anyone)
  if (det.source !== 'sim')
    for (const s of survivors) if (!s.found && Math.hypot(s.x - pinXY.x, s.y - pinXY.y) <= FOUND_PIN_M) markFound(s, 'pin', d);
  // turn and investigate along the bearing, but never leave this drone's own sector: a voice from a
  // neighbouring sector has already raised that sector's map (detectAll), so its own drone goes to check
  const ab = d.area.bounds;
  const inside = pinXY.x >= ab.x0 && pinXY.x <= ab.x1 && pinXY.y >= ab.y0 && pinXY.y <= ab.y1;
  if (!inside && fleet.length > 1) {
    const owner = fleet.find(o => o !== d && pinXY.x >= o.area.bounds.x0 && pinXY.x <= o.area.bounds.x1 && pinXY.y >= o.area.bounds.y0 && pinXY.y <= o.area.bounds.y1);
    if (owner) {
      if (owner.status === 'active' && owner.drone.state.mode !== 'investigate') { owner.current = { i: -1, ...pinXY }; owner.drone.setTarget(pinXY, 'investigate'); }
      if (d.id === selId || owner.id === selId) ui.log(`<b>${d.id}</b> heard a voice in <b>${owner.id}</b>'s sector · ${owner.id} investigates, ${d.id} keeps searching its own area`, 'muted');
      lastDetAt = simMs; redrawGrid();
      return;
    }
  }
  d.status = 'active';
  d.current = { i: -1, ...pinXY };
  drone.setTarget(pinXY, 'investigate');
  if (d.id === selId && simMs - lastDetAt > PIN_MERGE_MS) view.flash(pinXY);
  lastDetAt = simMs;
  if (!running) { running = true; ui.setStarted(true); if (t0Sim == null) t0Sim = simMs; }
  redrawGrid();
}

// one confirmed survivor at a time: finds queue up and come out at most every FIND_GAP_MS (real time)
const FIND_GAP_MS = 7000;
let findQueue = [], lastFoundAt = -1e9;
function markFound(s, how, d) {
  if (s.found || s.queued) return;
  s.queued = true;
  findQueue.push({ s, how, d });
  releaseFinds();
}
function releaseFinds() {
  if (!findQueue.length || Date.now() - lastFoundAt < FIND_GAP_MS) return;
  lastFoundAt = Date.now();
  const { s, how, d } = findQueue.shift();
  confirmFound(s, how, d);
}
function confirmFound(s, how, d) {
  s.found = true;
  const by = d ? `<b>${d.id}</b>` : 'the swarm';
  ui.log(`✅ Survivor found by ${by}: <b>${s.label}</b> (${how === 'pin' ? 'detection pin within 50 m' : 'drone passed within 30 m'})`, 'found');
  view.updateSurvivors(survivors, reveal);
  notifyRescue(s, d);
}

// =============================================================================================
// Rescue drone R1: a heavy-lift octocopter. Search drones find people; R1 brings them out.
// It lowers a fully enclosed capsule (seat + 5-point harness, locking door) on a dual rope onto the
// roof / spot, waits for the person to board and the safety checks, lifts and flies them to base.
// =============================================================================================
const LIFT = { speedMps: 9, lowerMs: 6000, boardMs: 9000, liftMs: 5000, unloadMs: 4000 };
const OFFICIALS = 'Bomba (JBPM) · APM · NADMA';
let lifter = null;
function resetLifter() {
  const pad = { x: basePad.x + 70, y: basePad.y };
  const cfg = { ...CONFIG, drone: { ...CONFIG.drone, speedMps: LIFT.speedMps, turnRateDegPerS: 60 } };
  lifter = { pad, drone: createDrone(cfg, { ...pad, headingDeg: 0 }), status: 'standby', job: null, queue: [], t: 0, rescued: 0 };
  view.setLifterPad(pad);
}
function notifyRescue(s, d) {
  lifter.queue.push(s);
  ui.alert(`🚨 <b>${d ? d.id : 'Swarm'}</b> confirmed a survivor: <b>${s.label}</b> · Rescue drone <b>R1</b> ${lifter.status === 'standby' ? 'dispatched' : `queued (#${lifter.queue.length})`} · ${OFFICIALS} notified`);
  ui.log(`📣 Officials notified (${OFFICIALS}) · GPS ${xyToLatLng(s.x, s.y).map(v => v.toFixed(5)).join(', ')} · R1 ${lifter.status === 'standby' ? 'dispatched' : 'queued'}`, 'alert');
}
const LIFTER_LABEL = { standby: 'Standby at base', enroute: 'Flying to survivor', lowering: 'Lowering capsule', boarding: 'Boarding · safety checks',
  lifting: 'Lifting capsule', returning: 'Flying to base', unloading: 'Handing over to medics' };
function lifterUi() {
  if (!lifter) return null;
  const phaseMs = { lowering: LIFT.lowerMs, boarding: LIFT.boardMs, lifting: LIFT.liftMs, unloading: LIFT.unloadMs }[lifter.status];
  return { status: lifter.status, label: LIFTER_LABEL[lifter.status], queue: lifter.queue.length, rescued: lifter.rescued,
    pct: phaseMs ? Math.min(100, (100 * lifter.t) / phaseMs) : null, job: lifter.job?.label || null };
}
function tickLifter(dt) {
  const L = lifter, dr = L.drone;
  const next = (status, msg, kind = '') => { L.status = status; L.t = 0; if (msg) ui.log(msg, kind); pushSwarmUi(); };
  switch (L.status) {
    case 'standby':
      if (L.queue.length) { L.job = L.queue.shift(); dr.setTarget(L.job, 'search'); next('enroute', `🚁 <b>R1</b> taking off for <b>${L.job.label}</b>`); }
      break;
    case 'enroute':
      if (dr.tick(dt).arrived) next('lowering', `<b>R1</b> over the survivor · holding hover, lowering the enclosed capsule`);
      break;
    case 'lowering': if ((L.t += dt) >= LIFT.lowerMs) next('boarding', `<b>R1</b> capsule down · door open, person boarding`); break;
    case 'boarding':
      if ((L.t += dt) >= LIFT.boardMs) next('lifting', `<b>R1</b> safety checks OK: harness locked, door sealed, ropes tensioned · lifting`, 'found');
      break;
    case 'lifting':
      if ((L.t += dt) >= LIFT.liftMs) { dr.setTarget(L.pad, 'search'); next('returning', `<b>R1</b> capsule secured under the drone · flying to base`); }
      break;
    case 'returning':
      if (dr.tick(dt).arrived) next('unloading', `<b>R1</b> landed at base · handing over to medics`);
      break;
    case 'unloading':
      if ((L.t += dt) >= LIFT.unloadMs) {
        L.job.rescued = true; L.rescued++;
        ui.log(`🏥 <b>${L.job.label}</b> rescued and with medics (${L.rescued} rescued)`, 'found');
        view.updateSurvivors(survivors, reveal);
        L.job = null; next('standby');
      }
      break;
  }
  if (['lowering', 'boarding', 'lifting', 'unloading'].includes(L.status)) pushSwarmUiThrottled();
}
let lastSwarmUi = 0;
function pushSwarmUiThrottled() { const now = performance.now(); if (now - lastSwarmUi > 300) { lastSwarmUi = now; pushSwarmUi(); } }

// hidden survivors occasionally call out; heard with the engine's own POD
function survivorCalls(d) {
  if ((responder.busy() && d === respD) || Object.values(ears).some(e => Date.now() - e.last < 5000)) return;   // live demo: real people only
  // each hidden survivor calls out ~30% of seconds (CONFIG.sensors.audio.callProb), heard with the engine's POD,
  // so the simulation behaves the way the trust map assumes (no 'cleared' cells hiding unfound people)
  const callProb = CONFIG.sensors?.audio?.callProb ?? 0.3;
  const st = d.drone.state;
  for (const s of survivors) {
    if (s.found || s.queued) continue;
    const dist = Math.hypot(s.x - st.x, s.y - st.y);
    if (dist > CONFIG.pod.hearingRadiusM) continue;
    const pod = S.podFor(dist, currentNoiseDb(), CONFIG);
    if (Math.random() >= pod * callProb) continue;
    const rel = wrapDeg(bearingTo(st, s) - st.headingDeg);
    handleDetection({ type: 'detection', t: Date.now(), relBearingDeg: rel, confidence: Math.min(0.95, 0.35 + 0.6 * pod), ears: ['sim'], source: 'survivor' }, d);
    return;                                              // one detection per drone per second keeps the feed readable
  }
}

// ---- live rescue response (P1) ----
// P2: the response flies the drone that was selected when it started (respD); the other drones keep searching.
let respD = null;
let liveFlags = 0;
const responder = createResponder({
  get drone() { return (respD || sel()).drone; },
  setTarget: (xy) => { const d = respD || sel(); d.status = 'active'; d.current = { i: -1, ...xy }; d.drone.setTarget(xy, 'investigate'); },
  applyDetection: (xy, abs, conf) => detectAll(xy, abs, conf),
  addPin: (xy, conf, label) => view.addPin(xy, conf, `${(respD || sel()).id} · ${label}`),
  addFlag: (xy, html) => {
    view.addFlag?.(xy, html);
    // a confirmed live survivor also dispatches the rescue drone R1 and notifies the officials
    notifyRescue({ x: xy.x, y: xy.y, label: `Live survivor #${++liveFlags}` }, respD || sel());
  },
  showBearing: (xy, abs, len) => view.showBearing(xy, abs, len),
  flash: (xy) => view.flash(xy),
  log: (html, kind) => ui.log(html, kind),
  scenario: () => scenarioId,
  toLatLng: (x, y) => xyToLatLng(x, y),
  hud: document.getElementById('hud'),
});
// rehearsal without a camera: keys Q / P / E = person seen left / ahead / right
window.addEventListener('keydown', (ev) => {
  const off = { q: -0.7, p: 0, e: 0.7 }[ev.key?.toLowerCase()];
  if (off === undefined || ev.target?.tagName === 'INPUT') return;
  handleDetection({ type: 'detection', sensor: 'camera', t: Date.now(), relBearingDeg: off * (CONFIG.camera?.halfFovDeg ?? 30), confidence: 0.9, ears: ['C'], source: 'sim-camera' });
});

// ---- Single / Swarm toggle (single by default for the live demo) ----
{
  const act = document.querySelector('.swarm-act');
  const seg = document.createElement('div');
  seg.className = 'fleet-seg';
  seg.style.cssText = 'display:flex;gap:4px;margin-right:6px;padding-right:8px;border-right:1px solid var(--line)';
  seg.innerHTML = '<button class="btn sm toggle" data-fleet="single" title="One drone (live demo with the phones)">Single</button>' +
                  '<button class="btn sm toggle" data-fleet="swarm" title="Five drones sharing one probability map">Swarm · 5</button>';
  act?.prepend(seg);
  // Demo: the swarm is hidden (single drone only). Open with ?fleet=swarm to see/test it.
  if (fleetMode !== 'swarm') seg.style.display = 'none';
  const paint = () => {
    seg.querySelectorAll('[data-fleet]').forEach(b => b.classList.toggle('on', b.dataset.fleet === fleetMode));
    const all = document.querySelector('[data-act="d-all"]'); if (all) all.style.display = fleetMode === 'swarm' ? '' : 'none';
    document.body.classList.toggle('fleet-single', fleetMode === 'single');
  };
  seg.addEventListener('click', (ev) => {
    const m = ev.target.closest('[data-fleet]')?.dataset.fleet;
    if (!m || m === fleetMode) return;
    if (responder.busy()) { ui.log('Finish the current rescue response before switching fleet mode', 'warn'); return; }
    fleetMode = m;
    const q = new URLSearchParams(location.search); q.set('fleet', m); history.replaceState(null, '', `${location.pathname}?${q}${location.hash}`);
    respD = null; selId = SWARM[0].id;
    reset(); paint(); pushSwarmUi();
    ui.log(m === 'swarm' ? 'Swarm mode: 5 search drones share one probability map' : 'Single-drone mode: D1 searches the whole area', 'area');
  });
  window.__paintFleet = paint;
  paint();
}

// ---- Connect the drone (setup sheet) + Drone camera window (P1) ----
const connect = createConnect({
  room: ROOM,
  earUrl: ear => new URL(`ear.html?room=${ROOM}&ear=${ear}${ear === 'C' ? '&mode=eyes' : ''}`, location.href).href,
  onCalibrate: () => calibrate(),
  onClose: () => document.querySelector('[data-act="qr"]')?.classList.remove('on'),
});
{ const st = document.createElement('style'); st.textContent = '.qrpop{display:none!important}'; document.head.appendChild(st); }
document.addEventListener('click', (ev) => {               // "Join ears" opens the new sheet instead of the old strip
  const b = ev.target.closest?.('[data-act="qr"]');
  if (!b) return;
  ev.stopImmediatePropagation(); ev.preventDefault();
  connect.toggle(); b.classList.toggle('on', connect.isOpen());
}, true);
{ const setCalib = ui.setCalibStatus.bind(ui); ui.setCalibStatus = (t) => { setCalib(t); connect.setCalibStatus(t); }; }
if (!urlParams.has('nosetup')) setTimeout(() => connect.open(), 300);   // start with the setup sheet

// ---- realtime ears ----
const fusion = FU.createFusion(CONFIG, { onDetection: det => handleDetection(det) });
let calibPeaks = null;
const channel = CH.joinRoom(ROOM, {
  onMessage(msg) {
    if (!validate(msg)) return;
    const e = msg.ear && (ears[msg.ear] ||= { db: null, floorDb: null, last: 0, screamUntil: 0 });
    if (msg.type === 'hello') { e.last = Date.now(); ui.log(`Ear <b>${msg.ear}</b> joined`); }
    if (msg.type === 'frame') { e.last = Date.now(); e.frameAt = Date.now(); connect.onFrame(msg); return; }
    if (msg.type === 'level') {
      Object.assign(e, { db: msg.db, floorDb: msg.floorDb, last: Date.now(), levelAt: Date.now() });
      if (calibPeaks) calibPeaks[msg.ear] = Math.max(calibPeaks[msg.ear] ?? -Infinity, msg.db);
    }
    if (msg.type === 'scream') {
      e.last = Date.now(); e.screamUntil = Date.now() + 800;
      if (calibPeaks) calibPeaks[msg.ear] = Math.max(calibPeaks[msg.ear] ?? -Infinity, msg.peakDb);
      else ui.log(`Ear ${msg.ear} heard a scream · ${msg.peakDb?.toFixed?.(0)} dB`);
    }
    if (msg.type === 'level' || msg.type === 'scream' || msg.type === 'hello' || msg.type === 'sighting') fusion.ingest(msg);
    if (msg.type === 'sighting') e.last = Date.now();
  },
});

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function calibrate() {
  const live = Object.entries(ears).filter(([, e]) => Date.now() - e.last < 3000).map(([k]) => k);
  if (!live.length) { ui.setCalibStatus('No phones connected: calibration needs at least one ear.'); return; }
  channel.send({ type: 'calibrate', phase: 'start' });
  ui.setCalibStatus('Measuring noise floor: stay quiet (3 s)…'); ui.log('Calibration started');
  await sleep(3000);
  calibPeaks = {};
  channel.send({ type: 'calibrate', phase: 'clap' });
  ui.setCalibStatus('👏 CLAP once at the centre, between the phones');
  await sleep(2500);
  const peaks = calibPeaks; calibPeaks = null;
  if (Object.keys(peaks).length === 0) { ui.setCalibStatus('No clap heard. Try again.'); return; }
  const gains = computeGains(peaks);
  fusion.setGains?.(gains);                       // apply to direction finding (was computed but never used)
  channel.send({ type: 'calibrate', phase: 'done', gains });
  ui.setCalibStatus(`Gains: ${Object.entries(gains).map(([k, v]) => { const db = 20 * Math.log10(v); return `${k} ${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`; }).join(' · ')}`);
  ui.log('Calibration done');
}

// ---- view updates ----
function redrawGrid() {
  let cleared = 0, total = 0;
  for (const d of fleet) {
    const trust = trustOf(d.area);
    view.updateGrid(d.id, trust, probsOf(d.area));
    const c = trust.filter(t => t === 'cleared').length;
    d.clearedPct = (100 * c) / d.area.n;
    cleared += c; total += d.area.n;
  }
  if (fleet.length) pushSwarmUi();
  ui.setMetrics({
    rescued: lifter?.rescued ?? 0,
    clearedPct: total ? (100 * cleared) / total : 0,
    firstDetS: firstDetMs == null ? null : firstDetMs / 1000,
    found: survivors.filter(s => s.found).length, total: survivors.length,
    noiseDb: currentNoiseDb(),
  });
}
function redrawDrones(dtSimMs = 0) {
  for (const d of fleet) {
    const st = d.drone.state;
    if (dtSimMs > 0 && d.lastPos) {
      const v = Math.hypot(st.x - d.lastPos.x, st.y - d.lastPos.y) / (dtSimMs / 1000) * 3.6;
      d.speedKmh += (v - d.speedKmh) * 0.3;
    } else if (!running) d.speedKmh = 0;
    d.lastPos = { x: st.x, y: st.y };
  }
  view.updateFleet(fleet.map(d => ({ id: d.id, state: d.drone.state, target: d.drone.target, status: d.status })),
    selId, CONFIG.pod.hearingRadiusM, currentNoiseDb() > CONFIG.pod.noiseRefDb);
  // the rail shows the selected drone
  const d = sel(), st = d.drone.state, [lat, lng] = xyToLatLng(st.x, st.y);
  const mode = d.status !== 'active' ? d.status : running ? st.mode : 'idle';
  ui.setTelemetry({ lat, lng, altM: d.status === 'landed' ? 0 : ALTITUDE_M, speedKmh: d.speedKmh, headingDeg: st.headingDeg, mode, drone: d.id, color: d.color });
  if (lifter) view.updateLifter(lifter.drone.state, lifter.status, lifterUi().pct);
}

// family report click
view.onClick(xy => {
  if (!familyMode) return;
  // raise the cell under the click in every drone grid that covers it
  const hit = [];
  for (const d of fleet) {
    const a = d.area, b = a.bounds;
    if (xy.x < b.x0 || xy.x > b.x1 || xy.y < b.y0 || xy.y > b.y1) continue;
    let best = 0, bd = Infinity;
    a.centers.forEach((c, i) => { const dd = Math.hypot(c.x - xy.x, c.y - xy.y); if (dd < bd) { bd = dd; best = i; } });
    S.applyFamilyReport(a.grid, best, a.cfg);
    hit.push(d.id);
  }
  ui.log(hit.length ? `📍 Family report: "last seen here" · raised priority for ${hit.join(', ')}`
    : '📍 Family report is outside every drone area: give a drone an area there first', hit.length ? 'family' : 'warn');
  familyMode = false; ui.setFamilyMode(false);
  // searching drones re-plan right away so the report pulls the nearest one in
  for (const d of fleet) if (d.status === 'active' && d.drone.state.mode !== 'investigate') { d.current = null; d.drone.setTarget(null); }
  redrawGrid();
});
view.onDroneClick(id => selectDrone(id));

// =============================================================================================
// Main loop (every CONFIG.drone.tickMs)
// =============================================================================================
let gridRedrawAcc = 0;
function loop() {
  const now = Date.now();
  for (const k of ['L', 'C', 'R']) {
    const e = ears[k];
    ui.setEarStatus(k, e ? { connected: now - e.last < 3000, db: e.db, floorDb: e.floorDb, screaming: now < e.screamUntil } : {});
    connect.setEar(k, e ? { joined: now - e.last < 6000, listening: now - (e.levelAt || 0) < 3000, watching: now - (e.frameAt || 0) < 3000, db: e.db, screaming: now < e.screamUntil } : {});
  }
  if (!running) return;
  releaseFinds();
  const dt = CONFIG.drone.tickMs * speed;
  simMs += dt;

  scanAcc += dt; callAcc += dt;
  const scanNow = scanAcc >= SCAN_EVERY_MS, callNow = callAcc >= CALL_EVERY_MS;
  if (scanNow) { scanAcc -= SCAN_EVERY_MS; gridRedrawAcc = 1e9; }
  if (callNow) callAcc -= CALL_EVERY_MS;
  const noiseDb = currentNoiseDb();

  for (const d of fleet) {
    if (d.status === 'landed') continue;
    const drone = d.drone;

    // 1. fly (a holding drone hovers in place)
    const { arrived } = d.status === 'hold' ? { arrived: false } : drone.tick(dt);
    if (d.status === 'rtb') {
      if (arrived) { d.status = 'landed'; drone.setTarget(null); ui.log(`<b>${d.id}</b> landed at base`); pushSwarmUi(); }
      continue;
    }
    const xy = { x: drone.state.x, y: drone.state.y };

    // 2. "nothing heard" update from every flying drone, once per simulated second
    if (scanNow) scanAll(xy, noiseDb);

    // people layer: hidden survivors call out; close passes in quiet find them
    // simulated survivors are only heard / found once the drone is over its own search area (not while transiting)
    const onStation = inOwnArea(d, xy);
    if (callNow && onStation) survivorCalls(d);
    if (!rotorOn && onStation) for (const s of survivors) if (!s.found && Math.hypot(s.x - xy.x, s.y - xy.y) <= FOUND_PASS_M) markFound(s, 'pass', d);

    // P1's live response owns its drone while busy
    if (d === respD) {
      if (responder.tick(performance.now(), arrived) === 'resume') { d.current = null; drone.setTarget(null); respD = null; }
      else if (responder.busy()) continue;
    }
    if (d.status !== 'active') continue;

    // 3. next waypoint inside this drone's own area, on arrival (or if it has none)
    if (arrived || !drone.target) {
      if (arrived && drone.state.mode === 'investigate') ui.log(`<b>${d.id}</b> reached the investigation point · resuming search`);
      const w = waypointFor(d);
      if (w) {
        if (d.id === selId && (!d.current || d.current.i !== w.i)) ui.log(`<b>${d.id}</b> → cell ${w.i} (p=${w.p.toFixed(3)})`, 'muted');
        d.current = w;
        drone.setTarget(w, 'search');
      }
    }
  }

  tickLifter(dt);

  // 4. redraw
  redrawDrones(dt);
  gridRedrawAcc += CONFIG.drone.tickMs;
  if (gridRedrawAcc >= 250) { gridRedrawAcc = 0; redrawGrid(); }
}

// ---- tabs: Mission map | Drone operation ----
const ops = createOps(document.getElementById('hud'), {
  onTryArea: () => { setTab('map'); if (!document.querySelector('[data-act="area"]')?.classList.contains('on')) ui.trigger('area'); },
});
function setTab(tab) {
  ui.setTab(tab);
  tab === 'ops' ? ops.show() : ops.hide();
  const want = tab === 'ops' ? '#operation' : '';
  if (location.hash !== want) history.replaceState(null, '', `${location.pathname}${location.search}${want}`);
}
window.addEventListener('hashchange', () => setTab(location.hash === '#operation' ? 'ops' : 'map'));

applySite();
reset();
if (location.hash === '#operation') setTab('ops');
setInterval(loop, CONFIG.drone.tickMs);
window.GEMA = { get CONFIG() { return CONFIG; }, get scenario() { return scenarioId; },get drone() { return sel()?.drone; }, get fleet() { return fleet; }, get lifter() { return lifter; }, selectDrone, survivors: () => survivors, handleDetection, MOCKS, ROOM };
