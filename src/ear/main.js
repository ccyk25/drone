// Phone "ear" page wiring. Owner: P1.
// URL: ear.html?room=ABCD&ear=L|C|R
import { CONFIG } from '../shared/config.js';
import { EARS, MSG } from '../shared/protocol.js';
import { joinRoom } from '../realtime/channel.js';
import { startMic } from './audio.js';
import { createFloorTracker, createScreamDetector, createNoiseProfile } from './detector.js';
import { createCalibrator } from './calibrate.js';
import { loadDetector, startCamera, bestPerson, createSightingGate } from './camera.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const room = (params.get('room') || '').toUpperCase();
const ear = (params.get('ear') || '').toUpperCase();

if (!room || !EARS.includes(ear)) showJoin();
else runEar(room, ear);

function showJoin() {
  $('join').classList.remove('hidden');
  $('roomInput').value = room;
  document.querySelectorAll('#join [data-ear]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const r = $('roomInput').value.trim().toUpperCase();
      if (r.length !== 4) { $('roomInput').focus(); return; }
      location.search = `?room=${r}&ear=${btn.dataset.ear}`;
    });
  });
}

function runEar(room, ear) {
  $('earView').classList.remove('hidden');
  $('letter').textContent = ear;
  $('room').textContent = room;

  const setStatus = (s) => {
    $('dot').className = `dot ${s}`;
    $('status').textContent = { live: 'live', local: 'local only (same browser)', error: 'connection error', connecting: 'connecting…' }[s] || s;
  };
  const channel = joinRoom(room, { onStatus: setStatus, onMessage });
  setStatus(channel.status);

  const floor = createFloorTracker({
    windowS: CONFIG.ear.floorWindowS, percentile: CONFIG.ear.floorPercentile, analysisMs: CONFIG.ear.analysisMs
  });
  const detector = createScreamDetector(CONFIG.scream, CONFIG.muffled);
  const profile = createNoiseProfile(CONFIG.noiseProfile);   // learned background spectrum
  const calibrator = createCalibrator(CONFIG.calibration);
  let mic = null;
  let sent = 0;
  let lastLevelSent = 0;
  let lastHello = 0;
  let wakeLock = null;

  $('startBtn').addEventListener('click', async () => {
    if (mic) return;
    try {
      mic = await startMic(CONFIG.audio);
    } catch (err) {
      $('sub').textContent = `Microphone blocked: ${err.message}. This page needs HTTPS and mic permission.`;
      return;
    }
    $('startBtn').classList.add('hidden');
    $('muffledBtn').classList.remove('hidden');
    $('sub').textContent = 'Listening…';
    await keepAwake();
    channel.send({ type: MSG.HELLO, ear, label: navigator.userAgent.slice(0, 60) });
    lastHello = performance.now();
    setInterval(loop, CONFIG.ear.analysisMs);
  });

  // Muffled-voice mode: also detect quiet, dull, voiced sounds (a person behind rubble).
  // OFF by default because normal talking near the phone would trigger it during the pitch.
  $('muffledBtn').addEventListener('click', () => {
    detector.setMuffled(!detector.muffledOn);
    $('muffledBtn').textContent = detector.muffledOn ? '🔊 Muffled-voice mode: ON' : '🔇 Muffled-voice mode: OFF';
  });

  // --- Camera "eyes" (optional; independent of the microphone) ---------------
  let eyesOn = false;
  $('eyeBtn').addEventListener('click', async () => {
    if (eyesOn) return;
    eyesOn = true;
    $('eyeBtn').classList.add('hidden');
    $('eyeBox').classList.remove('hidden');
    const video = $('cam');
    try {
      await startCamera(video);
      $('eyeStatus').textContent = 'Loading person detector…';
      const model = await loadDetector();
      $('eyeStatus').textContent = 'Eyes on: looking for people';
      runEyes(model, video);
    } catch (err) {
      $('eyeStatus').textContent = `Camera unavailable: ${err.message}`;
    }
  });

  function runEyes(model, video) {
    const gate = createSightingGate(CONFIG.camera);
    const canvas = $('camOverlay');
    const g = canvas.getContext('2d');
    let busy = false;
    let seen = 0;
    setInterval(async () => {
      if (busy || video.readyState < 2) return;
      busy = true;
      try {
        const preds = await model.detect(video);
        const w = video.videoWidth, h = video.videoHeight;
        canvas.width = w; canvas.height = h;
        g.clearRect(0, 0, w, h);
        const person = bestPerson(preds, w, CONFIG.camera.minScore);
        if (person) {
          const [x, y, bw, bh] = person.bbox;
          g.strokeStyle = '#ff4d4f'; g.lineWidth = Math.max(3, w / 160);
          g.strokeRect(x, y, bw, bh);
          $('eyeStatus').textContent = `Person ${(person.score * 100).toFixed(0)}%`;
        } else {
          $('eyeStatus').textContent = `Eyes on: no person · ${seen} sent`;
        }
        const sighting = gate.update(person, performance.now());
        if (sighting) {
          channel.send({ type: MSG.SIGHTING, ear, t: Date.now(), ...sighting });
          seen += 1;
          flash();
        }
      } finally {
        busy = false;
      }
    }, CONFIG.camera.intervalMs);
  }

  function loop() {
    const at = performance.now();
    const features = mic.read();
    const { db, bandRatio } = features;
    const floorDb = floor.push(db);
    const novelty = profile.update(features.freqDb, features.binHz);
    const frame = { ...features, ...novelty, floorDb };
    const { score, event } = detector.update(frame, at);

    const cal = calibrator.update(db, at);
    if (cal?.done === 'floor') $('sub').textContent = `Noise floor ${cal.floorDb.toFixed(0)} dB. Waiting for the clap…`;
    if (cal?.done === 'clap') {
      channel.send({ type: MSG.CALIBRATION, ear, floorDb: cal.floorDb, clapPeakDb: cal.clapPeakDb });
      $('sub').textContent = `Clap heard at ${cal.clapPeakDb.toFixed(0)} dB. Sent.`;
    }

    if (event) {
      channel.send({ type: MSG.SCREAM, ear, t: Date.now(), ...event });
      sent += 1;
      $('countText').textContent = `${sent} sent · last: ${event.kind === 'muffled' ? 'muffled voice' : 'scream'}`;
      flash();
    }

    if (at - lastLevelSent >= 1000 / CONFIG.ear.levelHz) {
      lastLevelSent = at;
      channel.send({ type: MSG.LEVEL, ear, t: Date.now(), db, floorDb, bandRatio, screamScore: score });
    }
    if (at - lastHello >= CONFIG.ear.helloEveryMs) {
      lastHello = at;
      channel.send({ type: MSG.HELLO, ear });
    }
    render(db, floorDb, score);
    $('sound').textContent = describeSound(frame);
  }

  // What the phone thinks it hears right now (helps tune on the day)
  function describeSound(f) {
    const rise = Math.max(f.noveltyBrightDb, f.noveltyVoiceDb);
    if (rise < 6) return `background (learned) · ${f.db.toFixed(0)} dB`;
    if (f.clarity >= 0.55 && f.pitchHz >= 120) return `voice-like · pitch ${f.pitchHz.toFixed(0)} Hz · +${rise.toFixed(0)} dB`;
    return `noise burst (no pitch) · +${rise.toFixed(0)} dB`;
  }

  function onMessage(msg) {
    if (msg.type !== MSG.CALIBRATE) return;
    const at = performance.now();
    if (msg.phase === 'start') { calibrator.startFloor(at); $('sub').textContent = 'Calibrating: stay quiet for 3 seconds…'; }
    if (msg.phase === 'clap') { calibrator.startClap(at); $('sub').textContent = 'Clap once, loudly, at the centre!'; }
    if (msg.phase === 'done') {
      const g = msg.gains?.[ear];
      $('sub').textContent = g ? `Calibrated ✓ (gain ${(20 * Math.log10(g)).toFixed(1)} dB)` : 'Calibrated ✓';
    }
  }

  function render(db, floorDb, score) {
    const pct = (v) => Math.max(0, Math.min(100, ((v + 90) / 90) * 100)); // -90..0 dBFS
    $('levelBar').style.width = `${pct(db)}%`;
    $('floorMark').style.left = `${pct(floorDb)}%`;
    $('scoreBar').style.width = `${Math.round(score * 100)}%`;
    $('dbText').textContent = `${db.toFixed(0)} dB · floor ${floorDb.toFixed(0)}`;
  }

  function flash() {
    $('earBox').classList.add('flash');
    navigator.vibrate?.(150);
    setTimeout(() => $('earBox').classList.remove('flash'), 400);
  }

  async function keepAwake() {
    try {
      wakeLock = await navigator.wakeLock?.request('screen');
      document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'visible') wakeLock = await navigator.wakeLock?.request('screen');
      });
    } catch { /* not supported; ask the user to keep the screen on */ }
  }
}
