// ═══════════════════════════════════════════════════════════════
//  TfL Live Train Map
//  Strategy:
//  1. Fetch route sequences for each line → gives ordered stop list with lat/lng
//  2. Fetch all current vehicle arrivals for each line
//  3. For each vehicle, find which two stops it's between using timeToStation
//  4. Interpolate lat/lng position between those stops
//  5. Render everything on a canvas with pan/zoom
// ═══════════════════════════════════════════════════════════════

const LINE_DEFS = [
  { id: 'bakerloo',          name: 'Bakerloo',             color: '#996633' },
  { id: 'central',           name: 'Central',              color: '#CC3333' },
  { id: 'circle',            name: 'Circle',               color: '#E1A700' },
  { id: 'district',          name: 'District',             color: '#006633' },
  { id: 'hammersmith-city',  name: 'Hammersmith & City',   color: '#F68C95' },
  { id: 'jubilee',           name: 'Jubilee',              color: '#868F98' },
  { id: 'metropolitan',      name: 'Metropolitan',         color: '#660066' },
  { id: 'northern',          name: 'Northern',             color: '#aaaaaa' },
  { id: 'piccadilly',        name: 'Piccadilly',           color: '#0019a8' },
  { id: 'victoria',          name: 'Victoria',             color: '#0099CC' },
  { id: 'waterloo-city',     name: 'Waterloo & City',      color: '#7EC8E3' },
  { id: 'elizabeth',         name: 'Elizabeth line',       color: '#9E579D' },
  { id: 'london-overground', name: 'Overground',           color: '#EE7C0E' },
  { id: 'dlr',               name: 'DLR',                  color: '#009999' },
];

// ── State ──────────────────────────────────────────────────────
let lineData    = {};  // lineId → { stops: [{id,name,lat,lng}], segments: [[{lat,lng},...]] }
let trainData   = {};  // lineId → [{ lat, lng, dest, dest_to, mins, estimated, vehicleId }]
let hiddenLines = new Set();

// Pan/zoom state
let viewX = 0, viewY = 0, scale = 1;
let isDragging = false, dragStartX = 0, dragStartY = 0, viewStartX = 0, viewStartY = 0;
let animFrame = null;

// Geographic bounds of London (used for initial fit)
const GEO = { minLat: 51.28, maxLat: 51.72, minLng: -0.55, maxLng: 0.32 };

const canvas  = document.getElementById('map-canvas');
const ctx     = canvas.getContext('2d');
const tooltip = document.getElementById('tooltip');
const statusEl = document.getElementById('status-text');
const loadingEl = document.getElementById('loading');
const loadingMsg = document.getElementById('loading-msg');

// ── Boot ───────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  resizeCanvas();
  window.addEventListener('resize', () => { resizeCanvas(); render(); });
  setupInteraction();
  buildToggles();

  await loadAllRoutes();
  loadingMsg.textContent = 'Fetching live trains…';
  await loadAllTrains();

  loadingEl.style.display = 'none';
  render();

  // Refresh trains every 30 s
  setInterval(async () => {
    await loadAllTrains();
    render();
  }, 30000);
});

function resizeCanvas() {
  canvas.width  = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
}

// ── Geo → canvas projection ────────────────────────────────────
function project(lat, lng) {
  // Mercator-ish simple linear projection then apply pan/zoom
  const geoW = GEO.maxLng - GEO.minLng;
  const geoH = GEO.maxLat - GEO.minLat;
  const px = ((lng - GEO.minLng) / geoW) * canvas.width;
  const py = ((GEO.maxLat - lat) / geoH) * canvas.height;
  return {
    x: px * scale + viewX,
    y: py * scale + viewY
  };
}

function unproject(sx, sy) {
  const geoW = GEO.maxLng - GEO.minLng;
  const geoH = GEO.maxLat - GEO.minLat;
  const px = (sx - viewX) / scale;
  const py = (sy - viewY) / scale;
  const lng = (px / canvas.width)  * geoW + GEO.minLng;
  const lat = GEO.maxLat - (py / canvas.height) * geoH;
  return { lat, lng };
}

// ── Route loading ──────────────────────────────────────────────
async function loadAllRoutes() {
  const results = await Promise.allSettled(
    LINE_DEFS.map(l => loadLineRoute(l.id))
  );
  results.forEach((r, i) => {
    if (r.status === 'rejected')
      console.warn(`Route load failed for ${LINE_DEFS[i].id}:`, r.reason);
  });
}

async function loadLineRoute(lineId) {
  // Fetch inbound + outbound sequences to get full stop coverage
  const [outRes, inRes] = await Promise.allSettled([
    fetch(`https://api.tfl.gov.uk/Line/${lineId}/Route/Sequence/outbound?excludeCrowding=true`).then(r => r.json()),
    fetch(`https://api.tfl.gov.uk/Line/${lineId}/Route/Sequence/inbound?excludeCrowding=true`).then(r => r.json()),
  ]);

  const stopMap  = new Map(); // naptanId → {id, name, lat, lng}
  const segments = [];        // array of polylines (each is [{lat,lng},...])

  for (const res of [outRes, inRes]) {
    if (res.status !== 'fulfilled') continue;
    const data = res.value;
    const sequences = data.stopPointSequences || [];

    for (const seq of sequences) {
      const pts = [];
      for (const sp of (seq.stopPoint || [])) {
        if (!sp.lat || !sp.lon) continue;
        stopMap.set(sp.id, { id: sp.id, name: sp.name, lat: sp.lat, lng: sp.lon });
        pts.push({ lat: sp.lat, lng: sp.lon });
      }
      if (pts.length > 1) segments.push(pts);
    }
  }

  lineData[lineId] = {
    stops:    Array.from(stopMap.values()),
    segments,
    stopMap,   // keep for train interpolation lookup
  };
}

// ── Train loading ──────────────────────────────────────────────
async function loadAllTrains() {
  const results = await Promise.allSettled(
    LINE_DEFS.map(l => loadLineTrains(l.id))
  );
  const total = Object.values(trainData).reduce((s, arr) => s + arr.length, 0);
  const now = new Date();
  statusEl.textContent = `${total} trains · ${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}

async function loadLineTrains(lineId) {
  try {
    const res  = await fetch(`https://api.tfl.gov.uk/Line/${lineId}/Arrivals?t=${Date.now()}`, { cache: 'no-store' });
    const data = await res.json();
    if (!Array.isArray(data)) { trainData[lineId] = []; return; }

    // Group by vehicleId — each vehicle has multiple predictions (one per upcoming stop)
    const byVehicle = new Map();
    for (const p of data) {
      if (!p.vehicleId) continue;
      const key = p.vehicleId + '|' + (p.direction || '');
      if (!byVehicle.has(key)) byVehicle.set(key, []);
      byVehicle.get(key).push(p);
    }

    const trains = [];
    const ld = lineData[lineId];

    for (const [, preds] of byVehicle) {
      preds.sort((a, b) => a.timeToStation - b.timeToStation);

      // The prediction with the smallest positive timeToStation is the next stop
      const nextPred = preds.find(p => p.timeToStation > 0) || preds[0];
      if (!nextPred) continue;

      const nextStop = ld?.stopMap?.get(nextPred.naptanId);
      if (!nextStop) continue;

      // Find the previous stop in the sequence to interpolate from
      // We use the ordered segments to find which stop precedes nextStop
      const prevStop = findPreviousStop(lineId, nextPred, preds);

      let lat, lng, estimated;

      if (prevStop && nextPred.timeToStation > 0) {
        // Interpolate: fraction = how far through the gap (0=at prev, 1=at next)
        // The train left prevStop some time ago. We don't know exactly when,
        // but we can estimate: if travel time between stops averages ~90s,
        // fraction = 1 - (timeToStation / totalSegmentTime)
        // Use a rough segment time based on stop count on the line or fallback 90s
        const segTime = estimateSegmentTime(lineId, prevStop, nextStop);
        const elapsed  = segTime - nextPred.timeToStation;
        const fraction = Math.max(0, Math.min(1, elapsed / segTime));
        lat = lerp(prevStop.lat, nextStop.lat, fraction);
        lng = lerp(prevStop.lng, nextStop.lng, fraction);
        estimated = (lineId === 'elizabeth' || lineId === 'london-overground');
      } else {
        // Can't interpolate — just place at next stop
        lat = nextStop.lat;
        lng = nextStop.lng;
        estimated = true;
      }

      trains.push({
        lat, lng, estimated,
        vehicleId: nextPred.vehicleId,
        dest:      nextPred.destinationName || '',
        nextName:  nextStop.name,
        mins:      Math.round(nextPred.timeToStation / 60),
        lineId,
      });
    }

    // Deduplicate by vehicleId (same train can appear in multiple direction groups)
    const seen = new Set();
    trainData[lineId] = trains.filter(t => {
      if (seen.has(t.vehicleId)) return false;
      seen.add(t.vehicleId); return true;
    });
  } catch (e) {
    console.warn(`Train load failed for ${lineId}:`, e);
    trainData[lineId] = trainData[lineId] || [];
  }
}

function lerp(a, b, t) { return a + (b - a) * t; }

function findPreviousStop(lineId, nextPred, allPreds) {
  const ld = lineData[lineId];
  if (!ld) return null;

  // Strategy: look through segments to find the stop that comes just before nextPred.naptanId
  // in the direction of travel
  const nextId = nextPred.naptanId;
  const dir    = nextPred.direction || 'outbound';

  for (const seg of ld.segments) {
    for (let i = 1; i < seg.length; i++) {
      // We compare by coords since segment points aren't keyed by naptanId
      // Instead, find the stop object closest to each segment point
      // This is approximate — good enough for display
    }
  }

  // Simpler approach: find the stop in stopMap that is geographically closest
  // to the "behind" position by looking at the ordered stop sequence for this line
  // We use the fact that preds[0] is the soonest upcoming stop
  // and search for a stop just before it in the line's stop list

  const stops = ld.stops;
  if (!stops.length) return null;

  // Find next stop index in the flat stops array
  const nextIdx = stops.findIndex(s => s.id === nextId);
  if (nextIdx > 0) return stops[nextIdx - 1];
  if (nextIdx === 0) return null;

  // If not found in flat list, try to find by name similarity
  const nextStop = ld.stopMap?.get(nextId);
  return null;
}

function estimateSegmentTime(lineId, fromStop, toStop) {
  // Rough estimate: use great-circle distance to scale time
  // Average tube speed ~40 km/h between stops → ~90s for ~1km gaps
  const dLat = toStop.lat - fromStop.lat;
  const dLng = toStop.lng - fromStop.lng;
  const dist  = Math.sqrt(dLat * dLat + dLng * dLng) * 111; // rough km
  const speedKmPerSec = 40 / 3600;
  return Math.max(45, Math.min(300, dist / speedKmPerSec));
}

// ── Render ─────────────────────────────────────────────────────
function render() {
  if (animFrame) cancelAnimationFrame(animFrame);
  animFrame = requestAnimationFrame(drawFrame);
}

function drawFrame() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw subtle background grid
  drawGrid();

  // Draw lines and stations per line
  for (const lineDef of LINE_DEFS) {
    if (hiddenLines.has(lineDef.id)) continue;
    const ld = lineData[lineDef.id];
    if (!ld) continue;
    drawLineSegments(ld, lineDef.color);
  }

  // Draw stations on top of lines (so they're always visible)
  for (const lineDef of LINE_DEFS) {
    if (hiddenLines.has(lineDef.id)) continue;
    const ld = lineData[lineDef.id];
    if (!ld) continue;
    drawStations(ld, lineDef.color);
  }

  // Draw trains on top of everything
  for (const lineDef of LINE_DEFS) {
    if (hiddenLines.has(lineDef.id)) continue;
    const trains = trainData[lineDef.id] || [];
    for (const t of trains) {
      drawTrain(t, lineDef.color);
    }
  }
}

function drawGrid() {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.025)';
  ctx.lineWidth = 1;
  const step = 40;
  for (let x = (viewX % step); x < canvas.width; x += step) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let y = (viewY % step); y < canvas.height; y += step) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }
  ctx.restore();
}

function drawLineSegments(ld, color) {
  if (!ld.segments.length) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth   = Math.max(1.5, 3 * scale);
  ctx.globalAlpha = 0.75;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';

  for (const seg of ld.segments) {
    if (seg.length < 2) continue;
    ctx.beginPath();
    const p0 = project(seg[0].lat, seg[0].lng);
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < seg.length; i++) {
      const p = project(seg[i].lat, seg[i].lng);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawStations(ld, color) {
  const r = Math.max(2, 4 * scale);
  if (r < 1.5) return; // too small to bother at this zoom

  ctx.save();
  for (const stop of ld.stops) {
    const p = project(stop.lat, stop.lng);
    // clip to canvas with margin
    if (p.x < -10 || p.x > canvas.width + 10 || p.y < -10 || p.y > canvas.height + 10) continue;

    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle   = '#0d0f14';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth   = Math.max(1, 1.5 * scale);
    ctx.stroke();
  }

  // Draw station names only at higher zoom
  if (scale > 2.5) {
    ctx.font      = `${Math.min(11, 8 * scale)}px 'DM Sans', sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.textAlign = 'left';
    for (const stop of ld.stops) {
      const p = project(stop.lat, stop.lng);
      if (p.x < -10 || p.x > canvas.width + 10 || p.y < -10 || p.y > canvas.height + 10) continue;
      const name = stop.name.replace(/ Underground Station$/i, '').replace(/ Station$/i, '');
      ctx.fillText(name, p.x + r + 2, p.y + 4);
    }
  }
  ctx.restore();
}

function drawTrain(t, lineColor) {
  const p = project(t.lat, t.lng);
  if (p.x < -20 || p.x > canvas.width + 20 || p.y < -20 || p.y > canvas.height + 20) return;

  const r = Math.max(4, 7 * scale);

  ctx.save();

  // Outer glow for estimated trains
  if (t.estimated) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + 3, 0, Math.PI * 2);
    ctx.fillStyle = lineColor + '33';
    ctx.fill();
  }

  // Train circle
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fillStyle = t.estimated ? lineColor + 'bb' : lineColor;
  ctx.fill();

  // White border
  ctx.strokeStyle = t.estimated ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.9)';
  ctx.lineWidth   = Math.max(1.5, 2 * scale);
  ctx.stroke();

  ctx.restore();
}

// ── Interaction ────────────────────────────────────────────────
function setupInteraction() {
  // Mouse pan
  canvas.addEventListener('mousedown', e => {
    isDragging = true;
    dragStartX = e.clientX; dragStartY = e.clientY;
    viewStartX = viewX; viewStartY = viewY;
  });
  window.addEventListener('mousemove', e => {
    if (isDragging) {
      viewX = viewStartX + (e.clientX - dragStartX);
      viewY = viewStartY + (e.clientY - dragStartY);
      render();
    } else {
      handleHover(e.clientX, e.clientY);
    }
  });
  window.addEventListener('mouseup', () => { isDragging = false; });

  // Scroll zoom
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const rect  = canvas.getBoundingClientRect();
    const mx    = e.clientX - rect.left;
    const my    = e.clientY - rect.top;
    const delta = e.deltaY > 0 ? 0.85 : 1.18;
    const newScale = Math.max(0.4, Math.min(12, scale * delta));
    // Zoom toward cursor
    viewX = mx - (mx - viewX) * (newScale / scale);
    viewY = my - (my - viewY) * (newScale / scale);
    scale = newScale;
    render();
  }, { passive: false });

  // Touch pan/pinch
  let lastTouches = null;
  canvas.addEventListener('touchstart', e => {
    lastTouches = e.touches;
  }, { passive: true });
  canvas.addEventListener('touchmove', e => {
    if (!lastTouches) return;
    if (e.touches.length === 1 && lastTouches.length === 1) {
      viewX += e.touches[0].clientX - lastTouches[0].clientX;
      viewY += e.touches[0].clientY - lastTouches[0].clientY;
      render();
    } else if (e.touches.length === 2 && lastTouches.length === 2) {
      const d0 = Math.hypot(lastTouches[0].clientX - lastTouches[1].clientX, lastTouches[0].clientY - lastTouches[1].clientY);
      const d1 = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      const pivot = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
      };
      const factor = d1 / d0;
      const newScale = Math.max(0.4, Math.min(12, scale * factor));
      viewX = pivot.x - (pivot.x - viewX) * (newScale / scale);
      viewY = pivot.y - (pivot.y - viewY) * (newScale / scale);
      scale = newScale;
      render();
    }
    lastTouches = e.touches;
  }, { passive: true });
  canvas.addEventListener('touchend', () => { lastTouches = null; }, { passive: true });
}

// ── Hover / tooltip ────────────────────────────────────────────
const HIT_RADIUS = 14; // px

function handleHover(mx, my) {
  const rect = canvas.getBoundingClientRect();
  const cx = mx - rect.left;
  const cy = my - rect.top;

  // Check trains first (higher priority)
  for (const lineDef of LINE_DEFS) {
    if (hiddenLines.has(lineDef.id)) continue;
    for (const t of (trainData[lineDef.id] || [])) {
      const p = project(t.lat, t.lng);
      if (Math.hypot(p.x - cx, p.y - cy) < HIT_RADIUS) {
        const mins = t.mins <= 0 ? 'due' : `${t.mins} min`;
        showTooltip(mx, my,
          `<strong>${lineDef.name}</strong>
           <span class="tt-sub">→ ${t.dest || 'Unknown'}</span>
           <span class="tt-sub">Next: ${cleanName(t.nextName)} · ${mins}</span>
           ${t.estimated ? '<span class="tt-est">⚠ Estimated position</span>' : ''}`
        );
        return;
      }
    }
  }

  // Check stations
  for (const lineDef of LINE_DEFS) {
    if (hiddenLines.has(lineDef.id)) continue;
    const ld = lineData[lineDef.id];
    if (!ld) continue;
    for (const stop of ld.stops) {
      const p = project(stop.lat, stop.lng);
      if (Math.hypot(p.x - cx, p.y - cy) < HIT_RADIUS / scale) {
        showTooltip(mx, my,
          `<strong>${cleanName(stop.name)}</strong>
           <span class="tt-sub">${lineDef.name}</span>`
        );
        return;
      }
    }
  }

  hideTooltip();
}

function showTooltip(mx, my, html) {
  tooltip.innerHTML = html;
  tooltip.style.display = 'block';
  const tw = tooltip.offsetWidth;
  const th = tooltip.offsetHeight;
  let tx = mx + 14;
  let ty = my - 10;
  if (tx + tw > window.innerWidth - 10) tx = mx - tw - 14;
  if (ty + th > window.innerHeight - 10) ty = my - th;
  tooltip.style.left = tx + 'px';
  tooltip.style.top  = ty + 'px';
}
function hideTooltip() { tooltip.style.display = 'none'; }

function cleanName(n) {
  return (n || '').replace(/ Underground Station$/i, '').replace(/ Station$/i, '').trim();
}

// ── Line toggles ───────────────────────────────────────────────
function buildToggles() {
  const container = document.getElementById('line-toggles');
  for (const lineDef of LINE_DEFS) {
    const row = document.createElement('div');
    row.className = 'tog-row';
    row.dataset.lineId = lineDef.id;
    row.innerHTML = `<div class="tog-pip" style="background:${lineDef.color}"></div>${lineDef.name}`;
    row.addEventListener('click', () => {
      if (hiddenLines.has(lineDef.id)) {
        hiddenLines.delete(lineDef.id);
        row.classList.remove('off');
      } else {
        hiddenLines.add(lineDef.id);
        row.classList.add('off');
      }
      render();
    });
    container.appendChild(row);
  }
}
