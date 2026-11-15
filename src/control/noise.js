// noise.js (P2): synthetic rotor noise played through the laptop speakers (HANDOVER §5.6, §8.3).
// Two detuned sawtooth tones (~110 and ~180 Hz) with a blade-pass wobble, plus low-pass filtered noise.

let ctx = null;
let nodes = null;
let volume = 0.5;

function buildNoiseBuffer(ac) {
  const len = ac.sampleRate * 2;
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) { last = 0.97 * last + 0.03 * (Math.random() * 2 - 1); d[i] = last * 6; } // brown-ish
  return buf;
}

export function isRotorNoiseOn() { return !!nodes; }

export function startRotorNoise() {
  if (nodes) return;
  ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  const master = ctx.createGain();
  master.gain.setValueAtTime(0, ctx.currentTime);
  master.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.6);
  master.connect(ctx.destination);

  const toneBus = ctx.createGain(); toneBus.gain.value = 0.18;
  const toneLp = ctx.createBiquadFilter(); toneLp.type = 'lowpass'; toneLp.frequency.value = 900;
  toneBus.connect(toneLp).connect(master);

  const oscs = [];
  for (const [f, det] of [[110, -7], [112, 9], [180, -5], [183, 6]]) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
    o.connect(toneBus); o.start(); oscs.push(o);
  }
  // blade-pass amplitude wobble (~18 Hz) for the "chop"
  const lfo = ctx.createOscillator(); lfo.frequency.value = 18;
  const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.08;
  lfo.connect(lfoGain).connect(toneBus.gain); lfo.start(); oscs.push(lfo);

  const src = ctx.createBufferSource(); src.buffer = buildNoiseBuffer(ctx); src.loop = true;
  const nLp = ctx.createBiquadFilter(); nLp.type = 'lowpass'; nLp.frequency.value = 1200;
  const nGain = ctx.createGain(); nGain.gain.value = 0.55;
  src.connect(nLp).connect(nGain).connect(master); src.start();

  nodes = { master, oscs, src };
}

export function stopRotorNoise() {
  if (!nodes) return;
  const { master, oscs, src } = nodes;
  nodes = null;
  const t = ctx.currentTime;
  master.gain.cancelScheduledValues(t);
  master.gain.setValueAtTime(master.gain.value, t);
  master.gain.linearRampToValueAtTime(0, t + 0.3);
  setTimeout(() => { oscs.forEach(o => o.stop()); src.stop(); master.disconnect(); }, 400);
}

/** 0..1 */
export function setRotorVolume(v) {
  volume = Math.max(0, Math.min(1, v));
  if (nodes) nodes.master.gain.setTargetAtTime(volume, ctx.currentTime, 0.1);
}
