// Camera lab: runs the phones' person detector (COCO-SSD lite, same code path) on real photos.
// Also tests "tiled" detection, which cuts the image into overlapping tiles so small, distant
// people (drone's-eye view) are big enough for the model.
import { CONFIG } from '../shared/config.js';
import { loadDetector, bestPerson } from '../ear/camera.js';

const IMAGES = [
  ['flood-car-roof.jpg', 'Woman trapped on a car roof (flash flood)', 'person'],
  ['flood-rescue.jpg', 'Flood rescue scene', 'person'],
  ['katrina-rescue.jpg', 'Rescuer carrying a boy (Hurricane Katrina)', 'person'],
  ['helicopter-flood.jpg', 'Helicopter flood rescue, seen from a distance', 'person'],
  ['drone-jetski.jpg', "Drone's-eye view, small people on jet skis", 'person'],
  ['satellite-flood.jpg', 'Satellite flood image, no people (false-alarm check)', 'none']
];

const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

/** Detect on overlapping tiles and map boxes back to full-image coordinates. */
export async function detectTiled(model, img, grid = 2, overlap = 0.2) {
  const W = img.naturalWidth, H = img.naturalHeight;
  const tw = W / grid, th = H / grid;
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const out = [];
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      const x0 = Math.max(0, gx * tw - tw * overlap), y0 = Math.max(0, gy * th - th * overlap);
      const w = Math.min(W - x0, tw * (1 + 2 * overlap)), h = Math.min(H - y0, th * (1 + 2 * overlap));
      c.width = w; c.height = h;
      g.drawImage(img, x0, y0, w, h, 0, 0, w, h);
      for (const p of await model.detect(c)) out.push({ ...p, bbox: [p.bbox[0] + x0, p.bbox[1] + y0, p.bbox[2], p.bbox[3]] });
    }
  }
  return out;
}

export async function runCameraLab(container) {
  const t0 = performance.now();
  const model = await loadDetector();
  const loadMs = performance.now() - t0;
  const rows = [];
  container.innerHTML = '';
  for (const [file, label, expect] of IMAGES) {
    const img = await loadImg(`/images/${file}`);
    const s0 = performance.now();
    const whole = await model.detect(img);
    const wholeMs = performance.now() - s0;
    const tiled = await detectTiled(model, img, 2);
    const people = (preds) => preds.filter((p) => p.class === 'person' && p.score >= CONFIG.camera.minScore);
    const pw = people(whole), pt = people(tiled);
    const best = bestPerson(whole, img.naturalWidth) || bestPerson(tiled, img.naturalWidth);
    const found = pw.length > 0 || pt.length > 0;
    const pass = expect === 'none' ? !found : found;
    rows.push({ file, label, expect, whole: pw.length, tiled: pt.length, best: best ? +best.score.toFixed(2) : 0, ms: Math.round(wholeMs), pass });

    // draw
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    g.lineWidth = Math.max(3, c.width / 250);
    for (const [preds, color] of [[pt, '#f5a623'], [pw, '#ff4d4f']]) {
      g.strokeStyle = color;
      for (const p of preds) g.strokeRect(...p.bbox);
    }
    const fig = document.createElement('figure');
    fig.innerHTML = `<figcaption>${pass ? '✅' : '❌'} ${label}<br><small>whole image: ${pw.length} person(s) · tiled: ${pt.length} · best ${best ? (best.score * 100).toFixed(0) + '%' : '–'} · ${Math.round(wholeMs)} ms</small></figcaption>`;
    fig.prepend(c);
    container.appendChild(fig);
  }
  window.__cameraResults = { loadMs: Math.round(loadMs), rows };
  return window.__cameraResults;
}
