/* v2.9.3 */
const delay = ms => new Promise(r => setTimeout(r, ms));

async function tflFetch(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(url, { cache: 'no-store' });
    if (res.status === 429) { await delay((i + 1) * 3000); continue; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
  throw new Error('Rate limited');
}

let map, osmLayer, satelliteLayer;
let busCanvas = null, busCtx = null;
let busMarkers    = [];
let busData       = {};
let filterRoute   = null;
let _blockClicks  = false;
let routePolylines = [];

window.addEventListener('load', async () => {
  initMap();
  setupModal();
  setupRouteFilter();

  await loadBuses();
  document.getElementById('loading').style.display = 'none';
  redrawCanvas();

  setInterval(async () => { await loadBuses(); redrawCanvas(); }, 20000);
});

function initMap() {
  map = L.map('map', { center: [51.505, -0.09], zoom: 12 });

  osmLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd', maxZoom: 19,
  }).addTo(map);

  satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles © Esri', maxZoom: 19,
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

  map.on('move zoom moveend zoomend', redrawCanvas);
  map.on('mousemove', e => handleHover(e));
  map.on('click',    e => handleClick(e));
}

const stopCoordsCache = new Map();

async function getStopCoords(route) {
  if (stopCoordsCache.has(route)) return stopCoordsCache.get(route);
  try {
    const stops = await tflFetch(`https://api.tfl.gov.uk/Line/${encodeURIComponent(route)}/StopPoints`);
    const coords = new Map();
    if (Array.isArray(stops)) {
      for (const s of stops) {
        if (s.id && s.lat && s.lon) coords.set(s.id, { lat: s.lat, lng: s.lon });
        if (s.naptanId && s.lat && s.lon) coords.set(s.naptanId, { lat: s.lat, lng: s.lon });
      }
    }
    stopCoordsCache.set(route, coords);
    return coords;
  } catch { return new Map(); }
}

async function loadBuses() {
  const routes = filterRoute ? [filterRoute] : await getVisibleRoutes();
  if (!routes.length) {
    document.getElementById('status-text').textContent = 'Zoom in or enter a route number to see buses';
    return;
  }

  for (const route of routes) {
    try {
      const [arrivals, stopCoords] = await Promise.all([
        tflFetch(`https://api.tfl.gov.uk/Line/${encodeURIComponent(route)}/Arrivals?t=${Date.now()}`),
        getStopCoords(route),
      ]);

      if (!Array.isArray(arrivals)) continue;

      const byVehicle = new Map();
      for (const p of arrivals) {
        if (!p.vehicleId || !p.naptanId) continue;
        if (!byVehicle.has(p.vehicleId)) byVehicle.set(p.vehicleId, []);
        byVehicle.get(p.vehicleId).push(p);
      }

      const buses = [];
      for (const [vehicleId, preds] of byVehicle) {
        preds.sort((a, b) => a.timeToStation - b.timeToStation);

        const upcoming = preds.filter(p => p.timeToStation > 0);
        const passed   = preds.filter(p => p.timeToStation <= 0);
        const next = upcoming[0];
        if (!next) continue;

        const nextCoord = stopCoords.get(next.naptanId);
        if (!nextCoord) continue;

        let lat = nextCoord.lat, lng = nextCoord.lng;

        const prevPred  = passed.length ? passed[passed.length - 1] : null;
        const prevCoord = prevPred ? stopCoords.get(prevPred.naptanId) : null;

        if (prevCoord && next.timeToStation > 0) {
          const dLat = nextCoord.lat - prevCoord.lat;
          const dLng = nextCoord.lng - prevCoord.lng;
          const distKm  = Math.sqrt(dLat*dLat + dLng*dLng) * 111;
          const segTime = Math.max(20, Math.min(300, distKm / (20/3600)));
          const frac    = Math.max(0, Math.min(0.95, (segTime - next.timeToStation) / segTime));
          lat = prevCoord.lat + dLat * frac;
          lng = prevCoord.lng + dLng * frac;
        }

        if (lat < 51.28 || lat > 51.72 || lng < -0.56 || lng > 0.33) continue;

        buses.push({
          vehicleId, lat, lng,
          route:    next.lineName || next.lineId || route,
          lineId:   next.lineId || route,
          dest:     next.destinationName || '',
          towards:  next.towards || '',
          mins:     Math.round(next.timeToStation / 60),
          naptanId: next.naptanId,
        });
      }

      const seen = new Set();
      busData[route] = buses.filter(b => { if (seen.has(b.vehicleId)) return false; seen.add(b.vehicleId); return true; });
      await delay(150);
    } catch (e) {
      console.warn(`Bus load failed for route ${route}:`, e);
    }
  }

  const now   = new Date();
  const count = Object.values(busData).reduce((s, a) => s + a.length, 0);
  document.getElementById('status-text').textContent =
    `${count} buses · ${now.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', second:'2-digit' })}`;

  if (filterRoute) {
    document.getElementById('route-status').textContent =
      `${busData[filterRoute]?.length || 0} bus${busData[filterRoute]?.length !== 1 ? 'es' : ''} on route ${filterRoute}`;
  }
}

async function getVisibleRoutes() {
  try {
    const c = map.getCenter();
    const zoom = map.getZoom();
    if (zoom < 13) {
      document.getElementById('route-status').textContent = 'Zoom in or enter a route number';
      return [];
    }
    const radius = zoom >= 15 ? 400 : zoom >= 14 ? 700 : 1200;
    const stops = await tflFetch(
      `https://api.tfl.gov.uk/StopPoint?lat=${c.lat}&lon=${c.lng}&stopTypes=NaptanPublicBusCoachTram&radius=${radius}&modes=bus`
    );
    const routes = new Set();
    for (const s of (stops?.stopPoints || [])) {
      for (const l of (s.lines || [])) routes.add(l.id);
    }
    return Array.from(routes).slice(0, 8);
  } catch { return []; }
}

function ensureCanvas() {
  if (busCanvas) return;
  busCanvas = document.createElement('canvas');
  busCanvas.style.cssText = 'position:absolute;top:52px;left:0;right:0;bottom:0;width:100%;height:calc(100% - 52px);pointer-events:none;z-index:500';
  document.body.appendChild(busCanvas);
  busCtx = busCanvas.getContext('2d');
  resizeCanvas();
  window.addEventListener('resize', () => { resizeCanvas(); redrawCanvas(); });
}

function resizeCanvas() {
  if (!busCanvas) return;
  busCanvas.width  = busCanvas.offsetWidth;
  busCanvas.height = busCanvas.offsetHeight;
}

function redrawCanvas() {
  ensureCanvas();
  resizeCanvas();
  busCtx.clearRect(0, 0, busCanvas.width, busCanvas.height);
  busMarkers = [];

  const allBuses = filterRoute
    ? (busData[filterRoute] || [])
    : Object.values(busData).flat();

  for (const b of allBuses) {
    const pt = map.latLngToContainerPoint([b.lat, b.lng]);
    if (pt.x < -20 || pt.x > busCanvas.width+20 || pt.y < -20 || pt.y > busCanvas.height+20) continue;
    drawBusDot(pt.x, pt.y, b.route);
    busMarkers.push({ sx: pt.x, sy: pt.y, b });
  }
}

function drawBusDot(x, y, route) {
  const R    = 9;
  const text = (route || '?').toString().substring(0, 4);
  busCtx.save();
  busCtx.beginPath();
  busCtx.arc(x, y, R, 0, Math.PI * 2);
  busCtx.fillStyle = '#e1251b';
  busCtx.fill();
  busCtx.strokeStyle = '#fff';
  busCtx.lineWidth = 1.5;
  busCtx.stroke();
  busCtx.fillStyle = '#fff';
  busCtx.font = `bold ${text.length > 2 ? 6 : 7}px 'DM Mono', monospace`;
  busCtx.textAlign = 'center';
  busCtx.textBaseline = 'middle';
  busCtx.fillText(text, x, y);
  busCtx.restore();
}

const HIT_PX  = 14;
const tooltip = document.getElementById('tooltip');

function getBusAtScreen(clientX, clientY) {
  const rect = document.getElementById('map').getBoundingClientRect();
  const cx = clientX - rect.left, cy = clientY - rect.top;
  for (const m of busMarkers) {
    if (Math.hypot(m.sx - cx, m.sy - cy) < HIT_PX) return m;
  }
  return null;
}

function handleHover(e) {
  const hit = getBusAtScreen(e.originalEvent.clientX, e.originalEvent.clientY);
  if (hit) {
    const { b } = hit;
    const mins = b.mins <= 0 ? 'due' : `${b.mins} min`;
    tooltip.innerHTML = `<strong>Route ${b.route}</strong><span class="tt-sub">→ ${b.dest || 'Unknown'}</span><span class="tt-sub">Next stop in ${mins}</span>`;
    tooltip.style.display = 'block';
    const tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
    let tx = e.originalEvent.clientX + 14, ty = e.originalEvent.clientY - 10;
    if (tx + tw > window.innerWidth  - 10) tx = e.originalEvent.clientX - tw - 14;
    if (ty + th > window.innerHeight - 10) ty = e.originalEvent.clientY - th;
    tooltip.style.left = tx + 'px'; tooltip.style.top = ty + 'px';
    map.getContainer().style.cursor = 'pointer';
  } else {
    tooltip.style.display = 'none';
    map.getContainer().style.cursor = '';
  }
}

function handleClick(e) {
  if (_blockClicks) return;
  const hit = getBusAtScreen(e.originalEvent.clientX, e.originalEvent.clientY);
  if (hit) { e.originalEvent.stopPropagation(); showBusModal(hit.b); }
}

async function showBusModal(b) {
  openModal(`
    <div class="modal-route-badge">${b.route || '?'}</div>
    <div class="modal-dest">→ ${b.dest || 'Unknown destination'}</div>
    <div class="modal-sub">Vehicle: ${b.vehicleId}</div>
    <div class="modal-loading"><div class="modal-spinner"></div>Fetching stops…</div>
  `);
  try {
    const data = await tflFetch(`https://api.tfl.gov.uk/Vehicle/${b.vehicleId}/Arrivals?t=${Date.now()}`);
    if (!Array.isArray(data) || !data.length) throw new Error('No data');

    const filtered = b.lineId ? data.filter(v => v.lineId === b.lineId) : data;
    const sorted   = (filtered.length ? filtered : data).sort((a, c) => a.timeToStation - c.timeToStation);

    const loc = inferLocation(sorted);
    const nextStops = sorted.filter(s => s.timeToStation > 0).slice(0, 8);

    const stopsHTML = nextStops.length ? `
      <div class="modal-section">Next stops</div>
      <div class="modal-stops">
        ${nextStops.map((s, i) => {
          const m = Math.round(s.timeToStation / 60);
          const label = s.timeToStation < 30 ? 'Due' : m <= 1 ? '1 min' : `${m} min`;
          const cls   = s.timeToStation < 30 ? 'due' : m <= 2 ? 'soon' : 'ok';
          const name  = (s.stationName || '').replace(/ Bus Stop[^,]*/i, '').trim();
          return `<div class="modal-stop-row">
            <div class="modal-stop-dot ${i===0?'next':''}"></div>
            <span class="modal-stop-name">${name}</span>
            <span class="modal-stop-time ${cls}">${label}</span>
          </div>`;
        }).join('')}
      </div>` : '';

    openModal(`
      <div class="modal-route-badge">${b.route || '?'}</div>
      <div class="modal-dest">→ ${b.dest || 'Unknown destination'}</div>
      <div class="modal-sub">Vehicle: ${b.vehicleId}${b.towards ? ` · via ${b.towards}` : ''}</div>
      ${loc ? `<div class="modal-section">Estimated location</div><div style="font-size:0.85rem;color:var(--text-primary);padding:8px 12px;background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:8px">${loc}</div><div style="font-size:0.68rem;color:var(--text-muted);margin-top:4px;font-style:italic">⚠ Estimated from arrival times — TfL does not provide live bus GPS</div>` : ''}
      ${stopsHTML}
    `);
  } catch {
    openModal(`
      <div class="modal-route-badge">${b.route || '?'}</div>
      <div class="modal-dest">→ ${b.dest || 'Unknown destination'}</div>
      <div style="color:var(--text-muted);font-size:0.85rem;margin-top:12px">Unable to load stop details.</div>
    `);
  }
}

function inferLocation(data) {
  const passed   = data.filter(s => s.timeToStation <= 30);
  const upcoming = data.filter(s => s.timeToStation > 30);
  const ps = passed.length  ? passed[passed.length - 1] : null;
  const ns = upcoming.length ? upcoming[0] : null;

  const cleanName = n => (n || '').replace(/ Bus Stop[^,]*/i, '').trim();

  if (ps && ns) {
    const m = Math.round(ns.timeToStation / 60);
    return `Between ${cleanName(ps.stationName)} and ${cleanName(ns.stationName)}` +
           (m > 0 ? ` · ${m} min to ${cleanName(ns.stationName)}` : '');
  } else if (ns) {
    const m = Math.round(ns.timeToStation / 60);
    return `Approaching ${cleanName(ns.stationName)}` + (m > 0 ? ` · ${m} min` : '');
  } else if (ps) {
    return `At ${cleanName(ps.stationName)} (last stop)`;
  }
  return null;
}

function setupModal() {
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });
}
function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  _blockClicks = true;
  setTimeout(() => { _blockClicks = false; }, 400);
}
function openModal(html) {
  document.getElementById('modal-body').innerHTML = html;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function setupRouteFilter() {
  const input   = document.getElementById('route-input');
  const btn     = document.getElementById('route-btn');
  const display = document.getElementById('active-route-display');
  const status  = document.getElementById('route-status');

  const clearRouteLines = () => {
    routePolylines.forEach(p => map.removeLayer(p));
    routePolylines = [];
  };

  const drawRouteLines = async (route) => {
    clearRouteLines();
    if (!route) return;
    try {
      const [outData, inData] = await Promise.allSettled([
        tflFetch(`https://api.tfl.gov.uk/Line/${encodeURIComponent(route)}/Route/Sequence/outbound?excludeCrowding=true`),
        tflFetch(`https://api.tfl.gov.uk/Line/${encodeURIComponent(route)}/Route/Sequence/inbound?excludeCrowding=true`),
      ]);

      const drawnStops = new Map();
      const seenEdges  = new Set();

      for (const res of [outData, inData]) {
        if (res.status !== 'fulfilled') continue;
        const sequences = res.value?.stopPointSequences || [];
        for (const seq of sequences) {
          const stops = (seq.stopPoint || []).filter(s => s.lat && s.lon);
          if (stops.length < 2) continue;

          const edgeKey = (a, b) => [a, b].sort().join('|');
          let chain = [[stops[0].lat, stops[0].lon]];

          for (let i = 1; i < stops.length; i++) {
            const k = edgeKey(stops[i-1].id, stops[i].id);
            if (seenEdges.has(k)) {
              if (chain.length >= 2) {
                const poly = L.polyline(chain, {
                  color: '#e1251b', weight: 3, opacity: 0.75,
                  smoothFactor: 1, interactive: false,
                }).addTo(map);
                routePolylines.push(poly);
              }
              chain = [[stops[i].lat, stops[i].lon]];
            } else {
              seenEdges.add(k);
              chain.push([stops[i].lat, stops[i].lon]);
            }
          }
          if (chain.length >= 2) {
            const poly = L.polyline(chain, {
              color: '#e1251b', weight: 3, opacity: 0.75,
              smoothFactor: 1, interactive: false,
            }).addTo(map);
            routePolylines.push(poly);
          }

          for (const s of stops) {
            if (!drawnStops.has(s.id)) {
              drawnStops.set(s.id, true);
              const m = L.circleMarker([s.lat, s.lon], {
                radius: 3.5, color: '#fff', weight: 1.5,
                fillColor: '#0d0f14', fillOpacity: 1, interactive: false,
              }).addTo(map);
              routePolylines.push(m);
            }
          }
        }
      }

      if (routePolylines.length > 0) {
        const allPts = [];
        routePolylines.forEach(l => { if (l.getBounds) try { allPts.push(l.getBounds().getCenter()); } catch {} });
      }
    } catch (e) {
      console.warn('Route line failed:', e);
    }
  };

  const setRoute = async (route) => {
    filterRoute = route ? route.trim().toUpperCase() : null;
    busData = {};
    display.innerHTML = '';
    clearRouteLines();
    if (filterRoute) {
      display.innerHTML = `<div class="active-route-pill">Route ${filterRoute} <button class="clear-route" id="clear-route">✕</button></div>`;
      document.getElementById('clear-route').addEventListener('click', () => {
        filterRoute = null; input.value = '';
        display.innerHTML = ''; status.textContent = '';
        busData = {};
        clearRouteLines();
        loadBuses().then(redrawCanvas);
      });
      await drawRouteLines(filterRoute);
    }
    await loadBuses();
    redrawCanvas();
  };

  btn.addEventListener('click', () => setRoute(input.value));
  input.addEventListener('keydown', e => { if (e.key === 'Enter') setRoute(input.value); });
  map.on('moveend', () => { if (!filterRoute) { busData = {}; loadBuses().then(redrawCanvas); } });
}
