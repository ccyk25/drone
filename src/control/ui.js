// ui.js (P2): side panel: room + QR codes, ear status, controls, legend, metrics, event log.

const EARS = ['L', 'C', 'R'];
const $ = (sel, root = document) => root.querySelector(sel);

function qrInto(el, text) {
  el.innerHTML = '';
  if (window.QRCode && window.QRCode.toCanvas) {
    const c = document.createElement('canvas');
    window.QRCode.toCanvas(c, text, { width: 132, margin: 1 }, err => {
      if (err) return fallback();
      c.style.width = c.style.height = ''; // qrcode sets inline 132px, which overrides the CSS size
    });
    el.appendChild(c);
  } else fallback();
  function fallback() {
    el.innerHTML = '';
    const img = new Image(132, 132);
    img.alt = text;
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=132x132&margin=4&data=${encodeURIComponent(text)}`;
    el.appendChild(img);
  }
}

export function createUI(root, opts) {
  const { room, earUrl, handlers } = opts;
  root.innerHTML = `
    <header class="brand"><div class="logo">GEMA</div><div class="tag">listens for survivors, admits what it missed</div></header>

    <section class="panel">
      <h3>Join as an ear <span class="room">ROOM <b>${room}</b></span></h3>
      <div class="qrs">${EARS.map(e => `
        <a class="qr" data-ear="${e}" target="_blank" rel="noopener">
          <div class="qr-img"></div><div class="qr-label">${e}</div>
          <div class="ear-status" data-ear="${e}"><i class="dot"></i><span class="db">offline</span>
            <div class="bar"><div class="fill"></div></div></div>
        </a>`).join('')}</div>
    </section>

    <section class="panel">
      <h3>Controls</h3>
      <div class="row">
        <button data-act="start" class="primary">▶ Start search</button>
        <button data-act="reset">↺ Reset</button>
      </div>
      <div class="row"><span class="lbl">Simulate scream</span>
        ${EARS.map(e => `<button data-sim="${e}">${e}</button>`).join('')}</div>
      <div class="row">
        <button data-act="rotor" class="toggle">🔊 Rotor noise OFF</button>
        <input type="range" data-act="volume" min="0" max="100" value="50" title="Rotor volume">
      </div>
      <div class="row">
        <button data-act="family" class="toggle">📍 Family report</button>
        <button data-act="calibrate">🎚 Calibrate</button>
      </div>
      <div class="row">
        <label><input type="checkbox" data-act="heatmap"> Probability heatmap</label>
        <label><input type="checkbox" data-act="follow"> Follow drone</label>
      </div>
      <div class="row">
        <label><input type="checkbox" data-act="reveal"> Reveal ground truth</label>
        <label>Speed <select data-act="speed"><option>1</option><option selected>2</option><option>4</option><option>8</option></select>×</label>
      </div>
      <div class="calib muted"></div>
    </section>

    <section class="panel metrics">
      <div class="metric"><div class="v" data-m="cleared">0%</div><div class="k">cleared</div></div>
      <div class="metric"><div class="v" data-m="first">–</div><div class="k">first detection</div></div>
      <div class="metric"><div class="v" data-m="found">0/0</div><div class="k">survivors found</div></div>
      <div class="metric"><div class="v" data-m="noise">–</div><div class="k">noise floor</div></div>
    </section>

    <section class="panel legend">
      <span><i class="sw grey"></i>Unsearched</span>
      <span><i class="sw amber"></i>Uncertain · <b>NOT CLEARED</b></span>
      <span><i class="sw green"></i>Cleared</span>
      <span><i class="sw pinsw"></i>Detection (confidence %)</span>
    </section>

    <section class="panel log-panel"><h3>Event log</h3><ol class="log"></ol></section>
    <footer class="muted small">Simulated drone · phones stand in for a mic array · 1 m room = 25 m map · no audio stored</footer>
  `;

  // QR codes
  for (const e of EARS) {
    const a = $(`.qr[data-ear="${e}"]`, root);
    const url = earUrl(e);
    a.href = url;
    qrInto($('.qr-img', a), url);
  }

  // wiring
  root.addEventListener('click', ev => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.sim) return handlers.onSimScream?.(b.dataset.sim);
    switch (b.dataset.act) {
      case 'start': handlers.onStart?.(); break;
      case 'reset': handlers.onReset?.(); break;
      case 'calibrate': handlers.onCalibrate?.(); break;
      case 'rotor': {
        const on = !b.classList.contains('on');
        b.classList.toggle('on', on);
        b.textContent = on ? '🔊 Rotor noise ON' : '🔊 Rotor noise OFF';
        handlers.onRotor?.(on); break;
      }
      case 'family': {
        const on = !b.classList.contains('on');
        api.setFamilyMode(on);
        handlers.onFamilyMode?.(on); break;
      }
    }
  });
  root.addEventListener('change', ev => {
    const t = ev.target;
    switch (t.dataset.act) {
      case 'heatmap': handlers.onHeatmap?.(t.checked); break;
      case 'follow': handlers.onFollow?.(t.checked); break;
      case 'reveal': handlers.onReveal?.(t.checked); break;
      case 'speed': handlers.onSpeed?.(Number(t.value)); break;
    }
  });
  $('[data-act="volume"]', root).addEventListener('input', ev => handlers.onVolume?.(ev.target.value / 100));

  const logEl = $('.log', root);
  const t0 = Date.now();

  const api = {
    log(msg, kind = '') {
      const li = document.createElement('li');
      li.className = kind;
      const s = ((Date.now() - t0) / 1000).toFixed(1).padStart(6, ' ');
      li.innerHTML = `<time>${s}s</time> ${msg}`;
      logEl.prepend(li);
      while (logEl.children.length > 80) logEl.lastChild.remove();
    },
    setEarStatus(ear, { connected, db, floorDb, screaming } = {}) {
      const el = $(`.ear-status[data-ear="${ear}"]`, root);
      if (!el) return;
      el.classList.toggle('on', !!connected);
      el.classList.toggle('scream', !!screaming);
      $('.db', el).textContent = connected
        ? `${db != null ? db.toFixed(0) : '–'} dB · floor ${floorDb != null ? floorDb.toFixed(0) : '–'}`
        : 'offline';
      const pct = db == null ? 0 : Math.max(0, Math.min(100, ((db + 80) / 80) * 100));
      $('.fill', el).style.width = `${pct}%`;
    },
    setMetrics({ clearedPct, firstDetS, found, total, noiseDb }) {
      if (clearedPct != null) $('[data-m="cleared"]', root).textContent = `${clearedPct.toFixed(0)}%`;
      $('[data-m="first"]', root).textContent = firstDetS == null ? '–' : `${firstDetS.toFixed(1)}s`;
      if (total != null) $('[data-m="found"]', root).textContent = `${found}/${total}`;
      if (noiseDb != null) $('[data-m="noise"]', root).textContent = `${noiseDb.toFixed(0)} dB`;
    },
    setCalibStatus(text) { $('.calib', root).textContent = text || ''; },
    setFamilyMode(on) {
      const b = $('[data-act="family"]', root);
      b.classList.toggle('on', on);
      document.body.classList.toggle('family-mode', on);
    },
    setStarted(on) { $('[data-act="start"]', root).textContent = on ? '⏸ Pause' : '▶ Start search'; },
  };
  return api;
}
