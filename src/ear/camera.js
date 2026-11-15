// Phone camera "eyes": in-browser person detection (COCO-SSD). Owner: P1.
// The model (~5 MB) is lazy-loaded only when the user turns eyes on, so the ears stay light.
import { CONFIG } from '../shared/config.js';

let modelPromise = null;

export function loadDetector() {
  if (!modelPromise) {
    modelPromise = (async () => {
      const tf = await import('@tensorflow/tfjs');
      await tf.ready();
      const coco = await import('@tensorflow-models/coco-ssd');
      return coco.load({ base: 'lite_mobilenet_v2' });
    })();
  }
  return modelPromise;
}

export async function startCamera(videoEl) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false
  });
  videoEl.srcObject = stream;
  videoEl.setAttribute('playsinline', '');
  videoEl.muted = true;
  await videoEl.play();
  return { stop: () => stream.getTracks().forEach((t) => t.stop()) };
}

/**
 * Picks the most confident person. offset is the box centre's horizontal position:
 * -1 = left edge, 0 = centre, +1 = right edge (used to estimate direction).
 */
export function bestPerson(predictions, frameWidth, minScore = CONFIG.camera.minScore) {
  const people = predictions.filter((p) => p.class === 'person' && p.score >= minScore);
  if (!people.length) return null;
  const p = people.reduce((a, b) => (a.score >= b.score ? a : b));
  const [x, , w] = p.bbox;
  return { score: p.score, offset: ((x + w / 2) / frameWidth) * 2 - 1, bbox: p.bbox };
}

/** Requires the person in confirmFrames consecutive checks, then waits cooldownMs before reporting again. */
export function createSightingGate(cfg = CONFIG.camera) {
  let streak = 0;
  let lastFire = -Infinity;
  return {
    update(person, at) {
      streak = person ? streak + 1 : 0;
      if (person && streak >= cfg.confirmFrames && at - lastFire >= cfg.cooldownMs) {
        lastFire = at;
        return { confidence: person.score, offset: person.offset };
      }
      return null;
    }
  };
}
