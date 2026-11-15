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
import { createResponder } from './response.js';   // P1: camera → heat → voice → confirm → speaker + flag

const urlParams = new URLSearchParams(location.search);
export const MOCKS = urlParams.has('mocks') ? urlParams.get('mocks') !== '0' : false;   // real modules have landed; ?mocks=1 to force mocks

// ---- timing knobs (P2-only; not in config.js) ----
const SCAN_EVERY_MS = 1000;   // negative scan = one "listen" per simulated second
const CALL_EVERY_MS = 3000;   // a hidden survivor tries to call out this often
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
let N = CONFIG.grid.cols * CONFIG.grid.rows;
let grid;
const center = i => toXY(S.cellCenter(grid, i));
function probs() {
  const g = grid;
  const arr = g.p || g.probs || g.prob || (g.cells && g.cells.map(c => c.p));
  return arr ? Array.from(arr) : new Array(N).fill(1 / N);
}
const recent = [];          // last few cells visited, so the drone can't park on one cell forever
function waypointXY(xy) {
  const raw = S.nextWaypoint(grid, xy);
  let w = typeof raw === 'number' ? { i: raw, ...center(raw) }
    : raw && typeof raw.i === 'number' ? { i: raw.i, ...center(raw.i) }
    : raw ? { i: -1, ...toXY(raw) } : null;
  // planner picked where we already are (or just were): take the best other cell instead
  if (!w || Math.hypot(w.x - xy.x, w.y - xy.y) < 10 || recent.includes(w.i)) {
    const p = probs();
    let best = -1, bs = -1;
    for (let i = 0; i < N; i++) {
      const c = center(i), d = Math.hypot(c.x - xy.x, c.y - xy.y);
      if (d < 10 || recent.includes(i)) continue;
      const s = p[i] / (1 + d / 300);
      if (s > bs) { bs = s; best = i; }
    }
    if (best >= 0) w = { i: best, ...center(best) };
  }
  if (w && w.i >= 0) { recent.push(w.i); if (recent.length > 4) recent.shift(); }
  return w;
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
      ui.log(`Simulated scream on <b>${ear}</b>`, 'sim');
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
      if (!on) { cancelSelect?.(); cancelSelect = null; return; }
      if (familyMode) { familyMode = false; ui.setFamilyMode(false); }
      ui.log('Drag a rectangle on the map to set the search area', 'warn');
      cancelSelect = view.startAreaSelect(bounds => { cancelSelect = null; ui.setSelecting(false); setSearchArea(bounds); });
    },
  },
});

let running = false, rotorOn = false, reveal = false, familyMode = false, speed = 2;
let simMs = 0, t0Sim = null, firstDetMs = null, scanAcc = 0, callAcc = 0, lastDetAt = -1e9;
let drone, survivors = [], current = null, cancelSelect = null;
const ears = {}; // ear → { db, floorDb, last, screamUntil }

function applySite() {
  ui.setScenario(scenarioId, site.id);
  view.setImagery(site.imagery);
  ui.setSite(site);
}

// Operator-drawn search area -> grid size, cell size and centre.
const MAX_CELLS_SIDE = 40;
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
  N = CONFIG.grid.cols * CONFIG.grid.rows;
  grid = S.createGrid(CONFIG);
  // put the grid's centre on CONFIG.map.center, whatever origin search.js uses
  const cs = Array.from({ length: N }, (_, i) => center(i));
  const mx = cs.reduce((a, c) => a + c.x, 0) / N, my = cs.reduce((a, c) => a + c.y, 0) / N;
  const [lat0, lng0] = CONFIG.map.center;
  setOrigin([lat0 - my / 111320, lng0 - mx / (111320 * Math.cos(lat0 * Math.PI / 180))]);
  const bounds = view.buildGrid(cs, CONFIG.grid.cellMeters);
  view.fitToHud(bounds);
  const minY = Math.min(...cs.map(c => c.y));
  drone = createDrone(CONFIG, { x: mx, y: minY - CONFIG.grid.cellMeters, headingDeg: 0 });
  current = null; recent.length = 0;
  const W = CONFIG.grid.cols * CONFIG.grid.cellMeters, H = CONFIG.grid.rows * CONFIG.grid.cellMeters;
  survivors = (scenarioList || SCENARIOS[scenarioId].survivors).map((s, k) => {
    const xy = s.lat != null ? latLngToXY([s.lat, s.lng]) : s.fx != null ? { x: mx + s.fx * W, y: my + s.fy * H }
      : s.dx != null ? { x: mx + s.dx, y: my + s.dy } : { x: s.x, y: s.y };
    return { id: s.id || `s${k + 1}`, label: s.label || s.name || `Survivor ${k + 1}`, ...xy, found: false };
  });
  simMs = 0; t0Sim = null; firstDetMs = null; scanAcc = 0; callAcc = 0; lastDetAt = -1e9;
  running = false; ui.setStarted(false);
  view.resetTrail();
  view.updateSurvivors(survivors, reveal);
  redrawGrid(); redrawDrone();
  ui.setArea({ cols: CONFIG.grid.cols, rows: CONFIG.grid.rows, cellM: CONFIG.grid.cellMeters });
  ui.log(`Grid ${CONFIG.grid.cols}×${CONFIG.grid.rows} ready · room ${ROOM} · ${MOCKS ? 'MOCK engine' : 'live engine'}`);
}

// ---- noise floor the engine should assume ----
function currentNoiseDb() {
  const now = Date.now();
  const live = Object.values(ears).filter(e => now - e.last < 3000 && e.floorDb != null);
  if (live.length) return live.reduce((a, e) => a + e.floorDb, 0) / live.length;
  return rotorOn ? -35 : SCENARIOS[scenarioId].ambientDb;
}

// ---- detections ----
function handleDetection(det) {
  if (det.source !== 'survivor') {                     // real phones (camera / mic) and the simulate buttons
    if (!running) { running = true; ui.setStarted(true); if (t0Sim == null) t0Sim = simMs; }
    if (firstDetMs == null && t0Sim != null) firstDetMs = simMs - t0Sim;
    responder.onDetection(det, performance.now());
    redrawGrid();
    return;
  }
  const xy = { x: drone.state.x, y: drone.state.y };
  const abs = wrapDeg(drone.state.headingDeg + det.relBearingDeg);
  S.applyDetection(grid, xy, abs, det.confidence, CONFIG);
  const R = CONFIG.pod.hearingRadiusM, r = abs * Math.PI / 180;
  const pinXY = { x: xy.x + Math.sin(r) * R * EST_RANGE_FRAC, y: xy.y + Math.cos(r) * R * EST_RANGE_FRAC };
  view.addPin(pinXY, det.confidence, det.source === 'sim' ? 'Simulated scream' : det.sensor === 'camera' ? `Person seen · camera (${(det.ears || []).join('+')})` : `Scream (${(det.ears || []).join('+')})`);
  view.showBearing(xy, abs, R);
  if (firstDetMs == null && t0Sim != null) firstDetMs = simMs - t0Sim;
  ui.log(`${det.sensor === 'camera' ? '📷 Camera' : '🔴 Detection'} · bearing ${det.relBearingDeg >= 0 ? '+' : ''}${det.relBearingDeg.toFixed(0)}° rel (${abs.toFixed(0)}° abs) · conf ${(det.confidence * 100).toFixed(0)}%`, 'det');
  // mark survivors found by a pin landing near them (simulated button screams aren't a real voice, so they never "find" anyone)
  if (det.source !== 'sim')
    for (const s of survivors) if (!s.found && Math.hypot(s.x - pinXY.x, s.y - pinXY.y) <= FOUND_PIN_M) markFound(s, 'pin');
  // turn and investigate along the bearing
  current = { i: -1, ...pinXY };
  drone.setTarget(pinXY, 'investigate');
  if (simMs - lastDetAt > PIN_MERGE_MS) view.flash(pinXY);
  lastDetAt = simMs;
  if (!running) { running = true; ui.setStarted(true); if (t0Sim == null) t0Sim = simMs; }
  redrawGrid();
}

function markFound(s, how) {
  s.found = true;
  ui.log(`✅ Survivor found: <b>${s.label}</b> (${how === 'pin' ? 'detection pin within 50 m' : 'drone passed within 30 m'})`, 'found');
  view.updateSurvivors(survivors, reveal);
}

// hidden survivors occasionally call out; heard with the engine's own POD
function survivorCalls() {
  if (responder.busy() || Object.values(ears).some(e => Date.now() - e.last < 5000)) return;   // live demo: real people only
  const pending = survivors.filter(s => !s.found);
  if (!pending.length) return;
  const s = pending[Math.random() * pending.length | 0];
  const d = Math.hypot(s.x - drone.state.x, s.y - drone.state.y);
  if (d > CONFIG.pod.hearingRadiusM) return;
  const pod = S.podFor(d, currentNoiseDb(), CONFIG);
  if (Math.random() >= pod) return;
  const rel = wrapDeg(bearingTo(drone.state, s) - drone.state.headingDeg);
  handleDetection({ type: 'detection', t: Date.now(), relBearingDeg: rel, confidence: Math.min(0.95, 0.35 + 0.6 * pod), ears: ['sim'], source: 'survivor' });
}

// ---- live rescue response (P1) ----
const responder = createResponder({
  get drone() { return drone; },
  setTarget: (xy) => { current = { i: -1, ...xy }; drone.setTarget(xy, 'investigate'); },
  applyDetection: (xy, abs, conf) => S.applyDetection(grid, xy, abs, conf, CONFIG),
  addPin: (xy, conf, label) => view.addPin(xy, conf, label),
  addFlag: (xy, html) => view.addFlag?.(xy, html),
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

// ---- realtime ears ----
const fusion = FU.createFusion(CONFIG, { onDetection: det => handleDetection(det) });
let calibPeaks = null;
const channel = CH.joinRoom(ROOM, {
  onMessage(msg) {
    if (!validate(msg)) return;
    const e = msg.ear && (ears[msg.ear] ||= { db: null, floorDb: null, last: 0, screamUntil: 0 });
    if (msg.type === 'hello') { e.last = Date.now(); ui.log(`Ear <b>${msg.ear}</b> joined`); }
    if (msg.type === 'level') {
      Object.assign(e, { db: msg.db, floorDb: msg.floorDb, last: Date.now() });
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
  const trust = Array.from({ length: N }, (_, i) => S.trustClass(grid, i, CONFIG));
  view.updateGrid(trust, probs());
  const cleared = trust.filter(t => t === 'cleared').length;
  ui.setMetrics({
    clearedPct: (100 * cleared) / N,
    firstDetS: firstDetMs == null ? null : firstDetMs / 1000,
    found: survivors.filter(s => s.found).length, total: survivors.length,
    noiseDb: currentNoiseDb(),
  });
}
let lastPos = null, speedKmh = 0;
function redrawDrone(dtSimMs = 0) {
  const st = drone.state;
  view.updateDrone(st, drone.target, CONFIG.pod.hearingRadiusM, currentNoiseDb() > CONFIG.pod.noiseRefDb);
  if (dtSimMs > 0 && lastPos) {
    const v = Math.hypot(st.x - lastPos.x, st.y - lastPos.y) / (dtSimMs / 1000) * 3.6;
    speedKmh += (v - speedKmh) * 0.3;
  } else if (!running) speedKmh = 0;
  lastPos = { x: st.x, y: st.y };
  const [lat, lng] = xyToLatLng(st.x, st.y);
  ui.setTelemetry({ lat, lng, altM: ALTITUDE_M, speedKmh, headingDeg: st.headingDeg, mode: running ? st.mode : 'idle' });
}

// family report click
view.onClick(xy => {
  if (!familyMode) return;
  let best = 0, bd = Infinity;
  for (let i = 0; i < N; i++) { const c = center(i); const d = Math.hypot(c.x - xy.x, c.y - xy.y); if (d < bd) { bd = d; best = i; } }
  S.applyFamilyReport(grid, best, CONFIG);
  ui.log(`📍 Family report: "last seen here" · cell ${best}`, 'family');
  familyMode = false; ui.setFamilyMode(false);
  if (drone.state.mode !== 'investigate') { current = null; }
  redrawGrid();
});

// =============================================================================================
// Main loop (every CONFIG.drone.tickMs)
// =============================================================================================
let gridRedrawAcc = 0;
function loop() {
  const now = Date.now();
  for (const k of ['L', 'C', 'R']) {
    const e = ears[k];
    ui.setEarStatus(k, e ? { connected: now - e.last < 3000, db: e.db, floorDb: e.floorDb, screaming: now < e.screamUntil } : {});
  }
  if (!running) return;
  const dt = CONFIG.drone.tickMs * speed;
  simMs += dt;

  // 1. fly
  const { arrived } = drone.tick(dt);
  const xy = { x: drone.state.x, y: drone.state.y };

  // 2. "nothing heard" update, once per simulated second
  scanAcc += dt;
  if (scanAcc >= SCAN_EVERY_MS) { scanAcc -= SCAN_EVERY_MS; S.applyNegativeScan(grid, xy, currentNoiseDb(), CONFIG); gridRedrawAcc = 1e9; }

  // people layer: hidden survivors call out; close passes in quiet find them
  callAcc += dt;
  if (callAcc >= CALL_EVERY_MS) { callAcc -= CALL_EVERY_MS; survivorCalls(); }
  if (!rotorOn) for (const s of survivors) if (!s.found && Math.hypot(s.x - xy.x, s.y - xy.y) <= FOUND_PASS_M) markFound(s, 'pass');

  // 3. live response owns the drone while busy; otherwise pick the next waypoint
  const resp = responder.tick(performance.now(), arrived);
  if (resp === 'resume') { const w = waypointXY(xy); if (w) { current = w; drone.setTarget(w, 'search'); } }
  if (responder.busy()) { /* response flow is steering */ }
  else if (arrived || !drone.target) {
    if (arrived && drone.state.mode === 'investigate') ui.log('Investigation point reached · resuming search');
    const w = waypointXY(xy);
    if (w) {
      if (!current || current.i !== w.i) ui.log(`→ next waypoint: cell ${w.i} (p=${(probs()[w.i] ?? 0).toFixed(3)})`, 'muted');
      current = w;
      drone.setTarget(w, 'search');
    }
  } else if (current === null && drone.state.mode === 'search') {
    const w = waypointXY(xy); if (w) { current = w; drone.setTarget(w, 'search'); ui.log(`→ re-planned to cell ${w.i}`, 'muted'); }
  }

  // 4. redraw
  redrawDrone(dt);
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
window.GEMA = { get CONFIG() { return CONFIG; }, get scenario() { return scenarioId; },get grid() { return grid; }, get drone() { return drone; }, survivors: () => survivors, handleDetection, MOCKS, ROOM };
