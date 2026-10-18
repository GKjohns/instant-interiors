# Instant Interiors v0 — walk a floor plan, change it by talking

Conjure's approach, pointed at interior design: paste or upload a floor plan, the app builds a walkable
3D home from it, and you change it in plain English ("move the sofa under the window", "wallpaper the
bedroom in a soft green floral", "what does the kitchen look like at golden hour"). Conjure's rules carry
over unchanged:

- **Models never do coordinate math.** A fast model (Haiku 5.5 through the AI Gateway) turns one sentence
  into a few flat JSON ops (`shared/home/ops.ts`). A deterministic kernel (`shared/home/state.ts` +
  `layout.ts`) resolves every op into metres, seeded from the sentence so replay is identical.
- **The op log is the truth.** Undo, save and load all replay the log over the plan.
- **Stream, don't wait.** The server streams NDJSON, one op the moment its JSON object closes
  (`server/utils/gateway.ts` + `opStream.ts`, copied from conjure). The client applies each op as it lands.
- **Deictic rule.** "There", "that", "here" mean where you were looking / standing when you STARTED the
  sentence (`OpContext.gaze` / `player`, frozen on first keystroke or speech start).
- **Honesty.** The genie's `say` can only claim what actually changed; the kernel reports notes for what didn't.

What's new vs Conjure: a **plan** (rooms as polygons; walls derived), a **plan reader** (vision model →
`FloorPlan`), **rooms as first-class context** ("the bedroom", "here"), **surfaces** (paint / wallpaper /
floor patterns as procedural textures), **sun + lamps** that follow a time of day, and **wall collision**.

## Repo shape

```
app/
  pages/index.vue → components/HomeScene.client.vue (full-bleed canvas + HUD)
  components/hud/*.vue             bottom text bar, room chip, plan menu, light chips, history/undo
  composables/useHome.ts           HomeState + renderer + history; `run`, `extend`, `undo`, `loadPlan`, `restore`, `snapshot`
  composables/useIntent.ts         sentence + snapshot → /api/intent (NDJSON) → useHome().run/extend (mirror conjure's)
  composables/usePlan.ts           upload → /api/plan/extract → useHome().loadPlan
  home/renderer.ts                 three.js: shell from plan, furniture from kit, walk + plan views, sun/lamps
  home/look.ts                     mouse/touch look + WASD (copied from conjure; adapt)
  home/surfaces.ts                 procedural CanvasTextures for PATTERNS (walls / floors / ceilings)
  home/kit/{helpers,index,...}.ts  one Build per catalog kind (helpers.ts copied from conjure)
shared/
  plan/poly.ts                     2D helpers (DONE)
  plan/schema.ts                   FloorPlan / LoosePlan / normalizePlan / defaultSurfaces / roomTypeOf (DONE)
  plan/samples.ts                  TWO_BED_APARTMENT (DONE; add more)
  plan/geometry.ts                 walls from rooms, openings cut in, bounds, roomAt(point), spots on walls
  home/ops.ts                      the op language + strict parseOps (DONE)
  home/types.ts                    Item / Light / HomeState / OpContext / Effects / BatchResult (DONE)
  home/kinds.ts                    catalog (footprints, natural places), aliases, FURNISH defaults, STYLES (DONE)
  home/select.ts                   selectors → items; resolveRoom(plan, ref, ctx)
  home/layout.ts                   Spot → pos/yaw, de-overlap, keep-inside-room, arrangements
  home/state.ts                    createHome(plan), applyOp, applyBatch, extendLastBatch, undo, replayLog, export/import
  home/context.ts                  trimScene(state) → Scene; buildContext(scene, ctx) → the per-sentence text block
server/
  utils/gateway.ts, opStream.ts, aiModels.ts   (DONE, copied from conjure)
  utils/intent.ts                  the cached digest (language, catalog, rules, worked examples) + streamIntent
  utils/planExtract.ts             image → LoosePlan via Sonnet vision (generateText + Output.object) → normalizePlan
  api/intent.post.ts               POST { text, state, ctx } → NDJSON
  api/plan/extract.post.ts         POST { image: dataURL, hint? } → { plan, notes } | { error }
scripts/draw-plan.mjs              FloorPlan → SVG/PNG (ground-truth images for the extract bench)
scripts/bench-extract.mjs          PNGs → /api or planExtract directly → score vs samples
scripts/shoot.mjs                  Playwright screenshots
tests/*.test.ts                    node --test over the pure kernel (no three.js)
public/samples/*.png               floor plan images (desktop_2br.png is a real 2BR apartment screenshot)
```

Run: `nvm use 22 && npm run dev` → http://localhost:3092. `npm test`, `npm run typecheck`, `npm run lint`.
`.env` has `AI_GATEWAY_API_KEY` (copied from conjure). Add packages with `npx npm@11 install <pkg>`.

## Frames and conventions

- **Plan frame** = three.js x/z. Metres. x right, z DOWN the drawing (top of drawing = -z = north unless
  `plan.north` says otherwise). y is up; floors sit at y = 0; ceilings at `plan.ceiling`.
- **Polygons** wind clockwise on the drawing (positive `signedArea`). `nearestEdge().normal` points OUT of the room.
- **Yaw** (items and player): radians, 0 faces -z, positive turns toward -x (three.js `rotation.y`).
  An item's **front** is its local +z face (kit builders face +z like conjure's); `yaw = yawToward(pos, target)`
  turns the front toward `target`... careful: `yawToward` in poly.ts returns the yaw whose FORWARD (-z local)
  points at the target. For a kit piece whose front is +z, add π. layout.ts owns this: it exposes
  `faceToward(pos, target)` and everyone else uses that.
- **Footprint** `[length, width]`: length along the front (local x), width front-to-back (local z).
  `props.length / props.width` override for `sized` kinds; `props.scale` multiplies everything.
- **Walls** are 0.12 m thick between rooms, 0.25 m on the exterior. The wall's centreline is the shared
  polygon edge; each room's floor polygon is the full edge (walls overlap floors slightly, fine).
- **Ids**: items `sofa#3`; groups `g7`; rooms from the plan (`living`, `bedroom_2`). "outside" is a reserved room id.

## The kernel API (shared/home/state.ts) — what the app side calls

```ts
createHome(plan: FloorPlan, opts?: { furnish?: boolean }): HomeState      // furnish = run FURNISH defaults for every room, logged as batch g1 "furnished"
applyOp(state, op, ctx): { state, effects }                                // pure
applyBatch(state, raw: unknown, label: string, ctx: OpContext): BatchResult  // parseOps → applyOp each → logs one Batch (unless undo/reset)
extendLastBatch(state, batchId, at, ops: Op[]): BatchResult | null         // a later op from the same sentence joins its batch
undo(state): { state, effects }                                            // pop the last batch, replay the log
replayLog(plan, log: Batch[]): HomeState
exportHome(state): SavedHome   { v, plan, log }
importHome(saved: unknown): HomeState | null
diffItems(a, b): Effects-ish (for the renderer's sync)
```

Placement rules (layout.ts), all deterministic and seeded by `ctx.seed` + op index:
- `where` omitted → the kind's natural place (`KIT[kind].place`): wall = against the longest free wall
  stretch (prefer walls without openings; never block a door swing or a window for tall things); corner =
  a free corner; center = room centroid (rugs under the seating group if any); window = centred on the
  room's largest window; ceiling = centroid at ceiling height; wall_mounted = on a wall at `hang`.
- `near` + `of` + `side`: relative to the anchor's footprint and yaw (front/behind/left/right/opposite/beside/on).
  `on` = on top of the anchor (nightstand lamp, TV on stand, mirror above vanity on its wall).
- `count` + `arrange`: row along the wall / around a table / pair flanking / cluster.
- Keep inside the room (shrink toward centroid until the footprint fits), de-overlap against existing items
  (slide along the wall or nudge), skip with a note if nothing fits.
- `face`: room = front toward the room centroid; wall = back to the nearest wall; anchor = toward `of`.
- Room resolution (`select.ts resolveRoom`): exact id → name match → type match (first by area) →
  'here' / omitted = ctx.player.room → ctx.gaze.room → the largest room. 'all' = every room (surface/furnish).

## The renderer API (app/home/renderer.ts) — what composables call

```ts
class HomeRenderer {
  constructor(host: HTMLElement)
  camera: THREE.PerspectiveCamera; yaw: number; pitch: number
  sync(state: HomeState, effects?: Effects): void   // rebuild shell if plan changed (plan.id + JSON hash of rooms/openings/surfaces), diff items by id, light
  setMode(mode: 'walk' | 'plan'): void               // walk = first person 1.6 m; plan = top-down orbit "dollhouse" (ceilings hidden)
  mode: 'walk' | 'plan'
  gaze(): { point: Vec2, itemId?: string, room?: string }   // raycast from screen centre to floor/item
  player(): { pos: Vec2, yaw: number, room?: string }
  look(yaw: number, pitch: number, pos?: Vec2): void
  teleport(pos: Vec2, yaw?: number): void            // glide over ~600 ms
  spawn(plan: FloorPlan): void                        // stand just inside the entry door facing in (or the largest room's centre)
  highlight(itemId: string | null): void             // hover outline on the looked-at item
  toScreen(p: Vec2, y?: number): { x: number, y: number, visible: boolean }
  anticipate(point: Vec2 | null): void               // soft glow where you're looking while typing (optional)
  dispose(): void
}
```

Lighting: a directional sun whose azimuth/elevation/colour follow `light.time` (dawn → night) rotated by
`plan.north`; sky/ground hemisphere light; window panes glow by time; every `light: true` item gets a
pooled point light when `light.lamps` is on (cap ~12 nearest to the player; the rest emissive only);
`warmth` tints lamps. Night = sun off, lamps on by default. Shadows: sun only, PCFSoft, modest map size.

Walls: boxes per wall piece, with openings cut as splits (left piece, right piece, header above a door,
header + apron around a window). Door frames + an open door leaf; window frames + glass. Baseboards.
Collision: circle (r 0.3) vs wall pieces in the plan frame, slide along, doorways pass through naturally.

## Sprints and ownership

Wave 1 (parallel):
- **A — kernel**: `shared/plan/geometry.ts`, `shared/home/{select,layout,state}.ts`, `tests/{geometry,layout,state}.test.ts`.
- **B — kit**: `app/home/kit/*.ts` (every CATALOG kind), `app/home/surfaces.ts`, `scripts/kit-check.mjs` (builds every kind headless).
- **C — brain + plan reader**: `shared/home/context.ts`, `server/utils/{intent,planExtract}.ts`, `server/api/intent.post.ts`,
  `server/api/plan/extract.post.ts`, `scripts/{draw-plan,bench-extract}.mjs`, more sample images in `public/samples/`,
  `tests/{context,opstream}.test.ts`. Must prove: `public/samples/desktop_2br.png` → a sane FloorPlan.

Wave 2 (parallel): **D1 — renderer** (`app/home/renderer.ts`, `look.ts`), **D2 — app** (composables, HUD, page, shoot script).
Wave 3: **E — verification** (typecheck, lint, tests, Playwright walkthrough with real sentences, screenshots into this folder).

House rules: no new dependencies without cause; everything in `shared/` stays free of three.js and Nitro
globals; explicit `.ts` import extensions in `shared/` and `server/utils/` (node --test runs them raw);
comments say why, not what; `npm run lint` and `npm run typecheck` must stay green in your files.
