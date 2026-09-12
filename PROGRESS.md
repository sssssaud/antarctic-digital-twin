# PROGRESS — Antarctic Digital Twin (SIH 2026 / PS 26060)

Session save-file. Re-read at session start; update + commit after each meaningful step.

## Status: complete and verified — 2026-09-12

Built from `SIH_26060_Claude_Generator.zip`, which contained a generator prompt (not code)
specifying a fixed stack and four execution phases.

## Done

| Phase | Deliverable | State |
|---|---|---|
| 1 | `package.json`, `tsconfig.json`, `.gitignore`, folder structure | ✅ |
| 2 | `db.ts` (in-memory MongoDB), `models/station.ts`, `models/telemetry.ts` | ✅ |
| 3 | `seeder.ts` (+ live simulator), controllers, routes, `server.ts` | ✅ |
| 4 | `layout.ejs`, `dashboard.ejs`, `error.ejs`, partials — dark mission-control, 4 pillars | ✅ |
| — | Published to GitHub: github.com/sssssaud/antarctic-digital-twin (public) | ✅ |
| — | `presentation/deck.html` — 8-slide SIH pitch deck, self-contained | ✅ |

Beyond the prompt's minimum:
- Pure `telemetry-engine.ts` (NWS wind-chill formula, austral seasonal curve, bounded random walk,
  alert rules) with 14 `node:test` assertions.
- Live simulator so the twin actually moves; dashboard polls every 5 s.
- Scripted seed scenarios: Maitri storm front, Bharati supply squeeze.

## Verified

- `npm test` → 14/14 pass (includes a 1000-tick invariant sweep).
- `npm run typecheck` → clean; `npm run build` → clean.
- Dev (`ts-node`) and production (`node dist/server.js`) both boot, seed and serve.
- API: all 5 endpoints, plus 400 on bad station code, 404 on unknown route, `limit` clamped.
- Browser: both station views rendered and screenshotted, no app console errors, HTML well-formed.
- `npm audit` → 0 vulnerabilities.

## Decisions worth remembering

- **Express 5, not 4** — Express 4's `qs` dependency carries two moderate CVEs.
- **No `.env` / dotenv** — the project has no secrets; `PORT` and `TICK_SECONDS` are plain env vars,
  documented in the README. Shipping a `.env.example` nothing reads would be misleading.
- **Storm scenario interpolates to absolute targets.** First version used a relative target
  (`temp − 9`); since shaped readings feed back into the next tick it compounded every tick and slid
  the station to the random walk's floor. Fixed to target `seasonal − 9`.
- **Default station is MAITRI, set explicitly.** It was falling through to `snapshots[0]`, which is
  alphabetical — so the landing page silently showed Bharati.

## Presentation

`presentation/deck.html`, 8 slides on the SIH idea-submission sections. Single self-contained
file, 343 KB — screenshots and six subsetted font faces base64-embedded, no CDN, works offline.
Arrow keys navigate, Ctrl+P exports PDF at 1280x720 per page with Background graphics enabled.

**Rebuilt from scratch** against the installed design skills (`design-taste-frontend`,
`high-end-visual-design`). The first version was generic: system fonts, 1px gray borders,
symmetric equal-column grids, no motion. The rebuild uses Double-Bezel nested cards (outer
shell + inner core, concentric radii), asymmetric grids on every slide, macro-whitespace,
a staggered rise on slide entry with a custom `cubic-bezier(.32,.72,0,1)`, and `font-mono`
for every number. Source of truth for edits is `deck.src.html` in the build dir plus
`inject.py`, which base64-injects the fonts and images.

Verified by measuring the DOM, not by eye: all 8 slides report zero spill past the slide rect
in both axes and zero clipping on any element that can clip. Each slide was also screenshotted
and inspected.

Two layout bugs the measurement caught that screenshots alone would have missed:
- `.slide.on{display:flex}` (specificity 0,2,0) was overriding `.cover{display:grid}` (0,1,0),
  collapsing the title slide into a stack. Fixed with `.slide.cover.on{display:grid}`.
- The Dark Reader browser extension was repainting the whole deck to `#181A1B`, destroying the
  paper and accent colours. `color-scheme: light` alone did not stop it; `<meta name="darkreader-lock">`
  did. This would have inverted the deck during the actual presentation on this machine.

**Team name on slide 1 is still a placeholder** (dashed amber box) — fill it before submitting.

## Pending (optional)

- Swap to persistent MongoDB (one line in `src/db.ts`) if data must survive restarts.
- Per-station detail page; richer historical charts than sparklines.
- Prune readings (~1 MB/hour accumulates) before any long-running deployment.

## Blockers

None.
