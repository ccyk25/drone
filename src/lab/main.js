// Hearing lab: runs the real ear pipeline (features → floor → detector) on real recordings.
// Owner: P1. Open /lab.html, press Run. Results also land in window.__labResults.
import { CONFIG } from '../shared/config.js';
import { computeFeatures } from '../ear/audio.js';
import { createFloorTracker, createScreamDetector, createNoiseProfile } from '../ear/detector.js';

const SR = 48000;
const N = CONFIG.audio.frameSize;
const HOP = Math.round((CONFIG.ear.analysisMs / 1000) * SR);
const $ = (id) => document.getElementById(id);

// ---------- audio helpers ----------
async function load(name) {
  const buf = await (await fetch(`/sounds/${name}`)).arrayBuffer();
  const ctx = new OfflineAudioContext(1, SR, SR);
  const decoded = await ctx.decodeAudioData(buf);
  // resample to 48 kHz mono
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * SR), SR);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  return (await off.startRendering()).getChannelData(0).slice();
}

const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / Math.max(1, x.length));
const dbOf = (x) => 20 * Math.log10(rms(x) + 1e-12);
const scaleTo = (x, targetDb) => { const g = 10 ** ((targetDb - dbOf(x)) / 20); return x.map((v) => v * g); };
const seconds = (s) => Math.round(s * SR);

function loopTo(x, len) {
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) out[i] = x[i % x.length];
  return out;
}

/** Trims leading/trailing silence so loudness targets apply to the actual sound. */
function trim(x, thresh = 0.02) {
  let a = 0, b = x.length - 1;
  while (a < b && Math.abs(x[a]) < thresh) a++;
  while (b > a && Math.abs(x[b]) < thresh) b--;
  return x.slice(a, b + 1);
}

/** RBJ low-pass biquad: models sound passing through rubble/walls (high frequencies lost). */
function lowpass(x, cutoffHz, q = 0.7) {
  const w0 = (2 * Math.PI * cutoffHz) / SR, alpha = Math.sin(w0) / (2 * q), c = Math.cos(w0);
  const b0 = (1 - c) / 2, b1 = 1 - c, b2 = (1 - c) / 2, a0 = 1 + alpha, a1 = -2 * c, a2 = 1 - alpha;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  // two passes = steeper (24 dB/oct) like thick debris
  return y;
}
const muffle = (x, hz) => lowpass(lowpass(x, hz), hz);

function roomNoise(len, db = -65) {
  let s = 12345;
  const x = Float32Array.from({ length: len }, () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296) * 2 - 1);
  return scaleTo(x, db);
}

/** Repeats a short call ("help… help… help…") with gaps. */
function calls(x, times, gapS) {
  const gap = seconds(gapS);
  const out = new Float32Array(times * (x.length + gap));
  for (let k = 0; k < times; k++) out.set(x, k * (x.length + gap));
  return out;
}

/** background (with 5 s lead-in so the floor adapts) + event placed after the lead-in */
function scene(background, event, leadS = 5, tailS = 1.5) {
  const lead = seconds(leadS);
  const len = lead + (event ? event.length : 0) + seconds(tailS);
  const out = loopTo(background, len);
  if (event) for (let i = 0; i < event.length; i++) out[lead + i] += event[i];
  return { samples: out, eventStart: lead, eventEnd: lead + (event ? event.length : 0) };
}

// ---------- FFT (radix-2) → dB spectrum like AnalyserNode ----------
const hann = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
function spectrumDb(frame) {
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = frame[i] * hann[i];
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < N; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
        const vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
      }
    }
  }
  const out = new Float32Array(N / 2);
  for (let k = 0; k < N / 2; k++) out[k] = 10 * Math.log10((re[k] * re[k] + im[k] * im[k]) / N + 1e-20);
  return out;
}

// ---------- run the real ear pipeline over a scene ----------
function analyse({ samples, eventStart, eventEnd }, { muffled }) {
  const floor = createFloorTracker({ windowS: CONFIG.ear.floorWindowS, percentile: CONFIG.ear.floorPercentile, analysisMs: CONFIG.ear.analysisMs });
  const det = createScreamDetector(CONFIG.scream, CONFIG.muffled, { muffled });
  const profile = createNoiseProfile(CONFIG.noiseProfile);
  const events = [];
  const bg = { nov: -Infinity, clar: 0, n: 0 }, evStat = { bright: -Infinity, voice: -Infinity, clar: 0 };
  for (let start = 0, k = 0; start + N <= samples.length; start += HOP, k++) {
    const frame = samples.subarray(start, start + N);
    const f = computeFeatures(frame, spectrumDb(frame), SR, N);
    const nov = profile.update(f.freqDb, f.binHz);
    const floorDb = floor.push(f.db);
    const at = k * CONFIG.ear.analysisMs;
    const { event } = det.update({ ...f, ...nov, floorDb }, at);
    const inLead = start + N < eventStart, inEv = start + N >= eventStart && start <= eventEnd;
    if (inLead && k > 20) { bg.nov = Math.max(bg.nov, nov.noveltyBrightDb); bg.clar = Math.max(bg.clar, f.clarity); bg.n++; }
    (window.__labTrace ??= {})[analyse.current] ??= [];
    if (inEv || f.clarity >= 0.5 || (inLead && start + N > eventStart - seconds(1))) window.__labTrace[analyse.current].push([+(start / SR).toFixed(2), +nov.noveltyBrightDb.toFixed(1), +nov.noveltyVoiceDb.toFixed(1), +f.clarity.toFixed(2), Math.round(f.pitchHz), inEv ? 1 : 0]);
    if (inEv) { evStat.bright = Math.max(evStat.bright, nov.noveltyBrightDb); evStat.voice = Math.max(evStat.voice, nov.noveltyVoiceDb); evStat.clar = Math.max(evStat.clar, f.clarity); }
    if (event) events.push({ ...event, atS: start / SR, inEvent: start + N >= eventStart && start <= eventEnd + seconds(0.5) });
  }
  return { events, bgFlatness: bg.n ? bg.nov : null, bgClarity: bg.n ? bg.clar : null, evStat };
}

// ---------- scenarios ----------
async function run() {
  $('run').disabled = true;
  $('status').textContent = 'Loading recordings…';
  const [river, rain, rain2, sc, sd, help] = await Promise.all(
    ['flood-river.flac', 'rain-heavy.ogg', 'rain-summer.ogg', 'scream-c.wav', 'scream-d.wav', 'voice-help.ogg'].map(load)
  );
  const room = roomNoise(seconds(10));
  const screamC = trim(sc), screamD = trim(sd), helpCall = calls(trim(help), 3, 0.35);

  const FLOOD_DB = -30;                 // loud flood bed
  const floodRiver = scaleTo(river, FLOOD_DB), heavyRain = scaleTo(rain, FLOOD_DB), summerRain = scaleTo(rain2, FLOOD_DB);
  const ev = (x, db) => scaleTo(x, db);
  const muffledHelp = (db) => scaleTo(muffle(helpCall, 600), db);   // behind rubble: <600 Hz survives

  const S = [
    // [name, scene, options, expectation, what it proves]
    ['Flooded river only (loud)', scene(floodRiver, null), { muffled: true }, 'none', 'flood noise is not a person'],
    ['Heavy rain only (loud)', scene(heavyRain, null), { muffled: true }, 'none', 'rain is not a person'],
    ['Summer downpour only (loud)', scene(summerRain, null), { muffled: true }, 'none', 'rain is not a person'],
    ['River + heavy rain together (loud)', scene(floodRiver.map((v, i) => v + heavyRain[i % heavyRain.length]), null), { muffled: true }, 'none', 'combined storm noise is not a person'],
    ['Scream C in a quiet room', scene(room, ev(screamC, -25)), { muffled: false }, 'person', 'baseline'],
    ['Scream D in a quiet room', scene(room, ev(screamD, -25)), { muffled: false }, 'person', 'baseline'],
    ['Scream C over flooded river, +6 dB', scene(floodRiver, ev(screamC, FLOOD_DB + 6)), { muffled: false }, 'person', 'screams cut through floods'],
    ['Scream C over flooded river, 0 dB', scene(floodRiver, ev(screamC, FLOOD_DB)), { muffled: false }, 'person', 'as loud as the flood'],
    ['Scream D over heavy rain, 0 dB', scene(heavyRain, ev(screamD, FLOOD_DB)), { muffled: false }, 'person', 'as loud as the rain'],
    ['Scream C over flooded river, -6 dB', scene(floodRiver, ev(screamC, FLOOD_DB - 6)), { muffled: false }, 'person', 'quieter than the flood'],
    ['Scream D over flooded river, -12 dB', scene(floodRiver, ev(screamD, FLOOD_DB - 12)), { muffled: false }, 'either', 'limit test: much quieter than the flood'],
    ['"Help!" ×3 muffled by rubble, quiet room', scene(room, muffledHelp(-40)), { muffled: true }, 'person', 'muffled voice is heard'],
    ['"Help!" ×3 muffled, over flooded river +6 dB', scene(floodRiver, muffledHelp(FLOOD_DB + 6)), { muffled: true }, 'person', 'muffled voice through flood noise'],
    ['"Help!" ×3 muffled, over flooded river 0 dB', scene(floodRiver, muffledHelp(FLOOD_DB)), { muffled: true }, 'either', 'limit test'],
    ['"Help!" ×3 muffled, over heavy rain +6 dB', scene(heavyRain, muffledHelp(FLOOD_DB + 6)), { muffled: true }, 'either', 'limit test: hissy rain'],
    ['"Help!" ×3 muffled, over heavy rain 0 dB', scene(heavyRain, muffledHelp(FLOOD_DB)), { muffled: true }, 'either', 'limit test: hissy rain']
  ];

  const rows = [];
  for (const [name, sc2, opts, expect, why] of S) {
    $('status').textContent = `Analysing: ${name}…`;
    await new Promise((r) => setTimeout(r, 0));
    analyse.current = name;
    const r = analyse(sc2, opts);
    const kinds = r.events.map((e) => e.kind);
    const falseAlarms = r.events.filter((e) => !e.inEvent).length;
    let pass;
    if (expect === 'none') pass = r.events.length === 0;
    else if (expect === 'either') pass = falseAlarms === 0;
    else pass = r.events.some((e) => e.inEvent) && falseAlarms === 0;   // 'person': any human detection, in time
    rows.push({ name, expect, got: kinds.join(', ') || 'none', falseAlarms, pass, why,
      bgFlatness: r.bgFlatness?.toFixed(1), bgClarity: r.bgClarity?.toFixed(2),
      ev: `bright ${r.evStat.bright.toFixed(1)} dB, voice ${r.evStat.voice.toFixed(1)} dB, pitch-clarity ${r.evStat.clar.toFixed(2)}`,
      conf: r.events.map((e) => e.confidence.toFixed(2)).join(', ') });
  }
  window.__labResults = rows;
  render(rows);
  $('status').textContent = `Done: ${rows.filter((r) => r.pass).length}/${rows.length} pass`;
  $('run').disabled = false;
}

function render(rows) {
  $('out').innerHTML = `<table><tr><th></th><th>Scenario</th><th>Expected</th><th>Detected</th><th>Confidence</th><th>False alarms</th><th>Background: max rise / max pitch-clarity</th><th>During event</th><th>Proves</th></tr>${
    rows.map((r) => `<tr class="${r.pass ? 'ok' : 'bad'}"><td>${r.pass ? '✅' : '❌'}</td><td>${r.name}</td><td>${r.expect}</td><td>${r.got}</td><td>${r.conf}</td><td>${r.falseAlarms}</td><td>${r.bgFlatness ?? '–'} dB / ${r.bgClarity ?? '–'}</td><td>${r.ev}</td><td>${r.why}</td></tr>`).join('')
  }</table>`;
}

// ---------- listen to the demo sounds ----------
document.querySelectorAll('[data-play]').forEach((b) => {
  b.onclick = () => { const a = new Audio(`/sounds/${b.dataset.play}`); a.loop = b.dataset.play.startsWith('flood') || b.dataset.play.startsWith('rain'); a.play(); b.textContent = '▶ playing'; setTimeout(() => { a.pause(); b.textContent = `▶ ${b.dataset.play}`; }, 6000); };
});
$('run').onclick = run;
