document.addEventListener("DOMContentLoaded", function () {
  const statusContainer = document.getElementById("status-container");

  const tubeApiUrl = `https://api.tfl.gov.uk/line/mode/tube/status`;
  const elizabethLineApiUrl = 'https://api.tfl.gov.uk/line/elizabeth/status';
  const nationalRailApiUrl = 'https://api.tfl.gov.uk/line/mode/overground/status'; //not national rail data but overground, const name has not be updated to reflect :)

  const fetchTubeData = fetch(tubeApiUrl).then((response) => response.json());
  const fetchElizabethLineData = fetch(elizabethLineApiUrl).then((response) => response.json());
  const fetchNationalRailData = fetch(nationalRailApiUrl).then((response) => response.json());

  Promise.all([fetchTubeData, fetchElizabethLineData, fetchNationalRailData])
    .then(([tubeData, elizabethLineData, nationalRailData]) => displayTubeStatus(tubeData, elizabethLineData, nationalRailData))
    .catch((error) => console.error("Error fetching data:", error));

  function displayTubeStatus(tubeData, elizabethLineData, nationalRailData) {
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
      "London Overground": "#EE7C0E",
      "Elizabeth line": "#9E579D"
    };

    const tubeLines = tubeData.map((line) => {
      const lineColor = lineColors[line.name] || "#000000";
      const statusSeverity = line.lineStatuses[0].statusSeverity;
      const statusColor = getStatusColor(statusSeverity);
      const reason = line.lineStatuses[0].reason || '';

        let reasonHTML = '';
        if (reason !== '' && reason !== 'N/A') {
            const reasonTextColor = statusColor; // Set reason text color to match status color
            reasonHTML = `<div class="reason" style="color: ${reasonTextColor};">${reason}</div>`;
        }

        return `<div class="line-container">
                    <div class="line" style="color: ${lineColor};">
                        <strong>${line.name}</strong>
                        <span class="status" style="color: ${statusColor};">${line.lineStatuses[0].statusSeverityDescription}</span>
                    </div>
                    ${reasonHTML}
                </div>`;
    });

    const elizabethLine = elizabethLineData.map((line) => {
      const lineColor = lineColors[line.name] || "#000000";
      const statusSeverity = line.lineStatuses[0].statusSeverity;
      const statusColor = getStatusColor(statusSeverity);
      const reason = line.lineStatuses[0].reason || '';

        let reasonHTML = '';
        if (reason !== '' && reason !== 'N/A') {
            const reasonTextColor = statusColor; // Set reason text color to match status color
            reasonHTML = `<div class="reason" style="color: ${reasonTextColor};">${reason}</div>`;
        }

        return `<div class="line-container">
                    <div class="line" style="color: ${lineColor};">
                        <strong>${line.name}</strong>
                        <span class="status" style="color: ${statusColor};">${line.lineStatuses[0].statusSeverityDescription}</span>
                    </div>
                    ${reasonHTML}
                </div>`;
    });

    const londonOvergroundLine = nationalRailData.filter((line) => line.name === "London Overground")
      .map((line) => {
        const lineColor = lineColors[line.name] || "#000000";
        const statusSeverity = line.lineStatuses[0].statusSeverity;
        const statusColor = getStatusColor(statusSeverity);
        const reason = line.lineStatuses[0].reason || '';

        let reasonHTML = '';
        if (reason !== '' && reason !== 'N/A') {
            const reasonTextColor = statusColor; // Set reason text color to match status color
            reasonHTML = `<div class="reason" style="color: ${reasonTextColor};">${reason}</div>`;
        }

        return `<div class="line-container">
                    <div class="line" style="color: ${lineColor};">
                        <strong>${line.name}</strong>
                        <span class="status" style="color: ${statusColor};">${line.lineStatuses[0].statusSeverityDescription}</span>
                    </div>
                    ${reasonHTML}
                </div>`;
    });
  const allLines = tubeLines.concat(elizabethLine, londonOvergroundLine);

    statusContainer.innerHTML = `<div class="table-container">${allLines.join("")}</div>`;
  }

  function getStatusColor(severity) {
    switch (severity) {
      case 10: // Good Service
        return "#00AA00"; // Green
      case 9: // Minor Delays
        return "#E1A700"; // Orangeish
      case 8: // Severe Delays
        return "#FF0000"; // Red
      default:
        return "#FF0000"; // Default to red
    }
  }
});
