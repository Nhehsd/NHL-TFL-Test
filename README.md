# TfL Status — v2.9.3

A real-time Transport for London status and arrivals dashboard, built as a set of static HTML/CSS/JS pages. No backend, no build step — open the files directly in a browser or serve from any static host.

---

## Pages

### `/index.html` — Line Status
Live status for all tube lines, the Elizabeth line, and all six Overground lines (Lioness, Mildmay, Windrush, Weaver, Suffragette, Liberty). Refreshes every 60 seconds.

- Good Service / Minor Delays / Severe Delays / Suspended shown per line
- Delay reason shown inline, colour-matched to severity
- Left panel (tube) automatically widens when all Overground lines are on Good Service
- Scales to screen — designed for digital signage displays

### `/arrivals/index.html` — Station Arrivals
Live departure board for any TfL station.

- Search for any tube, Overground, Elizabeth line, DLR, or tram station
- Deduplicates stations that appear as both underground and national rail entries
- Groups services by platform
- Colour-coded arrival times (Due / 1–2 min / 3+ min)
- Click any service to see current train location and next stops
- Location inferred from arrival time sequence for Elizabeth line and Overground trains
- Refreshes every 30 seconds automatically

### `/bus/index.html` — Bus Stop Arrivals
Live departure board for any London bus stop.

- Search by stop name or the 5-digit stop code printed on the bus stop pole
- Automatically resolves stop areas to individual stops (e.g. Stop A / Stop B on opposite sides of the road), letting you pick the exact one
- Each row shows route number, destination, via info, and colour-coded time badge
- Click any row to see the bus's estimated location and next stops
- Auto-refreshes every 30 seconds

### `/bus-map/index.html` — Live Bus Map
Interactive map showing real-time bus positions across London.

- Same dark Leaflet map with satellite toggle
- Enter a route number (e.g. `25`, `N29`, `RV1`) and hit Go to show that route's buses
- Route line and stop markers drawn on the map when a route is selected
- Bus positions interpolated between stops using `timeToStation` (TfL does not provide live GPS for buses)
- Without a filter, fetches buses from routes serving stops near the map centre — zoom in to zoom 13+ first
- Bus dots are red circles with the route number inside; hover for destination and next stop time
- Click any bus dot to see next 8 stops with times and estimated location
- Refreshes every 20 seconds
- Stop coordinates cached in memory per session to reduce API calls

### `/map/index.html` — Live Train Map
Interactive map showing real-time train positions across the network.

- Base map: CARTO Dark (default) or Esri satellite — toggle in top right
- Line routes drawn from TfL route sequence data
- Train positions interpolated between stops using `timeToStation` values
- Estimated positions (Elizabeth line, Overground) shown with dimmer dot and glow ring
- Station dots with hover tooltips; permanent labels at zoom level 13+
- Click any train dot to see destination, current location, journey progress %, predicted crowding, and next 8 stops
- Click any station dot to see live departures grouped by platform
- Click any line to highlight it and hide all others; click empty map to reset
- Toggle individual lines on/off with the panel on the right
- Train dots are fixed 7px on screen regardless of zoom level
- Last known train positions retained if a fetch fails or is rate limited
- Progress bar on load shows which line is being fetched

---

## Data sources

| Data | Source |
|---|---|
| Line status | `api.tfl.gov.uk/line/mode/tube/status` |
| Elizabeth line status | `api.tfl.gov.uk/line/elizabeth/status` |
| Overground status | `api.tfl.gov.uk/line/mode/overground/status` |
| Route sequences & stop coords | `api.tfl.gov.uk/Line/{id}/Route/Sequence/outbound` |
| Station arrivals | `api.tfl.gov.uk/StopPoint/{id}/Arrivals` |
| Vehicle arrivals | `api.tfl.gov.uk/Vehicle/{id}/Arrivals` |
| Crowding (predicted) | `api.tfl.gov.uk/StopPoint/{id}/Crowding/{lineId}` |
| Station search | `api.tfl.gov.uk/StopPoint/Search` |
| Bus stop arrivals | `api.tfl.gov.uk/StopPoint/{id}/Arrivals` |
| Bus route stops (with coords) | `api.tfl.gov.uk/Line/{route}/StopPoints` |
| Bus route arrivals | `api.tfl.gov.uk/Line/{route}/Arrivals` |
| Map tiles (default) | CARTO Dark Matter (OpenStreetMap data) |
| Map tiles (satellite) | Esri World Imagery |

All TfL API calls use a `tflFetch()` wrapper with automatic retry on 429 rate-limit responses (waits 3s, 6s, 9s before giving up). Stop/route data is cached in `sessionStorage` for the duration of the browser session to reduce API load.

---

## File structure

```
/
├── index.html          — Line status page
├── styles.css          — Shared styles for status page
├── app.js              — Status page logic
├── arrivals_app.js     — Arrivals + train location logic (shared by arrivals and map)
├── arrivals/
│   └── index.html      — Station arrivals page
├── map/
│   ├── index.html      — Live train map page
│   └── map_app.js      — Map logic (Leaflet, train interpolation, modals)
├── bus/
│   ├── index.html      — Bus stop arrivals page
│   └── bus_app.js      — Bus stop search and arrivals logic
└── bus-map/
    ├── index.html      — Live bus map page
    └── bus_map_app.js  — Bus map logic (route lines, position interpolation)
```

---

## Running locally

No build step required. Just open any of the HTML files in a browser, or serve the folder with any static server:

```bash
npx serve .
```

or with Python:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.

> **Note:** The TfL API does not require an API key for public endpoints but is rate-limited. Opening the map page fires approximately 19 sequential requests on load (one per line, spaced 300ms apart). Refreshing rapidly may trigger 429 responses — the app will retry automatically.

---

## Known limitations

- **Train positions are estimates** — TfL does not expose real-time GPS coordinates via the public API. Positions are interpolated between stops using `timeToStation` values from the arrivals feed. Elizabeth line and Overground trains are particularly approximate and shown with a visual indicator.
- **Crowding data is historical** — the predicted crowding shown in the train modal is based on historical passenger flow averages by time of day, not live sensor data. Not available for all lines.
- **Line geometry** — track lines on the map connect stops with bezier curves; they do not follow actual tunnel geometry underground.

---

## Tech stack

- Vanilla HTML / CSS / JavaScript — no framework, no bundler
- [Leaflet.js](https://leafletjs.com/) v1.9.4 — map rendering for the live train map
- [DM Sans + DM Mono](https://fonts.google.com/specimen/DM+Sans) — typography
- TfL Unified API — all transport data
