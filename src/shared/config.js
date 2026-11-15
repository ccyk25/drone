// All tunable numbers live here. P3 owns the values; others propose changes.
export const CONFIG = {
  map: { center: [3.0190, 101.5370], zoom: 17 },       // Taman Sri Muda, Shah Alam (approximate; verify on the map)
  grid: { cols: 12, rows: 8, cellMeters: 50 },
  roomToMapScale: 25,                                  // 1 m in the room = 25 m on the map
  ears: { L: -45, C: 0, R: 45 },                       // degrees, relative to the drone's heading
  audio: { frameSize: 2048, bandLowHz: 1000, bandHighHz: 4000 },
  ear: { analysisMs: 50, levelHz: 8, floorWindowS: 5, floorPercentile: 0.2, helloEveryMs: 5000 },
  scream: { minAboveFloorDb: 15, minBandRatio: 0.45, minDurationMs: 300, cooldownMs: 1500, gapToleranceMs: 120 },
  fusion: { windowMs: 600, sharpness: 3, staleMs: 3000, levelLookbackMs: 900 },
  calibration: { floorMs: 3000, clapListenMs: 4000 },
  camera: { intervalMs: 600, minScore: 0.6, confirmFrames: 2, cooldownMs: 3000, halfFovDeg: 30 },
  pod: { max: 0.9, hearingRadiusM: 150, falloffM: 60, noiseRefDb: -50, noisePenaltyPerDb: 0.03 }, // REPLACE with the measured fit
  search: { detectionBoost: 6, bearingSpreadDeg: 25, familyReportBoost: 4 },
  drone: { speedMps: 15, turnRateDegPerS: 90, tickMs: 100 },
  trust: { clearedAt: 0.8, uncertainAt: 0.3 }
};
