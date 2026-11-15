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

const urlParams = new URLSearchParams(location.search);
export const MOCKS = urlParams.has('mocks') ? urlParams.get('mocks') !== '0' : true;

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
const CONFIG = realConfig?.CONFIG || realConfig?.default || FALLBACK_CONFIG;

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

// survivor positions relative to the grid centre (metres); ground truth for the people layer only
mock.SURVIVORS = [
  { id: 's1', label: 'Pak Ali (rooftop)', dx: -210, dy: 120 },
  { id: 's2', label: 'Mak Siti (attic)', dx: 160, dy: 140 },
  { id: 's3', label: 'Child on car roof', dx: 240, dy: -150 },
  { id: 's4', label: 'Elderly man', dx: -60, dy: -170 },
  { id: 's5', label: 'Teen with dead phone', dx: 40, dy: 30 },
];

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
const scenarioList = (!MOCKS && (realScenario?.SURVIVORS || realScenario?.default)) || null;

// ---- small adapters (tolerate slightly different return shapes from search.js) ----
const toXY = v => Array.isArray(v) ? { x: v[0], y: v[1] } : { x: v.x, y: v.y };
const N = CONFIG.grid.cols * CONFIG.grid.rows;
let grid;
const center = i => toXY(S.cellCenter(grid, i));
function probs() {
  const g = grid;
  const arr = g.p || g.probs || g.prob || (g.cells && g.cells.map(c => c.p));
  return arr ? Array.from(arr) : new Array(N).fill(1 / N);
}
function waypointXY(xy) {
  const w = S.nextWaypoint(grid, xy);
  if (typeof w === 'number') return { i: w, ...center(w) };
  if (w && typeof w.i === 'number') return { i: w.i, ...center(w.i) };
  return w ? { i: -1, ...toXY(w) } : null;
}

// =============================================================================================
// Setup
// =============================================================================================
const ROOM = (urlParams.get('room') || Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.random() * 24 | 0]).join('')).toUpperCase();
if (!urlParams.get('room')) { urlParams.set('room', ROOM); history.replaceState(null, '', `${location.pathname}?${urlParams}`); }

const view = createMap('map', CONFIG);
const ui = createUI(document.getElementById('side'), {
  room: ROOM,
  earUrl: ear => new URL(`ear.html?room=${ROOM}&ear=${ear}`, location.href).href,
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
      ui.log(on ? 'Rotor noise <b>ON</b>: silence now proves less' : 'Rotor noise OFF', on ? 'warn' : '');
    },
    onVolume: v => setRotorVolume(v),
    onHeatmap: on => { view.setHeatmap(on); redrawGrid(); },
    onFollow: on => view.setFollow(on),
    onReveal: on => { reveal = on; view.updateSurvivors(survivors, reveal); },
    onSpeed: x => { speed = x; },
    onFamilyMode: on => { familyMode = on; if (on) ui.log('Click the map where the person was last seen'); },
    onCalibrate: () => calibrate(),
  },
});

let running = false, rotorOn = false, reveal = false, familyMode = false, speed = 2;
let simMs = 0, t0Sim = null, firstDetMs = null, scanAcc = 0, callAcc = 0, lastDetAt = -1e9;
let drone, survivors = [], current = null;
const ears = {}; // ear → { db, floorDb, last, screamUntil }

function reset() {
  grid = S.createGrid(CONFIG);
  // put the grid's centre on CONFIG.map.center, whatever origin search.js uses
  const cs = Array.from({ length: N }, (_, i) => center(i));
  const mx = cs.reduce((a, c) => a + c.x, 0) / N, my = cs.reduce((a, c) => a + c.y, 0) / N;
  const [lat0, lng0] = CONFIG.map.center;
  setOrigin([lat0 - my / 111320, lng0 - mx / (111320 * Math.cos(lat0 * Math.PI / 180))]);
  const bounds = view.buildGrid(cs, CONFIG.grid.cellMeters);
  view.map.fitBounds(bounds, { padding: [20, 20] });
  const minY = Math.min(...cs.map(c => c.y));
  drone = createDrone(CONFIG, { x: mx, y: minY - CONFIG.grid.cellMeters, headingDeg: 0 });
  current = null;
  survivors = (scenarioList || mock.SURVIVORS).map((s, k) => {
    const xy = s.lat != null ? latLngToXY([s.lat, s.lng]) : s.dx != null ? { x: mx + s.dx, y: my + s.dy } : { x: s.x, y: s.y };
    return { id: s.id || `s${k + 1}`, label: s.label || s.name || `Survivor ${k + 1}`, ...xy, found: false };
  });
  simMs = 0; t0Sim = null; firstDetMs = null; scanAcc = 0; callAcc = 0; lastDetAt = -1e9;
  running = false; ui.setStarted(false);
  view.resetTrail();
  view.updateSurvivors(survivors, reveal);
  redrawGrid(); redrawDrone();
  ui.log(`Grid ${CONFIG.grid.cols}×${CONFIG.grid.rows} ready · room ${ROOM} · ${MOCKS ? 'MOCK engine' : 'live engine'}`);
}

// ---- noise floor the engine should assume ----
function currentNoiseDb() {
  const now = Date.now();
  const live = Object.values(ears).filter(e => now - e.last < 3000 && e.floorDb != null);
  if (live.length) return live.reduce((a, e) => a + e.floorDb, 0) / live.length;
  return rotorOn ? -35 : -60;
}

// ---- detections ----
function handleDetection(det) {
  const xy = { x: drone.state.x, y: drone.state.y };
  const abs = wrapDeg(drone.state.headingDeg + det.relBearingDeg);
  S.applyDetection(grid, xy, abs, det.confidence, CONFIG);
  const R = CONFIG.pod.hearingRadiusM, r = abs * Math.PI / 180;
  const pinXY = { x: xy.x + Math.sin(r) * R * EST_RANGE_FRAC, y: xy.y + Math.cos(r) * R * EST_RANGE_FRAC };
  view.addPin(pinXY, det.confidence, det.source === 'sim' ? 'Simulated scream' : `Scream (${(det.ears || []).join('+')})`);
  view.showBearing(xy, abs, R);
  if (firstDetMs == null && t0Sim != null) firstDetMs = simMs - t0Sim;
  ui.log(`🔴 Detection · bearing ${det.relBearingDeg >= 0 ? '+' : ''}${det.relBearingDeg.toFixed(0)}° rel (${abs.toFixed(0)}° abs) · conf ${(det.confidence * 100).toFixed(0)}%`, 'det');
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
    if (msg.type === 'level' || msg.type === 'scream' || msg.type === 'hello') fusion.ingest(msg);
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
  channel.send({ type: 'calibrate', phase: 'done', gains });
  ui.setCalibStatus(`Gains: ${Object.entries(gains).map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${v} dB`).join(' · ')}`);
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
function redrawDrone() {
  view.updateDrone(drone.state, drone.target, CONFIG.pod.hearingRadiusM, currentNoiseDb() > CONFIG.pod.noiseRefDb);
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

  // 3. pick the next waypoint on arrival (or if we have none)
  if (arrived || !drone.target) {
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
  redrawDrone();
  gridRedrawAcc += CONFIG.drone.tickMs;
  if (gridRedrawAcc >= 250) { gridRedrawAcc = 0; redrawGrid(); }
}

reset();
setInterval(loop, CONFIG.drone.tickMs);
window.GEMA = { CONFIG, get grid() { return grid; }, get drone() { return drone; }, survivors: () => survivors, handleDetection, MOCKS, ROOM };
