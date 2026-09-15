# PROGRESS — Antarctic Digital Twin (SIH 2026 / PS 26060)

Session save-file. Re-read at session start; update + commit after each meaningful step.

## Status: complete and verified — 2026-09-15 (divergence engine shipped)

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

## Console redesign — 2026-09-12

The first dashboard was generic AI output: `#05080f` ground, cyan/blue radial orbs, a grid-line
backdrop, glowing LED dots, a different neon accent per pillar, and **no `font-family` at all** — so
it silently inherited Tailwind's `system-ui`. Rebuilt to the deck's design language.

What changed:

- `public/console.css` — the whole design system in one stylesheet. Double-bezel cards, one teal
  accent, semantic `crit`/`warn`/`ok` tones, monospaced tabular numbers, film grain, staggered
  entry, `prefers-reduced-motion` and print rules.
- Fonts `git mv`'d from `presentation/src/fonts/` to `public/fonts/` — one copy now serves both the
  deck and the dashboard.
- `views/layout.ejs`, `error.ejs`, `partials/metric.ejs`, `partials/bar.ejs` rewritten; the partials
  now take `crit`/`warn`/`ok` instead of raw Tailwind colour classes.
- `views/dashboard.ejs` rebuilt around a sticky left rail (identity + alerts) beside a 2×2 pillar
  bento. The polling IIFE was kept intact — only the design layer moved.

Three real bugs caught while doing it:

- **Contrast failed WCAG AA.** Measured, not guessed: `--ink3` was 3.78:1 and `--ink4` 2.36:1
  against the card surface. Darkened to 5.95:1 and 4.53:1; `--warn` also nudged from 4.47 to 5.41.
- **`immutable` cache locked the stylesheet.** `express.static` served `/console.css` with
  `max-age=1y, immutable`, so an edited stylesheet never reached a browser that already had one —
  confirmed live when `--ink3` still read the old value after the fix. The link now carries the
  file's mtime as a cache key.
- **Five bars were frozen.** Bars showing a derived ratio had no `data-bar` path, so they sat still
  while the metric directly above them ticked. All nine now live-update via `data-bar-max`.

Verified in the browser: 6/6 fonts loaded, no horizontal overflow, no element spill, 22 metrics and
9 bars wired, `darkreader-lock` present, and the alert-signature reload observed firing for real
when Maitri's satellite uplink dropped mid-session.

Not verified: narrow-viewport rendering. The extension's window resize did not take effect, so the
mobile collapse rests on standard Tailwind breakpoints and a `minmax(0,1fr)` guard rather than on a
screenshot.

## Bharati 3D twin — 2026-09-13

Branch `worktree-bharati-3d-twin`. A second view at `/twin`: an interactive three-dimensional
model of Bharati, reachable from the **3D Twin** switch in the header. Maitri stays on the console
(your call — only Bharati's architectural set was available to trace).

**The registry is the point, not the polygons.** `src/facility.ts` holds the 21-bay column grid,
the H1–H4 elevation datums, the shell profile, 27 room volumes with bay spans and deck, and three
service routes. `public/twin.js` generates the geometry from it. A room cannot be coloured without
knowing what equipment is in it, so the 3D forced the asset registry the twin was missing.

What shipped:

- Extruded shell in two segments (deep end on V-columns, shallow end on stilts), four decks,
  stairs at both ends, and the ground radome carrying the comms zone.
- Rooms coloured live by alert severity, using the same rule and tokens as the console.
- Click a room or its chip to select it; the rail shows deck, bay span, pillar, five live metrics.
- **Explode decks**, **Services** (x-ray + flow), deck checkboxes, and **Reset view**.
- Flow markers travel at a speed set by the real rate — generator load, crew on station, site
  demand — so a stalled line reads as a stalled service.
- Three.js r186 served from `node_modules` at `/vendor/three`. No CDN: the demo has to work with
  no internet. WebGL missing → written fallback, console view carries the same information.

**Fixed during the screenshot loop** (headless Chrome + SwiftShader, since the browser extension
was down):

- **The building was twice as wide as it should be.** `HALF_WIDTH_M` was 18 — a 2376 m² single-deck
  footprint against Bharati's published ~2500 m² across three decks. Now 9 m, with the derivation
  written into the constant.
- **The model rendered flat white on white.** Root cause was blown-out lighting, not the material
  colours: `MeshStandardMaterial` clips to white past ~1.0 total intensity. Hemi 0.72 / key 1.35 /
  fill 0.22, and the ground is now a `ShadowMaterial` catcher so the CSS paper gradient shows
  through instead of a second painted disc.
- **The radome was clipped off the bottom of the frame.** Replaced hand-tuned camera numbers with
  `fitView()`, which projects the model's real bounding box through the camera and solves the
  push-back exactly. Geometry changes can no longer strand the camera.
- **Rooms read as a pile of glass boxes.** They were 0.9 opacity; every room behind bled through.
  Solid now — the translucent shell alone is what makes it a sectional view.
- **Severity colours looked like mud on the model.** `--warn` / `--crit` are *text* tokens,
  darkened for AA on white. Added `--warn-solid` / `--crit-solid` surface tokens; the legend and
  the 3D scene both read them, so they cannot drift apart.
- **The service network was two stubs and a pipe.** The routes in `facility.ts` were placeholders;
  they now run fuel store → riser → generator hall, and melt plant → riser → wet rooms → galley.
- **Legend and tool buttons overlapped on a phone.** One media query under 640px steps the legend
  up a row and shortens the stage.

**Verified:** typecheck clean, 23 tests pass (14 engine + 9 facility), all five routes 200, Explode
and Services both driven headlessly over CDP and screenshotted, dashboard header link renders per
station (`3D Twin` on Bharati, `3D Twin · Bharati` on Maitri), and **narrow viewport confirmed at
420px** — `scrollWidth === innerWidth`, no overlap. That closes the one thing the console redesign
could not check.

**Not verified:** nothing on this branch is unverified, but none of it has been through a real GPU
browser — SwiftShader renders the same pixels, it does not prove the frame rate.

## Divergence engine — 2026-09-15

The gap this closes: a threshold alarm fires when a number leaves its safe band. A **twin** carries a
model of what the station should be doing, so it can say a number has stopped matching physics
**while it is still inside that band**. Without this the project was a very good dashboard.

**What was built**

- `PlantState` (`foulingPct`, `leakLph`) threaded through `nextReading`. It never enters a `Reading`,
  so no threshold rule can ever fire on it — and no DB schema changed, because `toReading()` copies
  only the four pillars and the seeder is the sole caller of `nextReading`.
- `expectedReading()` re-derives each step from the same shared constants the simulator uses —
  `modelDemandKw()`, `DIESEL_L_PER_KWH`, `CREW_WATER_L_PER_DAY`, `MELT_FRACTION_PER_H`. If those ever
  stop being one copy, divergence becomes decoration.
- `divergences()` replays a **12 h window** and reports residuals on three metrics: site demand,
  fuel burn, water draw. Bands: 12 % warning, 30 % critical.
- Hidden faults in the seeder: Maitri 24 % fouling, Bharati a 16 L/h seep. Both invisible to alarms.
- Surfaced in three places from **one** partial (`views/_divergence.ejs`): the console, the 3D twin
  rail (with the rooms to walk to, via `DIVERGENCE_ZONES`), and `/api/facility` + station snapshots.

**Three things that took measuring, not guessing**

- **The water residual was lying.** Bharati read "76.6 % falling faster" while the reserve was
  actually *rising*. Cause: normalising against the **net** tank change, which straddles zero because
  melt output nearly cancels crew draw — so the ratio was an artifact of that near-cancellation.
  Fixed by normalising against gross modelled crew draw. Now reads a defensible +18 %.
- **The window had to be time-based, not row-based.** The live simulator ticks every ~5 s, so the
  newest 72 rows can span six minutes, over which no leak moves measurable water. Proved with 144
  live ticks: residuals held stable at 19 % / 23.6 % / 12.2 %.
- **The storm scenario does not fake a divergence.** Measured rather than argued: under the storm
  front the raw residuals are demand −0.5 %, fuel −2.1 %, water +1.8 %, against a 12 % band.

**Bugs found and fixed**

- Chip read `+14%` beside a message saying `13% more fuel` — the ratio was rounded for storage but
  the sentence was phrased from the unrounded value. Now rounded once, reported and phrased from the
  same number, with a regression assertion.
- A miscalibrated test assertion, not an engine bug: 22 % fouling gives a 22 % demand and 13.2 % fuel
  residual, both under the 30 % critical band. Split into a warning test at 0.22 and an ordering test
  at 0.35.
- The 3D twin's poller would have left the server-rendered divergence card stale forever. It now
  compares a `metric:severity` signature against the DOM and reloads, the same contract the console
  uses. Ratios are excluded on purpose — they drift every tick and would reload forever.

**Verified:** typecheck clean, **29 tests pass** (19 engine + 10 facility), console and twin both
screenshotted at 1280 px, DOM and API signatures confirmed identical so no reload loop fires, and the
demo story confirmed end to end — Maitri shows five alerts, *none of them about energy*, directly
above a +22 % demand and +14 % fuel divergence; Bharati shows 41 074 L of water and **no water
alarm** above a +18 % water divergence.

**The 3D visual channel — decided with Saud, same day.** Three options were put up: a dashed
outline, a colourless slow pulse, or a fourth hue. Saud picked the dashed outline, which is the one
that does not put divergence on the same scale as warning and critical.

- A divergent room keeps its **nominal grey fill** and takes a dashed `--accent` outline
  (`LineDashedMaterial` on the room's `EdgesGeometry`, added to the deck group so it rides the
  exploded view). Amber and red stay exclusively severity's.
- `divergenceZones()` sends the scene a zone id → metric map. It carries **no severity** on purpose:
  handing the scene a severity is an invitation to paint it like an alarm.
- The legend gained a dashed swatch, and clicking a flagged room quotes the engine's own sentence in
  a dashed-outline block, so the scene, the rail and the console never become three accounts of the
  same residual.

**Found while verifying this: the 3D twin was silently dead in this checkout.** The canvas had been
blank in every headless screenshot, which I had been writing off as a headless WebGL limitation. It
was not — a minimal WebGL probe rendered fine, and CDP console output showed
`/vendor/three/build/three.module.js` returning **404**. This working copy's `node_modules` predated
the 3D-twin merge and had no `three` at all. `npm install` fixed it; the repo itself was always
correct (`three` is in `dependencies`, and the installed 0.186.0 matches the lockfile exactly).
The lesson is the cheap one: *a blank canvas is a bug report until proven otherwise.*

**Verified for this change:** 30 tests pass (19 engine + 11 facility), typecheck clean, and the
scene rendered over CDP with real WebGL 2.0 — dashed outlines visible on the water plant, toilets
and bathrooms while the amber and red alarm rooms stay solid fills; clicking Bathrooms shows
"Model divergence +19%" with the engine's sentence; and at 420 px the four-item legend still fits
one row with `scrollWidth` 409 ≤ `innerWidth` 420.

**Known, pre-existing, not fixed here:** Three.js r186 logs two deprecations — `THREE.Clock` (use
`THREE.Timer`) and `PCFSoftShadowMap` removed, silently downgrading to `PCFShadowMap`, so shadows
are slightly harder than the code asks for. Cosmetic; untouched because it is not what this change
was about.

**Still open:** the selected-room highlight glows the same accent teal the divergence dashes use.
Different channels — a fill versus an outline — and only one room is ever selected, but if it reads
ambiguously in a live demo the selection glow is the one to change, not the dashes.

## Pending (optional)

- Swap to persistent MongoDB (one line in `src/db.ts`) if data must survive restarts.
- Per-station detail page; richer historical charts than sparklines.
- Prune readings (~1 MB/hour accumulates) before any long-running deployment.
- Run the 3D twin on a real GPU browser — SwiftShader proves the pixels, not the frame rate.
- `CLAUDE.md` was drafted solo and still needs your review — it should have been filled in together.
- Deck slide 1 still carries a team-name placeholder; slide 8's reference links need a check.
- The deck's `maitri.jpg` / `bharati.jpg` are screenshots of the **old dark dashboard that no longer
  exists** — they need replacing before the deck is shown.
- **Phase 2 — what-if simulation:** *"generator 2 fails at −40 °C — how long does the habitat hold
  above 18 °C?"* The physics for this already exists in `modelDemandKw`.
- **Phase 3 — forecast / predictive maintenance:** projected diesel exhaustion against the resupply
  window, driven off the same divergence-corrected burn rate.

## Blockers

None.
