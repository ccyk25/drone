// ui.js (P2): HUD overlay on top of the full-screen map.
// top bar (room, scenario toggle, clock) · left telemetry rail · right event feed · bottom control dock · QR popover.

const EARS = ['L', 'C', 'R'];
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const SCENARIO_INFO = {
  flood: {
    icon: '🌊', title: 'Flood', sub: 'Typhoon storm surge · river overflow',
    bullets: ['Survivors on rooftops, attics, car roofs', 'Water & rain raise the noise floor', 'Voices carry far over open water'],
  },
  collapse: {
    icon: '🏚️', title: 'Collapsed buildings', sub: 'Earthquake · typhoon wind damage',
    bullets: ['Survivors trapped in voids under rubble', 'Debris muffles voices: shorter hearing range', 'Quieter streets once the shaking stops'],
  },
};

function qrInto(el, text) {
  el.innerHTML = '';
  if (window.QRCode && window.QRCode.toCanvas) {
    const c = document.createElement('canvas');
    window.QRCode.toCanvas(c, text, { width: 160, margin: 1 }, err => {
      if (err) return fallback();
      c.style.width = c.style.height = ''; // qrcode sets an inline size, which overrides the CSS size
    });
    el.appendChild(c);
  } else fallback();
  function fallback() {
    el.innerHTML = '';
    const img = new Image(160, 160);
    img.alt = text;
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&margin=4&data=${encodeURIComponent(text)}`;
    el.appendChild(img);
  }
}

const KIND_LABEL = { alert: 'Officials notified', rescue: 'Rescue drone R1', area: 'Search area', det: 'Detection', found: 'Survivor found', family: 'Family report', sim: 'Simulation', warn: 'Warning', muted: 'Navigation', '': 'System' };

export function createUI(root, opts) {
  const { room, earUrl, handlers, scenario = 'flood', site = null, sites = {} } = opts;
  const tz = -new Date().getTimezoneOffset() / 60;

  root.innerHTML = `
    <header class="topbar">
      <div class="logo">GEMA<i>.</i></div>
      <nav class="tabs" role="tablist" aria-label="View">
        <button role="tab" data-tab="map" aria-selected="true" class="on">Mission map</button>
        <button role="tab" data-tab="ops" aria-selected="false">Drone operation</button>
      </nav>
      <span class="chip inv">Sector</span>
      <span class="chip sector"><span class="k">Room</span> ${room}</span>
      <button class="scn-btn" data-act="scenario" aria-expanded="false" title="Choose disaster scenario">
        <span class="ico"></span><span class="nm"></span><span class="car">▾</span>
      </button>
      <div class="ruler"></div>
      <div class="clock hudtxt"><span class="hm">--:--:--</span><small>GMT${tz >= 0 ? '+' : ''}${tz}</small></div>
    </header>

    <section class="drawer" aria-label="Scenario">
      <h4>Disaster scenario · switching resets the search</h4>
      <div class="scn-cards">${Object.entries(SCENARIO_INFO).map(([id, s]) => `
        <div class="scn-card ${id}" data-scn="${id}" role="button" tabindex="0">
          <span class="ttl"><span>${s.icon}</span>${s.title}</span>
          <span class="sub">${s.sub}</span>
          <ul>${s.bullets.map(b => `<li>${b}</li>`).join('')}</ul>
          <div class="sites">${(sites[id] || []).map(st => `
            <button class="site" data-site="${st.id}" data-of="${id}"><b>${st.name}</b><small>${st.event}</small></button>`).join('')}</div>
          <span class="sel">● ACTIVE</span>
        </div>`).join('')}</div>
      <p class="drawer-note">Real post-disaster aerial imagery. Survivors are simulated. Toggle "Post-disaster imagery" in the layer menu to compare with before.</p>
    </section>

    <section class="swarm" aria-label="Drone swarm">
      <div class="swarm-list" role="listbox" aria-label="Select a drone"></div>
      <div class="swarm-act">
        <span class="swarm-sel hudtxt">D1</span>
        <button class="btn sm toggle area" data-act="d-area" title="Click or drag on the map: the selected drone searches only there">⬚ Set area</button>
        <button class="btn sm" data-act="d-all" title="Place D1→D5 one after another: click (or drag) a box for each">⬚ Place all 5</button>
        <button class="btn sm toggle" data-act="d-hold" title="Hover in place and keep listening">⏸ Hold</button>
        <button class="btn sm" data-act="d-land" title="Fly back to base and land">⤓ Land</button>
      </div>
    </section>

    <aside class="rail hudtxt">
      <div class="kv"><div class="k">Selected drone</div><div class="v sm sel-drone" data-t="drone">–</div></div>
      <div class="kv site-kv"><div class="k">Site</div><div class="v sm" data-t="site">–</div><div class="ev" data-t="event"></div></div>
      <div class="kv"><div class="k">Search area</div><div class="v sm" data-t="area">–</div></div>
      <div class="sep"></div>
      <div class="kv2">
        <div class="kv"><div class="k">Latitude (N)</div><div class="v" data-t="lat">–</div></div>
        <div class="kv"><div class="k">Longitude (E)</div><div class="v" data-t="lng">–</div></div>
      </div>
      <div class="kv2">
        <div class="kv"><div class="k">Altitude</div><div class="v"><span data-t="alt">–</span><small>m</small></div></div>
        <div class="kv"><div class="k">Speed</div><div class="v"><span data-t="spd">–</span><small>km/h</small></div></div>
      </div>
      <div class="heading">
        <div class="kv"><div class="k">Heading</div><div class="v"><span data-t="hdg">–</span><small>°</small></div></div>
        <svg class="dial" viewBox="0 0 44 44" aria-hidden="true">
          <circle cx="22" cy="22" r="20" fill="none" stroke="#ffffff30" />
          <circle cx="22" cy="22" r="13" fill="none" stroke="#ffffff14" />
          <text x="22" y="9" fill="#8a929c" font-size="7" text-anchor="middle" font-family="Chakra Petch">N</text>
          <line data-t="needle" x1="22" y1="22" x2="22" y2="5" stroke="#fff" stroke-width="2" stroke-linecap="round" />
          <circle cx="22" cy="22" r="2.5" fill="#fff" />
        </svg>
      </div>
      <div class="sep"></div>
      <div class="kv"><div class="k">Noise floor</div><div class="v"><span data-m="noise">–</span><small>dB</small></div></div>
      <div>
        <div class="kv"><div class="k" style="margin-bottom:6px">Ears connected</div></div>
        <div class="ears">${EARS.map(e => `
          <div class="earrow" data-ear-status="${e}"><b>${e}</b><div class="bar"><div class="fill"></div></div><span class="db">offline</span></div>`).join('')}</div>
      </div>
      <div class="sep"></div>
      <div class="pills">
        <span class="k">Search</span><span class="pill" data-p="search">Idle</span>
        <span class="k">Drone</span><span class="pill" data-p="mode">Idle</span>
        <span class="k">Rotor</span><span class="pill" data-p="rotor">Off</span>
        <span class="k">Scenario</span><span class="pill" data-p="scn">–</span>
      </div>
      <div class="sep"></div>
      <div class="big3">
        <div><div class="v" data-m="cleared">0%</div><div class="k">Cleared</div></div>
        <div><div class="v" data-m="found">0/0</div><div class="k">Found</div></div>
        <div><div class="v" data-m="first">–</div><div class="k">1st det.</div></div>
      </div>
      <div class="statusbar paused" data-t="status"><span>STANDBY</span><span>sim drone</span></div>
    </aside>

    <section class="feed">
      <div class="feed-head">
        <span class="tag">Live feed</span>
        <span class="cnt" data-t="cnt">0 events</span>
        <button class="collapse-btn" data-act="feed" title="Collapse feed">–</button>
      </div>
      <ol class="log"></ol>
    </section>

    <section class="qrpop" aria-label="Join as an ear">
      <h4><span>Scan to join as an ear</span><span>Room <b>${room}</b></span></h4>
      <div class="qrs">${EARS.map(e => `
        <a class="qr" data-ear="${e}" target="_blank" rel="noopener">
          <div class="qr-img"></div><div class="qr-label">${e === 'C' ? 'C · 📷 camera' : e === 'L' ? 'L · 🎤 left mic' : 'R · 🎤 right mic'}</div><div class="qr-state" data-ear-state="${e}">offline</div>
        </a>`).join('')}</div>
    </section>

    <section class="dock">
      <div class="grp">
        <div class="lab">Mission</div>
        <div class="row">
          <button class="btn primary" data-act="start">▶ Start search</button>
          <button class="btn" data-act="reset">↺ Reset</button>
        </div>
        <button class="btn toggle area" data-act="area" title="Drag a rectangle on the map to set the search area">⬚ Select area</button>
      </div>
      <div class="grp">
        <div class="lab">Simulate scream <em>ear</em></div>
        <div class="seg sim">${EARS.map(e => `<button data-sim="${e}" title="Simulate a scream heard by ear ${e}">${e}</button>`).join('')}</div>
        <button class="btn toggle" data-act="family">📍 Family report</button>
      </div>
      <div class="grp">
        <div class="lab">Rotor noise <em data-t="vol">50%</em></div>
        <div class="row">
          <button class="btn toggle" data-act="rotor">🔊 Off</button>
          <input class="slider" type="range" data-act="volume" min="0" max="100" value="50" title="Rotor volume">
        </div>
        <div class="row"><button class="btn toggle" data-act="qr">▦ Join ears</button><button class="btn" data-act="calibrate">🎚 Calibrate</button></div>
        <span class="calib"></span>
      </div>
      <div class="grp">
        <div class="lab">Map view</div>
        <div class="seg" data-seg="view"><button class="on" data-view="trust">Trust</button><button data-view="heat">Heatmap</button></div>
        <div class="row"><button class="btn toggle" data-act="follow">◎ Follow</button><button class="btn toggle" data-act="reveal">👁 Truth</button></div>
      </div>
      <div class="grp">
        <div class="lab">Sim speed</div>
        <div class="seg" data-seg="speed">${[1, 2, 4, 8].map(x => `<button data-speed="${x}" class="${x === 2 ? 'on' : ''}">${x}×</button>`).join('')}</div>
      </div>
    </section>
  `;

  // QR codes
  for (const e of EARS) {
    const a = $(`.qr[data-ear="${e}"]`, root);
    const url = earUrl(e);
    a.href = url;
    qrInto($('.qr-img', a), url);
  }

  // clock
  const hm = $('.clock .hm', root);
  const tickClock = () => { hm.textContent = new Date().toLocaleTimeString('en-GB', { hour12: false }); };
  tickClock(); setInterval(tickClock, 1000);

  const drawer = $('.drawer', root), scnBtn = $('[data-act="scenario"]', root), qrpop = $('.qrpop', root);
  const setDrawer = open => { drawer.classList.toggle('open', open); scnBtn.setAttribute('aria-expanded', String(open)); };
  const toggleBtn = (act, on) => { const b = $(`[data-act="${act}"]`, root); b.classList.toggle('on', on); return b; };

  const pick = (scn, siteId) => {
    setDrawer(false);
    if (scn !== current.scenario || (siteId && siteId !== current.site)) handlers.onScenario?.(scn, siteId);
  };
  root.addEventListener('keydown', ev => {
    const card = ev.target.closest?.('.scn-card');
    if (card && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); pick(card.dataset.scn); }
  });
  root.addEventListener('click', ev => {
    const siteBtn = ev.target.closest('[data-site]');
    if (siteBtn) return pick(siteBtn.dataset.of, siteBtn.dataset.site);
    const card = ev.target.closest('.scn-card');
    if (card) return pick(card.dataset.scn);
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.tab) return handlers.onTab?.(b.dataset.tab);
    if (b.dataset.drone) return handlers.onSelectDrone?.(b.dataset.drone);
    if (b.dataset.sim) return handlers.onSimScream?.(b.dataset.sim);
    if (b.dataset.view) {
      $$('[data-seg="view"] button', root).forEach(x => x.classList.toggle('on', x === b));
      return handlers.onHeatmap?.(b.dataset.view === 'heat');
    }
    if (b.dataset.speed) {
      $$('[data-seg="speed"] button', root).forEach(x => x.classList.toggle('on', x === b));
      return handlers.onSpeed?.(Number(b.dataset.speed));
    }
    const on = !b.classList.contains('on');
    switch (b.dataset.act) {
      case 'start': handlers.onStart?.(); break;
      case 'reset': handlers.onReset?.(); break;
      case 'calibrate': handlers.onCalibrate?.(); break;
      case 'scenario': setDrawer(!drawer.classList.contains('open')); break;
      case 'feed': $('.feed', root).classList.toggle('min'); b.textContent = $('.feed', root).classList.contains('min') ? '+' : '–'; break;
      case 'qr': toggleBtn('qr', on); qrpop.classList.toggle('open', on); break;
      case 'rotor': api.setRotor(on); handlers.onRotor?.(on); break;
      case 'family': if (on) api.setSelecting(false), api.setDroneSelecting(false), handlers.onSelectArea?.(false); api.setFamilyMode(on); handlers.onFamilyMode?.(on); break;
      case 'area': api.setDroneSelecting(false); api.setSelecting(on); handlers.onSelectArea?.(on); break;
      case 'd-area': api.setSelecting(false); api.setDroneSelecting(on); handlers.onDroneArea?.(on); break;
      case 'd-all': api.setSelecting(false); handlers.onPlaceAll?.(); break;
      case 'd-hold': handlers.onDroneHold?.(); break;
      case 'd-land': handlers.onDroneLand?.(); break;
      case 'follow': toggleBtn('follow', on); handlers.onFollow?.(on); break;
      case 'reveal': toggleBtn('reveal', on); handlers.onReveal?.(on); break;
    }
  });
  // close popovers on outside click / Esc
  document.addEventListener('pointerdown', ev => {
    if (!drawer.contains(ev.target) && !scnBtn.contains(ev.target)) setDrawer(false);
  });
  document.addEventListener('keydown', ev => {
    if (ev.key !== 'Escape') return;
    setDrawer(false); qrpop.classList.remove('open'); toggleBtn('qr', false);
    if ($('[data-act="area"]', root).classList.contains('on')) { api.setSelecting(false); handlers.onSelectArea?.(false); }
    if ($('[data-act="d-area"]', root).classList.contains('on')) { api.setDroneSelecting(false); handlers.onDroneArea?.(false); }
  });
  // keys 1-5 select a drone (not while typing, not on the Drone operation tab)
  document.addEventListener('keydown', ev => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey || /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName) || document.body.classList.contains('tab-ops')) return;
    const card = $$('.dcard', root)[Number(ev.key) - 1];
    if (card) handlers.onSelectDrone?.(card.dataset.drone);
  });
  // leaflet controls sit just under the swarm bar, whatever its height
  const swarmEl = $('.swarm', root);
  new ResizeObserver(() => document.documentElement.style.setProperty('--swarm-h', `${swarmEl.offsetHeight}px`)).observe(swarmEl);

  $('[data-act="volume"]', root).addEventListener('input', ev => {
    $('[data-t="vol"]', root).textContent = `${ev.target.value}%`;
    handlers.onVolume?.(ev.target.value / 100);
  });

  const logEl = $('.log', root);
  const t0 = Date.now();
  let nEvents = 0;
  const current = { scenario, site };
  const setPill = (k, text, cls = '') => { const p = $(`[data-p="${k}"]`, root); p.textContent = text; p.className = `pill ${cls}`; };

  const api = {
    log(msg, kind = '') {
      const li = document.createElement('li');
      li.className = kind;
      const s = ((Date.now() - t0) / 1000).toFixed(1);
      li.innerHTML = `<div class="t">${msg}</div><div class="s">${KIND_LABEL[kind] ?? kind}</div><time>${s}s</time>`;
      logEl.prepend(li);
      while (logEl.children.length > 80) logEl.lastChild.remove();
      nEvents++;
      $('[data-t="cnt"]', root).textContent = `${nEvents} event${nEvents === 1 ? '' : 's'}`;
    },
    setEarStatus(ear, { connected, db, floorDb, screaming } = {}) {
      const el = $(`[data-ear-status="${ear}"]`, root);
      if (!el) return;
      el.classList.toggle('on', !!connected);
      el.classList.toggle('scream', !!screaming);
      $('.db', el).textContent = connected ? `${db != null ? db.toFixed(0) : '–'} / ${floorDb != null ? floorDb.toFixed(0) : '–'}` : 'offline';
      const pct = db == null ? 0 : Math.max(0, Math.min(100, ((db + 80) / 80) * 100));
      $('.fill', el).style.width = `${pct}%`;
      const st = $(`[data-ear-state="${ear}"]`, root);
      st.textContent = connected ? (screaming ? 'scream!' : 'live') : 'offline';
      st.classList.toggle('on', !!connected);
    },
    setMetrics({ clearedPct, firstDetS, found, total, noiseDb, rescued }) {
      if (clearedPct != null) $('[data-m="cleared"]', root).textContent = `${clearedPct.toFixed(0)}%`;
      $('[data-m="first"]', root).textContent = firstDetS == null ? '–' : `${firstDetS.toFixed(1)}s`;
      if (total != null) $('[data-m="found"]', root).textContent = `${found}/${total}`;
      if (rescued != null) $('[data-m="found"]', root).nextElementSibling.textContent = rescued ? `Found · ${rescued} rescued` : 'Found';
      if (noiseDb != null) $('[data-m="noise"]', root).textContent = noiseDb.toFixed(0);
    },
    /** { lat, lng, altM, speedKmh, headingDeg, mode } */
    setTelemetry({ lat, lng, altM, speedKmh, headingDeg, mode, drone, color }) {
      if (drone) { const el = $('[data-t="drone"]', root); el.textContent = drone; el.style.color = color || ''; }
      $('[data-t="lat"]', root).textContent = `${lat.toFixed(4)}°`;
      $('[data-t="lng"]', root).textContent = `${lng.toFixed(4)}°`;
      $('[data-t="alt"]', root).textContent = altM.toFixed(0);
      $('[data-t="spd"]', root).textContent = speedKmh.toFixed(0);
      const h = (headingDeg + 360) % 360;
      $('[data-t="hdg"]', root).textContent = h.toFixed(0).padStart(3, '0');
      $('[data-t="needle"]', root).style.transform = `rotate(${h}deg)`;
      const MODES = { investigate: ['Investigate', 'r'], search: ['Searching', 'b'], hold: ['Holding', 'a'], rtb: ['Returning', 'a'], landed: ['Landed', ''] };
      const [txt, cls] = MODES[mode] || ['Hover', ''];
      setPill('mode', txt, cls);
    },
    /** drones: [{ id, color, status, label, clearedPct }] · selId · sel: { hold, grounded } for the selected drone */
    setSwarm(drones, selId, { hold = false, grounded = false } = {}, lifter = null) {
      const list = $('.swarm-list', root);
      if (list.querySelectorAll('.dcard').length !== drones.length) {
        list.innerHTML = drones.map((d, k) => `
          <button class="dcard" data-drone="${d.id}" role="option" style="--dc:${d.color}" title="Select ${d.id} (key ${k + 1})">
            <i class="dot"></i><b>${d.id}</b><small></small><span class="bar"><i></i></span>
          </button>`).join('') + `
          <div class="rcard" title="R1 heavy-lift rescue drone: lowers an enclosed, harnessed capsule on a dual rope">
            <i class="dot"></i><b>R1</b><small></small><span class="bar"><i></i></span>
          </div>`;
      }
      const rc = $('.rcard', list);
      if (lifter && rc) {
        rc.dataset.status = lifter.status;
        const q = lifter.queue ? ` · ${lifter.queue} waiting` : '';
        $('small', rc).textContent = `${lifter.label}${lifter.job && lifter.status !== 'standby' ? `: ${lifter.job}` : ''}${q} · ${lifter.rescued} saved`;
        $('.bar i', rc).style.width = `${lifter.pct ?? (lifter.status === 'standby' ? 0 : 100)}%`;
      }
      drones.forEach((d, k) => {
        const c = list.querySelectorAll('.dcard')[k];
        c.classList.toggle('on', d.id === selId);
        c.setAttribute('aria-selected', String(d.id === selId));
        c.dataset.status = d.status;
        $('small', c).textContent = `${d.label} · ${d.clearedPct.toFixed(0)}%`;
        $('.bar i', c).style.width = `${d.clearedPct}%`;
      });
      const s = drones.find(d => d.id === selId);
      if (s) { const el = $('.swarm-sel', root); el.textContent = s.id; el.style.color = s.color; }
      const hb = $('[data-act="d-hold"]', root), lb = $('[data-act="d-land"]', root);
      hb.classList.toggle('on', hold); hb.textContent = hold ? '▶ Resume' : '⏸ Hold'; hb.disabled = grounded;
      lb.textContent = grounded ? '⤒ Launch' : '⤓ Land';
    },
    setDroneSelecting(on) {
      toggleBtn('d-area', on);
      document.body.classList.toggle('area-mode', on || $('[data-act="area"]', root).classList.contains('on'));
      if (on) { toggleBtn('family', false); document.body.classList.remove('family-mode'); }
    },
    /** banner at the top: survivor found → rescue drone + officials notified */
    alert(html) {
      let box = $('.alerts', root);
      if (!box) { box = document.createElement('div'); box.className = 'alerts'; root.appendChild(box); }
      const el = document.createElement('div');
      el.className = 'alert-toast'; el.setAttribute('role', 'alert'); el.innerHTML = html;
      box.prepend(el);
      while (box.children.length > 3) box.lastChild.remove();
      setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 7000);
    },
    setCalibStatus(text) { $('.calib', root).textContent = text || ''; },
    setTab(tab) {
      $$('[data-tab]', root).forEach(b => { const on = b.dataset.tab === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
      document.body.classList.toggle('tab-ops', tab === 'ops');
      if (tab === 'ops') { setDrawer(false); qrpop.classList.remove('open'); toggleBtn('qr', false); }
    },
    /** press a dock/tool button programmatically, e.g. trigger('area') */
    trigger(act) { $(`[data-act="${act}"]`, root)?.click(); },
    setSite(st) {
      $('[data-t="site"]', root).textContent = st.name;
      $('[data-t="event"]', root).textContent = st.event;
    },
    /** { cols, rows, cellM } */
    setArea({ cols, rows, cellM }) {
      const w = cols * cellM, h = rows * cellM, f = m => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`);
      $('[data-t="area"]', root).textContent = `${f(w)}×${f(h)} · ${((w * h) / 1e6).toFixed(2)} km²`;
    },
    setSelecting(on) {
      toggleBtn('area', on);
      document.body.classList.toggle('area-mode', on);
      if (on) { toggleBtn('family', false); document.body.classList.remove('family-mode'); }
    },
    setFamilyMode(on) {
      toggleBtn('family', on);
      document.body.classList.toggle('family-mode', on);
    },
    setRotor(on) {
      const b = toggleBtn('rotor', on);
      b.textContent = on ? '🔊 On' : '🔊 Off';
      setPill('rotor', on ? 'Noisy' : 'Off', on ? 'a' : '');
    },
    setStarted(on) {
      $('[data-act="start"]', root).textContent = on ? '⏸ Pause' : '▶ Start search';
      setPill('search', on ? 'Active' : 'Paused', on ? 'g' : '');
      const sb = $('[data-t="status"]', root);
      sb.classList.toggle('paused', !on);
      sb.firstElementChild.textContent = on ? 'SEARCH ACTIVE' : 'STANDBY';
      sb.lastElementChild.textContent = on ? 'running smoothly' : 'sim drone';
    },
    setScenario(id, siteId) {
      current.scenario = id;
      current.site = siteId || (sites[id] || [])[0]?.id || null;
      const s = SCENARIO_INFO[id];
      const st = (sites[id] || []).find(x => x.id === current.site);
      scnBtn.className = `scn-btn ${id}`;
      $('.ico', scnBtn).textContent = s.icon;
      $('.nm', scnBtn).textContent = st ? `${s.title} · ${st.name.split(',')[0]}` : s.title;
      $$('.scn-card', root).forEach(c => c.classList.toggle('on', c.dataset.scn === id));
      $$('.site', root).forEach(b => b.classList.toggle('on', b.dataset.of === id && b.dataset.site === current.site));
      setPill('scn', id === 'flood' ? 'Flood' : 'Collapse', id === 'flood' ? 'b' : 'a');
    },
  };
  api.setScenario(scenario, site);
  api.setStarted(false);
  return api;
}
