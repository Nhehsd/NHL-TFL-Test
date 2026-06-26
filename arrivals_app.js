/* v3.0.8 */
const delay = ms => new Promise(r => setTimeout(r, ms));

async function tflFetch(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(url, { cache: 'no-store' });
    if (res.status === 429) {
      await delay((i + 1) * 3000);
      continue;
    }
    return res.json();
  }
  throw new Error('Rate limited');
}

const lineColors = {
  bakerloo:           '#996633',
  central:            '#CC3333',
  circle:             '#E1A700',
  district:           '#006633',
  'hammersmith-city': '#F68C95',
  jubilee:            '#868F98',
  metropolitan:       '#660066',
  northern:           '#000000',
  piccadilly:         '#0019a8',
  victoria:           '#0099CC',
  'waterloo-city':    '#7EC8E3',
  elizabeth:          '#9E579D',
  'elizabeth-line':   '#9E579D',
  'london-overground':'#EE7C0E',
  lioness:            '#E1A700',
  mildmay:            '#1E90FF',
  windrush:           '#FF4500',
  weaver:             '#800000',
  suffragette:        '#228B22',
  liberty:            '#808080',
  dlr:                '#009999',
  tram:               '#66A429',
};

const lineNames = {
  bakerloo:           'Bakerloo',
  central:            'Central',
  circle:             'Circle',
  district:           'District',
  'hammersmith-city': 'Hammersmith & City',
  jubilee:            'Jubilee',
  metropolitan:       'Metropolitan',
  northern:           'Northern',
  piccadilly:         'Piccadilly',
  victoria:           'Victoria',
  'waterloo-city':    'Waterloo & City',
  elizabeth:          'Elizabeth line',
  'elizabeth-line':   'Elizabeth line',
  'london-overground':'Overground',
  lioness:            'Lioness',
  mildmay:            'Mildmay',
  windrush:           'Windrush',
  weaver:             'Weaver',
  suffragette:        'Suffragette',
  liberty:            'Liberty',
  dlr:                'DLR',
  tram:               'Tram',
};

document.addEventListener('DOMContentLoaded', () => {
  const searchInput      = document.getElementById('station-search');
  const dataList         = document.getElementById('stations');
  const searchBtn        = document.getElementById('search-btn');
  const lastUpdatedEl    = document.getElementById('last-updated');
  const arrivalsEl       = document.getElementById('arrivals');
  const stationNameEl    = document.getElementById('station-name-display');
  const modalOverlay     = document.getElementById('modal-overlay');
  const modalBody        = document.getElementById('modal-body');
  const modalClose       = document.getElementById('modal-close');

  let idToDisplay   = new Map();
  let displayToId   = new Map();
  let currentStopId = null;
  let refreshTimer  = null;

  function canonicalName(s) {
    return (s || '')
      .replace(/\s+(underground\s+)?station$/i, '')
      .replace(/\s+rail$/i, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  searchInput.addEventListener('input', async (e) => {
    const q = e.target.value.trim();
    if (q.length < 2) return;
    const matches = await fetchStations(q);
    dataList.innerHTML = '';
    idToDisplay.clear();
    displayToId.clear();

    const seenCanonical = new Map();
    const allowed = ['tube', 'overground', 'elizabeth-line', 'dlr', 'tram', 'national-rail'];

    for (const s of matches) {
      const modes = s.modes || [];
      if (!modes.some(m => allowed.includes(m))) continue;
      const display = s.commonName || s.name || '';
      if (!display) continue;
      const canon = canonicalName(display);

      if (seenCanonical.has(canon)) {
        const existing = seenCanonical.get(canon);
        const existingModes = existing.modes || [];
        const betterModes = ['tube', 'overground', 'elizabeth-line', 'dlr', 'tram'];
        const newIsBetter = modes.some(m => betterModes.includes(m)) &&
                            !existingModes.some(m => betterModes.includes(m));
        if (newIsBetter) seenCanonical.set(canon, s);
      } else {
        seenCanonical.set(canon, s);
      }
    }

    for (const [canon, s] of seenCanonical) {
      const rawDisplay = s.commonName || s.name || '';
      const cleanDisplay = rawDisplay
        .replace(/\s+underground\s+station$/i, '')
        .replace(/\s+rail\s+station$/i, '')
        .trim();

      const opt = document.createElement('option');
      opt.value = cleanDisplay;
      opt.dataset.stopId = s.id;
      dataList.appendChild(opt);
      idToDisplay.set(s.id, cleanDisplay);
      displayToId.set(canon, s.id);
    }
  });

  function resolveStopId() {
    const raw = searchInput.value.trim();
    const exact = Array.from(dataList.options).find(o => o.value === raw);
    if (exact?.dataset.stopId) return exact.dataset.stopId;
    const canon = canonicalName(raw);
    if (displayToId.has(canon)) return displayToId.get(canon);
    const partial = Array.from(dataList.options)
      .find(o => canonicalName(o.value).includes(canon) || canon.includes(canonicalName(o.value)));
    if (partial?.dataset.stopId) return partial.dataset.stopId;
    return null;
  }

  searchBtn.addEventListener('click', () => {
    const stopId = resolveStopId();
    if (!stopId) { alert('Please select a valid station from the list.'); return; }
    currentStopId = stopId;
    if (refreshTimer) clearInterval(refreshTimer);
    const chosenOption = Array.from(dataList.options).find(o => o.dataset.stopId === stopId);
    if (chosenOption) stationNameEl.textContent = chosenOption.value;
    loadArrivals();
    refreshTimer = setInterval(loadArrivals, 30000);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); searchBtn.click(); }
  });

  modalClose.addEventListener('click', () => modalOverlay.classList.add('hidden'));
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) modalOverlay.classList.add('hidden');
  });

  arrivalsEl.addEventListener('click', async (e) => {
    const row = e.target.closest('.train-row');
    if (!row) return;
    const vehicleId = row.dataset.vehicleId;
    const lineId    = row.dataset.lineId;
    if (!vehicleId) return;

    modalBody.innerHTML = `<p style="color:var(--text-muted)">Locating train…</p>`;
    modalOverlay.classList.remove('hidden');

    try {
      let data = await fetchVehicleArrivals(vehicleId);
      if (lineId) {
        const filtered = data.filter(v => v.lineId === lineId);
        if (filtered.length) data = filtered;
      }

      let loc       = data[0]?.currentLocation || '';
      let inferred  = false;

      if (!loc.trim()) {
        const now = 0;

        let passedStop  = null;
        let nextStop    = null;

        for (let i = 0; i < data.length; i++) {
          const secs = data[i].timeToStation;
          if (secs <= 30) {
            passedStop = data[i];
          } else if (!nextStop) {
            nextStop = data[i];
          }
        }

        if (passedStop && nextStop) {
          const from = cleanStationName(passedStop.stationName);
          const to   = cleanStationName(nextStop.stationName);
          const minsAway = Math.round(nextStop.timeToStation / 60);
          loc = `Between ${from} and ${to}`;
          if (minsAway > 0) loc += ` · ${minsAway} min to ${to}`;
          inferred = true;
        } else if (nextStop && !passedStop) {
          const to = cleanStationName(nextStop.stationName);
          const minsAway = Math.round(nextStop.timeToStation / 60);
          loc = `Approaching ${to}`;
          if (minsAway > 0) loc += ` · ${minsAway} min`;
          inferred = true;
        } else if (passedStop && !nextStop) {
          const at = cleanStationName(passedStop.stationName);
          loc = `At ${at} (terminus)`;
          inferred = true;
        }
      }

      if (loc && !inferred && /^at\s+/i.test(loc)) {
        const locBody = loc.replace(/^at\s+/i, '').toLowerCase();
        const alreadySpecific = /platform\s*\d/i.test(loc) || /between\s+/i.test(loc);
        if (!alreadySpecific) {
          const idx = data.findIndex(entry => entry.naptanId === currentStopId);
          if (idx > 0) {
            const prevStop = data[idx - 1];
            const prevName = prevStop.stationName || idToDisplay.get(prevStop.naptanId) || '';
            if (prevName && !locBody.includes(prevName.toLowerCase())) {
              loc = `${prevName}: ${loc}`;
            }
          }
        }
      }

      const upcoming = data.filter(s => s.timeToStation > 30);
      const nextNaptan = upcoming[0]?.naptanId || null;
      const crowdVal = nextNaptan ? await fetchCrowding(nextNaptan) : null;

      let html = '';
      if (loc) {
        html += `<h3>Train location</h3><p>${loc}</p>`;
        if (inferred) {
          html += `<p style="font-size:0.75rem;color:var(--text-muted);margin-top:10px">
            ⓘ Estimated from arrival times — Elizabeth line trains don't broadcast live position data.
          </p>`;
        }
      } else {
        html = `<p style="color:var(--text-muted)">Location not available for this train.</p>`;
      }

      if (crowdVal !== null) {
        const pct   = Math.min(100, Math.round(crowdVal * 100));
        const cls   = crowdVal < 0.4 ? 'crowd-low' : crowdVal < 0.7 ? 'crowd-mid' : 'crowd-high';
        const label = crowdVal < 0.4 ? 'Quiet' : crowdVal < 0.7 ? 'Busy' : 'Very busy';
        const nextName = cleanStationName(upcoming[0]?.stationName || '');
        html += `<h3 style="margin-top:16px">Live crowding${nextName ? ` at ${nextName}` : ''}</h3>
          <div style="display:flex;align-items:center;gap:10px;margin-top:6px">
            <div class="crowd-bar-track" style="flex:1">
              <div class="crowd-bar-fill ${cls}" style="width:${pct}%"></div>
            </div>
            <span class="crowd-label ${cls}">${label}</span>
          </div>`;
      }

      if (upcoming.length) {
        html += `<h3 style="margin-top:16px">Next stops</h3><ul style="list-style:none;padding:0;margin:6px 0 0;display:flex;flex-direction:column;gap:5px">`;
        for (const s of upcoming.slice(0, 5)) {
          const m = Math.round(s.timeToStation / 60);
          const label = m <= 1 ? '1 min' : `${m} min`;
          html += `<li style="display:flex;justify-content:space-between;font-size:0.88rem">
            <span>${cleanStationName(s.stationName)}</span>
            <span style="font-family:var(--font-mono);color:var(--text-muted)">${label}</span>
          </li>`;
        }
        html += '</ul>';
      }

      modalBody.innerHTML = html;
    } catch {
      modalBody.innerHTML = `<p style="color:var(--text-muted)">Unable to fetch train details.</p>`;
    }
  });

  function cleanStationName(name) {
    return (name || '')
      .replace(/\s+underground\s+station$/i, '')
      .replace(/\s+rail\s+station$/i, '')
      .replace(/\s+station$/i, '')
      .trim();
  }

  async function loadArrivals() {
    showSkeletons();
    try {
      const [arr, crowdVal] = await Promise.allSettled([
        fetchArrivals(currentStopId),
        fetchCrowding(currentStopId),
      ]);
      renderArrivals(
        arr.status === 'fulfilled' ? arr.value : [],
        crowdVal.status === 'fulfilled' ? crowdVal.value : null
      );
    } catch {
      arrivalsEl.innerHTML = '<div class="state-msg">Unable to load arrivals. Check your connection.</div>';
    }
    const now = new Date();
    lastUpdatedEl.textContent =
      `Updated ${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  }

  function showSkeletons() {
    arrivalsEl.innerHTML = Array(3).fill(
      `<div class="platform-section"><div class="skeleton-row" style="margin:10px"></div><div class="skeleton-row" style="margin:10px;opacity:.6"></div></div>`
    ).join('');
  }
});


async function fetchStations(q) {
  const body = await tflFetch(`https://api.tfl.gov.uk/StopPoint/Search?query=${encodeURIComponent(q)}&modes=tube,overground,elizabeth-line,dlr,tram,national-rail`);
  return body.matches || [];
}

async function fetchArrivals(id) {
  async function getArrivalsFor(stopId) {
    const arr = await tflFetch(`https://api.tfl.gov.uk/StopPoint/${stopId}/Arrivals?t=${Date.now()}`).catch(() => []);
    return Array.isArray(arr) ? arr : [];
  }

  const basePromise = getArrivalsFor(id);

  const childrenPromise = (async () => {
    try {
      const meta = await tflFetch(`https://api.tfl.gov.uk/StopPoint/${id}`);
      const children = meta?.children || [];
      const tflModes = new Set(['tube', 'overground', 'elizabeth-line', 'dlr', 'tram', 'national-rail']);
      const seen = new Set([id]);
      const childIds = [];
      for (const c of children) {
        if (!c.id || seen.has(c.id)) continue;
        if ((c.modes || []).some(m => tflModes.has(m))) {
          seen.add(c.id);
          childIds.push(c.id);
        }
      }
      if (!childIds.length) return [];
      const lists = await Promise.all(childIds.map(cid => getArrivalsFor(cid).catch(() => [])));
      return lists.flat();
    } catch { return []; }
  })();

  const [baseArr, childArr] = await Promise.all([basePromise, childrenPromise]);

  const seen = new Set();
  const all  = [];
  for (const a of [...baseArr, ...childArr]) {
    const key = `${a.vehicleId}|${a.lineId}|${a.platformName}`;
    if (!seen.has(key)) { seen.add(key); all.push(a); }
  }
  all.sort((a, b) => a.timeToStation - b.timeToStation);
  return all;
}

async function fetchVehicleArrivals(id) {
  const data = await tflFetch(`https://api.tfl.gov.uk/Vehicle/${id}/Arrivals?t=${Date.now()}`);
  data.sort((a, b) => a.timeToStation - b.timeToStation);
  return data;
}


async function fetchCrowding(naptanId) {
  try {
    const json = await tflFetch(`https://api.tfl.gov.uk/crowding/${naptanId}/Live`);
    if (!json?.dataAvailable) return null;
    return json.percentageOfBaseline ?? null;
  } catch {
    return null;
  }
}

function renderArrivals(arrivals, crowdValue = null) {
  const container = document.getElementById('arrivals');
  container.innerHTML = '';

  if (!arrivals.length) {
    container.innerHTML = '<div class="state-msg">No upcoming services found for this station.</div>';
    return;
  }

  if (crowdValue !== null) {
    const pct   = Math.min(100, Math.round(crowdValue * 100));
    const cls   = crowdValue < 0.4 ? 'crowd-low' : crowdValue < 0.7 ? 'crowd-mid' : 'crowd-high';
    const label = crowdValue < 0.4 ? 'Quiet' : crowdValue < 0.7 ? 'Busy' : 'Very busy';
    const crowdEl = document.createElement('div');
    crowdEl.className = 'crowd-banner';
    crowdEl.innerHTML = `
      <div class="crowd-banner-label">Live crowding</div>
      <div class="crowd-bar-track">
        <div class="crowd-bar-fill ${cls}" style="width:${pct}%"></div>
      </div>
      <span class="crowd-label ${cls}">${label}</span>
    `;
    container.appendChild(crowdEl);
  }

  const byPlatform = {};
  for (const p of arrivals) {
    const key = p.platformName || p.platformNaptanId || 'Unknown platform';
    (byPlatform[key] = byPlatform[key] || []).push(p);
  }

  const platforms = Object.keys(byPlatform).sort((a, b) => {
    const na = parseInt((a.match(/\d+/) || [])[0], 10);
    const nb = parseInt((b.match(/\d+/) || [])[0], 10);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    if (!isNaN(na)) return -1;
    if (!isNaN(nb)) return 1;
    return a.localeCompare(b);
  });

  for (const platform of platforms) {
    const section = document.createElement('div');
    section.className = 'platform-section';

    const header = document.createElement('div');
    header.className = 'platform-header';
    header.innerHTML = `<h2>${platform}</h2>`;
    section.appendChild(header);

    for (const p of byPlatform[platform]) {
      const dest   = p.destinationName || p.lineName || 'Unknown';
      const secs   = p.timeToStation;
      const mins   = Math.round(secs / 60);
      const timeLabel = secs < 30 ? 'Due' : `${mins} min`;
      const timeClass = secs < 30 ? 'due' : mins <= 2 ? 'soon' : 'ok';
      const color  = lineColors[p.lineId] || '#6b7385';
      const lname  = lineNames[p.lineId]  || p.lineName || p.lineId || '';

      const row = document.createElement('div');
      row.className = 'train-row';
      row.dataset.vehicleId = p.vehicleId || '';
      row.dataset.lineId    = p.lineId    || '';

      row.innerHTML = `
        <div class="line-pip" style="background:${color}"></div>
        <span class="train-dest">${dest}</span>
        <span class="train-line-label">${lname}</span>
        <span class="train-time ${timeClass}">${timeLabel}</span>
      `;
      section.appendChild(row);
    }

    container.appendChild(section);
  }
}
