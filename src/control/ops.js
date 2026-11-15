// ops.js (P2): "Drone operation" tab: step-by-step walkthrough of how a GEMA drone finds people.
// Mixes the Blender animation (media/drone-operation.mp4, 10 s @ 24 fps) with two live mini-map
// simulations from ops-sim.js (AI camera search, heat sensor) on one shared timeline.
import { renderSim, SIM_W, SIM_H, SIM_LENGTH } from './ops-sim.js';

const media = f => new URL(`./media/${f}`, import.meta.url).href;

export const OPS_STEPS = [
  {
    title: 'Choose the search area', kind: 'none', tag: 'Operator',
    body: 'On the post-disaster map, the operator drags a rectangle over the area to search. GEMA splits it into a grid, and each drone plans a route through the cells most likely to hold survivors.',
    action: 'Try it on the map',
  },
  {
    title: 'Fly in and listen', kind: 'video', t0: 0, t1: 2.5, thumb: 'op-flyin.jpg', tag: 'Drone',
    body: 'The drone flies to the search area and sweeps it in rows, listening the whole way. Each quiet pass lowers the chance that someone is in that cell. A pass made in noise never counts as "cleared", so the map stays honest about what was missed.',
  },
  {
    title: 'AI camera search', kind: 'sim', sim: 'camera', thumbT: 9.4, tag: 'Camera · YOLO',
    body: 'The camera looks straight down and a YOLO person detector checks every frame. Over the high-rise it picks up a faint shape on the roof (only 41% sure), so the drone stops, drops from 60 m to 36 m for a sharper look, and the score climbs past 90%: two people, found by the camera alone.',
  },
  {
    title: 'Lower the mic pod', kind: 'video', t0: 2.5, t1: 4.9, thumb: 'op-lower.jpg', tag: 'Winch',
    body: 'For people the camera can\'t see, the drone holds its hover over a gap in the rubble and a winch pays out a tether. The microphone + camera pod drops straight down into the void, close to where voices would be.',
  },
  {
    title: 'Steer with the camera', kind: 'video', t0: 4.9, t1: 6.3, thumb: 'op-podcam.jpg', tag: 'Pod camera',
    body: 'Inside the rubble the pod switches on its LED ring. Its camera shows the operator the gaps between slabs and rebar, so the pod is guided through the openings instead of lowered blind.',
  },
  {
    title: 'Listen and confirm', kind: 'video', t0: 6.3, t1: 8.3, thumb: 'op-podcam.jpg', tag: 'Mic + camera',
    body: 'Down in the void the microphone hears faint calls that never reach the drone above (the blue ping). The camera confirms what is there: here, a person trapped under debris.',
  },
  {
    title: 'Heat sensor (last resort)', kind: 'sim', sim: 'heat', thumbT: 5.4, tag: 'Thermal',
    body: 'If the camera still finds no one, the drone switches on its heat sensor. A body is about 34 °C against cold rubble or flood water, so someone trapped inside a collapsed building, or hidden under trees and debris in a flood, still shows up as a hot spot.',
  },
  {
    title: 'Mark and dispatch', kind: 'video', t0: 8.3, t1: 10, thumb: 'op-flyin.jpg', tag: 'Rescue team',
    body: 'Every confirmed person gets a GPS pin with the camera or heat image. The rescue drone R1 and the officials (Bomba, APM, NADMA) are notified at the same moment. The pod is winched back up and the search drone moves on to the next most likely area.',
  },
  {
    title: 'Rescue lift (R1)', kind: 'sim', sim: 'lift', thumbT: 10.4, tag: 'Rescue drone',
    body: 'The big rescue drone R1 lowers a fully enclosed capsule on two ropes. The survivor sits in a padded seat with a 5-point harness and the door locks shut. R1 only lifts once every safety check passes (harness, door, rope tension, wind), then it lifts slowly and flies low to the medics before going back for the next person.',
  },
];
let acc = 0;
for (const s of OPS_STEPS) {
  s.dur = s.kind === 'video' ? s.t1 - s.t0 : s.kind === 'sim' ? SIM_LENGTH[s.sim] : 0;
  s.start = acc; acc += s.dur;
}
const TOTAL = acc;
const FIRST = OPS_STEPS.findIndex(s => s.dur > 0);

const pad = n => String(n).padStart(2, '0');
const fmt = t => `${Math.floor(t / 60)}:${pad(Math.floor(t % 60))}`;

export function createOps(root, { onTryArea } = {}) {
  const el = document.createElement('section');
  el.className = 'ops';
  el.setAttribute('aria-label', 'Drone operation');
  el.hidden = true;
  el.innerHTML = `
    <div class="ops-inner">
      <header class="ops-head">
        <div>
          <div class="ops-kicker hudtxt">Drone operation</div>
          <h2>How a GEMA drone finds people after a disaster</h2>
        </div>
        <button class="btn primary" data-ops="all">▶ Play all steps</button>
      </header>
      <div class="ops-body">
        <div class="ops-stage">
          <div class="ops-video">
            <video muted playsinline preload="auto" poster="${media('op-flyin.jpg')}" src="${media('drone-operation.mp4')}"></video>
            <canvas class="ops-sim" hidden></canvas>
            <div class="ops-badge hudtxt"></div>
            <button class="ops-bigplay" data-ops="toggle" aria-label="Play">▶</button>
          </div>
          <div class="ops-controls">
            <button class="ops-play" data-ops="toggle" aria-label="Play">▶</button>
            <div class="ops-track" role="slider" aria-label="Walkthrough position" tabindex="0">
              ${OPS_STEPS.map((s, i) => (s.dur > 0 ? `<div class="seg${s.kind === 'sim' ? ' sim' : ''}" style="left:${(s.start / TOTAL) * 100}%;width:${(s.dur / TOTAL) * 100}%" title="${s.title}"><span>${pad(i + 1)}</span></div>` : '')).join('')}
              <div class="head"></div>
            </div>
            <span class="ops-time hudtxt">0:00 / ${fmt(TOTAL)}</span>
          </div>
          <div class="ops-caption">
            <div class="ops-step-no hudtxt"></div>
            <h3></h3>
            <p></p>
          </div>
        </div>
        <ol class="ops-steps">
          ${OPS_STEPS.map((s, i) => `
          <li><button class="ops-step" data-step="${i}">
            <span class="no hudtxt">${pad(i + 1)}</span>
            <span class="thumb">${s.thumb ? `<img src="${media(s.thumb)}" alt="" loading="lazy">` : s.kind === 'sim' ? `<canvas width="192" height="108" data-thumb="${i}"></canvas>` : '<i class="gridthumb"></i>'}</span>
            <span class="txt"><b>${s.title}</b><small class="hudtxt">${s.tag}${s.dur ? ` · ${fmt(s.start)}–${fmt(s.start + s.dur)}` : ''}</small></span>
          </button></li>`).join('')}
        </ol>
      </div>
    </div>`;
  root.appendChild(el);

  const $ = s => el.querySelector(s);
  const video = $('video'), canvas = $('.ops-sim'), ctx = canvas.getContext('2d');
  const head = $('.ops-track .head'), track = $('.ops-track');
  let cur = -1, local = 0, playing = false, mode = 'all', shown = false, last = performance.now();

  el.querySelectorAll('canvas[data-thumb]').forEach(c => {
    const s = OPS_STEPS[+c.dataset.thumb], x = c.getContext('2d');
    x.scale(c.width / SIM_W, c.height / SIM_H);
    renderSim(x, s.sim, s.thumbT, 0.3);
  });

  function setStep(i) {
    cur = i;
    const s = OPS_STEPS[i];
    el.querySelectorAll('.ops-step').forEach((b, k) => { b.classList.toggle('on', k === i); b.classList.toggle('done', k < i); });
    $('.ops-step-no').textContent = `Step ${pad(i + 1)} of ${pad(OPS_STEPS.length)} · ${s.tag}`;
    $('.ops-caption h3').textContent = s.title;
    $('.ops-caption p').textContent = s.body;
    $('.ops-badge').textContent = `${pad(i + 1)} · ${s.title}`;
    $('.ops-caption .btn')?.remove();
    if (s.action) {
      const b = document.createElement('button');
      b.className = 'btn primary'; b.textContent = `⬚ ${s.action}`;
      b.addEventListener('click', () => onTryArea?.());
      $('.ops-caption').appendChild(b);
    }
    const sim = s.kind === 'sim';
    canvas.hidden = !sim;
    video.style.visibility = sim ? 'hidden' : '';
    el.classList.toggle('sim', sim);
  }

  function draw() {
    const s = OPS_STEPS[cur];
    if (!s || s.kind !== 'sim' || canvas.hidden) return;
    const r = canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (!w || !h) return;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    ctx.setTransform(w / SIM_W, 0, 0, h / SIM_H, 0, 0);
    renderSim(ctx, s.sim, local, performance.now() / 1000);
  }

  function syncUi() {
    const s = OPS_STEPS[cur], T = s.start + Math.min(local, s.dur);
    head.style.left = `${(T / TOTAL) * 100}%`;
    $('.ops-time').textContent = `${fmt(T)} / ${fmt(TOTAL)}`;
    el.querySelectorAll('[data-ops="toggle"]').forEach(b => { b.textContent = playing ? '❚❚' : '▶'; b.setAttribute('aria-label', playing ? 'Pause' : 'Play'); });
    el.classList.toggle('playing', playing);
    track.setAttribute('aria-valuenow', T.toFixed(1));
  }

  // jump to step i, t seconds in; keep playing (or not)
  function go(i, t = 0, play = playing) {
    if (i !== cur) setStep(i);
    const s = OPS_STEPS[i];
    local = Math.max(0, Math.min(t, s.dur));
    playing = play && s.kind !== 'none';
    if (s.kind === 'video') {
      video.currentTime = s.t0 + local + 0.01;
      if (playing) video.play().catch(() => {}); else video.pause();
    } else {
      video.pause();
      if (s.kind === 'none') video.currentTime = 0;
    }
    draw(); syncUi();
  }
  function endStep() {
    if (mode === 'all' && cur + 1 < OPS_STEPS.length) return go(cur + 1, 0, true);
    playing = false; video.pause(); local = OPS_STEPS[cur].dur;
    draw(); syncUi();
  }
  function pause() { playing = false; video.pause(); syncUi(); }
  function seekT(T) {
    T = Math.max(0, Math.min(TOTAL - 0.001, T));
    let i = OPS_STEPS.findIndex(s => s.dur > 0 && T >= s.start && T < s.start + s.dur);
    if (i < 0) i = OPS_STEPS.length - 1;
    mode = 'all';
    go(i, T - OPS_STEPS[i].start, playing);
  }

  // advance the timeline: driven by animation frames, with a timer as backup for when the browser
  // stops painting (hidden pane / background window) so steps still hand over to each other
  function tick(ts) {
    const dt = Math.max(0, Math.min(0.1, (ts - last) / 1000)); last = Math.max(last, ts);
    if (!shown || cur < 0) return;
    const s = OPS_STEPS[cur];
    if (playing) {
      if (s.kind === 'video') {
        local = video.currentTime - s.t0;
        if (video.currentTime >= s.t1 - 0.03 || video.ended) return endStep();
      } else if (s.kind === 'sim') {
        local += dt;
        if (local >= s.dur) { local = s.dur; return endStep(); }
      }
      syncUi();
    }
    if (s.kind === 'sim') draw();          // keeps rotors spinning / person waving while paused
  }
  const frame = ts => { tick(ts); requestAnimationFrame(frame); };
  requestAnimationFrame(frame);
  setInterval(() => { const now = performance.now(); if (now - last > 150) tick(now); }, 100);

  el.addEventListener('click', e => {
    const step = e.target.closest('[data-step]');
    if (step) { mode = 'step'; return go(+step.dataset.step, 0, true); }
    const b = e.target.closest('[data-ops]');
    if (!b) return;
    if (b.dataset.ops === 'all') { mode = 'all'; go(FIRST, 0, true); }
    if (b.dataset.ops === 'toggle') {
      if (playing) return pause();
      mode = 'all';
      const s = OPS_STEPS[cur];
      if (s.kind === 'none') go(FIRST, 0, true);
      else if (local >= s.dur - 0.05) go(cur + 1 < OPS_STEPS.length ? cur + 1 : FIRST, 0, true);
      else go(cur, local, true);
    }
  });
  track.addEventListener('pointerdown', e => {
    track.setPointerCapture(e.pointerId);
    const r = track.getBoundingClientRect();
    seekT(((e.clientX - r.left) / r.width) * TOTAL);
  });
  track.addEventListener('pointermove', e => {
    if (!e.buttons) return;
    const r = track.getBoundingClientRect();
    seekT(((e.clientX - r.left) / r.width) * TOTAL);
  });
  track.addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const s = OPS_STEPS[cur];
    seekT(s.start + local + (e.key === 'ArrowRight' ? 1 : -1));
  });
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', TOTAL.toFixed(1));
  window.addEventListener('resize', draw);

  go(0, 0, false);
  return {
    show() { shown = true; el.hidden = false; draw(); syncUi(); },
    hide() { shown = false; el.hidden = true; pause(); },
  };
}
