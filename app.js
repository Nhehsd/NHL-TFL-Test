document.addEventListener("DOMContentLoaded", function () {
  const tubeApiUrl = `https://api.tfl.gov.uk/line/mode/tube/status`;
  const elizabethLineApiUrl = 'https://api.tfl.gov.uk/line/elizabeth/status';
  const overgroundApiUrl = 'https://api.tfl.gov.uk/line/mode/overground/status';

  const fetchTubeData = fetch(tubeApiUrl).then((response) => response.json());
  const fetchElizabethLineData = fetch(elizabethLineApiUrl).then((response) => response.json());
  const fetchOvergroundData = fetch(overgroundApiUrl).then((response) => response.json());

  Promise.all([fetchTubeData, fetchElizabethLineData, fetchOvergroundData])
    .then(([tubeData, elizabethLineData, overgroundData]) => displayTubeStatus(tubeData, elizabethLineData, overgroundData))
    .catch((error) => console.error("Error fetching data:", error));

  function displayTubeStatus(tubeData, elizabethLineData, overgroundData) {
    const lineColors = {
      Bakerloo: "#996633",
      Central: "#CC3333",
      Circle: "#E1A700",
      District: "#006633",
      Jubilee: "#868F98",
      Metropolitan: "#660066",
      Northern: "#000000",
      Piccadilly: "#0019a8",
      Victoria: "#0099CC",
      "Waterloo & City": "#7EC8E3",
      "Hammersmith & City": "#F68C95",
      "Elizabeth line": "#9E579D",
      Lioness: "#E1A700",
      Mildmay: "#1E90FF",
      Windrush: "#FF4500",
      Weaver: "#800000",
      Suffragette: "#228B22",
      Liberty: "#808080"
    };

  const getLineHTML = (line) => {
    const lineColor = lineColors[line.name] || "#000000";
    const statusSeverity = line.lineStatuses[0].statusSeverity;
    const statusColor = getStatusColor(statusSeverity);
    const reason = line.lineStatuses[0].reason || '';

    // Debug raw API reason
    console.log("Raw reason for", line.name, ":", line.lineStatuses[0].reason);

    // Preserve newlines for display
    const formattedReason = reason.replace(/\n/g, "<br>");

    let reasonHTML = '';
    if (reason !== '' && reason !== 'N/A') {
        reasonHTML = `<div class="reason" style="color: ${statusColor};">${formattedReason}</div>`;
    }

    return `<div class="line-container">
              <div class="line" style="color: ${lineColor};">
                <strong>${line.name}</strong>
                <span class="status" style="color: ${statusColor};">${line.lineStatuses[0].statusSeverityDescription}</span>
              </div>
              ${reasonHTML}
            </div>`;
};


    // Generate content for each table
    const tubeLines = tubeData.map(getLineHTML);
    const elizabethLine = elizabethLineData.map(getLineHTML);
    const overgroundLines = overgroundData.map(getLineHTML);

    // Insert into respective tables
    document.querySelector(".others-table").innerHTML = tubeLines.concat(elizabethLine).join("");
    document.querySelector(".overground-table").innerHTML = overgroundLines.join("");
  }

  function getStatusColor(severity) {
    switch (severity) {
      case 10: // Good Service
        return "#00AA00"; // Green
      case 9: // Minor Delays
        return "#E1A700"; // Orange
      case 8: // Severe Delays
        return "#FF0000"; // Red
      default:
        return "#FF0000"; // Default to red
    }
  }
});
