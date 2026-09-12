# Antarctic Digital Twin

Digital Twin platform for efficient **remote management of the Indian Antarctic research stations
Maitri and Bharati** — integrating infrastructure, energy, logistics and environmental monitoring
into a single mission-control console.

| | |
|---|---|
| **Problem Statement** | SIH 2026 · **26060** |
| **Organisation** | Ministry of Earth Sciences (MoES) / NCPOR |
| **Category / Theme** | Software · Smart Automation |

---

## Why this exists

Maitri and Bharati are run by small over-wintering crews with a satellite link as their only
connection to India. The people responsible for them sit thousands of kilometres away, and the
questions they need answered are always the same four: *is the habitat safe, is there power, is
the structure holding, will the supplies last?*

This prototype models both stations as a live **digital twin**: a continuously updating simulation
of each station across those four pillars, with a rules engine that turns raw telemetry into
ranked, human-readable alerts.

---

## Quick start

```bash
npm install     # also downloads the mongod binary (~176 MB, one time, needs internet)
npm run dev     # boots DB, seeds it, starts the simulator and the server
```

Then open **http://localhost:3000**.

There is **no database to install and no connection string to configure.** `mongodb-memory-server`
starts a real MongoDB against an ephemeral data directory inside `node_modules/.cache`, seeds it on
boot, and throws it away on exit.

| Command | What it does |
|---|---|
| `npm run dev` | Run from TypeScript source via `ts-node` |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run the compiled build |
| `npm test` | Self-check for the telemetry engine (14 tests, no framework) |
| `npm run typecheck` | Type-check without emitting |

Environment variables (both optional, plain `VAR=value` prefixes — no `.env` loader is used
because the project has no secrets):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `TICK_SECONDS` | `10` | How often the simulator appends a new reading |

```bash
PORT=4000 TICK_SECONDS=3 npm run dev
```

---

## What a judge sees

On boot the twin lays down **12 hours of 10-minute telemetry** for both stations, then keeps
ticking live. Each station is seeded with a deliberate scenario so the alerting is visible
immediately rather than needing to be waited for:

- **Maitri** — a katabatic **storm front** builds across the second half of the seeded history and
  ends in full blizzard conditions: wind past 55 kts, wind chill below −45 °C, whiteout visibility,
  HVAC under strain. The temperature sparkline shows the front arriving.
- **Bharati** — a **supply-chain squeeze**: diesel at ~27 %, thin rations, a resupply that lands
  *after* the food runs out, and a degraded satellite uplink.

The dashboard polls the API every 5 s and patches the numbers in place; when the set of active
alerts changes it reloads so the server-rendered banner stays the single source of truth.

---

## The four pillars

| Pillar | Tracked |
|---|---|
| **Environment** | Air temperature, wind chill, sustained wind, peak gust, visibility, humidity, pressure, snow depth, blizzard flag |
| **Energy** | Site demand, generator load vs. rated capacity, solar array, wind turbines, diesel reserve (% and litres), battery state of charge |
| **Infrastructure** | HVAC status, habitat temperature, water reserve, structural integrity index, satellite link status, uplink latency, waste tank |
| **Logistics** | Crew on station vs. capacity, ration endurance, next resupply, medical kits, cargo awaiting airlift |

### Alert rules

Severity is derived from the newest reading; a station's headline status is the worst severity present.

| Severity | Raised when |
|---|---|
| 🔴 Critical | Wind chill ≤ −45 °C · blizzard · visibility < 100 m · diesel < 15 % · HVAC fault · habitat < 16 °C · uplink down · rations < 30 days · resupply lands after rations run out |
| 🟠 Warning | Gale ≥ 34 kts · visibility < 1000 m · diesel < 30 % · generator > 90 % rated · battery < 25 % · HVAC strained · uplink degraded · water < 15 % · structural index < 85 % · rations < 60 days · medical kits < 5 |

---

## API

| Method | Endpoint | Returns |
|---|---|---|
| `GET` | `/api/health` | Service + database health |
| `GET` | `/api/stations` | Both stations with latest reading, alerts, status |
| `GET` | `/api/stations/:code` | One station snapshot (`MAITRI` / `BHARATI`) |
| `GET` | `/api/stations/:code/telemetry?limit=n` | History, oldest-first (`limit` clamped to 500) |
| `GET` | `/api/alerts` | Every active alert across both stations |

Unknown station codes return **400** with the list of valid codes; unknown API paths return **404**
as JSON. Every handler is wrapped in `try/catch` and forwards to a central error middleware.

```bash
curl localhost:3000/api/stations/MAITRI | jq '.data.alerts'
```

---

## Architecture

```
src/
  telemetry-engine.ts       Pure core — physics, simulation, alert rules. No I/O, fully testable.
  telemetry-engine.test.ts  14 assertions covering the above.
  db.ts                     In-memory MongoDB lifecycle.
  models/station.ts         Mongoose schema — identity, capacities, status.
  models/telemetry.ts       Mongoose schema — one reading, four pillar sub-documents.
  seeder.ts                 Seeds 12 h of history + the live simulator tick.
  station-service.ts        Read model shared by the API and the dashboard.
  controllers/api.ts        JSON handlers + input validation.
  controllers/views.ts      Dashboard handler + formatting helpers.
  routes/                   Router definitions.
  server.ts                 Boot sequence, error middleware, graceful shutdown.
views/
  layout.ejs                Dark mission-control wrapper; pulls in the page named by `view`.
  dashboard.ejs             Four-pillar console, alert banner, sparklines, live poller.
  error.ejs                 404 / 500 page.
  partials/                 metric row, progress bar.
```

The design rule worth noting: **all physics and alert logic live in `telemetry-engine.ts`, which
touches nothing external.** That is what makes the rules testable without a database, and what lets
the API and the dashboard agree on status by construction rather than by duplication.

Wind chill uses the Environment Canada / NWS formula, and the seasonal temperature curve peaks in
mid-January and bottoms in mid-July, so the austral seasons run the right way round.

---

## Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 20+ with TypeScript (strict) |
| API | Express 5 |
| Database | MongoDB via `mongodb-memory-server` (zero setup) |
| ODM | Mongoose 8 |
| Views | EJS (server-side rendering) |
| Styling | TailwindCSS via CDN |

Express 5 rather than 4 — Express 4's `qs` dependency carries two moderate CVEs, and Express 5
forwards rejected promises to the error handler on its own. `npm audit` reports **0 vulnerabilities**.

---

## Honest limitations

- **The telemetry is simulated, not live.** There is no NCPOR feed behind this; it is a physics-shaped
  model seeded on boot. Every figure on the dashboard is generated locally.
- **Data does not survive a restart** — that is the deliberate cost of a zero-setup in-memory database.
  Swapping to a persistent MongoDB is a one-line change in `src/db.ts`.
- **`npm install` needs internet** to fetch the mongod binary (~176 MB, cached afterwards). The *run*
  needs nothing.
- Station coordinates and commissioning years are real; engineering capacities (generator kW, tank
  volumes) are plausible prototype figures, not published NCPOR specifications.
- Readings accumulate in memory unbounded (~1 MB/hour for both stations). Irrelevant for a demo,
  worth pruning before any long-running deployment.
