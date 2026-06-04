/* v2.4.0 */
const LINE_DEFS = [
  { id: 'bakerloo',          name: 'Bakerloo',           color: '#B36305', osmRef: 'London Underground Bakerloo line' },
  { id: 'central',           name: 'Central',            color: '#E32017', osmRef: 'London Underground Central line' },
  { id: 'circle',            name: 'Circle',             color: '#FFD300', osmRef: 'London Underground Circle line' },
  { id: 'district',          name: 'District',           color: '#00782A', osmRef: 'London Underground District line' },
  { id: 'hammersmith-city',  name: 'Hammersmith & City', color: '#F3A9BB', osmRef: 'London Underground Hammersmith and City line' },
  { id: 'jubilee',           name: 'Jubilee',            color: '#A0A5A9', osmRef: 'London Underground Jubilee line' },
  { id: 'metropolitan',      name: 'Metropolitan',       color: '#9B0056', osmRef: 'London Underground Metropolitan line' },
  { id: 'northern',          name: 'Northern',           color: '#C8C8C8', osmRef: 'London Underground Northern line' },
  { id: 'piccadilly',        name: 'Piccadilly',         color: '#003688', osmRef: 'London Underground Piccadilly line' },
  { id: 'victoria',          name: 'Victoria',           color: '#0098D4', osmRef: 'London Underground Victoria line' },
  { id: 'waterloo-city',     name: 'Waterloo & City',    color: '#93CEBA', osmRef: 'London Underground Waterloo and City line' },
  { id: 'elizabeth',         name: 'Elizabeth line',     color: '#6950A1', osmRef: 'Elizabeth line' },
  { id: 'lioness',          name: 'Lioness',            color: '#E1A700', osmRef: 'London Overground Lioness line' },
  { id: 'mildmay',          name: 'Mildmay',            color: '#1E90FF', osmRef: 'London Overground Mildmay line' },
  { id: 'windrush',         name: 'Windrush',           color: '#FF4500', osmRef: 'London Overground Windrush line' },
  { id: 'weaver',           name: 'Weaver',             color: '#800000', osmRef: 'London Overground Weaver line' },
  { id: 'suffragette',      name: 'Suffragette',        color: '#228B22', osmRef: 'London Overground Suffragette line' },
  { id: 'liberty',          name: 'Liberty',            color: '#808080', osmRef: 'London Overground Liberty line' },
  { id: 'dlr',               name: 'DLR',                color: '#00A4A7', osmRef: 'Docklands Light Railway' },
];

let lineData    = {};
let selectedLine = null;
let trainData   = {};
let hiddenLines = new Set();
let trainMarkers = [];
let map, osmLayer, satelliteLayer;
let trainCanvas = null, trainCtx = null;

const TOTAL_STEPS = LINE_DEFS.length * 2 + 2;
let   loadStep    = 0;

function setProgress(msg, step) {
  const pct = Math.round((step / TOTAL_STEPS) * 100);
  const bar  = document.getElementById('loading-bar');
  const txt  = document.getElementById('loading-step');
  const lmsg = document.getElementById('loading-msg');
  if (bar)  bar.style.width  = pct + '%';
  if (txt)  txt.textContent  = pct + '%';
  if (lmsg) lmsg.textContent = msg;
}

window.addEventListener('load', async () => {
  initMap();
  buildToggles();
  setupModal();

  setProgress('Initialising…', 0);
  await loadAllOsmTracks();

  await loadAllStopsAndTrains();

  document.getElementById('loading').style.display = 'none';
  map.on('moveend zoomend', redrawCanvas);
  map.on('move zoom',       redrawCanvas);
  map.on('zoomend', updateStationLabels);
  redrawCanvas();

  setInterval(async () => { await loadAllTrains(); redrawCanvas(); }, 30000);
});

function initMap() {
  map = L.map('map', { center: [51.505, -0.09], zoom: 11, zoomControl: true });

  osmLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd', maxZoom: 19,
  }).addTo(map);

  satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics', maxZoom: 19,
  });

  document.getElementById('btn-map').addEventListener('click', () => {
    map.removeLayer(satelliteLayer); map.addLayer(osmLayer);
    document.getElementById('btn-map').classList.add('active');
    document.getElementById('btn-satellite').classList.remove('active');
  });
  document.getElementById('btn-satellite').addEventListener('click', () => {
    map.removeLayer(osmLayer); map.addLayer(satelliteLayer);
    document.getElementById('btn-satellite').classList.add('active');
    document.getElementById('btn-map').classList.remove('active');
  });

  map.createPane('linesPane');
  map.createPane('stationsPane');
  map.getPane('linesPane').style.zIndex    = 350;
  map.getPane('stationsPane').style.zIndex = 360;

  map.on('click',     e => handleMapClick(e));
  map.on('mousemove', e => handleMapHover(e));
}

async function loadAllOsmTracks() {
  await Promise.allSettled(LINE_DEFS.map(l => loadOsmTrack(l)));
}

async function loadOsmTrack(lineDef) {
  if (!lineData[lineDef.id]) lineData[lineDef.id] = { stops: [], stopMap: new Map(), polylines: [], stationMarkers: [] };
}

const delay = ms => new Promise(r => setTimeout(r, ms));

async function tflFetch(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    const res  = await fetch(url, { cache: 'no-store' });
    if (res.status === 429) {
      const wait = (i + 1) * 3000;
      await delay(wait);
      continue;
    }
    return res.json();
  }
  throw new Error('Rate limited after retries');
}

async function loadAllStopsAndTrains() {
  for (let i = 0; i < LINE_DEFS.length; i++) {
    const l = LINE_DEFS[i];
    setProgress(`Loading ${l.name} stops…`, i + 1);
    await loadLineStops(l.id);
    await delay(300);
  }
  await delay(500);
  await loadAllTrains();
}

async function loadLineStops(lineId) {
  try {
    const cacheKey = `tfl_stops_${lineId}`;
    let sequences = null;

    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      sequences = JSON.parse(cached);
    } else {
      const data = await tflFetch(`https://api.tfl.gov.uk/Line/${lineId}/Route/Sequence/outbound?excludeCrowding=true`);
      sequences = data?.stopPointSequences || [];
      try { sessionStorage.setItem(cacheKey, JSON.stringify(sequences)); } catch {}
    }

    const fakeRes = { status: 'fulfilled', value: { stopPointSequences: sequences } };
    const outRes = fakeRes, inRes = { status: 'rejected' };

    if (!lineData[lineId]) lineData[lineId] = { stops: [], stopMap: new Map(), polylines: [], stationMarkers: [] };
    const ld = lineData[lineId];

    for (const res of [outRes, inRes]) {
      if (res.status !== 'fulfilled') continue;
      for (const seq of (res.value.stopPointSequences || [])) {
        for (const sp of (seq.stopPoint || [])) {
          if (!sp.lat || !sp.lon) continue;
          ld.stopMap.set(sp.id, { id: sp.id, name: sp.name, lat: sp.lat, lng: sp.lon });
        }
      }
    }
    ld.stops = Array.from(ld.stopMap.values());

    const lineDef = LINE_DEFS.find(l => l.id === lineId);

    const seenEdges = new Set();
    const edgeKey   = (a, b) => [a, b].sort().join('|');

    for (const res of [outRes, inRes]) {
      if (res.status !== 'fulfilled') continue;
      for (const seq of (res.value.stopPointSequences || [])) {
        const stops = (seq.stopPoint || []).filter(sp => sp.lat && sp.lon);
        if (stops.length < 2) continue;

        let chain = [stops[0]];
        for (let i = 1; i < stops.length; i++) {
          const k = edgeKey(stops[i - 1].id, stops[i].id);
          if (!seenEdges.has(k)) {
            seenEdges.add(k);
            chain.push(stops[i]);
          } else {
            if (chain.length >= 2) {
              const pts    = chain.map(sp => [sp.lat, sp.lon]);
              const curved = buildCurvedLine(pts);
              const poly   = L.polyline(curved, {
                color: lineDef?.color || '#888', weight: 4, opacity: 0.9,
                smoothFactor: 0, interactive: false,
              });
              if (!hiddenLines.has(lineId)) poly.addTo(map);
              ld.polylines.push(poly);
            }
            chain = [stops[i]];
          }
        }
        if (chain.length >= 2) {
          const pts    = chain.map(sp => [sp.lat, sp.lon]);
          const curved = buildCurvedLine(pts);
          const poly   = L.polyline(curved, {
            color: lineDef?.color || '#888', weight: 4, opacity: 0.9,
            smoothFactor: 0, interactive: true,
            pane: 'linesPane',
          });
          poly._lineId = lineId;
          poly.on('click', e => { L.DomEvent.stopPropagation(e); selectLine(lineId); });
          poly.on('mouseover', () => { if (!selectedLine) poly.setStyle({ weight: 6, opacity: 1 }); });
          poly.on('mouseout',  () => { if (!selectedLine) poly.setStyle({ weight: 4, opacity: 0.9 }); });
          if (!hiddenLines.has(lineId)) poly.addTo(map);
          ld.polylines.push(poly);
        }
      }
    }

    const seenStopIds = new Set();
    for (const s of ld.stops) {
      if (seenStopIds.has(s.id)) continue;
      seenStopIds.add(s.id);
      const name = s.name.replace(/ Underground Station$/i,'').replace(/ Station$/i,'');
      const circle = L.circleMarker([s.lat, s.lng], {
        radius: 5, color: '#ffffff', weight: 2,
        fillColor: '#0d0f14', fillOpacity: 1,
        interactive: true, pane: 'stationsPane',
      }).bindTooltip(name, {
        permanent: false, direction: 'top', offset: [0, -6],
        className: 'station-tooltip',
      });
      circle._stationName = name;
      circle._stationId   = s.id;
      circle.on('click', e => { L.DomEvent.stopPropagation(e); showStationModal(s.id, name); });
      if (!hiddenLines.has(lineId)) circle.addTo(map);
      ld.stationMarkers.push(circle);
    }
  } catch (e) {
    console.warn(`Stops failed for ${lineId}:`, e);
  }
}

async function loadAllTrains() {
  for (let i = 0; i < LINE_DEFS.length; i++) {
    const l = LINE_DEFS[i];
    setProgress(`Loading ${l.name} trains…`, LINE_DEFS.length + i + 1);
    await loadLineTrains(l.id);
    await delay(250);
  }
  setProgress('Ready!', TOTAL_STEPS);
  const total = Object.values(trainData).reduce((s, a) => s + a.length, 0);
  const now   = new Date();
  document.getElementById('status-text').textContent =
    `${total} trains · ${now.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', second:'2-digit' })}`;
}

async function loadLineTrains(lineId) {
  try {
    const data = await tflFetch(`https://api.tfl.gov.uk/Line/${lineId}/Arrivals?t=${Date.now()}`);
    if (!Array.isArray(data)) return;

    const byVehicle = new Map();
    for (const p of data) {
      if (!p.vehicleId) continue;
      const key = p.vehicleId + '|' + (p.direction || '');
      if (!byVehicle.has(key)) byVehicle.set(key, []);
      byVehicle.get(key).push(p);
    }

    const ld     = lineData[lineId];
    const trains = [];

    for (const [, preds] of byVehicle) {
      preds.sort((a, b) => a.timeToStation - b.timeToStation);
      const nextPred = preds.find(p => p.timeToStation > 0) || preds[0];
      if (!nextPred) continue;

      const nextStop = ld?.stopMap?.get(nextPred.naptanId);
      if (!nextStop) continue;

      const prevStop = findPrevStop(ld, nextPred.naptanId);
      if (!prevStop) continue;

      const segTime  = estimateSegTime(prevStop, nextStop);
      const fraction = Math.max(0, Math.min(0.95, (segTime - nextPred.timeToStation) / segTime));
      const lat      = lerp(prevStop.lat, nextStop.lat, fraction);
      const lng      = lerp(prevStop.lng, nextStop.lng, fraction);

      if (lat < 51.28 || lat > 51.72 || lng < -0.56 || lng > 0.33) continue;

      trains.push({
        lat, lng,
        estimated: lineId === 'elizabeth' || lineId === 'lioness' || lineId === 'mildmay' || lineId === 'windrush' || lineId === 'weaver' || lineId === 'suffragette' || lineId === 'liberty',
        vehicleId: nextPred.vehicleId,
        dest:      nextPred.destinationName || '',
        nextName:  nextStop.name,
        mins:      Math.round(nextPred.timeToStation / 60),
        lineId,
      });
    }

    const seen = new Set();
    const fresh = trains.filter(t => { if (seen.has(t.vehicleId)) return false; seen.add(t.vehicleId); return true; });
    if (fresh.length > 0) trainData[lineId] = fresh;
  } catch (e) {
    if (!trainData[lineId]) trainData[lineId] = [];
  }
}

function buildCurvedLine(pts) {
  if (pts.length < 2) return pts;
  const result = [];
  const STEPS  = 12;

  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const prev = i > 0 ? pts[i - 1] : null;
    const next = i < pts.length - 2 ? pts[i + 2] : null;

    const cp1 = catmullTangent(prev, p0, p1, 0.35);
    const cp2 = catmullTangent(p0, p1, next, 0.35);

    for (let t = 0; t <= STEPS; t++) {
      const u  = t / STEPS;
      const u2 = u * u, u3 = u2 * u;
      const b0 = 2*u3 - 3*u2 + 1;
      const b1 = u3 - 2*u2 + u;
      const b2 = -2*u3 + 3*u2;
      const b3 = u3 - u2;
      result.push([
        b0*p0[0] + b1*cp1[0] + b2*p1[0] + b3*cp2[0],
        b0*p0[1] + b1*cp1[1] + b2*p1[1] + b3*cp2[1],
      ]);
    }
  }
  return result;
}

function catmullTangent(prev, cur, next, alpha) {
  if (!prev && !next) return [cur[0], cur[1]];
  const from = prev || cur;
  const to   = next || cur;
  return [
    (to[0] - from[0]) * alpha,
    (to[1] - from[1]) * alpha,
  ];
}

function findPrevStop(ld, nextId) {
  if (!ld) return null;
  const idx = ld.stops.findIndex(s => s.id === nextId);
  return idx > 0 ? ld.stops[idx - 1] : null;
}

function estimateSegTime(a, b) {
  const dLat = b.lat - a.lat, dLng = b.lng - a.lng;
  return Math.max(45, Math.min(300, Math.sqrt(dLat*dLat + dLng*dLng) * 111 / (40/3600)));
}

function lerp(a, b, t) { return a + (b - a) * t; }

function ensureTrainCanvas() {
  if (trainCanvas) return;
  trainCanvas = document.createElement('canvas');
  trainCanvas.style.cssText = 'position:absolute;top:52px;left:0;right:0;bottom:0;width:100%;height:calc(100% - 52px);pointer-events:none;z-index:500';
  document.body.appendChild(trainCanvas);
  trainCtx = trainCanvas.getContext('2d');
  resizeTrainCanvas();
  window.addEventListener('resize', () => { resizeTrainCanvas(); redrawCanvas(); });
}

function resizeTrainCanvas() {
  if (!trainCanvas) return;
  trainCanvas.width  = trainCanvas.offsetWidth;
  trainCanvas.height = trainCanvas.offsetHeight;
}

function redrawCanvas() {
  ensureTrainCanvas();
  resizeTrainCanvas();
  trainCtx.clearRect(0, 0, trainCanvas.width, trainCanvas.height);
  trainMarkers = [];

  for (const lineDef of LINE_DEFS) {
    if (hiddenLines.has(lineDef.id)) continue;
    for (const t of (trainData[lineDef.id] || [])) {
      const pt = map.latLngToContainerPoint([t.lat, t.lng]);
      if (pt.x < -20 || pt.x > trainCanvas.width+20 || pt.y < -20 || pt.y > trainCanvas.height+20) continue;
      const dimmed = selectedLine && selectedLine !== lineDef.id;
      drawTrainDot(pt.x, pt.y, lineDef.color, t.estimated, dimmed);
      trainMarkers.push({ sx: pt.x, sy: pt.y, t, lineDef });
    }
  }
}

function drawTrainDot(x, y, color, estimated, dimmed = false) {
  const R = 7;
  trainCtx.save();
  if (estimated) {
    trainCtx.beginPath();
    trainCtx.arc(x, y, R+4, 0, Math.PI*2);
    const g = trainCtx.createRadialGradient(x, y, R, x, y, R+4);
    g.addColorStop(0, color+'55'); g.addColorStop(1, 'transparent');
    trainCtx.fillStyle = g; trainCtx.fill();
  }
  trainCtx.beginPath();
  trainCtx.arc(x, y, R, 0, Math.PI*2);
  trainCtx.globalAlpha = dimmed ? 0.12 : 1;
  trainCtx.fillStyle   = estimated ? color+'aa' : color;
  trainCtx.fill();
  trainCtx.strokeStyle = estimated ? 'rgba(255,255,255,0.4)' : '#ffffff';
  trainCtx.lineWidth   = 2;
  trainCtx.stroke();
  trainCtx.globalAlpha = 1;
  trainCtx.restore();
}

const HIT_PX  = 14;
const tooltip = document.getElementById('train-tooltip');

function getTrainAtScreen(clientX, clientY) {
  const mapRect = document.getElementById('map').getBoundingClientRect();
  const cx = clientX - mapRect.left, cy = clientY - mapRect.top;
  for (const m of trainMarkers) {
    if (Math.hypot(m.sx - cx, m.sy - cy) < HIT_PX) return m;
  }
  return null;
}

function handleMapHover(e) {
  const hit = getTrainAtScreen(e.originalEvent.clientX, e.originalEvent.clientY);
  if (hit) {
    const { t, lineDef } = hit;
    const mins = t.mins <= 0 ? 'due' : `${t.mins} min`;
    tooltip.innerHTML = `<strong>${lineDef.name}</strong><span class="tt-sub">→ ${t.dest || 'Unknown'}</span><span class="tt-sub">Next: ${cleanName(t.nextName)} · ${mins}</span>${t.estimated ? '<span class="tt-est">⚠ Estimated position</span>' : ''}`;
    tooltip.style.display = 'block';
    const tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
    let tx = e.originalEvent.clientX + 14, ty = e.originalEvent.clientY - 10;
    if (tx + tw > window.innerWidth  - 10) tx = e.originalEvent.clientX - tw - 14;
    if (ty + th > window.innerHeight - 10) ty = e.originalEvent.clientY - th;
    tooltip.style.left = tx+'px'; tooltip.style.top = ty+'px';
    map.getContainer().style.cursor = 'pointer';
  } else {
    tooltip.style.display = 'none';
    map.getContainer().style.cursor = '';
  }
}

function handleMapClick(e) {
  const hit = getTrainAtScreen(e.originalEvent.clientX, e.originalEvent.clientY);
  if (hit) { e.originalEvent.stopPropagation(); showTrainModal(hit.t, hit.lineDef); return; }
  if (selectedLine) deselectLine();
}

function setupModal() {
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });
}
function closeModal() { document.getElementById('modal-overlay').classList.add('hidden'); }
function openModal(html) {
  document.getElementById('modal-body').innerHTML = html;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

async function showTrainModal(t, lineDef) {
  openModal(`<div class="modal-line-badge"><div class="modal-line-pip" style="background:${lineDef.color}"></div>${lineDef.name}</div><div class="modal-dest">${t.dest || 'Unknown destination'}</div><div class="modal-vehicle">Vehicle ${t.vehicleId}</div><div class="modal-loading"><div class="modal-spinner"></div>Fetching live data…</div>`);
  try {
    let data = await tflFetch(`https://api.tfl.gov.uk/Vehicle/${t.vehicleId}/Arrivals?t=${Date.now()}`);
    if (!Array.isArray(data) || !data.length) throw new Error('No data');
    const filtered = data.filter(v => v.lineId === t.lineId);
    if (filtered.length) data = filtered;
    data.sort((a, b) => a.timeToStation - b.timeToStation);

    let loc = data[0]?.currentLocation || '', estimated = false;
    if (!loc.trim()) {
      const passed   = data.filter(s => s.timeToStation <= 30);
      const upcoming = data.filter(s => s.timeToStation > 30);
      const ps = passed.length ? passed[passed.length-1] : null;
      const ns = upcoming.length ? upcoming[0] : null;
      if (ps && ns) {
        const m = Math.round(ns.timeToStation/60);
        loc = `Between ${cleanName(ps.stationName)} and ${cleanName(ns.stationName)}` + (m > 0 ? ` · ${m} min to ${cleanName(ns.stationName)}` : '');
        estimated = true;
      } else if (ns) {
        loc = `Approaching ${cleanName(ns.stationName)}` + (ns.timeToStation > 30 ? ` · ${Math.round(ns.timeToStation/60)} min` : '');
        estimated = true;
      } else if (ps) {
        loc = `At ${cleanName(ps.stationName)} (terminus)`; estimated = true;
      }
    }

    const journeyHTML = buildJourneyProgress(data, t.lineId, lineDef.color);

    const crowdingHTML = await buildCrowdingBar(data, t.lineId);

    const nextStops = data.filter(s => s.timeToStation > 30).slice(0, 8);
    const stopsHTML = nextStops.length ? `<div class="modal-section-title">Next stops</div><div class="modal-stops">${nextStops.map((s,i) => {
      const m = Math.round(s.timeToStation/60);
      const label = s.timeToStation < 30 ? 'Due' : m <= 1 ? '1 min' : `${m} min`;
      const cls   = s.timeToStation < 30 ? 'due' : m <= 2 ? 'soon' : 'ok';
      return `<div class="modal-stop-row"><div class="modal-stop-dot ${i===0?'next':''}"></div><span class="modal-stop-name">${cleanName(s.stationName)}</span><span class="modal-stop-time ${cls}">${label}</span></div>`;
    }).join('')}</div>` : '';

    openModal(`
      <div class="modal-line-badge"><div class="modal-line-pip" style="background:${lineDef.color}"></div>${lineDef.name}</div>
      <div class="modal-dest">→ ${t.dest || 'Unknown destination'}</div>
      <div class="modal-vehicle">Vehicle ID: ${t.vehicleId}</div>
      ${journeyHTML}
      ${crowdingHTML}
      ${loc ? `<div class="modal-section-title">Current location</div><div class="modal-location">${loc}</div>${estimated ? '<div class="modal-est-note">⚠ Position estimated from arrival times</div>' : ''}` : ''}
      ${stopsHTML}
    `);
  } catch {
    openModal(`<div class="modal-line-badge"><div class="modal-line-pip" style="background:${lineDef.color}"></div>${lineDef.name}</div><div class="modal-dest">${t.dest || 'Unknown destination'}</div><div style="color:var(--text-muted);font-size:0.85rem;margin-top:12px">Unable to load details for this train.</div>`);
  }
}

function buildJourneyProgress(data, lineId, color) {
  const ld = lineData[lineId];
  if (!ld || !ld.stops.length) return '';

  const totalStops    = ld.stops.length;
  const stopsLeft     = data.filter(s => s.timeToStation > 30).length;
  const stopsComplete = Math.max(0, totalStops - stopsLeft - 1);
  const pct           = Math.round((stopsComplete / (totalStops - 1)) * 100);
  const originStop    = cleanName(ld.stops[0]?.name || '');
  const destStop      = cleanName(ld.stops[ld.stops.length - 1]?.name || '');

  return `
    <div class="modal-section-title">Journey progress</div>
    <div class="journey-bar-wrap">
      <div class="journey-endpoints">
        <span>${originStop}</span><span>${destStop}</span>
      </div>
      <div class="journey-bar-track">
        <div class="journey-bar-fill" style="width:${pct}%;background:${color}"></div>
        <div class="journey-bar-dot" style="left:${pct}%;border-color:${color}"></div>
      </div>
      <div class="journey-pct">${pct}% · ${stopsComplete} of ${totalStops - 1} stops completed</div>
    </div>
  `;
}

async function buildCrowdingBar(data, lineId) {
  const nextStop = data.find(s => s.timeToStation > 30);
  if (!nextStop?.naptanId) return '';

  try {
    const now  = new Date();
    const hour = now.getHours();
    const json = await tflFetch(`https://api.tfl.gov.uk/StopPoint/${nextStop.naptanId}/Crowding/${lineId}`);

    const timeBands = json?.crowding?.passengerFlows || [];
    const band = timeBands.find(b => {
      const [h] = (b.timeSlice || '').split(':').map(Number);
      return h === hour;
    }) || timeBands[0];

    if (!band) return '';

    const value = band.value || 0;
    const pct   = Math.min(100, Math.round(value * 100));
    const cls   = pct < 40 ? 'crowd-low' : pct < 70 ? 'crowd-mid' : 'crowd-high';
    const label = pct < 40 ? 'Quiet' : pct < 70 ? 'Moderate' : 'Busy';

    return `
      <div class="modal-section-title">Predicted crowding <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--text-dim);font-size:0.6rem">historical average</span></div>
      <div class="crowd-bar-wrap">
        <div class="crowd-bar-track">
          <div class="crowd-bar-fill ${cls}" style="width:${pct}%"></div>
        </div>
        <span class="crowd-label ${cls}">${label}</span>
      </div>
    `;
  } catch {
    return '';
  }
}

function buildToggles() {
  const container = document.getElementById('line-toggles');
  for (const l of LINE_DEFS) {
    const row = document.createElement('div');
    row.className = 'tog-row';
    row.innerHTML = `<div class="tog-pip" style="background:${l.color}"></div>${l.name}`;
    row.addEventListener('click', () => {
      const ld = lineData[l.id];
      if (hiddenLines.has(l.id)) {
        hiddenLines.delete(l.id); row.classList.remove('off');
        ld?.polylines?.forEach(p => p.addTo(map));
        ld?.stationMarkers?.forEach(m => m.addTo(map));
      } else {
        hiddenLines.add(l.id); row.classList.add('off');
        ld?.polylines?.forEach(p => map.removeLayer(p));
        ld?.stationMarkers?.forEach(m => map.removeLayer(m));
      }
      redrawCanvas();
    });
    container.appendChild(row);
  }
}

async function showStationModal(stopId, stationName) {
  openModal(`
    <div class="modal-dest">${stationName}</div>
    <div class="modal-vehicle" style="margin-bottom:0">Live departures</div>
    <div class="modal-loading" style="margin-top:12px"><div class="modal-spinner"></div>Fetching arrivals…</div>
  `);

  try {
    let arr = await tflFetch(`https://api.tfl.gov.uk/StopPoint/${stopId}/Arrivals?t=${Date.now()}`);
    if (!Array.isArray(arr)) throw new Error('No data');

    const children = await fetchChildArrivals(stopId);
    const allArr   = [...arr, ...children];

    const seen = new Set();
    const deduped = allArr.filter(a => {
      const k = `${a.vehicleId}|${a.lineId}|${a.platformName}`;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
    deduped.sort((a, b) => a.timeToStation - b.timeToStation);

    if (!deduped.length) {
      openModal(`<div class="modal-dest">${stationName}</div><p style="color:var(--text-muted);font-size:0.85rem;margin-top:12px">No upcoming services found.</p>`);
      return;
    }

    const byPlatform = {};
    for (const a of deduped) {
      const key = a.platformName || 'Unknown platform';
      (byPlatform[key] = byPlatform[key] || []).push(a);
    }

    const platforms = Object.keys(byPlatform).sort((a, b) => {
      const na = parseInt((a.match(/\d+/) || [])[0], 10);
      const nb = parseInt((b.match(/\d+/) || [])[0], 10);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      if (!isNaN(na)) return -1;
      if (!isNaN(nb)) return 1;
      return a.localeCompare(b);
    });

    let html = `<div class="modal-dest">${stationName}</div>`;

    for (const platform of platforms) {
      const services = byPlatform[platform].slice(0, 6);
      html += `<div class="modal-section-title">${platform}</div><div class="modal-stops">`;
      for (const a of services) {
        const mins  = Math.round(a.timeToStation / 60);
        const label = a.timeToStation < 30 ? 'Due' : mins <= 1 ? '1 min' : `${mins} min`;
        const cls   = a.timeToStation < 30 ? 'due' : mins <= 2 ? 'soon' : 'ok';
        const ldef  = LINE_DEFS.find(l => l.id === a.lineId);
        const color = ldef?.color || '#6b7385';
        const dest  = a.destinationName || a.lineName || '—';
        html += `<div class="modal-stop-row">
          <div class="modal-stop-dot" style="border-color:${color};background:${color}22"></div>
          <span class="modal-stop-name" style="flex:1;min-width:0">
            <span style="font-size:0.7rem;color:${color};font-weight:700;margin-right:5px">${ldef?.name || a.lineId}</span>
            ${cleanName(dest)}
          </span>
          <span class="modal-stop-time ${cls}">${label}</span>
        </div>`;
      }
      html += `</div>`;
    }

    openModal(html);
  } catch {
    openModal(`<div class="modal-dest">${stationName}</div><p style="color:var(--text-muted);font-size:0.85rem;margin-top:12px">Unable to load arrivals.</p>`);
  }
}

async function fetchChildArrivals(stopId) {
  try {
    const meta = await tflFetch(`https://api.tfl.gov.uk/StopPoint/${stopId}`);
    const tflModes = new Set(['tube','overground','elizabeth-line','dlr','tram','national-rail']);
    const seen = new Set([stopId]);
    const childIds = [];
    for (const c of (meta?.children || [])) {
      if (!c.id || seen.has(c.id)) continue;
      if ((c.modes || []).some(m => tflModes.has(m))) { seen.add(c.id); childIds.push(c.id); }
    }
    if (!childIds.length) return [];
    const lists = await Promise.all(childIds.map(id =>
      tflFetch(`https://api.tfl.gov.uk/StopPoint/${id}/Arrivals?t=${Date.now()}`).catch(() => [])
    ));
    return lists.flat().filter(Boolean);
  } catch { return []; }
}

function selectLine(lineId) {
  selectedLine = lineId;
  for (const l of LINE_DEFS) {
    const ld = lineData[l.id];
    if (!ld) continue;
    if (l.id === lineId) {
      ld.polylines.forEach(p => p.setStyle({ opacity: 1, weight: 6, color: l.color }));
      ld.stationMarkers.forEach(m => { if (!map.hasLayer(m)) m.addTo(map); m.setStyle({ opacity: 1, fillOpacity: 1 }); });
    } else {
      ld.polylines.forEach(p => p.setStyle({ opacity: 0.12, weight: 3 }));
      ld.stationMarkers.forEach(m => { if (map.hasLayer(m)) map.removeLayer(m); });
    }
  }
  redrawCanvas();
}

function deselectLine() {
  selectedLine = null;
  for (const l of LINE_DEFS) {
    const ld = lineData[l.id];
    if (!ld || hiddenLines.has(l.id)) continue;
    ld.polylines.forEach(p => p.setStyle({ opacity: 0.9, weight: 4, color: l.color }));
    ld.stationMarkers.forEach(m => { if (!map.hasLayer(m)) m.addTo(map); m.setStyle({ opacity: 1, fillOpacity: 1 }); });
  }
  redrawCanvas();
}

function updateStationLabels() {
  const zoom = map.getZoom();
  const showLabels = zoom >= 13;
  for (const ld of Object.values(lineData)) {
    for (const marker of (ld.stationMarkers || [])) {
      if (showLabels) {
        marker.unbindTooltip();
        marker.bindTooltip(marker._stationName, {
          permanent: true, direction: 'top', offset: [0, -6],
          className: 'station-tooltip',
        });
        if (map.hasLayer(marker)) marker.openTooltip();
      } else {
        marker.unbindTooltip();
        marker.bindTooltip(marker._stationName, {
          permanent: false, direction: 'top', offset: [0, -6],
          className: 'station-tooltip',
        });
      }
    }
  }
}

function cleanName(n) {
  return (n||'').replace(/ Underground Station$/i,'').replace(/ Station$/i,'').trim();
}
