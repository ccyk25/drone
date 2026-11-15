// Live rescue response on the mission map. Owner: P1 (Claude), plugged into P2's main.js.
//
// The demo sequence, driven by the REAL phone sensors (camera sightings + mic screams):
//   1. 📷 Camera sees a person → turn toward them and step forward a little (re-steer on every sighting)
//   2. Person leaves the camera view → 🌡 heat check (SIMULATED thermal: works in the open, blocked by rubble)
//   3. 👂 Drone speaker: "If you can hear me, shout!" → a voice from the left turns the drone left, a short step
//   4. ✅ Confirmed (voice + camera/heat, or the same voice twice) → speaker: "Help is coming", 🚩 flag with details
//   5. Resume searching; the next voice starts the same sequence.
// Moves are always bounded steps (never "fly forward forever").

const STEP = { camera: 15, audio: 25 };            // metres per response step
const EST_RANGE = { camera: 20, audio: 40 };        // where we guess the person is along the bearing
const LOST_MS = 5000;                               // camera hasn't seen them for this long → heat check
const HEAT_MS = 2500;                               // time the heat check takes
const LISTEN_MS = 30000;                            // how long we wait for a voice before resuming search
const CONFIRMED_HOLD_MS = 9000;                     // show the confirmation, then resume search
const SAME_VOICE_DEG = 35;                          // two voices this close in direction = same person

const rad = (d) => (d * Math.PI) / 180;
const wrap = (d) => ((d % 360) + 360) % 360;
const angGap = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const compass = (d) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(wrap(d) / 45) % 8];

export function createResponder(env) {
  // env: { drone, setTarget(xy), applyDetection(xy, abs, conf), addPin(xy, conf, label), addFlag(xy, html),
  //        showBearing(xy, abs, len), flash(xy), log(html, kind), scenario() → 'flood'|'collapse', toLatLng(x,y), hud }
  let phase = 'search';
  let evidence = [];          // { sensor, t, abs, xy, conf }
  let lastSeen = { camera: -1e9, audio: -1e9 };
  let phaseAt = 0;
  let speakingUntil = 0;
  let heatResult = null;
  let flags = 0;

  // ---------- on-screen phase banner ----------
  const banner = document.createElement('div');
  banner.id = 'gema-phase';
  banner.style.cssText = 'position:fixed;top:30vh;left:50%;transform:translateX(-50%);z-index:2000;padding:10px 18px;border-radius:14px;' +
    'font:700 18px system-ui;color:#fff;background:rgba(15,18,24,.88);box-shadow:0 6px 24px rgba(0,0,0,.4);pointer-events:none;' +
    'transition:background .2s;max-width:92vw;text-align:center';
  (env.hud || document.body).appendChild(banner);
  const PHASES = {
    search: ['🔍 SEARCHING', 'rgba(15,18,24,.88)'],
    track: ['📷 PERSON IN VIEW · approaching', 'rgba(46,125,50,.92)'],
    heat: ['🌡 HEAT CHECK · thermal (simulated)', 'rgba(230,81,0,.92)'],
    listen: ['👂 LISTENING · shout for help!', 'rgba(21,101,192,.92)'],
    voice: ['🔊 VOICE HEARD · turning toward it', 'rgba(21,101,192,.92)'],
    confirmed: ['✅ PERSON CONFIRMED · help is coming', 'rgba(27,94,32,.95)']
  };
  function setPhase(p, now, extra = '') {
    phase = p; phaseAt = now;
    const [text, bg] = PHASES[p];
    banner.innerHTML = text + (extra ? `<div style="font:500 13px system-ui;opacity:.9;margin-top:2px">${extra}</div>` : '');
    banner.style.background = bg;
  }
  setPhase('search', 0);

  // ---------- drone speaker (laptop speech) ----------
  function say(text) {
    env.log(`🔈 Drone speaker: "${text}"`, 'det');
    try {
      const synth = window.speechSynthesis;
      if (!synth) return;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.95; u.pitch = 1; u.volume = 1;
      speakingUntil = Date.now() + 800 + text.length * 65;           // estimate, corrected on end
      u.onend = () => { speakingUntil = Date.now() + 800; };           // ignore our own voice echoing into the mics
      synth.speak(u);
    } catch { /* speech not available */ }
  }

  // ---------- helpers ----------
  const droneXY = () => ({ x: env.drone.state.x, y: env.drone.state.y });
  const along = (from, abs, m) => ({ x: from.x + Math.sin(rad(abs)) * m, y: from.y + Math.cos(rad(abs)) * m });
  const has = (s) => evidence.some((e) => e.sensor === s);
  function personXY() {
    const pts = evidence.length ? evidence : [];
    return { x: pts.reduce((a, e) => a + e.xy.x, 0) / pts.length, y: pts.reduce((a, e) => a + e.xy.y, 0) / pts.length };
  }

  function step(sensor, abs) {
    const from = droneXY();
    env.setTarget(along(from, abs, STEP[sensor]));
  }

  function confirmedNow() {
    const voices = evidence.filter((e) => e.sensor === 'audio');
    if (!voices.length) return false;
    if (has('camera') || (has('thermal') && heatResult?.seen)) return true;
    // the same voice twice from a consistent direction
    for (let i = 0; i < voices.length; i++)
      for (let j = i + 1; j < voices.length; j++)
        if (angGap(voices[i].abs, voices[j].abs) <= SAME_VOICE_DEG) return true;
    return false;
  }

  function confirm(now) {
    const p = personXY();
    const [lat, lng] = env.toLatLng(p.x, p.y);
    const scen = env.scenario();
    const heatSeen = heatResult?.seen;
    const where = scen === 'collapse'
      ? (heatSeen ? 'In the open near collapsed structures' : 'Likely <b>under rubble</b>: no heat line of sight, voice heard')
      : (heatSeen ? 'Exposed <b>on a roof or vehicle</b> above the water' : 'Likely <b>inside a building</b> (attic or upper floor)');
    const voices = evidence.filter((e) => e.sensor === 'audio');
    const dir = voices.length ? voices[voices.length - 1].abs : evidence[evidence.length - 1].abs;
    const sensors = [
      has('camera') ? '📷 camera ✓' : '📷 camera –',
      heatResult ? (heatSeen ? '🌡 heat ✓' : '🌡 heat: blocked') : '🌡 heat –',
      `👂 voice ✓${voices.length > 1 ? ` ×${voices.length}` : ''}`
    ].join(' · ');
    flags += 1;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const html = `<div style="font:600 13px system-ui;line-height:1.35;min-width:220px">
      <div style="font-size:15px">🚩 Survivor #${flags} confirmed</div>
      <div>${where}</div>
      <div style="color:#555">${sensors}</div>
      <div style="color:#555">Direction ${Math.round(wrap(dir))}° ${compass(dir)} from drone · ${time}</div>
      <div style="color:#555">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
      <div style="color:#1b5e20">Speaker: "Help is coming" · rescue team notified</div></div>`;
    env.addFlag(p, html);
    env.flash(p);
    env.log(`✅ <b>Survivor #${flags} confirmed</b> · ${where.replace(/<[^>]+>/g, '')} · ${sensors}`, 'found');
    say('Help is coming. Stay where you are.');
    env.setTarget(droneXY());                                   // hover over the spot
    setPhase('confirmed', now, `${where.replace(/<[^>]+>/g, '')}`);
  }

  function startHeat(now) {
    setPhase('heat', now, 'Checking for body heat where the person was…');
    env.log('🌡 Person out of sight → heat check (simulated thermal)', 'muted');
  }

  function finishHeat(now) {
    // SIMULATED thermal, consistent with the engine: sees people in the open, blocked by rubble/roofs.
    const seen = env.scenario() !== 'collapse';
    heatResult = { seen };
    const p = evidence.length ? personXY() : droneXY();
    evidence.push({ sensor: 'thermal', t: now, abs: env.drone.state.headingDeg, xy: p, conf: seen ? 0.8 : 0 });
    if (seen) env.log('🌡 Heat signature found (~36 °C) · simulated thermal', 'det');
    else env.log('🌡 No heat line of sight (rubble/roof blocks thermal) · switching to ears', 'warn');
    if (confirmedNow()) { confirm(now); return; }
    setPhase('listen', now, seen ? 'Heat found. Call out to confirm and get a direction.' : 'Thermal blocked. Call out so the ears can find you.');
    say('If you can hear me, shout for help.');
  }

  function resume(now) {
    evidence = []; heatResult = null; lastSeen = { camera: -1e9, audio: -1e9 };
    setPhase('search', now);
    env.log('🔍 Resuming search', 'muted');
    return 'resume';
  }

  // ---------- public ----------
  return {
    get phase() { return phase; },
    busy: () => phase !== 'search',

    /** Returns true if handled (real sensor or simulate button). */
    onDetection(det, now) {
      const sensor = det.sensor === 'camera' ? 'camera' : 'audio';
      if (sensor === 'audio' && Date.now() < speakingUntil) { env.log('(ignored: drone speaker echo)', 'muted'); return true; }
      if (phase === 'confirmed') return true;                     // holding over the confirmed survivor
      // A voice answering the drone's "shout for help" confirms, even if the person moved relative to the
      // drone (the phones stay put on stage while the virtual drone turns).
      const answeredCallout = sensor === 'audio' && phase === 'listen' && evidence.length > 0;
      const from = droneXY();
      const abs = wrap(env.drone.state.headingDeg + det.relBearingDeg);
      const est = along(from, abs, EST_RANGE[sensor]);
      evidence.push({ sensor, t: now, abs, xy: est, conf: det.confidence });
      lastSeen[sensor] = now;
      env.applyDetection(from, abs, det.confidence);
      env.showBearing(from, abs, EST_RANGE[sensor] * 1.5);
      env.addPin(est, det.confidence, sensor === 'camera' ? 'Person seen · camera' : 'Voice · mic');
      const turn = Math.abs(det.relBearingDeg) < 8 ? 'straight ahead' : det.relBearingDeg < 0 ? `turning left ${Math.round(-det.relBearingDeg)}°` : `turning right ${Math.round(det.relBearingDeg)}°`;
      if (sensor === 'camera') {
        env.log(`📷 Person in view · ${turn} · step ${STEP.camera} m`, 'det');
        setPhase('track', now, `${turn} · ${Math.round(det.confidence * 100)}%`);
      } else {
        env.log(`🔊 Voice heard · ${turn} · step ${STEP.audio} m`, 'det');
        setPhase('voice', now, turn);
      }
      step(sensor, abs);
      if (answeredCallout || confirmedNow()) confirm(now);
      return true;
    },

    /** Call every tick. Returns 'resume' when the main loop should go back to normal search. */
    tick(now, arrived) {
      if (phase === 'track' && now - lastSeen.camera > LOST_MS) startHeat(now);
      else if (phase === 'voice' && (arrived || now - lastSeen.audio > 4000)) {
        if (!heatResult) startHeat(now);
        else { setPhase('listen', now, 'Call out again to confirm.'); say('Shout again so I can find you.'); }
      } else if (phase === 'heat' && now - phaseAt > HEAT_MS) finishHeat(now);
      else if (phase === 'listen' && now - phaseAt > LISTEN_MS) { env.log('No voice heard', 'warn'); return resume(now); }
      else if (phase === 'confirmed' && now - phaseAt > CONFIRMED_HOLD_MS) return resume(now);
      return null;
    }
  };
}
