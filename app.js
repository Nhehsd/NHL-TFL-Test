/* v2.7.0 */
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

    const now = new Date();
    document.getElementById('last-updated').textContent =
      `Updated ${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;

    requestAnimationFrame(() => adjustReasonLines());
  }

  function adjustReasonLines() {
    document.querySelectorAll('.line-container').forEach(card => {
      const reason = card.querySelector('.reason');
      if (!reason) return;

      const cardH    = card.clientHeight;
      const nameEl   = card.querySelector('strong');
      const nameH    = nameEl ? nameEl.offsetHeight : 0;
      const gap      = parseFloat(getComputedStyle(card.querySelector('.line-body')).gap) || 2;
      const bodyStyle = getComputedStyle(card);
      const padV     = parseFloat(bodyStyle.paddingTop || 0) + parseFloat(bodyStyle.paddingBottom || 0);

      const reasonLineH = reason.offsetHeight / (parseInt(getComputedStyle(reason).webkitLineClamp) || 1);
      const available  = cardH - padV - nameH - gap;
      const lines = Math.max(1, Math.min(2, Math.floor(available / (reasonLineH || 16))));

      reason.style.webkitLineClamp = lines;
      reason.style.overflow = 'hidden';
    });
  }

  window.addEventListener('resize', adjustReasonLines);

  function getStatusBadgeClass(severity) {
    switch (severity) {
      case 10: return 'good';
      case 9:  return 'warn';
      default: return 'bad';
    }
  }
});
