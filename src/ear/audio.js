// Microphone capture and per-frame features. Owner: P1.
//
// Features per frame (about every 50 ms):
//   db         loudness (RMS dBFS)
//   bandRatio  share of energy between 1 and 4 kHz (a clear scream is bright)
//   flatness   spectral flatness 0..1: rushing water, rain and wind are broadband ("flat", near 1);
//              voices are peaky (near 0). This is how we tell flood noise from people.
//   clarity    0..1 strength of a repeating pitch (autocorrelation). Voices, even muffled
//              ones behind rubble, are periodic; water and rotor wash are not.
//   pitchHz    estimated pitch when clarity is high
import { CONFIG } from '../shared/config.js';

/** Normalised autocorrelation peak in the voice range → { clarity, pitchHz }. */
export function voicing(timeData, sampleRate, minHz = 120, maxHz = 1000) {
  const n = timeData.length;
  const minLag = Math.max(2, Math.floor(sampleRate / maxHz));
  const maxLag = Math.min(n - 2, Math.ceil(sampleRate / minHz));
  // remove DC so a constant offset can't look "periodic"
  let mean = 0;
  for (let i = 0; i < n; i++) mean += timeData[i];
  mean /= n;
  let best = 0, bestLag = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let xy = 0, xx = 0, yy = 0;
    for (let i = 0; i + lag < n; i++) {
      const a = timeData[i] - mean, b = timeData[i + lag] - mean;
      xy += a * b; xx += a * a; yy += b * b;
    }
    const r = xx > 0 && yy > 0 ? xy / Math.sqrt(xx * yy) : 0;
    if (r > best) { best = r; bestLag = lag; }
  }
  return { clarity: Math.max(0, best), pitchHz: bestLag ? sampleRate / bestLag : 0 };
}

/** Pure feature extraction so it can be unit-tested. */
export function computeFeatures(timeData, freqDb, sampleRate, fftSize, audioCfg = CONFIG.audio, withVoicing = true) {
  let sum = 0;
  for (let i = 0; i < timeData.length; i++) sum += timeData[i] * timeData[i];
  const rms = Math.sqrt(sum / timeData.length);
  const db = 20 * Math.log10(rms + 1e-9);

  const binHz = sampleRate / fftSize;
  let total = 0, band = 0, logSum = 0, count = 0;
  for (let i = 1; i < freqDb.length; i++) {
    const hz = i * binHz;
    if (hz < 80 || hz > 8000) continue;          // ignore rumble and very high hiss
    const p = 10 ** (freqDb[i] / 10);
    if (!Number.isFinite(p)) continue;
    total += p;
    if (hz >= audioCfg.bandLowHz && hz <= audioCfg.bandHighHz) band += p;
    logSum += Math.log(p + 1e-20);
    count += 1;
  }
  const bandRatio = total > 0 ? band / total : 0;
  const flatness = count && total > 0 ? Math.min(1, Math.exp(logSum / count) / (total / count)) : 1;

  const v = withVoicing ? voicing(timeData, sampleRate) : { clarity: 0, pitchHz: 0 };
  return { db, bandRatio, flatness, clarity: v.clarity, pitchHz: v.pitchHz };
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
