/* v3.0.8 */
document.addEventListener("DOMContentLoaded", function () {
  const tubeApiUrl          = `https://api.tfl.gov.uk/line/mode/tube/status`;
  const elizabethLineApiUrl = 'https://api.tfl.gov.uk/line/elizabeth/status';
  const overgroundApiUrl    = 'https://api.tfl.gov.uk/line/mode/overground/status';

  const makeSkeleton = (n) => Array(n).fill('<div class="skeleton"></div>').join('');
  document.querySelector('.others-table').innerHTML     = makeSkeleton(12);
  document.querySelector('.overground-table').innerHTML = makeSkeleton(6);

  const fetchTubeData          = fetch(tubeApiUrl).then(r => r.json());
  const fetchElizabethLineData = fetch(elizabethLineApiUrl).then(r => r.json());
  const fetchOvergroundData    = fetch(overgroundApiUrl).then(r => r.json());

  Promise.all([fetchTubeData, fetchElizabethLineData, fetchOvergroundData])
    .then(([tubeData, elizabethLineData, overgroundData]) =>
      displayTubeStatus(tubeData, elizabethLineData, overgroundData))
    .catch(error => console.error("Error fetching data:", error));

  function displayTubeStatus(tubeData, elizabethLineData, overgroundData) {
    const lineColors = {
      Bakerloo:             "#996633",
      Central:              "#CC3333",
      Circle:               "#E1A700",
      District:             "#006633",
      Jubilee:              "#868F98",
      Metropolitan:         "#660066",
      Northern:             "#000000",
      Piccadilly:           "#0019a8",
      Victoria:             "#0099CC",
      "Waterloo & City":    "#7EC8E3",
      "Hammersmith & City": "#F68C95",
      "Elizabeth line":     "#9E579D",
      Lioness:              "#E1A700",
      Mildmay:              "#1E90FF",
      Windrush:             "#FF4500",
      Weaver:               "#800000",
      Suffragette:          "#228B22",
      Liberty:              "#808080"
    };

    const getLineHTML = (line) => {
      const lineColor      = lineColors[line.name] || "#555";
      const statusSeverity = line.lineStatuses[0].statusSeverity;
      const badgeClass     = getStatusBadgeClass(statusSeverity);
      const reason         = line.lineStatuses[0].reason || '';
      const flatReason     = reason.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
      const hasReason      = flatReason && flatReason !== 'N/A';

      const reasonHTML = hasReason
        ? `<span class="reason ${badgeClass}">${flatReason}</span>`
        : '';

      return `<div class="line-container" style="--line-color:${lineColor}">
                <div class="line-stripe"></div>
                <div class="line-body">
                  <strong>${line.name}</strong>
                  ${reasonHTML}
                </div>
                <span class="status ${badgeClass}">${line.lineStatuses[0].statusSeverityDescription}</span>
              </div>`;
    };

    const tubeLines       = tubeData.map(getLineHTML);
    const elizabethLine   = elizabethLineData.map(getLineHTML);
    const overgroundLines = overgroundData.map(getLineHTML);

    document.querySelector('.others-table').innerHTML     = tubeLines.concat(elizabethLine).join('');
    document.querySelector('.overground-table').innerHTML = overgroundLines.join('');

    const tCount = tubeLines.length + elizabethLine.length;
    const oCount = overgroundLines.length;
    document.getElementById('tube-count').textContent = `${tCount} lines`;
    document.getElementById('og-count').textContent   = `${oCount} lines`;

    const ogHasDelays = overgroundData.some(l => l.lineStatuses[0].statusSeverity !== 10);
    document.querySelector('.panel-left').classList.toggle('expanded', !ogHasDelays);
    document.querySelector('.panel-right').classList.toggle('compact', !ogHasDelays);

    document.querySelectorAll('.panel-right .line-container').forEach(card => {
      const hasDelay = card.querySelector('.reason') !== null;
      card.classList.toggle('has-delay', hasDelay);
    });

    const now = new Date();
    document.getElementById('last-updated').textContent =
      `Updated ${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;

    requestAnimationFrame(() => {
      adjustReasonLines();
      setupLeftPanelScroll();
      startBusTicker();
    });
  }

  function setupPanelScroll(panelSelector) {
    const wrap = document.querySelector(`${panelSelector} .lines-list-scroll-wrap`);
    const list = document.querySelector(`${panelSelector} .lines-list`);
    if (!wrap || !list) return;

    list.style.animation = 'none';

    const original = list.innerHTML;
    list.innerHTML = original + original;

    requestAnimationFrame(() => {
      const totalH   = list.scrollHeight / 2;
      const wrapH    = wrap.clientHeight;
      const pxPerSec = 40;
      const duration = totalH / pxPerSec;

      list.style.setProperty('--scroll-dist', `-${totalH}px`);
      list.style.animationDuration       = `${duration}s`;
      list.style.animationName           = 'scroll-up';
      list.style.animationTimingFunction = 'linear';
      list.style.animationIterationCount = 'infinite';
    });
  }

  function setupLeftPanelScroll() {
    setupPanelScroll('.panel-left');
  }

  function adjustReasonLines() {
  }

  window.addEventListener('resize', () => {
    adjustReasonLines();
    setupPanelScroll('.panel-left');
  });

  async function startBusTicker() {
    await loadBusTicker();
    setInterval(loadBusTicker, 30000);
  }

  async function loadBusTicker() {
    const STOPS = [
      { id: '490008655E', label: 'SA → Ealing Broadway' },
      { id: '490008655W', label: 'SX → Greenford / Willesden' },
    ];

    try {
      const results = await Promise.all(
        STOPS.map(s =>
          fetch(`https://api.tfl.gov.uk/StopPoint/${s.id}/Arrivals?t=${Date.now()}`, { cache: 'no-store' })
            .then(r => r.json())
            .then(arr => Array.isArray(arr) ? arr.map(a => ({ ...a, _stopLabel: s.label, _stopId: s.id })) : [])
            .catch(() => [])
        )
      );

      const all = results.flat()
        .filter(a => ['e10','297'].includes((a.lineId || '').toLowerCase()))
        .sort((a, b) => a.timeToStation - b.timeToStation)
        .slice(0, 12);

      if (!all.length) {
        document.getElementById('bus-ticker-inner').innerHTML =
          '<span class="bus-ticker-loading">No buses due</span>';
        return;
      }

      const makeItem = (a) => {
        const secs  = a.timeToStation;
        const mins  = Math.round(secs / 60);
        const label = secs < 30 ? 'Due' : mins <= 1 ? '1 min' : `${mins} min`;
        const cls   = secs < 30 ? 'due' : mins <= 2 ? 'soon' : 'ok';
        return { a, label, cls };
      };

      const allMapped = all.map(makeItem);

      const firstSA = allMapped.find(({ a }) => a._stopId === '490008655E');
      const firstSX = allMapped.find(({ a }) => a._stopId === '490008655W');

      const makePinnedHTML = ({ a, label, cls }) => `
        <span class="bus-ticker-route">${(a.lineName || a.lineId || '').toUpperCase()}</span>
        <span class="bus-ticker-dest">${a.destinationName || ''}</span>
        <span class="bus-ticker-time ${cls}">${label}</span>
      `;

      const nextEl = document.getElementById('bus-ticker-next');
      let pinnedHTML = '';
      if (firstSA) {
        pinnedHTML += `<span class="bus-ticker-pinned-dir">→ Ealing Broadway</span>` + makePinnedHTML(firstSA);
      }
      if (firstSA && firstSX) {
        pinnedHTML += `<span class="bus-ticker-pinned-sep"></span>`;
      }
      if (firstSX) {
        pinnedHTML += `<span class="bus-ticker-pinned-dir">→ Greenford</span>` + makePinnedHTML(firstSX);
      }
      nextEl.innerHTML = pinnedHTML;

      const pinned = new Set([firstSA?.a, firstSX?.a].filter(Boolean));
      const scrollItems = allMapped
        .filter(({ a }) => !pinned.has(a))
        .map(({ a, label, cls }) =>
          `<span class="bus-ticker-item">
            <span class="bus-ticker-route">${(a.lineName || a.lineId || '').toUpperCase()}</span>
            <span class="bus-ticker-dest">${a.destinationName || ''}</span>
            <span class="bus-ticker-time ${cls}">${label}</span>
          </span>
          <span class="bus-ticker-sep">·</span>`
        ).join('');

      const inner = document.getElementById('bus-ticker-inner');
      inner.style.animation = 'none';
      inner.innerHTML = scrollItems + scrollItems;

      requestAnimationFrame(() => {
        const totalW   = inner.offsetWidth / 2;
        const duration = Math.max(20, totalW / 80);
        inner.style.animationDuration       = `${duration}s`;
        inner.style.animationTimingFunction  = 'linear';
        inner.style.animationIterationCount  = 'infinite';
        inner.style.animationName            = 'ticker-scroll';
      });

    } catch (e) {
      console.warn('Bus ticker failed:', e);
    }
  }

  function getStatusBadgeClass(severity) {
    switch (severity) {
      case 10: return 'good';
      case 9:  return 'warn';
      default: return 'bad';
    }
  }
});
