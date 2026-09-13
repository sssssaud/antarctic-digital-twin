# Antarctic Digital Twin

Digital Twin console for remote management of India's Maitri and Bharati Antarctic research
stations — SIH 2026 problem statement 26060 (MoES / NCPOR).
Stack: Node.js + TypeScript, Express 5, Mongoose 8, in-memory MongoDB, EJS + TailwindCSS (CDN).

## Project goal
A judge clones the repo, runs `npm install && npm run dev`, opens localhost:3000, and sees a live
mission-control dashboard for both stations split into four pillars (environment, energy,
infrastructure, logistics) with ranked alerts — with **zero database setup**.

## Directory map
- `src/telemetry-engine.ts` — pure core: wind-chill physics, seasonal curve, simulation walk, alert rules. No I/O.
- `src/telemetry-engine.test.ts` — `node:test` self-check for the engine (14 assertions).
- `src/db.ts` — in-memory MongoDB lifecycle (boot / connect / teardown).
- `src/models/` — Mongoose schemas: `station.ts` (identity + capacities), `telemetry.ts` (one reading, four pillar sub-docs).
- `src/seeder.ts` — seeds 12 h of history with scripted scenarios, plus the live simulator tick.
- `src/station-service.ts` — read model shared by API and dashboard, so both agree on status.
- `src/controllers/` — `api.ts` (JSON + validation), `views.ts` (dashboard + format helpers).
- `src/routes/` — router definitions for `/api` and `/`.
- `src/server.ts` — boot sequence, error middleware, graceful shutdown.
- `src/facility.ts` — Bharati's asset registry: column grid, elevation datums, 27 room volumes,
  service routes. The 3D model is generated from this, so the drawings stay the source of truth.
- `src/facility.test.ts` — `node:test` self-check for the registry (9 assertions).
- `views/` — `layout.ejs` wrapper, `dashboard.ejs`, `twin.ejs`, `error.ejs`, `partials/`.
- `public/console.css` — every token and component style; `public/twin.js` — the Three.js scene.

## Stack
Node 20+ · TypeScript strict · Express 5 (not 4 — `qs` CVEs) · Mongoose 8 ·
`mongodb-memory-server` 10 · EJS 6 · Tailwind via CDN · Three.js r186 served from
`node_modules` (no CDN — the 3D twin has to work offline in the demo room).
No GPU, no ML — the 6 GB VRAM ceiling is irrelevant here. `npm install` pulls a ~176 MB mongod
binary once; runtime needs no network except the Tailwind CDN.

## Build / run commands
- Setup: `npm install`
- Run: `npm run dev` (or `PORT=4000 TICK_SECONDS=3 npm run dev`)
- Build + run compiled: `npm run build && npm start`
- Test: `npm test`
- Typecheck: `npm run typecheck`

## Conventions that matter here
- **All physics and alert logic stay in `telemetry-engine.ts`, free of I/O.** That is what keeps
  the rules unit-testable and stops the API and the dashboard from drifting apart.
- Scenario shaping in the seeder must interpolate toward **absolute** targets, never relative ones —
  shaped readings feed back into the next tick, so a relative target compounds every tick.
- Every API handler validates its inputs (`parseStationCode`, clamped `limit`) and wraps in try/catch.
- The dashboard re-renders alerts server-side; the client poller only patches numbers and reloads
  when the alert set changes, so alert markup exists in exactly one place.

## Current status
- Done: all four phases of the generator prompt — setup, DB + models, seeder/controllers/routes/server,
  EJS + Tailwind dashboard. 14 tests pass, `npm audit` clean, dev and production builds both verified
  serving, both station views checked in a browser.
- Pending: nothing required. Optional next steps — persistent MongoDB swap, per-station detail page,
  historical charts beyond sparklines, prune old readings.
- Blockers: none.
