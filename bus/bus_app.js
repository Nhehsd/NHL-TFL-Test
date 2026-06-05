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

document.addEventListener('DOMContentLoaded', () => {
  const searchInput   = document.getElementById('stop-search');
  const searchBtn     = document.getElementById('search-btn');
  const stopSelector  = document.getElementById('stop-selector');
  const arrivalsEl    = document.getElementById('arrivals');
  const stopNameEl    = document.getElementById('stop-name-display');
  const lastUpdatedEl = document.getElementById('last-updated');
  const modalOverlay  = document.getElementById('modal-overlay');
  const modalBody     = document.getElementById('modal-body');
  const modalClose    = document.getElementById('modal-close');

  let currentStopId = null;
  let refreshTimer  = null;

  modalClose.addEventListener('click', () => modalOverlay.classList.add('hidden'));
  modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) modalOverlay.classList.add('hidden'); });

  searchBtn.addEventListener('click', () => doSearch());
  searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

  async function doSearch() {
    const q = searchInput.value.trim();
    if (!q) return;
    stopSelector.innerHTML = '<div class="stop-selector-label">Select a stop</div>';
    stopSelector.classList.remove('visible');
    arrivalsEl.innerHTML = '<div class="state-msg">Searching…</div>';

    try {
      const data = await tflFetch(`https://api.tfl.gov.uk/StopPoint/Search?query=${encodeURIComponent(q)}&modes=bus&maxResults=10`);
      const matches = (data.matches || []).filter(m => (m.modes || []).includes('bus'));

      if (!matches.length) {
        arrivalsEl.innerHTML = '<div class="state-msg">No bus stops found. Try a stop name or the 5-digit stop code on the bus stop pole.</div>';
        return;
      }

      if (matches.length === 1) {
        await selectStopArea(matches[0].id, matches[0].commonName || matches[0].name);
        return;
      }

      stopSelector.classList.add('visible');
      for (const m of matches) {
        const btn = document.createElement('button');
        btn.className = 'stop-btn';
        const ind = m.stopLetter || m.indicator || '🚌';
        btn.innerHTML = `
          <div class="stop-indicator">${ind}</div>
          <div>
            <div class="stop-info-name">${m.commonName || m.name}</div>
            <div class="stop-info-sub">${m.toward || ''}</div>
          </div>`;
        btn.addEventListener('click', () => {
          stopSelector.classList.remove('visible');
          selectStopArea(m.id, m.commonName || m.name);
        });
        stopSelector.appendChild(btn);
      }
      arrivalsEl.innerHTML = '<div class="state-msg">Select a stop above.</div>';
    } catch {
      arrivalsEl.innerHTML = '<div class="state-msg">Search failed. Please try again.</div>';
    }
  }

  async function selectStopArea(areaId, areaName) {
    stopNameEl.textContent = areaName;
    if (refreshTimer) clearInterval(refreshTimer);

    try {
      const meta = await tflFetch(`https://api.tfl.gov.uk/StopPoint/${areaId}`);
      const children = (meta?.children || []).filter(c =>
        (c.modes || []).includes('bus') && c.id && !c.id.startsWith('490G')
      );

      if (children.length > 1) {
        stopSelector.innerHTML = '<div class="stop-selector-label">Which stop?</div>';
        stopSelector.classList.add('visible');
        for (const c of children) {
          const btn = document.createElement('button');
          btn.className = 'stop-btn';
          const ind = c.stopLetter || c.indicator || '🚌';
          const towards = c.additionalProperties?.find(p => p.key === 'Towards')?.value || '';
          btn.innerHTML = `
            <div class="stop-indicator">${ind}</div>
            <div>
              <div class="stop-info-name">${c.commonName || areaName}</div>
              <div class="stop-info-sub">${towards || c.id}</div>
            </div>`;
          btn.addEventListener('click', () => {
            stopSelector.classList.remove('visible');
            currentStopId = c.id;
            const lbl = towards ? `${areaName} — towards ${towards}` : `${areaName} — Stop ${ind}`;
            stopNameEl.textContent = lbl;
            loadArrivals();
            refreshTimer = setInterval(loadArrivals, 30000);
          });
          stopSelector.appendChild(btn);
        }
        arrivalsEl.innerHTML = '<div class="state-msg">Select a stop above.</div>';
      } else {
        stopSelector.classList.remove('visible');
        currentStopId = children.length === 1 ? children[0].id : areaId;
        loadArrivals();
        refreshTimer = setInterval(loadArrivals, 30000);
      }
    } catch {
      stopSelector.classList.remove('visible');
      currentStopId = areaId;
      loadArrivals();
      refreshTimer = setInterval(loadArrivals, 30000);
    }
  }

  async function loadArrivals() {
    showSkeletons();
    try {
      const arr = await tflFetch(`https://api.tfl.gov.uk/StopPoint/${currentStopId}/Arrivals?t=${Date.now()}`);
      if (!Array.isArray(arr)) throw new Error('Bad response');
      arr.sort((a, b) => a.timeToStation - b.timeToStation);
      renderArrivals(arr);
    } catch {
      arrivalsEl.innerHTML = '<div class="state-msg">Unable to load arrivals. Please try again.</div>';
    }
    const now = new Date();
    lastUpdatedEl.textContent = `Updated ${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  }

  function showSkeletons() {
    arrivalsEl.innerHTML = Array(5).fill('<div class="skeleton-row"></div>').join('');
  }

  function renderArrivals(arrivals) {
    arrivalsEl.innerHTML = '';
    if (!arrivals.length) {
      arrivalsEl.innerHTML = '<div class="state-msg">No buses due in the next 30 minutes.</div>';
      return;
    }
    for (const a of arrivals) {
      const secs    = a.timeToStation;
      const mins    = Math.round(secs / 60);
      const label   = secs < 30 ? 'Due' : mins <= 1 ? '1 min' : `${mins} min`;
      const cls     = secs < 30 ? 'due' : mins <= 2 ? 'soon' : 'ok';
      const dest    = a.destinationName || '—';
      const towards = a.towards || '';

      const row = document.createElement('div');
      row.className = 'bus-row';
      row.dataset.vehicleId = a.vehicleId || '';
      row.dataset.lineId    = a.lineId    || '';
      row.style.cursor = 'pointer';
      row.innerHTML = `
        <div class="route-badge">${a.lineName || a.lineId || '?'}</div>
        <div class="bus-dest">
          <div class="bus-dest-main">${dest}</div>
          ${towards ? `<div class="bus-dest-towards">via ${towards}</div>` : ''}
        </div>
        <span class="bus-time ${cls}">${label}</span>
      `;
      row.addEventListener('click', () => showBusModal(a));
      arrivalsEl.appendChild(row);
    }
  }

  async function showBusModal(arrival) {
    modalBody.innerHTML = `
      <div class="modal-route-badge">${arrival.lineName || arrival.lineId || '?'}</div>
      <div class="modal-dest">→ ${arrival.destinationName || 'Unknown'}</div>
      <div class="modal-sub">Vehicle: ${arrival.vehicleId || '—'}</div>
      <div class="modal-loading"><div class="modal-spinner"></div>Fetching location…</div>`;
    modalOverlay.classList.remove('hidden');

    try {
      const data = await tflFetch(`https://api.tfl.gov.uk/Vehicle/${arrival.vehicleId}/Arrivals?t=${Date.now()}`);
      if (!Array.isArray(data) || !data.length) throw new Error('No data');

      const filtered = arrival.lineId ? data.filter(v => v.lineId === arrival.lineId) : data;
      const sorted   = (filtered.length ? filtered : data).sort((a, b) => a.timeToStation - b.timeToStation);

      const loc = inferLocation(sorted);
      const nextStops = sorted.filter(s => s.timeToStation > 0).slice(0, 6);

      const stopsHTML = nextStops.length ? `
        <div class="modal-section">Next stops</div>
        <ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:0">
          ${nextStops.map((s, i) => {
            const m = Math.round(s.timeToStation / 60);
            const label = s.timeToStation < 30 ? 'Due' : m <= 1 ? '1 min' : `${m} min`;
            const cls   = s.timeToStation < 30 ? 'due' : m <= 2 ? 'soon' : 'ok';
            const name  = (s.stationName || '').replace(/ Bus Stop[^,]*/i, '').trim();
            return `<li style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
              <div style="width:8px;height:8px;border-radius:50%;border:2px solid ${i===0?'#e1251b':'var(--text-dim)'};background:${i===0?'rgba(225,37,27,0.15)':'var(--bg)'};flex-shrink:0"></div>
              <span style="flex:1;font-size:0.85rem;color:var(--text-primary)">${name}</span>
              <span style="font-family:var(--font-mono);font-size:0.75rem;padding:2px 8px;border-radius:99px;border:1px solid" class="${cls}">${label}</span>
            </li>`;
          }).join('')}
        </ul>` : '';

      modalBody.innerHTML = `
        <div class="modal-route-badge">${arrival.lineName || arrival.lineId || '?'}</div>
        <div class="modal-dest">→ ${arrival.destinationName || 'Unknown'}</div>
        <div class="modal-sub">Vehicle: ${arrival.vehicleId || '—'}</div>
        ${loc ? `
          <div class="modal-section">Estimated location</div>
          <div style="font-size:0.85rem;color:var(--text-primary);padding:8px 12px;background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:8px;margin-bottom:4px">${loc}</div>
          <div style="font-size:0.68rem;color:var(--text-muted);font-style:italic;margin-bottom:12px">⚠ Estimated from arrival times — TfL does not provide live bus GPS</div>` : ''}
        ${stopsHTML}
      `;
    } catch {
      modalBody.innerHTML = `
        <div class="modal-route-badge">${arrival.lineName || arrival.lineId || '?'}</div>
        <div class="modal-dest">→ ${arrival.destinationName || 'Unknown'}</div>
        <p style="color:var(--text-muted);font-size:0.85rem;margin-top:12px">Unable to load details.</p>`;
    }
  }

  function inferLocation(data) {
    const passed   = data.filter(s => s.timeToStation <= 30);
    const upcoming = data.filter(s => s.timeToStation > 30);
    const ps = passed.length  ? passed[passed.length - 1] : null;
    const ns = upcoming.length ? upcoming[0] : null;
    const clean = n => (n || '').replace(/ Bus Stop[^,]*/i, '').trim();

    if (ps && ns) {
      const m = Math.round(ns.timeToStation / 60);
      return `Between ${clean(ps.stationName)} and ${clean(ns.stationName)}` + (m > 0 ? ` · ${m} min to ${clean(ns.stationName)}` : '');
    } else if (ns) {
      const m = Math.round(ns.timeToStation / 60);
      return `Approaching ${clean(ns.stationName)}` + (m > 0 ? ` · ${m} min` : '');
    } else if (ps) {
      return `At ${clean(ps.stationName)} (last stop)`;
    }
    return null;
  }
});
