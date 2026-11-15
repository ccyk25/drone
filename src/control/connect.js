// "Connect the drone" setup sheet + live "Drone camera" window for the mission map. Owner: P1.
// Three cards laid out like the phones on the table: 🎤 Left ear · 📷 Camera · 🎤 Right ear.
// Each card walks the operator through: waiting for phone → joined (tap Start…) → 🟢 live.
import QRCode from 'qrcode';

const CSS = `
/* Matches the mission map HUD (index.html tokens: --card, --line, --hud font, --green/--amber/--red) */
.cx-sheet{position:fixed;inset:0;z-index:3000;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.5);backdrop-filter:blur(4px)}
.cx-sheet.open{display:flex}
.cx-card{width:min(900px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;background:var(--card,rgba(20,22,26,.92));border:1px solid var(--line,rgba(255,255,255,.08));border-radius:16px;padding:16px;color:var(--text,#eef1f4);font:14px/1.35 var(--ui,system-ui);backdrop-filter:blur(10px);box-shadow:0 20px 60px rgba(0,0,0,.55)}
.cx-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:6px}
.cx-head h3{margin:0;font:700 16px var(--hud,monospace);letter-spacing:.18em;text-transform:uppercase;color:#fff}
.cx-room{font:600 11px var(--hud,monospace);letter-spacing:.14em;color:var(--muted,#8a929c);text-transform:uppercase}.cx-room b{color:#fff;font-size:18px;letter-spacing:.24em;margin-left:8px}
.cx-sub{color:var(--muted,#8a929c);margin:0 0 14px;font-size:13px}
.cx-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
@media (max-width:640px){.cx-grid{grid-template-columns:1fr}}
.cx-ear{background:var(--card-2,#1c1f24);border:1px solid var(--line,rgba(255,255,255,.08));border-radius:12px;padding:12px;display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;transition:border-color .2s,box-shadow .2s}
.cx-ear.joined{border-color:var(--amber,#ffb020)}
.cx-ear.live{border-color:var(--green,#3be07c);box-shadow:0 0 0 1px var(--green,#3be07c) inset}
.cx-ear h4{margin:0;font:700 13px var(--hud,monospace);letter-spacing:.14em;text-transform:uppercase}
.cx-ear .role{font:500 10px var(--hud,monospace);letter-spacing:.1em;color:var(--muted,#8a929c);text-transform:uppercase;margin-top:-4px}
.cx-qr{background:#fff;border-radius:8px;padding:6px;line-height:0}.cx-qr canvas{width:140px!important;height:140px!important}
.cx-step{font-size:12.5px;color:var(--text,#eef1f4);opacity:.85;min-height:34px}
.cx-state{padding:3px 9px;border-radius:4px;font:600 10px var(--hud,monospace);letter-spacing:.1em;text-transform:uppercase;background:#ffffff14;color:var(--muted,#8a929c)}
.cx-ear.joined .cx-state{background:rgba(255,176,32,.14);color:var(--amber,#ffb020)}
.cx-ear.live .cx-state{background:var(--green-bg,#173d27);color:var(--green,#3be07c)}
.cx-ear.scream .cx-state{background:rgba(255,77,94,.16);color:var(--red,#ff4d5e)}
.cx-meter{width:100%;height:6px;border-radius:3px;background:var(--card-3,#262a30);overflow:hidden}.cx-meter i{display:block;height:100%;width:0;background:var(--green,#3be07c);transition:width .1s}
.cx-ear.scream .cx-meter i{background:var(--red,#ff4d5e)}
.cx-thumb{width:100%;aspect-ratio:4/3;border-radius:8px;background:#000 center/cover no-repeat;display:none;border:1px solid var(--line,rgba(255,255,255,.08))}
.cx-ear.live .cx-thumb{display:block}
.cx-link{color:var(--blue,#5fd0ff);font:500 10px var(--hud,monospace);letter-spacing:.04em;word-break:break-all;text-decoration:none;opacity:.8}
.cx-foot{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:12px;padding-top:12px;border-top:1px solid var(--line,rgba(255,255,255,.08))}
.cx-ready{font:700 12px var(--hud,monospace);letter-spacing:.12em;text-transform:uppercase}
.cx-ready.all{color:var(--green,#3be07c)}
.cx-calib{color:var(--muted,#8a929c);font-size:12px;flex:1;min-width:180px}
.cx-pip{position:fixed;left:calc(var(--rail,236px) + var(--gap,12px) * 2);top:calc(var(--top,52px) + 84px);z-index:1100;width:300px;background:var(--card,rgba(20,22,26,.92));border:1px solid var(--line,rgba(255,255,255,.08));border-radius:16px;overflow:hidden;backdrop-filter:blur(8px);box-shadow:0 10px 30px rgba(0,0,0,.45);display:none;color:var(--text,#eef1f4)}
.cx-pip.on{display:block}
.cx-pip .bar{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;font:600 11px var(--hud,monospace);letter-spacing:.14em;text-transform:uppercase;color:var(--muted,#8a929c)}
.cx-pip .bar b{color:#fff;font-weight:700}
.cx-pip .bar .rec{width:8px;height:8px;border-radius:50%;background:var(--red,#ff4d5e);display:inline-block;margin-right:7px;animation:cxblink 1.2s infinite}
@keyframes cxblink{50%{opacity:.25}}
.cx-pip .view{position:relative;line-height:0;margin:0 8px 8px;border-radius:10px;overflow:hidden;background:#000}.cx-pip img{width:100%;display:block}
.cx-pip .box{position:absolute;border:2px solid var(--green,#3be07c);border-radius:3px;display:none;box-shadow:0 0 0 1px rgba(0,0,0,.4)}
.cx-pip .lbl{position:absolute;left:8px;top:8px;font:700 12px var(--hud,monospace);letter-spacing:.1em;text-transform:uppercase;line-height:1;padding:5px 8px;border-radius:4px;background:rgba(0,0,0,.6);color:var(--muted,#8a929c)}
.cx-pip .lbl.person{background:var(--green,#3be07c);color:#04210f}
.cx-pip.stale img{filter:grayscale(1) brightness(.45)}
`;

const CARDS = [
  { ear: 'L', title: '🎤 Left ear', role: 'microphone · place on the LEFT', step: 'Scan with the <b>left</b> phone → tap <b>Start listening</b>' },
  { ear: 'C', title: '📷 Camera', role: 'drone camera · place in the MIDDLE, facing forward', step: 'Scan with the <b>middle</b> phone → wait for <b>“ready”</b> → tap <b>Start eyes</b>' },
  { ear: 'R', title: '🎤 Right ear', role: 'microphone · place on the RIGHT', step: 'Scan with the <b>right</b> phone → tap <b>Start listening</b>' }
];

export function createConnect({ room, earUrl, onCalibrate, onClose } = {}) {
  if (!document.getElementById('cx-style')) {
    const st = document.createElement('style'); st.id = 'cx-style'; st.textContent = CSS; document.head.appendChild(st);
  }

  // ---------- setup sheet ----------
  const sheet = document.createElement('div');
  sheet.className = 'cx-sheet';
  sheet.innerHTML = `<div class="cx-card" role="dialog" aria-label="Connect the drone">
    <div class="cx-head"><h3>Connect the drone</h3><div class="cx-room">Room<b>${room}</b></div></div>
    <p class="cx-sub">Three phones = one drone: its camera in the middle and its two ears on the sides. Lay them out like the cards below, about 1 m apart.</p>
    <div class="cx-grid">${CARDS.map((c) => `
      <div class="cx-ear" data-cx="${c.ear}">
        <h4>${c.title}</h4><div class="role">${c.role}</div>
        <div class="cx-qr"><canvas></canvas></div>
        <a class="cx-link" target="_blank" rel="noopener"></a>
        <div class="cx-step">${c.step}</div>
        <div class="cx-state">Waiting for phone</div>
        ${c.ear === 'C' ? '<div class="cx-thumb"></div>' : '<div class="cx-meter"><i></i></div>'}
      </div>`).join('')}</div>
    <div class="cx-foot">
      <span class="cx-ready">0 / 3 ready</span>
      <span class="cx-calib">Different phone models for L and R? Calibrate once now (3 s quiet, then one clap). Same model → skip.</span>
      <button class="btn" data-cx-act="calib">🎚 Calibrate</button>
      <button class="btn primary" data-cx-act="done">Done</button>
    </div></div>`;
  document.body.appendChild(sheet);
  for (const c of CARDS) {
    const card = sheet.querySelector(`[data-cx="${c.ear}"]`);
    const url = earUrl(c.ear);
    const a = card.querySelector('.cx-link'); a.href = url; a.textContent = url.replace(/^https?:\/\//, '');
    QRCode.toCanvas(card.querySelector('canvas'), url, { width: 150, margin: 1 }).catch(() => {});
  }
  sheet.addEventListener('click', (ev) => {
    const act = ev.target.closest('[data-cx-act]')?.dataset.cxAct;
    if (act === 'calib') onCalibrate?.();
    if (act === 'done' || ev.target === sheet) close();
  });
  const isOpen = () => sheet.classList.contains('open');
  function open() { sheet.classList.add('open'); }
  function close() { sheet.classList.remove('open'); onClose?.(); }

  // ---------- drone camera window ----------
  const pip = document.createElement('div');
  pip.className = 'cx-pip';
  pip.innerHTML = '<div class="bar"><span><span class="rec"></span><b>Drone camera</b> · C</span><span class="sc"></span></div><div class="view"><img alt="Drone camera"><div class="box"></div><div class="lbl">Looking…</div></div>';
  document.body.appendChild(pip);
  const img = pip.querySelector('img'), box = pip.querySelector('.box'), lbl = pip.querySelector('.lbl'), sc = pip.querySelector('.sc');
  let lastFrameAt = 0;

  function onFrame(msg) {
    lastFrameAt = Date.now();
    img.src = msg.jpg;
    pip.classList.add('on'); pip.classList.remove('stale');
    const thumb = sheet.querySelector('[data-cx="C"] .cx-thumb');
    if (thumb) thumb.style.backgroundImage = `url(${msg.jpg})`;
    if (msg.box && msg.score > 0) {
      const [x, y, w, h] = msg.box;
      Object.assign(box.style, { display: 'block', left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` });
      lbl.textContent = `Person ${Math.round(msg.score * 100)}%`; lbl.classList.add('person');
    } else {
      box.style.display = 'none'; lbl.textContent = 'Looking…'; lbl.classList.remove('person');
    }
    sc.textContent = new Date().toLocaleTimeString([], { hour12: false });
  }
  setInterval(() => {                                          // stay below the drone bar and the phase banner
    const r = document.querySelector('section.swarm')?.getBoundingClientRect();
    if (r && r.height) pip.style.top = `${Math.round(r.bottom + 72)}px`;
  }, 1000);
  setInterval(() => {
    if (lastFrameAt && Date.now() - lastFrameAt > 3000) { pip.classList.add('stale'); lbl.textContent = 'Camera offline'; lbl.classList.remove('person'); box.style.display = 'none'; }
  }, 1000);

  // ---------- live status per card ----------
  const state = {};
  function setEar(ear, { joined = false, listening = false, watching = false, db = null, screaming = false } = {}) {
    const card = sheet.querySelector(`[data-cx="${ear}"]`);
    if (!card) return;
    const live = ear === 'C' ? watching : listening;
    state[ear] = live;
    card.classList.toggle('joined', joined && !live);
    card.classList.toggle('live', live);
    card.classList.toggle('scream', !!screaming);
    const s = card.querySelector('.cx-state');
    if (ear === 'C') s.textContent = live ? 'Watching' : joined ? 'Joined · tap Start eyes' : 'Waiting for phone';
    else s.textContent = live ? (screaming ? 'Scream heard' : 'Listening') : joined ? 'Joined · tap Start listening' : 'Waiting for phone';
    const m = card.querySelector('.cx-meter i');
    if (m) m.style.width = `${db == null || !live ? 0 : Math.max(0, Math.min(100, ((db + 80) / 80) * 100))}%`;
    const n = ['L', 'C', 'R'].filter((k) => state[k]).length;
    const r = sheet.querySelector('.cx-ready'); r.textContent = n === 3 ? '3 / 3 ready · press Done, then Start search' : `${n} / 3 ready`; r.classList.toggle('all', n === 3);
  }

  return {
    open, close, toggle: () => (isOpen() ? close() : open()), isOpen, onFrame, setEar,
    setCalibStatus: (t) => { if (t) sheet.querySelector('.cx-calib').textContent = t; }
  };
}
