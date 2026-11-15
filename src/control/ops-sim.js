// ops-sim.js (P2): top-down mini-map simulations for the "Drone operation" tab.
//   camera: the drone sweeps a city block; its camera's YOLO person detector picks up 2 people on the roof
//           of a high-rise, the drone stops, moves closer and confirms them.
//   heat:   last resort. The thermal sensor finds people the camera can't see: trapped inside a collapsed
//           building, and hidden by trees / debris in a flood.
// Everything is drawn in a 960x540 "world"; the caller only scales the context. This is a scripted demo:
// detections and confidence scores are animated, no real model runs here.

export const SIM_W = 960, SIM_H = 540;
const W = SIM_W, H = SIM_H;

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const ease = k => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
const prog = (t, a, b) => clamp((t - a) / (b - a));
function rng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
const circle = (ctx, x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); };
const rr = (ctx, x, y, w, h, r) => { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); };
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const SANS = 'system-ui, -apple-system, Segoe UI, sans-serif';

const SKIN = '#e6b089';
const GREEN = '#3be07c', AMBER = '#ffcf4a', HEAT = '#ff9a3c', MUTED = '#cfd5db';

// ---------------------------------------------------------------- scenes
const CITY = {
  roadsH: [[160, 40], [420, 40]],
  roadsV: [[190, 40], [500, 40], [810, 40]],
  buildings: [
    { x: 30, y: 30, w: 140, h: 110, roof: '#5d656d' }, { x: 250, y: 30, w: 230, h: 110, roof: '#6a625a' },
    { x: 560, y: 30, w: 230, h: 110, roof: '#59636c' }, { x: 870, y: 30, w: 70, h: 110, roof: '#666d73' },
    { x: 30, y: 220, w: 140, h: 180, roof: '#625b55' }, { x: 250, y: 220, w: 230, h: 180, rubble: true },
    { x: 560, y: 220, w: 230, h: 180, tower: true }, { x: 870, y: 220, w: 70, h: 180, roof: '#5b646b' },
    { x: 30, y: 480, w: 140, h: 50, roof: '#5f676e' }, { x: 250, y: 480, w: 230, h: 50, roof: '#6b645c' },
    { x: 560, y: 480, w: 230, h: 50, roof: '#5a6269' }, { x: 870, y: 480, w: 70, h: 50, roof: '#646a70' },
  ],
  trees: [[182, 150, 14], [238, 410, 15], [548, 152, 14], [858, 152, 13], [182, 470, 14], [858, 470, 13]],
  cars: [[70, 168, 26, 13, '#b94a48'], [330, 438, 26, 13, '#d9dde0'], [640, 168, 26, 13, '#3a6ea5'], [512, 330, 13, 26, '#e0c45c']],
  // the only two people: stranded on the roof of high-rise B4 (one waving)
  people: [
    { x: 700, y: 332, a: -0.5, shirt: '#e8892c', hair: '#2a1d17', wave: true },
    { x: 730, y: 352, a: 0.8, shirt: '#4a7fd6', hair: '#5b3a22' },
  ],
  hidden: [{ x: 372, y: 318 }],          // buried in collapsed B2: invisible to the camera, warm to the heat sensor
};
const RUBBLE = (() => {
  const r = rng(7), b = CITY.buildings.find(b => b.rubble), out = [], bars = [];
  for (let i = 0; i < 90; i++) {
    const cx = b.x + 8 + r() * (b.w - 16), cy = b.y + 8 + r() * (b.h - 16), rad = 6 + r() * 16, n = 4 + ((r() * 3) | 0), a0 = r() * 6.28;
    const pts = [];
    for (let k = 0; k < n; k++) { const a = a0 + (k / n) * 6.28, q = rad * (0.6 + r() * 0.5); pts.push([cx + Math.cos(a) * q, cy + Math.sin(a) * q]); }
    out.push({ pts, k: i % 4 });
  }
  for (let i = 0; i < 16; i++) { const x = b.x + r() * b.w, y = b.y + r() * b.h, a = r() * 6.28, l = 14 + r() * 26; bars.push([x, y, x + Math.cos(a) * l, y + Math.sin(a) * l]); }
  return { out, bars };
})();

const FLOOD = {
  buildings: [
    { x: 30, y: 30, w: 140, h: 110, roof: '#5d656d' }, { x: 250, y: 30, w: 230, h: 110, roof: '#6a625a' },
    { x: 560, y: 30, w: 230, h: 110, roof: '#59636c' }, { x: 870, y: 30, w: 70, h: 110, roof: '#666d73' },
    { x: 30, y: 220, w: 140, h: 180, roof: '#625b55' }, { x: 640, y: 220, w: 150, h: 120, roof: '#6b7076' },
    { x: 870, y: 220, w: 70, h: 180, roof: '#5b646b' }, { x: 30, y: 480, w: 140, h: 50, roof: '#5f676e' },
    { x: 560, y: 480, w: 230, h: 50, roof: '#5a6269' },
  ],
  trees: [[430, 296, 34], [300, 250, 24], [235, 430, 22], [820, 420, 26], [600, 410, 18]],
  debris: [[556, 316, 46, 9, 0.5], [572, 330, 38, 8, -0.3], [550, 336, 30, 7, 1.2], [586, 314, 22, 12, 0.1]],
  hidden: [{ x: 430, y: 300 }, { x: 566, y: 324 }],   // under the tree canopy / in the water under debris
};
const RIPPLES = (() => { const r = rng(11), a = []; for (let i = 0; i < 90; i++) a.push([r() * W, r() * H, 6 + r() * 14, r() * 6.28]); return a; })();

// ---------------------------------------------------------------- drawing helpers
function person(ctx, p, now) {      // seen from above: shoulders, arms, head (hair)
  ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(2.5, 2.5, 11, 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = p.shirt;
  if (p.wave) {
    ctx.save(); ctx.translate(8, -1); ctx.rotate(-1.1 + Math.sin(now * 8) * 0.55);
    ctx.fillRect(0, -2.2, 12, 4.4); ctx.fillStyle = SKIN; circle(ctx, 13, 0, 2.6); ctx.restore();
    ctx.fillStyle = p.shirt;
  } else circle(ctx, 9.5, 2, 3.2);
  circle(ctx, -9.5, 2, 3.2);
  ctx.beginPath(); ctx.ellipse(0, 0, 10, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = p.hair; circle(ctx, 0, -0.5, 5.4);
  ctx.fillStyle = 'rgba(255,255,255,.18)'; circle(ctx, -1.6, -2.2, 2);
  ctx.restore();
}

function heat(ctx, x, y, s = 1) {    // human-shaped hot spot (head + torso)
  for (const [dx, dy, r] of [[0, -6, 10], [0, 6, 14]]) {
    const R = r * 1.8 * s, g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, R);
    g.addColorStop(0, '#fffbe6'); g.addColorStop(0.25, '#ffd84a'); g.addColorStop(0.55, '#ff6b2c'); g.addColorStop(1, 'rgba(190,30,110,0)');
    ctx.fillStyle = g; circle(ctx, x + dx, y + dy, R);
  }
}

function trees(ctx, list, th) {
  for (const [x, y, r] of list) {
    if (!th) { ctx.fillStyle = 'rgba(0,0,0,.35)'; circle(ctx, x + 5, y + 5, r); }
    ctx.fillStyle = th ? '#1e2156' : '#3f6e47'; circle(ctx, x, y, r);
    if (!th) { ctx.fillStyle = '#4f8457'; circle(ctx, x - r * 0.25, y - r * 0.25, r * 0.6); }
  }
}

function label(ctx, text, x, y) {
  ctx.font = `600 11px ${MONO}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fillText(text, x, y);
}

function drawTower(ctx, b, th) {
  ctx.fillStyle = th ? 'rgba(0,0,0,.3)' : 'rgba(0,0,0,.5)';          // long shadow = tall building
  ctx.beginPath(); ctx.moveTo(b.x + b.w, b.y); ctx.lineTo(b.x + b.w + 34, b.y + 28); ctx.lineTo(b.x + b.w + 34, b.y + b.h + 28);
  ctx.lineTo(b.x + 34, b.y + b.h + 28); ctx.lineTo(b.x, b.y + b.h); ctx.closePath(); ctx.fill();
  ctx.fillStyle = th ? '#222459' : '#8a939b'; ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.strokeStyle = th ? '#2b2e6a' : '#b3bbc2'; ctx.lineWidth = 5; ctx.strokeRect(b.x + 2.5, b.y + 2.5, b.w - 5, b.h - 5);
  const hx = b.x + 62, hy = b.y + 70;                                  // helipad
  ctx.fillStyle = th ? '#1f2155' : '#6a737b'; circle(ctx, hx, hy, 36);
  if (!th) {
    ctx.strokeStyle = '#f2c94c'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(hx, hy, 30, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#f2c94c'; ctx.font = `700 30px ${SANS}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('H', hx, hy + 1);
  }
  for (let i = 0; i < 3; i++) {                                         // AC units
    const x = b.x + 140 + i * 26, y = b.y + 18;
    ctx.fillStyle = th ? '#26296a' : '#c9d0d6'; ctx.fillRect(x, y, 20, 26);
    if (!th) { ctx.strokeStyle = '#7d868e'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x + 10, y + 13, 7, 0, Math.PI * 2); ctx.stroke(); }
  }
  ctx.fillStyle = th ? '#24275f' : '#7f8a94'; circle(ctx, b.x + 205, b.y + 155, 14);     // water tank
  ctx.fillStyle = th ? '#25285f' : '#9ea7ae'; ctx.fillRect(b.x + 20, b.y + 128, 46, 36); // stair housing
  if (!th) label(ctx, 'B4 · HIGH-RISE · 18 FL', b.x + 4, b.y - 8);
}

function drawRubble(ctx, b, th) {
  ctx.fillStyle = th ? '#17183f' : '#4d463f'; ctx.fillRect(b.x, b.y, b.w, b.h);
  const WARM = ['#7d746a', '#5f574f', '#8f877c', '#6d6155'], COLD = ['#1c1d48', '#202252', '#191a43', '#23255a'];
  for (const c of RUBBLE.out) {
    ctx.fillStyle = (th ? COLD : WARM)[c.k];
    ctx.beginPath(); c.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill();
    if (!th) { ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1; ctx.stroke(); }
  }
  ctx.fillStyle = th ? '#222458' : '#6b645c'; ctx.fillRect(b.x, b.y, 96, 12); ctx.fillRect(b.x, b.y, 12, 74);   // standing wall
  ctx.strokeStyle = th ? '#26285e' : '#a0643c'; ctx.lineWidth = 1.6;
  ctx.beginPath(); for (const [a, c, d, e] of RUBBLE.bars) { ctx.moveTo(a, c); ctx.lineTo(d, e); } ctx.stroke();
  if (!th) {
    ctx.strokeStyle = 'rgba(255,138,61,.8)'; ctx.lineWidth = 2; ctx.setLineDash([7, 6]);
    ctx.strokeRect(b.x - 3, b.y - 3, b.w + 6, b.h + 6); ctx.setLineDash([]);
    label(ctx, 'B2 · COLLAPSED', b.x + 4, b.y - 8);
  }
}

function drawCity(ctx, th, now) {
  ctx.fillStyle = th ? '#15163c' : '#3a3f43'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = th ? '#101132' : '#25292d';
  for (const [y, h] of CITY.roadsH) ctx.fillRect(0, y, W, h);
  for (const [x, w] of CITY.roadsV) ctx.fillRect(x, 0, w, H);
  if (!th) {
    ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 1.5; ctx.setLineDash([10, 12]); ctx.beginPath();
    for (const [y, h] of CITY.roadsH) { ctx.moveTo(0, y + h / 2); ctx.lineTo(W, y + h / 2); }
    for (const [x, w] of CITY.roadsV) { ctx.moveTo(x + w / 2, 0); ctx.lineTo(x + w / 2, H); }
    ctx.stroke(); ctx.setLineDash([]);
  }
  for (const [x, y, w, h, c] of CITY.cars) {
    if (!th) { ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(x + 2, y + 2, w, h); }
    ctx.fillStyle = th ? '#1e2152' : c; ctx.fillRect(x, y, w, h);
  }
  for (const b of CITY.buildings) {
    if (b.rubble) { drawRubble(ctx, b, th); continue; }
    if (b.tower) { drawTower(ctx, b, th); continue; }
    ctx.fillStyle = `rgba(0,0,0,${th ? 0.25 : 0.4})`; ctx.fillRect(b.x + 7, b.y + 7, b.w, b.h);
    ctx.fillStyle = th ? '#1d1f4e' : b.roof; ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = th ? '#25285e' : 'rgba(255,255,255,.12)'; ctx.lineWidth = 2; ctx.strokeRect(b.x + 4, b.y + 4, b.w - 8, b.h - 8);
  }
  trees(ctx, CITY.trees, th);
  if (th) { for (const p of [...CITY.people, ...CITY.hidden]) heat(ctx, p.x, p.y); }
  else for (const p of CITY.people) person(ctx, p, now);
}

function drawFlood(ctx, th, now) {
  ctx.fillStyle = th ? '#0c0f2e' : '#4d5f63'; ctx.fillRect(0, 0, W, H);      // muddy flood water
  if (!th) {
    ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 1.2; ctx.beginPath();
    for (const [x, y, l, ph] of RIPPLES) { const o = Math.sin(now * 1.5 + ph) * 3; ctx.moveTo(x - l + o, y); ctx.quadraticCurveTo(x + o, y - 3, x + l + o, y); }
    ctx.stroke();
  }
  for (const b of FLOOD.buildings) {
    ctx.fillStyle = `rgba(0,0,0,${th ? 0.25 : 0.35})`; ctx.fillRect(b.x + 6, b.y + 6, b.w, b.h);
    ctx.fillStyle = th ? '#1d1f52' : b.roof; ctx.fillRect(b.x, b.y, b.w, b.h);
    if (!th) { ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 3; ctx.strokeRect(b.x - 2, b.y - 2, b.w + 4, b.h + 4); }
  }
  ctx.fillStyle = th ? '#1d2052' : '#b94a48'; ctx.fillRect(330, 170, 26, 14);   // car roof just above the water
  for (const [x, y, w, h, a] of FLOOD.debris) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.fillStyle = th ? '#1d2052' : '#6f4e30'; ctx.fillRect(-w / 2, -h / 2, w, h); ctx.restore();
  }
  trees(ctx, FLOOD.trees, th);
  if (th) for (const p of FLOOD.hidden) heat(ctx, p.x, p.y, 0.9);
  else label(ctx, 'SECTOR C · FLOODED', 250, 212);
}

const drawWorld = (ctx, scene, th, now) => (scene === 'flood' ? drawFlood(ctx, th, now) : drawCity(ctx, th, now));

const foot = alt => { const w = alt * 3.6; return { w, h: w * 9 / 16 }; };   // camera footprint on the ground

function drone(ctx, x, y, alt, now) {
  const s = 1 + (60 - alt) / 80, so = alt * 0.3;
  ctx.fillStyle = 'rgba(0,0,0,.35)'; circle(ctx, x + so, y + so, 15 * s);
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.rotate(Math.PI / 4);
  ctx.strokeStyle = '#dfe6ec'; ctx.lineWidth = 3.5;
  ctx.beginPath(); ctx.moveTo(-15, 0); ctx.lineTo(15, 0); ctx.moveTo(0, -15); ctx.lineTo(0, 15); ctx.stroke();
  for (const [rx, ry] of [[15, 0], [-15, 0], [0, 15], [0, -15]]) {
    ctx.fillStyle = 'rgba(220,230,240,.18)'; circle(ctx, rx, ry, 8.5);
    const a = now * 40 + rx; ctx.strokeStyle = 'rgba(230,238,245,.7)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(rx - Math.cos(a) * 8, ry - Math.sin(a) * 8); ctx.lineTo(rx + Math.cos(a) * 8, ry + Math.sin(a) * 8); ctx.stroke();
  }
  ctx.fillStyle = '#e9eef2'; ctx.fillRect(-6, -6, 12, 12);
  ctx.restore();
  ctx.fillStyle = GREEN; circle(ctx, x, y, 2.2);
}

function pin(ctx, p) {
  const k = p.k ?? 1, y = p.y - 26 * (1 - ease(k));
  ctx.save(); ctx.globalAlpha = clamp(k * 2);
  ctx.fillStyle = p.col; ctx.beginPath(); ctx.arc(p.x, y - 22, 9, Math.PI * 0.85, Math.PI * 2.15); ctx.lineTo(p.x, y - 4); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#0b0d10'; circle(ctx, p.x, y - 22, 3.6);
  if (p.label) {
    ctx.font = `600 12px ${SANS}`; const w = ctx.measureText(p.label).width + 14, lx = p.x + 12, ly = y - 40;
    ctx.fillStyle = 'rgba(8,10,12,.85)'; rr(ctx, lx, ly, w, 22, 6); ctx.fill();
    ctx.strokeStyle = p.col; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(p.label, lx + 7, ly + 11.5);
  }
  ctx.restore();
}

// the drone camera's view, bottom-left of the map
const IN = { x: 14, y: H - 190, w: 312, h: 176 };
function drawInset(ctx, st, now) {
  const f = foot(st.alt), z = IN.w / f.w, cx = IN.x + IN.w / 2, cy = IN.y + IN.h / 2, th = st.thermal > 0.5;
  ctx.save();
  ctx.fillStyle = '#000'; ctx.fillRect(IN.x - 3, IN.y - 3, IN.w + 6, IN.h + 6);
  ctx.beginPath(); ctx.rect(IN.x, IN.y, IN.w, IN.h); ctx.clip();
  ctx.save(); ctx.translate(cx, cy); ctx.scale(z, z); ctx.translate(-st.x, -st.y);
  drawWorld(ctx, st.scene, false, now);
  if (st.thermal > 0) {
    ctx.beginPath(); ctx.rect(st.x - f.w / 2, st.y - f.h, f.w * st.thermal, f.h * 2); ctx.clip();
    drawWorld(ctx, st.scene, true, now);
  }
  ctx.restore();
  if (st.thermal > 0 && st.thermal < 1) { ctx.fillStyle = HEAT; ctx.fillRect(IN.x + IN.w * st.thermal - 1, IN.y, 2, IN.h); }
  for (const b of st.boxes) {                                           // detector boxes
    const bx = cx + (b.x - st.x) * z, by = cy + (b.y - st.y) * z, s = b.r * z;
    ctx.strokeStyle = b.col; ctx.lineWidth = 2; ctx.strokeRect(bx - s, by - s, s * 2, s * 2);
    ctx.font = `700 11px ${MONO}`; const tw = ctx.measureText(b.label).width + 8;
    ctx.fillStyle = b.col; ctx.fillRect(bx - s, by - s - 16, tw, 16);
    ctx.fillStyle = '#000'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(b.label, bx - s + 4, by - s - 7.5);
  }
  ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(cx - 10, cy); ctx.lineTo(cx + 10, cy); ctx.moveTo(cx, cy - 10); ctx.lineTo(cx, cy + 10); ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect(IN.x, IN.y, IN.w, 20); ctx.fillRect(IN.x, IN.y + IN.h - 20, IN.w, 20);
  ctx.font = `600 11px ${MONO}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillStyle = th ? HEAT : '#fff';
  ctx.fillText(`${th ? 'THERMAL' : 'DRONE CAM'} · ALT ${Math.round(st.alt)} m`, IN.x + 8, IN.y + 10.5);
  if (Math.floor(now * 2) % 2) { ctx.fillStyle = '#ff4d4d'; circle(ctx, IN.x + IN.w - 40, IN.y + 10, 3.5); }
  ctx.fillStyle = '#fff'; ctx.textAlign = 'right'; ctx.fillText('REC', IN.x + IN.w - 8, IN.y + 10.5);
  ctx.textAlign = 'left'; ctx.fillStyle = st.statusCol || MUTED; ctx.fillText(st.status, IN.x + 8, IN.y + IN.h - 9.5);
  ctx.restore();
  ctx.strokeStyle = th ? HEAT : 'rgba(255,255,255,.6)'; ctx.lineWidth = 1.5; ctx.strokeRect(IN.x - 1, IN.y - 1, IN.w + 2, IN.h + 2);
}

function hud(ctx, st) {
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.font = `700 14px ${MONO}`;
  const w1 = ctx.measureText(st.phase).width + 30;
  ctx.fillStyle = 'rgba(0,0,0,.75)'; rr(ctx, 14, 14, w1, 28, 6); ctx.fill();
  ctx.fillStyle = st.phaseCol; circle(ctx, 27, 28, 4.5); ctx.fillText(st.phase, 38, 28.5);
  ctx.font = `500 13px ${SANS}`;
  const w2 = ctx.measureText(st.sub).width + 18;
  ctx.fillStyle = 'rgba(0,0,0,.65)'; rr(ctx, 14, 48, w2, 24, 6); ctx.fill();
  ctx.fillStyle = '#e6eaee'; ctx.fillText(st.sub, 23, 60.5);
  ctx.font = `600 11px ${MONO}`; ctx.textAlign = 'right';
  const tel = `ALT ${Math.round(st.alt)} m  ·  ${st.thermal > 0.5 ? 'THERMAL' : 'CAMERA · YOLO'}`, w3 = ctx.measureText(tel).width + 18;
  ctx.fillStyle = 'rgba(0,0,0,.65)'; rr(ctx, W - 14 - w3, 14, w3, 24, 6); ctx.fill();
  ctx.fillStyle = MUTED; ctx.fillText(tel, W - 23, 26.5);
}

// ---------------------------------------------------------------- timelines
const CAM_PATH = [[60, 100], [900, 100], [900, 320], [712, 332]];      // lawnmower sweep ending over B4
const PATH_LEN = CAM_PATH.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - CAM_PATH[i][0], p[1] - CAM_PATH[i][1]), 0);
function along(path, d) {
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i], l = Math.hypot(bx - ax, by - ay);
    if (d <= l) return [lerp(ax, bx, d / l), lerp(ay, by, d / l)];
    d -= l;
  }
  return path[path.length - 1];
}
const inView = (st, p) => { const f = foot(st.alt); return Math.abs(p.x - st.x) < f.w / 2 - 4 && Math.abs(p.y - st.y) < f.h / 2 - 4; };

export const SIM_LENGTH = { camera: 11, heat: 13 };

function camState(t) {
  const st = { scene: 'city', thermal: 0, boxes: [], pins: [], fade: 0, path: CAM_PATH };
  const T1 = 5.2, T2 = 5.7, T3 = 8.1;            // sweep → stop → move closer → confirmed
  if (t < T1) { const u = t / T1; [st.x, st.y] = along(CAM_PATH, PATH_LEN * (1 - (1 - u) ** 1.25)); st.alt = 60; }
  else { const k = ease(prog(t, T2, T3)); st.x = lerp(712, 715, k); st.y = lerp(332, 339, k); st.alt = lerp(60, 36, k); }
  const k = ease(prog(t, T2, T3)), CONF = [[0.41, 0.93], [0.36, 0.88]];
  CITY.people.forEach((p, i) => {
    if (!inView(st, p)) return;
    const c = lerp(CONF[i][0], CONF[i][1], k), ok = c > 0.8;
    st.boxes.push({ x: p.x, y: p.y, r: 13, col: ok ? GREEN : AMBER, c, label: `${ok ? 'person' : 'person?'} ${c.toFixed(2)}` });
  });
  const seen = st.boxes.length > 0;
  if (t < T1) { st.phase = 'SWEEP'; st.phaseCol = GREEN; st.sub = seen ? 'Faint shape on the roof of high-rise B4…' : 'Camera + YOLO person detector checks every frame'; }
  else if (t < T2) { st.phase = 'STOP'; st.phaseCol = AMBER; st.sub = 'Possible person (41% sure): holding position'; }
  else if (t < T3) { st.phase = 'MOVE CLOSER'; st.phaseCol = AMBER; st.sub = `Descending to ${Math.round(st.alt)} m for a sharper look`; }
  else { st.phase = 'CONFIRMED'; st.phaseCol = GREEN; st.sub = t < 9.8 ? '2 people stranded on the roof of B4' : 'Next: lower the mic pod to talk to them'; }
  st.status = seen ? `YOLO · ${st.boxes.length} × person · ${st.boxes.map(b => Math.round(b.c * 100) + '%').join(' / ')}` : 'YOLO · scanning… 0 detections';
  st.statusCol = seen ? (st.boxes.every(b => b.col === GREEN) ? GREEN : AMBER) : MUTED;
  if (t > 8.5) st.pins.push({ x: 715, y: 340, col: GREEN, label: '2 people · Rooftop B4', k: prog(t, 8.5, 9.1) });
  return st;
}

function heatState(t) {
  const st = { thermal: 0, boxes: [], pins: [], fade: 0 };
  if (t < 6.6) {                                   // part 1: someone trapped inside collapsed B2
    st.scene = 'city';
    const k = ease(prog(t, 0, 1.4));
    st.x = lerp(715, 368, k); st.y = lerp(339, 314, k); st.alt = lerp(36, 35, k);
    st.thermal = ease(prog(t, 3.0, 3.7));
    st.fade = prog(t, 5.9, 6.6);
    st.pins.push({ x: 715, y: 340, col: GREEN, k: 1 });
    if (t < 1.4) { st.phase = 'NEXT AREA'; st.phaseCol = MUTED; st.sub = 'Collapsed building B2'; }
    else if (t < 3.0) { st.phase = 'CAMERA'; st.phaseCol = AMBER; st.sub = 'Rubble hides everyone: the camera sees no one'; }
    else if (t < 3.7) { st.phase = 'HEAT SENSOR ON'; st.phaseCol = HEAT; st.sub = 'Last resort when the camera finds nothing'; }
    else { st.phase = 'HEAT FOUND'; st.phaseCol = HEAT; st.sub = 'Body heat (~34 °C) shows through gaps in the rubble'; }
    if (t > 4.0) st.boxes.push({ x: 372, y: 318, r: 18, col: HEAT, label: 'heat 34.2°C' });
    if (t > 4.6) st.pins.push({ x: 372, y: 316, col: HEAT, label: 'Trapped inside · B2', k: prog(t, 4.6, 5.2) });
    st.status = t < 3.0 ? 'YOLO · 0 detections (rubble)' : t < 4.0 ? 'THERMAL · scanning…' : 'THERMAL · 1 human-sized heat source';
    st.statusCol = t < 3.0 ? MUTED : HEAT;
  } else {                                         // part 2: flood, people hidden by trees and debris
    st.scene = 'flood';
    st.x = 497 + Math.sin(t * 1.3) * 3; st.y = 312; st.alt = 48;
    st.fade = 1 - prog(t, 6.6, 7.2);
    st.thermal = ease(prog(t, 8.6, 9.3));
    if (t < 8.6) { st.phase = 'FLOOD ZONE'; st.phaseCol = '#7fb2ff'; st.sub = 'Trees and floating debris hide people: 0 seen'; }
    else if (t < 9.3) { st.phase = 'HEAT SENSOR ON'; st.phaseCol = HEAT; st.sub = 'Warm bodies stand out against cold water'; }
    else { st.phase = 'HEAT FOUND'; st.phaseCol = HEAT; st.sub = '2 people the camera missed'; }
    const [f1, f2] = FLOOD.hidden;
    if (t > 9.6) st.boxes.push({ x: f1.x, y: f1.y, r: 18, col: HEAT, label: 'heat 33.8°C' });
    if (t > 10.0) st.boxes.push({ x: f2.x, y: f2.y, r: 18, col: HEAT, label: 'heat 31.5°C' });
    if (t > 10.4) st.pins.push({ x: f1.x, y: f1.y - 2, col: HEAT, label: 'Under tree', k: prog(t, 10.4, 11) });
    if (t > 10.9) st.pins.push({ x: f2.x, y: f2.y - 2, col: HEAT, label: 'In water by debris', k: prog(t, 10.9, 11.5) });
    st.status = t < 8.6 ? 'YOLO · 0 detections (trees / debris)' : t < 9.6 ? 'THERMAL · scanning…' : `THERMAL · ${st.boxes.length} human-sized heat source${st.boxes.length > 1 ? 's' : ''}`;
    st.statusCol = t < 8.6 ? MUTED : HEAT;
  }
  return st;
}

/** Draw simulation `sim` ('camera' | 'heat') at time t (s). ctx must already be scaled to SIM_W x SIM_H. */
export function renderSim(ctx, sim, t, now = t) {
  const st = sim === 'heat' ? heatState(t) : camState(t);
  const f = foot(st.alt), fx = st.x - f.w / 2, fy = st.y - f.h / 2;
  drawWorld(ctx, st.scene, false, now);
  if (st.thermal > 0) { ctx.save(); ctx.beginPath(); ctx.rect(fx, fy, f.w * st.thermal, f.h); ctx.clip(); drawWorld(ctx, st.scene, true, now); ctx.restore(); }
  if (st.path) {
    ctx.strokeStyle = 'rgba(59,224,124,.35)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 6]);
    ctx.beginPath(); st.path.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); ctx.setLineDash([]);
  }
  for (const b of st.boxes) { ctx.strokeStyle = b.col; ctx.lineWidth = 1.5; ctx.strokeRect(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2); }
  const fc = st.thermal > 0.5 ? HEAT : GREEN;
  ctx.fillStyle = fc + '14'; ctx.fillRect(fx, fy, f.w, f.h);
  ctx.strokeStyle = fc; ctx.lineWidth = 1.5; ctx.setLineDash([6, 5]); ctx.strokeRect(fx, fy, f.w, f.h); ctx.setLineDash([]);
  drone(ctx, st.x, st.y, st.alt, now);
  for (const p of st.pins) pin(ctx, p);
  drawInset(ctx, st, now);
  hud(ctx, st);
  if (st.fade > 0) { ctx.fillStyle = `rgba(0,0,0,${st.fade})`; ctx.fillRect(0, 0, W, H); }
}
