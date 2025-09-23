const lineColors = {
  bakerloo: '#996633',
  central: '#CC3333',
  circle: '#E1A700',
  district: '#006633',
  'hammersmith-city': '#F68C95',
  jubilee: '#868F98',
  metropolitan: '#660066',
  northern: '#000000',
  piccadilly: '#0019a8',
  victoria: '#0099CC',
  'waterloo-city': '#7EC8E3',
  elizabeth: '#9E579D',
  'elizabeth-line': '#9E579D',
  'london-overground': '#EE7C0E',
  lioness: '#E1A700',
  mildmay: '#1E90FF',
  windrush: '#FF4500',
  weaver: '#800000',
  suffragette: '#228B22',
  liberty: '#808080'
};

document.addEventListener('DOMContentLoaded', () => {
  const searchInput   = document.getElementById('station-search');
  const dataList      = document.getElementById('stations');
  const searchBtn     = document.getElementById('search-btn');
  const lastUpdatedEl = document.getElementById('last-updated');
  const arrivalsEl    = document.getElementById('arrivals');
  const modalOverlay = document.getElementById('modal-overlay');
  const modalBody    = document.getElementById('modal-body');
  const modalClose   = document.getElementById('modal-close');

  let idToDisplay   = new Map();
  let displayToId   = new Map();
  let currentStopId = null;
  let refreshTimer  = null;

  modalOverlay.style.display = 'none';

  function normalise(s) {
    return (s || '')
      .toLowerCase()
      .replace(/station\b/gi, 'station')
      .replace(/\s+/g, ' ')
      .trim();
  }

  searchInput.addEventListener('input', async (e) => {
    const q = e.target.value.trim();
    if (!q) return;
    const matches = await fetchStations(q);
    dataList.innerHTML = '';
    idToDisplay.clear();
    displayToId.clear();
    const seen = new Set();
    for (const s of matches) {
      const modes = s.modes || [];
      const allowed = ['tube', 'overground', 'elizabeth-line', 'dlr', 'tram', 'national-rail'];
      if (!modes.some(m => allowed.includes(m))) continue;
      const display = s.commonName || s.name || '';
      if (!display) continue;
      if (seen.has(display)) continue;
      seen.add(display);
      const opt = document.createElement('option');
      opt.value = display;
      opt.dataset.stopId = s.id;
      dataList.appendChild(opt);
      idToDisplay.set(s.id, display);
      displayToId.set(normalise(display), s.id);
    }
  });

  function resolveStopIdFromInput() {
    const raw = searchInput.value.trim();
    const exact = Array.from(dataList.options).find(o => o.value === raw);
    if (exact && exact.dataset.stopId) return exact.dataset.stopId;
    const norm = normalise(raw);
    const fromMap = displayToId.get(norm);
    if (fromMap) return fromMap;
    const optEq = Array.from(dataList.options).find(o => normalise(o.value) === norm);
    if (optEq && optEq.dataset.stopId) return optEq.dataset.stopId;
    const optIncl = Array.from(dataList.options).find(o => {
      const ov = normalise(o.value);
      return ov.includes(norm) || norm.includes(ov);
    });
    if (optIncl && optIncl.dataset.stopId) return optIncl.dataset.stopId;
    return null;
  }

  searchBtn.addEventListener('click', () => {
    const stopId = resolveStopIdFromInput();
    if (!stopId) {
      alert('Please select a valid station from the list.');
      return;
    }
    currentStopId = stopId;
    if (refreshTimer) clearInterval(refreshTimer);
    updateArrivals();
    refreshTimer = setInterval(updateArrivals, 60000);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      searchBtn.click();
    }
  });

  modalClose.addEventListener('click', () => {
    modalOverlay.style.display = 'none';
  });
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) {
      modalOverlay.style.display = 'none';
    }
  });

  arrivalsEl.addEventListener('click', async (e) => {
    const row = e.target.closest('.line');
    if (!row) return;
    const vehicleId = row.dataset.vehicleId;
    const lineId    = row.dataset.lineId;
    if (!vehicleId) return;
    try {
      const rawData = await fetchVehicleArrivals(vehicleId);
      let data = rawData;
      if (lineId) {
        const filtered = rawData.filter(v => v.lineId === lineId || (lineId === 'london-overground' && v.lineId === 'london-overground'));
        if (filtered.length) data = filtered;
      }
      const stopNames = new Map(data.map(v => [v.naptanId, v.stationName]));
      let loc = data[0]?.currentLocation;
      if (!loc) {
        const stName = data[0]?.stationName;
        if (stName) loc = `Near ${stName}`;
      }
      const idx = data.findIndex(entry => entry.naptanId === currentStopId);
      if (loc && /^at\s+/i.test(loc) && idx > 0) {
        const prevId   = data[idx - 1].naptanId;
        const prevName = stopNames.get(prevId) || idToDisplay.get(prevId) || '';
        loc = `${prevName}: ${loc}`;
      }
      let html = '';
      if (loc) html += `<h3>Train location</h3><p>${loc}</p>`;
      modalBody.innerHTML = html;
      modalOverlay.style.display = 'flex';
    } catch {
      modalBody.textContent = 'Unable to fetch train details';
      modalOverlay.style.display = 'flex';
    }
  });

  async function updateArrivals() {
    const arr = await fetchArrivals(currentStopId);
    renderArrivals(arr);
    const now = new Date();
    lastUpdatedEl.textContent = `Last updated: ${now.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`;
  }
});

async function fetchStations(q) {
  const res = await fetch(`https://api.tfl.gov.uk/StopPoint/Search?query=${encodeURIComponent(q)}`);
  const body = await res.json();
  return body.matches || [];
}

async function fetchArrivals(id) {
  async function getArrivalsFor(stopId) {
    const res = await fetch(`https://api.tfl.gov.uk/StopPoint/${stopId}/Arrivals?t=${Date.now()}`, { cache: 'no-store' });
    const arr = await res.json();
    return Array.isArray(arr) ? arr : [];
  }
  const basePromise = getArrivalsFor(id);
  const childrenPromise = (async () => {
    try {
      const metaRes = await fetch(`https://api.tfl.gov.uk/StopPoint/${id}`);
      const meta = await metaRes.json();
      const children = (meta && meta.children) ? meta.children : [];
      const wantedModes = new Set(['overground', 'elizabeth-line']);
      const childIds = [];
      const seen = new Set();
      for (const c of children) {
        const modes = c.modes || [];
        const cid = c.id;
        if (!cid) continue;
        if (modes.some(m => wantedModes.has(m)) && !seen.has(cid)) {
          seen.add(cid);
          childIds.push(cid);
        }
      }
      if (!childIds.length) return [];
      const promises = childIds.map(cid => getArrivalsFor(cid).catch(() => []));
      const lists = await Promise.all(promises);
      return lists.flat();
    } catch {
      return [];
    }
  })();
  const [baseArr, childArr] = await Promise.all([basePromise, childrenPromise]);
  const all = [...baseArr, ...childArr];
  all.sort((a, b) => a.timeToStation - b.timeToStation);
  return all;
}

async function fetchVehicleArrivals(id) {
  const res = await fetch(`https://api.tfl.gov.uk/Vehicle/${id}/Arrivals?t=${Date.now()}`, {cache: 'no-store'});
  const data = await res.json();
  data.sort((a, b) => a.timeToStation - b.timeToStation);
  return data;
}

function renderArrivals(arrivals) {
  const container = document.getElementById('arrivals');
  container.innerHTML = '';
  if (!arrivals.length) {
    container.textContent = 'No upcoming services for this station.';
    return;
  }
  const byPlatform = arrivals.reduce((acc, p) => {
    const key = p.platformName || p.platformNaptanId || 'Platform';
    (acc[key] = acc[key] || []).push(p);
    return acc;
  }, {});
  const platforms = Object.keys(byPlatform).sort((a, b) => {
    const numA = parseInt((a.match(/\d+/) || [])[0], 10);
    const numB = parseInt((b.match(/\d+/) || [])[0], 10);
    const isNumA = !isNaN(numA);
    const isNumB = !isNaN(numB);
    if (isNumA && isNumB) return numA - numB;
    if (isNumA) return -1;
    if (isNumB) return 1;
    return a.localeCompare(b);
  });
  for (const platform of platforms) {
    const section = document.createElement('div');
    section.classList.add('line-container');
    const header = document.createElement('h2');
    header.textContent = platform;
    section.appendChild(header);
    for (const p of byPlatform[platform]) {
      const dest = p.destinationName || p.lineName || 'Unknown';
      const mins = p.timeToStation < 60 ? 'due' : `${Math.round(p.timeToStation / 60)} min`;
      const color = lineColors[p.lineId] || '#333';
      const lineDiv = document.createElement('div');
      lineDiv.classList.add('line');
      lineDiv.dataset.vehicleId = p.vehicleId;
      lineDiv.dataset.lineId    = p.lineId;
      lineDiv.style.cursor      = 'pointer';
      const destEl   = document.createElement('strong'); destEl.textContent = dest; destEl.style.color = color;
      const statusEl = document.createElement('span'); statusEl.textContent = mins; statusEl.classList.add('status'); statusEl.style.color = color;
      lineDiv.appendChild(destEl);
      lineDiv.appendChild(statusEl);
      section.appendChild(lineDiv);
    }
    container.appendChild(section);
  }
}