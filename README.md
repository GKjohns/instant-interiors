# Hearth

Paste a floor plan, walk through it, and change it by talking. Hearth turns a floor-plan image into a
first-person 3D home (Nuxt 4 + three.js), then lets you say what you'd change in plain English: "move the
sofa under the window", "wallpaper the bedroom in a soft green floral", "what does the kitchen look like
at golden hour". A fast model turns each sentence into a few small JSON ops; a deterministic engine places,
paints and lights. Conjure's architecture, pointed at interior design.

## Run

```bash
nvm use 22
npm install            # add packages with `npx npm@11 install <pkg>` (npm 10 hits an arborist bug here)
npm run dev            # http://localhost:3092
npm test               # node --test over the pure kernel (plan geometry, layout, state, context, kit coverage)
npm run typecheck && npm run lint
npm run draw:plans     # draw the built-in sample plans to public/samples/*.png
npm run bench:extract  # read every public/samples image through the plan reader and score it
node --env-file=.env bench/intent.ts   # ~35 sentences × 2 homes through Haiku: pass rate, latency, cost
node scripts/shoot.mjs --port 3096      # Playwright tour with real sentences, screenshots into internal_docs
npm run qa -- --port 3096               # the full QA pass against a running dev server (--only walk,light,… to narrow)
```

`.env` needs `AI_GATEWAY_API_KEY` (Vercel AI Gateway). Two model calls exist: Haiku 5.5 for sentences
(~0.8 s to the first op, ~$0.0002 a sentence) and Sonnet 5.5 vision for reading a plan (6–9 s, ~$0.02).

Walk with WASD (shift runs), drag to look, double-click to lock the mouse. Enter focuses the bar; Tab
flips between walking and the top-down plan view; Cmd-Z undoes the last sentence. Paste a screenshot of a
floor plan anywhere on the page (or drop a file, or use the Plan panel) to read it; a one-line hint like
"2 bedroom apartment, dimensions in feet" makes the read noticeably more stable. The home saves to
localStorage; export and import JSON from the ⋯ menu (loading replays the op log over the plan).

## How it works

- **The plan** (`shared/plan/`): rooms are polygons in metres (x right, z down the drawing); walls are
  derived, never stored, so two rooms that share an edge share a wall. Openings (doors, windows, cased
  openings) sit on edges. `normalizePlan` takes the loose shape a vision model writes (feet or metres,
  sloppy corners, missing ids) and makes it strict: snaps, winds, dedupes, attaches openings, fills default
  finishes by room type. `samples.ts` ships a 2-bedroom apartment so there is always a home to walk.
- **The plan reader** (`server/utils/planExtract.ts`): Sonnet 5.5 through the gateway with structured
  output (`generateText` + `Output.object`), prompted to make rooms tile without gaps and to read dimension
  labels. Benchmarked in `internal_docs/20261017_hearth_v0/extract/` against a drawn ground-truth plan and
  a real listing screenshot (10 rooms, both bedrooms within 3 % of their labelled areas).
- **The op language** (`shared/home/ops.ts`): `place | move | remove | restyle | surface | light | furnish |
  goto | undo | reset | say`. Models never do coordinate math: a place is a Spot ("against the north wall
  of the living room", "beside the sofa", "where I'm looking") and a selector names things by kind, room,
  gaze or "what you just placed". `parseOps` validates each op strictly and drops the bad ones alone.
- **The kernel** (`shared/home/state.ts`, `layout/`, `select.ts`, `plan/geometry/`): pure TypeScript,
  no three.js. Resolves every Spot into metres deterministically (seeded by the sentence), keeps things
  inside rooms, off door swings and away from each other, and logs one batch per sentence. The log is the
  truth: undo, save and load replay it over the plan.
- **The brain** (`server/utils/intent.ts`): a cached digest (language, catalog, rules, worked examples)
  plus a per-sentence context block (`shared/home/context.ts`: which room you're in, what you're looking
  at, each room's size, windows and doors, what's in it). Ops stream back as NDJSON the moment each JSON
  object closes, and the client applies them as they land.
- **The renderer** (`app/home/`): the shell from the plan (floors with metre UVs, split wall pieces with
  door and window cut-outs, frames, glass, sky cards), 70 hand-built low-poly furniture kinds
  (`kit/`), 13 procedural wall and floor patterns (`surfaces.ts`), a sun that follows the time of day
  and the plan's north, a pool of real point lights for the nearest lamps, wall collision, and a plan view.

## Layout

```
app/components/HomeScene.client.vue   the canvas + HUD host; window.__hearth for scripts
app/components/hud/                   bar, caption, room chip, plan panel, top-right (light popover, history, ⋯ menu), whisper
app/composables/{useHome,useIntent,usePlan}.ts
app/home/{renderer,shell,lights,look,surfaces,color}.ts, app/home/kit/
app/pages/dev/renderer.vue            dev-only renderer harness for scripts/render-check.mjs
shared/plan/{poly,schema,samples}.ts, shared/plan/geometry/{walls,rooms,entry}.ts
shared/home/{ops,types,kinds,select,state,context}.ts, shared/home/layout/{spots,arrange,fit,facing,site,resolve}.ts
shared/{math,models}.ts               seeded rng / rounding / clamp; the model aliases (client and server)
server/api/intent.post.ts, server/api/plan/extract.post.ts
server/utils/{gateway,opStream,aiModels,intent,planExtract}.ts
scripts/   draw-plan, bench-extract, kit-check, render-check, shoot, qa; lib/ (dev server, browser, shots, tables)
tests/     node --test; fixtures/ holds a saved real-plan read
internal_docs/20261017_hearth_v0/   brief, competitive research, benches, screenshots
public/samples/                     floor plan images and their sources
```

## What's not here yet

Realtime voice (Conjure's genie voice; the browser mic fallback works where SpeechRecognition exists),
wall edits ("put a door here", "knock this wall through"), furniture collision while walking, a shoppable
catalog, and a deploy. See `~/claude-ops/monument/projects/hearth/STATE.md`.
