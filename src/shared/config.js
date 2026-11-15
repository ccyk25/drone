// All tunable numbers live here. P3 owns the values; others propose changes.
export const CONFIG = {
  map: { center: [3.0190, 101.5370], zoom: 17 },       // Taman Sri Muda, Shah Alam (approximate; verify on the map)
  grid: { cols: 12, rows: 8, cellMeters: 50 },
  roomToMapScale: 25,                                  // 1 m in the room = 25 m on the map
  ears: { L: -45, C: 0, R: 45 },                       // degrees, relative to the drone's heading
  audio: { frameSize: 2048, bandLowHz: 1000, bandHighHz: 4000 },
  ear: { analysisMs: 50, levelHz: 8, floorWindowS: 5, floorPercentile: 0.2, helloEveryMs: 5000 },
  // Learned background spectrum ("noise profile"): adapts fast downward, slowly upward,
  // and barely at all while something is happening, so a scream doesn't erase itself.
  noiseProfile: { alphaDown: 0.3, alphaUpQuiet: 0.02, alphaUpActive: 0.002, activeNoveltyDb: 6,
    brightBand: [1000, 4000], voiceBand: [250, 3500] },
  // Clear scream: bright-band energy well above the learned background AND voiced (pitched).
  // Rain/rushing water can be bright, but they have no pitch.
  // Lab (real recordings): screams reach pitch-clarity 0.90–1.00; river/rain never exceed ~0.45.
  // In noise, scream frames flicker, so count qualifying frames within a window instead of
  // requiring continuous sound.
  // (In noise, scream frames measured 0.62–0.90, so 0.6 keeps a ~0.15 margin above the noise maximum.)
  scream: { minNoveltyDb: 10, minClarity: 0.6, minPitchHz: 150, maxPitchHz: 1600,
    minVoicedMs: 250, windowMs: 700, cooldownMs: 1500,
    minBandRatio: 0.45 /* UI score only */ },
  // DEMO sensitivity (default on the phones): a room full of people talking must not trigger it.
  // Only a LOUD, bright, sustained shout counts. 'Field' sensitivity (above, lab-validated on
  // flood recordings) is available on the phone with the Sensitivity button.
  // (tuned on the day: 'talking' measured +4 dB over the room → rejected; a real shout is well above +7)
  screamDemo: { minNoveltyDb: 12, minAboveFloorDb: 7, minLevelDb: -38, minClarity: 0.55, minVoicedMs: 350, windowMs: 900 },
  // Muffled voice behind rubble/walls: high frequencies lost, so use the wider voice band;
  // calls are short syllables, so count voiced time within a window instead of continuous sound.
  // (A spoken "help" has only ~100–150 ms of clearly voiced sound, so two calls within 2.5 s = 200 ms.)
  muffled: { minNoveltyDb: 12, minClarity: 0.55, minPitchHz: 120, maxPitchHz: 1000,
    minVoicedMs: 200, minBursts: 2, windowMs: 2500, confidenceScale: 0.7 },
  fusion: { windowMs: 400, sharpness: 3, staleMs: 3000, levelLookbackMs: 900 },
  calibration: { floorMs: 3000, clapListenMs: 4000 },
  camera: { intervalMs: 350, minScore: 0.6, confirmFrames: 2, cooldownMs: 3000, halfFovDeg: 30 },
  pod: { max: 0.9, hearingRadiusM: 150, falloffM: 60, noiseRefDb: -50, noisePenaltyPerDb: 0.03 }, // REPLACE with the measured fit
  search: { detectionBoost: 6, bearingSpreadDeg: 25, familyReportBoost: 4, pointDetectionRadiusM: 40 },
  // Each sensor's chance of detecting a survivor in a cell, by what covers that cell.
  // Thermal needs line of sight (blocked by roofs/rubble, water hides body heat, hot afternoons
  // wash people out). Microphones hear through gaps. Camera (general model) is weak from drone height.
  // These are modelling assumptions for the demo, stated openly; the audio curve comes from the hearing lab.
  sensors: {
    // callProb: survivors call out ~30% of seconds, so one second of silence only rules out that much.
    // (Without it, five drones 'cleared' everything in seconds while people were still missing.)
    audio: { callProb: 0.3, cover: { open: 1.0, trees: 0.9, roof: 0.75, water: 0.7 } },
    thermal: { radiusM: 60, max: 0.85, hotDayFactor: 0.5,
      cover: { open: 1.0, trees: 0.35, roof: 0.03, water: 0.1 } },
    camera: { radiusM: 40, max: 0.3,
      cover: { open: 1.0, trees: 0.4, roof: 0.0, water: 0.5 } }
  },
  drone: { speedMps: 15, turnRateDegPerS: 90, tickMs: 100 },
  trust: { clearedAt: 0.8, uncertainAt: 0.3 }
};
