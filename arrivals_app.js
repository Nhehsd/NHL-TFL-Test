// Colour mapping by line ID
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
  'elizabeth-line': '#9E579D',
  lioness: '#E1A700',
  mildmay: '#1E90FF',
  windrush: '#FF4500',
  weaver: '#800000',
  suffragette: '#228B22',
  liberty: '#808080',
  'london-overground': '#E86A10'
};

document.addEventListener('DOMContentLoaded', () => {
  const searchInput   = document.getElementById('station-search');
  const dataList      = document.getElementById('stations');
  const searchBtn     = document.getElementById('search-btn');
  const lastUpdatedEl = document.getElementById('last-updated');
  const arrivalsEl    = document.getElementById('arrivals');

  // Modal elements
  const modalOverlay = document.getElementById('modal-overlay');
  const modalBody    = document.getElementById('modal-body');
  const modalClose   = document.getElementById('modal-close');

  let stationMap    = new Map();
  // Reverse map: stopPointId → display name
  let idToDisplay   = new Map();
  let currentStopId = null;
  let refreshTimer  = null;

  // Hide modal initially
  modalOverlay.style.display = 'none';

  // Autocomplete handler
  searchInput.addEventListener('input', async (e) => {
    const q = e.target.value.trim();
    if (!q) return;

    const matches = await fetchStations(q);
    dataList.innerHTML = '';
    stationMap.clear();
    idToDisplay.clear();

    const seen = new Set();
    for (const s of matches) {
      const modes = s.modes || [];
      if (!modes.includes('tube') && !modes.includes('overground') && !modes.includes('elizabeth-line')) continue;
      let name = s.commonName || s.name;
      if (!name) continue;
      name = name.replace(/\s*(?:Underground|Overground)\s+station$/i, '');

      let suffix = '';
      if (modes.includes('tube') || modes.includes('elizabeth-line')) suffix = ' Underground station';
      else if (modes.includes('overground')) suffix = ' Overground station';

      const display = name + suffix;
      if (seen.has(display)) continue;
      seen.add(display);

      const opt = document.createElement('option');
      opt.value = display;
      dataList.appendChild(opt);
      stationMap.set(display, s.id);
      idToDisplay.set(s.id, display);
    }
  });

  // Search button handler
  searchBtn.addEventListener('click', () => {
    const display = searchInput.value.trim();
    const stopId  = stationMap.get(display);
    if (!stopId) {
      alert('Please select a valid station from the list.');
      return;
    }

    currentStopId = stopId;
    if (refreshTimer) clearInterval(refreshTimer);

    updateArrivals();
    refreshTimer = setInterval(updateArrivals, 60000);
  });

  // Modal close handlers
  modalClose.addEventListener('click', () => {
    modalOverlay.style.display = 'none';
  });
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) {
      modalOverlay.style.display = 'none';
    }
  });

  // Delegate click for train rows
  arrivalsEl.addEventListener('click', async (e) => {
    const row = e.target.closest('.line');
    if (!row) return;
    const vehicleId = row.dataset.vehicleId;
    const lineId    = row.dataset.lineId;
    if (!vehicleId) return;
    try {
      const rawData = await fetchVehicleArrivals(vehicleId);
      // Filter only stops on this line
      const data = lineId ? rawData.filter(v => v.lineId === lineId) : rawData;

      // Map naptanId→stationName for lookup
      const stopNames = new Map(data.map(v => [v.naptanId, v.stationName]));
      // Determine train location
      let loc = data[0]?.currentLocation;
      // If at a platform, prefix with previous stop on this line
      const idx = data.findIndex(entry => entry.naptanId === currentStopId);
      if (loc && /^at\s+/i.test(loc) && idx > 0) {
        const prevId   = data[idx - 1].naptanId;
        const prevName = stopNames.get(prevId) || idToDisplay.get(prevId) || '';
        loc = `${prevName}: ${loc}`;
      }

      // Only show current train location
      let html = '';
      if (loc) html += `<h3>Train location</h3><p>${loc}</p>`;

      modalBody.innerHTML = html;
      modalOverlay.style.display = 'flex';
    } catch (err) {
      modalBody.textContent = 'Unable to fetch train details';
      modalOverlay.style.display = 'flex';
    }
  });

  // Fetch, render, timestamp
  async function updateArrivals() {
    const arr = await fetchArrivals(currentStopId);
    renderArrivals(arr);
    const now = new Date();
    lastUpdatedEl.textContent = `Last updated: ${now.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`;
  }

});

// Fetch station autocomplete
async function fetchStations(q) {
  const res = await fetch(`https://api.tfl.gov.uk/StopPoint/Search?query=${encodeURIComponent(q)}`);
  const body = await res.json();
  return body.matches || [];
}

// Fetch live arrivals (including Overground & Elizabeth branches)
async function fetchArrivals(id) {
  // Base station arrivals
  const res = await fetch(
    `https://api.tfl.gov.uk/StopPoint/${id}/Arrivals?t=${Date.now()}`,
    {cache: 'no-store'}
  );
  const baseArr = await res.json();
  baseArr.sort((a, b) => a.timeToStation - b.timeToStation);

  // Branch lines to include
  const branches = ['london-overground', 'elizabeth-line'];
  const branchPromises = branches.map(lineId =>
    fetch(`https://api.tfl.gov.uk/line/${lineId}/Arrivals?t=${Date.now()}`, {cache:'no-store'})
      .then(r => r.json())
      .then(arr => arr.filter(item => item.naptanId === id))
      .catch(() => [])
  );
  const branchLists = await Promise.all(branchPromises);
  const branchArr = branchLists.flat();

  // Merge and sort all arrivals
  const allArr = [...baseArr, ...branchArr];
  allArr.sort((a, b) => a.timeToStation - b.timeToStation);
  return allArr;
}

// Fetch vehicle details
async function fetchVehicleArrivals(id) {
  const res = await fetch(
    `https://api.tfl.gov.uk/Vehicle/${id}/Arrivals?t=${Date.now()}`,
    {cache: 'no-store'}
  );
  const data = await res.json();
  data.sort((a, b) => a.timeToStation - b.timeToStation);
  return data;
}

// Render arrivals grouped by platform
function renderArrivals(arrivals) {
  const container = document.getElementById('arrivals');
  container.innerHTML = '';
  if (!arrivals.length) {
    container.textContent = 'No upcoming services for this station.';
    return;
  }
  const byPlatform = arrivals.reduce((acc, p) => {
    (acc[p.platformName] = acc[p.platformName] || []).push(p);
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
