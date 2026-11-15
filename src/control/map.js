// map.js (P2): Leaflet basemap, search grid, drone sprite, pins, survivors.
// Leaflet is loaded as a global (window.L) from index.html, so this works with or without npm.
// Local frame: x = metres east, y = metres north of the frame origin. Heading 0 = north, clockwise.

const L = window.L;
const M_PER_DEG_LAT = 111320;

let origin = { lat: 0, lng: 0 };

/** Set the lat/lng that local (0,0) maps to. */
export function setOrigin(latlng) { origin = { lat: latlng[0], lng: latlng[1] }; }

/** Local metres → [lat, lng]. */
export function xyToLatLng(x, y) {
  const lat = origin.lat + y / M_PER_DEG_LAT;
  const lng = origin.lng + x / (M_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180));
  return [lat, lng];
}

/** [lat, lng] (or {lat,lng}) → local metres {x, y}. */
export function latLngToXY(ll) {
  const lat = Array.isArray(ll) ? ll[0] : ll.lat;
  const lng = Array.isArray(ll) ? ll[1] : ll.lng;
  return {
    x: (lng - origin.lng) * M_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180),
    y: (lat - origin.lat) * M_PER_DEG_LAT,
  };
}

const TRUST_STYLE = {
  unsearched: { color: '#9aa3ad', fillColor: '#6b7480', fillOpacity: 0.28 },
  uncertain: { color: '#ffb020', fillColor: '#ffb020', fillOpacity: 0.42 },
  cleared: { color: '#2fd36b', fillColor: '#2fd36b', fillOpacity: 0.32 },
};

// probability → colour (dark blue → yellow → red), t in 0..1
function heatColor(t) {
  const stops = [[0, [20, 30, 80]], [0.5, [255, 210, 40]], [1, [230, 30, 30]]];
  let a = stops[0], b = stops[2];
  for (let k = 0; k < stops.length - 1; k++) if (t >= stops[k][0] && t <= stops[k + 1][0]) { a = stops[k]; b = stops[k + 1]; }
  const u = (t - a[0]) / (b[0] - a[0] || 1);
  const c = a[1].map((v, j) => Math.round(v + (b[1][j] - v) * u));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export function createMap(elId, config) {
  setOrigin(config.map.center);
  const map = L.map(elId, { zoomControl: true, attributionControl: true, zoomSnap: 0.25 })
    .setView(config.map.center, config.map.zoom);
  const el = map.getContainer();

  const esri = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 20, maxNativeZoom: 19, attribution: 'Pre-event basemap &copy; Esri' }
  );
  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { maxZoom: 20, maxNativeZoom: 19, attribution: '&copy; OpenStreetMap contributors' });
  esri.addTo(map);
  map.setMaxZoom(20);
  const layers = L.control.layers({ 'Satellite (Esri, pre-event)': esri, 'OpenStreetMap': osm }, {}, { position: 'topleft' }).addTo(map);
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

  // real post-disaster imagery sits above the basemap; toggle it off in the layer control to compare before/after
  let disaster = null;
  function setImagery(img) {
    if (disaster) { layers.removeLayer(disaster); map.removeLayer(disaster); disaster = null; }
    if (!img) return;
    disaster = L.tileLayer(img.url, { maxZoom: 20, maxNativeZoom: img.maxNativeZoom || 19, attribution: img.attribution, zIndex: 5 }).addTo(map);
    layers.addOverlay(disaster, 'Post-disaster imagery');
  }

  /** Drag a rectangle to choose the search area. Calls onDone(LatLngBounds). Returns a cancel function. */
  function startAreaSelect(onDone) {
    map.dragging.disable(); map.boxZoom.disable();
    el.classList.add('selecting');
    let start = null, rect = null;
    const sizeText = b => {
      const k = M_PER_DEG_LAT * Math.cos((b.getCenter().lat * Math.PI) / 180);
      const w = (b.getEast() - b.getWest()) * k, h = (b.getNorth() - b.getSouth()) * M_PER_DEG_LAT;
      const f = m => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(0)} m`);
      return `${f(w)} × ${f(h)} · ${((w * h) / 1e6).toFixed(2)} km²`;
    };
    const down = e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      start = map.mouseEventToLatLng(e);
      rect = L.rectangle([start, start], { color: '#3be07c', weight: 2, dashArray: '6 4', fillColor: '#3be07c', fillOpacity: 0.1, interactive: false }).addTo(map);
      rect.bindTooltip('', { permanent: true, direction: 'center', className: 'area-tip' }).openTooltip();
      el.setPointerCapture?.(e.pointerId);
    };
    const move = e => {
      if (!rect) return;
      const b = L.latLngBounds(start, map.mouseEventToLatLng(e));
      rect.setBounds(b); rect.setTooltipContent(sizeText(b)); rect.openTooltip(b.getCenter());
    };
    const up = e => {
      if (!rect) return;
      e.stopPropagation();
      const b = rect.getBounds();
      cancel();
      onDone(b);
    };
    const stopClick = e => e.stopPropagation();
    function cancel() {
      el.removeEventListener('pointerdown', down, true);
      el.removeEventListener('pointermove', move, true);
      el.removeEventListener('pointerup', up, true);
      setTimeout(() => el.removeEventListener('click', stopClick, true), 0);
      if (rect) map.removeLayer(rect);
      rect = null;
      el.classList.remove('selecting');
      map.dragging.enable(); map.boxZoom.enable();
    }
    el.addEventListener('pointerdown', down, true);
    el.addEventListener('pointermove', move, true);
    el.addEventListener('pointerup', up, true);
    el.addEventListener('click', stopClick, true); // the drag must not also count as a family-report click
    return cancel;
  }

  const gridLayer = L.layerGroup().addTo(map);
  const trailLayer = L.layerGroup().addTo(map);
  const pinLayer = L.layerGroup().addTo(map);
  const survivorLayer = L.layerGroup().addTo(map);

  let cells = [];           // L.rectangle per cell
  let heatmap = false;
  let half = config.grid.cellMeters / 2;

  /** Build cell rectangles from a list of local cell centres. */
  function buildGrid(centers, cellMeters) {
    gridLayer.clearLayers();
    half = cellMeters / 2;
    cells = centers.map((c, i) => {
      const r = L.rectangle([xyToLatLng(c.x - half, c.y - half), xyToLatLng(c.x + half, c.y + half)],
        { weight: 1, ...TRUST_STYLE.unsearched, interactive: false });
      r.addTo(gridLayer);
      r._gemaIdx = i;
      return r;
    });
    const all = centers.flatMap(c => [xyToLatLng(c.x - half, c.y - half), xyToLatLng(c.x + half, c.y + half)]);
    return L.latLngBounds(all);
  }

  /** trust[i] = 'cleared'|'uncertain'|'unsearched', probs[i] = number. */
  function updateGrid(trust, probs) {
    const maxP = Math.max(...probs, 1e-12);
    for (let i = 0; i < cells.length; i++) {
      if (heatmap) {
        const t = Math.sqrt(probs[i] / maxP);
        cells[i].setStyle({ color: 'rgba(255,255,255,0.25)', fillColor: heatColor(t), fillOpacity: 0.55 });
      } else {
        cells[i].setStyle(TRUST_STYLE[trust[i]] || TRUST_STYLE.unsearched);
      }
    }
  }

  function setHeatmap(on) { heatmap = !!on; }

  /** Fit bounds into the part of the map not covered by the HUD panels. */
  function fitToHud(bounds) {
    const css = getComputedStyle(document.documentElement);
    const px = name => parseFloat(css.getPropertyValue(name)) || 0;
    const wide = window.innerWidth > 900;
    const rail = $px('.rail'), feed = $px('.feed'), dock = $px('.dock');
    function $px(sel) { const n = document.querySelector(sel); return n ? n.getBoundingClientRect() : null; }
    const top = px('--top') + 16 + (!wide && feed ? feed.height + 8 : 0);
    const left = wide && rail ? rail.right + 16 : 16;
    const right = wide && feed ? window.innerWidth - feed.left + 16 : 16;
    const bottom = dock ? window.innerHeight - dock.top + 16 : 16;
    map.fitBounds(bounds, { paddingTopLeft: [left, top], paddingBottomRight: [right, bottom] });
  }

  // ---- drone sprite ----
  const droneIcon = L.divIcon({
    className: 'drone-icon',
    iconSize: [56, 56], iconAnchor: [28, 28],
    html: `<div class="drone-body"><div class="drone-shadow"></div>
      <div class="arm a1"></div><div class="arm a2"></div>
      <div class="rotor r1"></div><div class="rotor r2"></div><div class="rotor r3"></div><div class="rotor r4"></div>
      <div class="hull"></div><div class="nose"></div></div>`,
  });
  const droneMarker = L.marker(config.map.center, { icon: droneIcon, interactive: false, zIndexOffset: 1000 }).addTo(map);
  const hearCircle = L.circle(config.map.center, {
    radius: config.pod.hearingRadiusM, color: '#5fd0ff', weight: 1.5, dashArray: '6 6', fillOpacity: 0.06, interactive: false,
  }).addTo(map);
  const targetMarker = L.circleMarker(config.map.center, { radius: 6, color: '#fff', weight: 2, fillColor: '#5fd0ff', fillOpacity: 0.9, interactive: false }).addTo(map);
  const bearingLine = L.polyline([], { color: '#ff4d6d', weight: 3, dashArray: '2 8', interactive: false }).addTo(map);
  let trail = L.polyline([], { color: '#5fd0ff', weight: 2.5, opacity: 0.75, interactive: false }).addTo(trailLayer);
  let trailPts = [];
  let follow = false;

  function updateDrone(state, target, hearingRadiusM, noisy) {
    const ll = xyToLatLng(state.x, state.y);
    droneMarker.setLatLng(ll);
    const el = droneMarker.getElement();
    if (el) {
      const body = el.querySelector('.drone-body');
      if (body) body.style.transform = `rotate(${state.headingDeg}deg)`;
      el.classList.toggle('investigate', state.mode === 'investigate');
    }
    hearCircle.setLatLng(ll);
    hearCircle.setRadius(hearingRadiusM);
    hearCircle.setStyle({ color: noisy ? '#ffb020' : '#5fd0ff' });
    if (target) targetMarker.setLatLng(xyToLatLng(target.x, target.y));
    const last = trailPts[trailPts.length - 1];
    if (!last || Math.hypot(last.x - state.x, last.y - state.y) > 4) {
      trailPts.push({ x: state.x, y: state.y });
      if (trailPts.length > 1500) trailPts.shift();
      trail.setLatLngs(trailPts.map(p => xyToLatLng(p.x, p.y)));
    }
    if (follow) map.panTo(ll, { animate: false });
  }

  function showBearing(from, absBearingDeg, lengthM) {
    const r = (absBearingDeg * Math.PI) / 180;
    bearingLine.setLatLngs([xyToLatLng(from.x, from.y),
      xyToLatLng(from.x + Math.sin(r) * lengthM, from.y + Math.cos(r) * lengthM)]);
    setTimeout(() => bearingLine.setLatLngs([]), 4000);
  }

  function addPin(xy, confidence, label) {
    const pct = Math.round(confidence * 100);
    const icon = L.divIcon({
      className: 'pin-icon', iconSize: [30, 42], iconAnchor: [15, 40],
      html: `<div class="pin"><span>${pct}</span></div>`,
    });
    const m = L.marker(xyToLatLng(xy.x, xy.y), { icon }).addTo(pinLayer);
    m.bindTooltip(`${label || 'Detection'} · confidence ${pct}%`, { direction: 'top', offset: [0, -36] });
    return m;
  }

  // ---- survivors (ground truth) ----
  const survivorMarkers = new Map();
  function updateSurvivors(survivors, reveal) {
    for (const s of survivors) {
      const show = s.found || reveal;
      let m = survivorMarkers.get(s.id);
      if (!show) { if (m) { survivorLayer.removeLayer(m); survivorMarkers.delete(s.id); } continue; }
      const cls = s.found ? 'found' : 'missed';
      if (!m || m._gemaCls !== cls) {
        if (m) survivorLayer.removeLayer(m);
        const icon = L.divIcon({
          className: 'person-icon', iconSize: [34, 34], iconAnchor: [17, 17],
          html: `<div class="person ${cls}"><div class="head"></div><div class="torso"></div></div>`,
        });
        m = L.marker(xyToLatLng(s.x, s.y), { icon, zIndexOffset: 500 }).addTo(survivorLayer);
        m.bindTooltip(`${s.label || s.id} · ${s.found ? 'FOUND' : 'not found'}`, { direction: 'top' });
        m._gemaCls = cls;
        survivorMarkers.set(s.id, m);
      }
    }
  }

  function flash(xy) {
    map.flyTo(xyToLatLng(xy.x, xy.y), Math.min(19, config.map.zoom + 1.5), { duration: 0.8 });
  }

  function resetTrail() { trailPts = []; trail.setLatLngs([]); pinLayer.clearLayers(); }

  return {
    map, buildGrid, updateGrid, setHeatmap, fitToHud, setImagery, startAreaSelect, updateDrone, showBearing, addPin, updateSurvivors, flash, resetTrail,
    setFollow(on) { follow = !!on; },
    onClick(fn) { map.on('click', e => fn(latLngToXY(e.latlng), e.latlng)); },
  };
}
