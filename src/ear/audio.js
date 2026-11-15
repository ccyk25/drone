// Microphone capture and per-frame features. Owner: P1.
import { CONFIG } from '../shared/config.js';

/** Pure feature extraction so it can be unit-tested. */
export function computeFeatures(timeData, freqDb, sampleRate, fftSize, audioCfg = CONFIG.audio) {
  let sum = 0;
  for (let i = 0; i < timeData.length; i++) sum += timeData[i] * timeData[i];
  const rms = Math.sqrt(sum / timeData.length);
  const db = 20 * Math.log10(rms + 1e-9);

  const binHz = sampleRate / fftSize;
  let total = 0, band = 0;
  for (let i = 1; i < freqDb.length; i++) {
    const hz = i * binHz;
    if (hz < 80) continue;                       // ignore DC / rumble
    const p = 10 ** (freqDb[i] / 10);
    if (!Number.isFinite(p)) continue;
    total += p;
    if (hz >= audioCfg.bandLowHz && hz <= audioCfg.bandHighHz) band += p;
  }
  const bandRatio = total > 0 ? band / total : 0;
  return { db, bandRatio };
}

/**
 * Starts the mic. Must be called from a user gesture (iOS).
 * Echo cancellation, noise suppression and auto gain are switched OFF: they would flatten
 * loudness differences between phones (needed for direction) and suppress rotor noise.
 */
export async function startMic(audioCfg = CONFIG.audio) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
  });
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  await ctx.resume();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = audioCfg.frameSize;
  analyser.smoothingTimeConstant = 0;
  source.connect(analyser);

  const time = new Float32Array(analyser.fftSize);
  const freq = new Float32Array(analyser.frequencyBinCount);

  return {
    sampleRate: ctx.sampleRate,
    read() {
      analyser.getFloatTimeDomainData(time);
      analyser.getFloatFrequencyData(freq);
      return computeFeatures(time, freq, ctx.sampleRate, analyser.fftSize, audioCfg);
    },
    async stop() {
      stream.getTracks().forEach((t) => t.stop());
      await ctx.close();
    }
  };
}
