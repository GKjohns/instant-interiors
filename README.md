# Instant Interiors

**Paste a floor plan. Walk through it. Change it by talking.**

Instant Interiors turns a floor-plan image into a first-person 3D home in about eight seconds, then lets
you redesign it in plain English: "move the sofa under the window", "wallpaper the bedroom in a soft
green floral", "what does the kitchen look like at golden hour". A fast model turns each sentence into a
few small JSON ops and a deterministic engine places, paints and lights, streaming each change into the
room you are standing in before the model has finished its sentence.

![Walking a home read from a real listing floor plan](docs/screenshots/tour_19_extract_living.png)

## What it does

| | |
|---|---|
| ![Living room, morning sun](docs/screenshots/renderer_living_morning.png) | ![The same room after "wallpaper this room in a soft green floral"](docs/screenshots/renderer_living_floral.png) |
| **Walk it.** WASD and drag to look, 1.6 m eye height, real sun through the windows that follows the time of day and the plan's north. | **Say it.** "wallpaper this room in a soft green floral" became one `surface` op; the pattern is drawn procedurally and tiles around the window. |
| ![Primary bedroom at night, lamps on](docs/screenshots/renderer_primary_night.png) | ![Dollhouse view of a home read from a listing screenshot](docs/screenshots/tour_17_extract_plan.png) |
| **Light it.** "it's night, lamps on" switches the sun off and lights the nearest lamps with real point lights, warmth adjustable. | **See it whole.** Tab flips to a dollhouse view. This home was read from a real 2 bed / 2 bath listing screenshot: ten rooms, both bedrooms within 3 % of their labelled areas. |

Things you can say, all exercised by the bench and the QA tour:

- **Furniture**: "put a round table with four chairs in the kitchen", "swap the sofa for a green velvet
  sectional", "two nightstands with lamps", "hang a big mirror over the console", "move the bed to the
  other wall", "I don't like this" while looking at something, "make the rug bigger", "remove all the plants".
- **Finishes**: "paint the living room a warm terracotta", "navy damask in the primary bedroom", "make all
  the floors light oak herringbone", "black and white checkerboard in the kitchen".
- **Light**: "dawn", "golden hour", "it's too dark in here", "make it cozy", "turn off the lamps".
- **Whole rooms**: "furnish bedroom 2 scandinavian", "clear the living room", "furnish the whole place".
- **Moving around**: "take me to the kitchen", "undo", "start over", and questions ("how big is the living room?").

The sentence model is Haiku 5.5: about 0.8 s to the first change, about $0.0002 a sentence, 35/35 on the
bench. Reading a plan is Sonnet 5.5 vision: 6 to 9 s, about $0.02. Both go through the Vercel AI Gateway.

## Run

```bash
nvm use 22
npm install            # add packages with `npx npm@11 install <pkg>` (npm 10 hits an arborist bug here)
npm run dev            # http://localhost:3092 (PORT=3097 npm run dev for another port)
npm test               # node --test over the pure kernel: plan geometry, layout, state, context, kit coverage
npm run typecheck && npm run lint
npm run check:kit      # build every furniture kind headless and check its footprint
npm run bench:intent   # ~35 sentences × 2 homes through Haiku: pass rate, latency, cost
npm run bench:extract  # read every public/samples image through the plan reader and score it
npm run qa -- --port 3097     # Playwright QA tour against the running app (sentences, upload, reload, mobile)
```

`.env` needs `AI_GATEWAY_API_KEY`. Walk with WASD (shift runs), drag to look, double-click to lock the
mouse. Enter focuses the bar, Tab flips walk and plan view, Cmd-Z undoes the last sentence. Paste a
screenshot of a floor plan anywhere on the page (or drop a file, or open the Plan panel); a one-line hint
such as "2 bedroom apartment, dimensions in feet" makes reads noticeably more stable. The home saves to
localStorage; export and import JSON from the ⋯ menu.

## How it works

![The built-in sample plan, drawn by scripts/draw-plan.mjs](docs/screenshots/sample_plan_input.png)

1. **The plan** (`shared/plan/`). Rooms are polygons in metres; walls are derived, never stored, so two
   rooms that share an edge share one wall, and openings sit on edges. `normalizePlan` takes the loose
   shape a vision model writes (feet or metres, sloppy corners, slivers between rooms) and makes it strict.
   A drawn two-bedroom sample ships so there is always a home to walk, and so the plan reader has ground
   truth to be scored against.
2. **The plan reader** (`server/utils/planExtract.ts`). Sonnet with structured output, prompted to make
   rooms tile without gaps, read dimension labels, and attach doors and windows to the rooms they join.
   Open-plan boundaries (a kitchen open to the living room) come back as one full-width opening, and the
   home draws no wall there. Two reads run side by side and a deterministic scorer keeps the better
   (`shared/plan/score.ts`). `connectRooms` adds a door only for a room or group a read left with no way in,
   and says so in the plan's notes. Scores live in `internal_docs/`.
3. **The op language** (`shared/home/ops.ts`). `place | move | remove | restyle | surface | light | furnish
   | goto | undo | reset | say`. Models never do coordinate math: a place is a Spot ("against the north
   wall of the living room", "beside the sofa", "where I'm looking") and a selector names things by kind,
   room, gaze or "what you just placed". Each op is validated on its own; a bad one never loses the sentence.
4. **The kernel** (`shared/home/`). Pure TypeScript, no three.js. Resolves every Spot into metres,
   deterministically and seeded by the sentence, keeping things inside rooms, off door swings and out of
   each other. Every room gets walkways (a clear strip inside each door, lanes between doors) and every
   piece gets its clearance (legroom in front of a sofa, an open side on a bed); placements that would block
   them are refused or moved, and natural placement scores each wall for how livable it is. Moving a bed
   carries its nightstands, lamps and picture; a swapped sofa leaves its replacement in the same spot. Honest notes come back for what did not fit ("put the stove on the east wall instead"). The
   op log is the truth: undo, reload, export and import replay it over the plan.
5. **The brain** (`server/utils/intent.ts`). A cached digest (language, 70-kind catalog, rules, worked
   examples) plus a compact per-sentence context: which room you are in, what you are looking at, each
   room's size, windows and doors, what is in it. Ops stream back as NDJSON as each JSON object closes.
6. **The renderer** (`app/home/`). Shell from the plan (metre UVs, wall pieces cut for doors and
   windows), 70 hand-built low-poly furniture kinds, 13 procedural wall and floor patterns, a sun that
   follows the time of day, a pool of real point lights for the nearest lamps, wall collision, a plan view.
   60 fps on a laptop.

This is Conjure's architecture (speak a world into existence) pointed at interior design. Why build it:
as of October 2026 nobody ships the full loop. Floor-plan-to-3D tools exist, conversational photo
redesign exists, and natural-language editing of a live 3D room is mostly research; the notes with
sources are in `internal_docs/20261017_instant_interiors_v0/research.md`.

## Layout

```
app/components/HomeScene.client.vue   canvas + HUD host; window.__ii for scripts
app/components/hud/                   bar, caption, room chip, plan panel, light popover, history, menu, whisper
app/composables/{useHome,useIntent,usePlan}.ts
app/home/{renderer,shell,lights,look,surfaces,color}.ts, app/home/kit/
shared/plan/{poly,schema,samples}.ts, shared/plan/geometry/{walls,rooms,entry}.ts
shared/home/{ops,types,kinds,select,state,context}.ts, shared/home/layout/{spots,arrange,fit,facing,site,resolve}.ts
shared/{math,models}.ts
server/api/intent.post.ts, server/api/plan/extract.post.ts
server/utils/{gateway,opStream,aiModels,intent,planExtract}.ts
scripts/   draw-plan, bench-extract, kit-check, render-check, shoot, qa (+ lib/harness)
tests/     node --test; fixtures/ holds saved real-plan reads
docs/screenshots/, public/samples/ (plan images + SOURCES.md), internal_docs/ (brief, research, benches)
```

## Known limits

Plan reads still fold small closets (W/D, mech) into the hall about half the time, and reads without a hint
are less stable; each plan is read twice and the cleaner read wins. Tight rooms now refuse a piece rather
than block a walkway, so a small kitchen may seat only one or two chairs at a round table (the dial is
`BLOCK_SHARE` in `shared/home/layout/clear.ts`). Floor pieces can sink a few centimetres into walls. Not
here yet: realtime voice (the browser mic works where SpeechRecognition exists), wall edits ("put a door
here"), furniture collision while walking, a shoppable catalog.
