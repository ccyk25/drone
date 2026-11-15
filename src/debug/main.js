// P1's ears debug console: QR join, live levels, calibration, fused bearing, simulate buttons.
// P2 can copy patterns from here into the real control screen (ui.js / main.js).
import QRCode from 'qrcode';
import { CONFIG } from '../shared/config.js';
import { EARS, MSG, makeRoomCode } from '../shared/protocol.js';
import { joinRoom, hasSupabase } from '../realtime/channel.js';
import { createFusion, computeGains } from '../control/fusion.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const room = (params.get('room') || makeRoomCode()).toUpperCase();
if (!params.get('room')) history.replaceState(null, '', `?room=${room}`);
$('room').textContent = room;

// Phones can't open "localhost": in local dev use the laptop's LAN address (injected by vite.config.js).
const origin = (typeof __DEV_LAN_ORIGIN__ !== 'undefined' && __DEV_LAN_ORIGIN__ && ['localhost', '127.0.0.1'].includes(location.hostname))
  ? __DEV_LAN_ORIGIN__ : location.origin;

const log = (line) => {
  const el = $('log');
  el.textContent = `${new Date().toLocaleTimeString()}  ${line}\n` + el.textContent.slice(0, 6000);
};

// --- Ear cards with QR codes -------------------------------------------------
for (const ear of EARS) {
  const url = `${origin}/ear.html?room=${room}&ear=${ear}`;
  const div = document.createElement('div');
  div.className = 'ear';
  div.innerHTML = `<div class="name">${ear}</div><canvas id="qr-${ear}"></canvas>
    <div><a href="${url}" target="_blank">${url}</a></div>
    <div class="meter"><i id="lv-${ear}"></i><b id="fl-${ear}"></b></div>
    <div class="stat" id="st-${ear}">not connected</div>`;
  $('ears').appendChild(div);
  QRCode.toCanvas($(`qr-${ear}`), url, { width: 140, margin: 1 });
}
if (!hasSupabase()) log('No Supabase keys in .env → local mode: only tabs in THIS browser can join. Open the ear links in new tabs to test.');

// --- Fusion + channel --------------------------------------------------------
const clapPeaks = {};
const fusion = createFusion(CONFIG, { onDetection });
const channel = joinRoom(room, {
  onStatus: (s) => { $('chan').textContent = s; log(`channel ${s}`); },
  onMessage
});

function onMessage(msg) {
  fusion.ingest(msg);
  if (msg.type === MSG.HELLO) log(`hello from ${msg.ear}`);
  if (msg.type === MSG.LEVEL) {
    const pct = (v) => Math.max(0, Math.min(100, ((v + 90) / 90) * 100));
    $(`lv-${msg.ear}`).style.width = `${pct(msg.db)}%`;
    $(`fl-${msg.ear}`).style.left = `${pct(msg.floorDb)}%`;
  }
  if (msg.type === MSG.SCREAM) log(`${msg.kind === 'muffled' ? 'MUFFLED VOICE' : 'SCREAM'} ${msg.ear}: peak ${msg.peakDb.toFixed(1)} dB, ${msg.durationMs.toFixed(0)} ms, conf ${msg.confidence.toFixed(2)}`);
  if (msg.type === MSG.SIGHTING) log(`📷 SIGHTING ${msg.ear}: person ${(msg.confidence * 100).toFixed(0)}%, offset ${msg.offset.toFixed(2)}`);
  if (msg.type === MSG.CALIBRATION) {
    clapPeaks[msg.ear] = msg.clapPeakDb;
    log(`calibration ${msg.ear}: floor ${msg.floorDb.toFixed(1)} dB, clap ${msg.clapPeakDb.toFixed(1)} dB`);
  }
}

// Connection status per ear
setInterval(() => {
  const live = fusion.connectedEars();
  for (const ear of EARS) {
    const el = $(`st-${ear}`);
    el.textContent = live.includes(ear) ? 'connected' : 'not connected';
    el.classList.toggle('on', live.includes(ear));
  }
}, 500);

// --- Detection display -------------------------------------------------------
function onDetection(d) {
  $('bearing').textContent = `${d.relBearingDeg > 0 ? '+' : ''}${d.relBearingDeg.toFixed(0)}°`;
  const icon = d.sensor === 'camera' ? '📷' : '👂';
  $('detStat').textContent = `${icon} ${d.sensor} · confidence ${(d.confidence * 100).toFixed(0)}% · from ${d.ears.join(', ')}`;
  log(`${icon} DETECTION (${d.sensor}) bearing ${d.relBearingDeg.toFixed(1)}°, conf ${d.confidence.toFixed(2)} (ears ${d.ears.join(',')})`);
  drawCompass(d.relBearingDeg);
}

function drawCompass(deg) {
  const c = $('compass'); const g = c.getContext('2d');
  const cx = c.width / 2, cy = c.height - 10, r = 115;
  g.clearRect(0, 0, c.width, c.height);
  g.strokeStyle = '#2a3542'; g.lineWidth = 2;
  g.beginPath(); g.arc(cx, cy, r, Math.PI, 2 * Math.PI); g.stroke();
  g.fillStyle = '#8a96a3'; g.font = '12px system-ui';
  for (const [ear, a] of Object.entries(CONFIG.ears)) {
    const rad = ((a - 90) * Math.PI) / 180;
    g.fillText(ear, cx + Math.cos(rad) * (r - 14) - 4, cy + Math.sin(rad) * (r - 14));
  }
  if (deg === null) return;
  const rad = ((deg - 90) * Math.PI) / 180;
  g.strokeStyle = '#ff4d4f'; g.lineWidth = 5;
  g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(rad) * (r - 25), cy + Math.sin(rad) * (r - 25)); g.stroke();
}
drawCompass(null);

// --- Calibration -------------------------------------------------------------
$('calStart').onclick = () => { channel.send({ type: MSG.CALIBRATE, phase: 'start' }); log('calibrate: start (stay quiet 3 s)'); };
$('calClap').onclick = () => { channel.send({ type: MSG.CALIBRATE, phase: 'clap' }); log('calibrate: clap now!'); };
$('calDone').onclick = () => {
  const gains = computeGains(clapPeaks);
  fusion.setGains(gains);
  channel.send({ type: MSG.CALIBRATE, phase: 'done', gains });
  $('calStat').textContent = 'Gains: ' + (Object.entries(gains).map(([e, g]) => `${e} ${(20 * Math.log10(g)).toFixed(1)} dB`).join(' · ') || 'none');
  log(`calibrate: gains applied ${JSON.stringify(gains)}`);
};

// --- Simulation (no phones) --------------------------------------------------
// Rough room model: ~1 m between phones, screamer ~1 m in front of the chosen phone.
const SIM_DB = { L: { L: -20, C: -24, R: -28 }, C: { L: -24, C: -20, R: -24 }, R: { L: -28, C: -24, R: -20 } };
document.querySelectorAll('[data-sim]').forEach((btn) => {
  btn.onclick = () => {
    const near = btn.dataset.sim;
    const t = Date.now();
    for (const ear of EARS) {
      const db = SIM_DB[near][ear];
      fusion.ingest({ type: MSG.LEVEL, ear, t, db, floorDb: -60, bandRatio: 0.6, screamScore: 0.9 });
      if (ear === near || db > -25) fusion.ingest({ type: MSG.SCREAM, ear, t, peakDb: db, durationMs: 350, confidence: 0.9 });
    }
    log(`simulated scream near ${near}`);
  };
});
document.querySelectorAll('[data-simcam]').forEach((btn) => {
  btn.onclick = () => {
    fusion.ingest({ type: MSG.SIGHTING, ear: btn.dataset.simcam, t: Date.now(), confidence: 0.85, offset: 0.2 });
    log(`simulated camera sighting on ${btn.dataset.simcam}`);
  };
});
