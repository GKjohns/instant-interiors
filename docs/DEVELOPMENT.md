# Development notes

Working notes for people changing the code. The README covers what the project is and how to run it.

## Commands

```bash
nvm use 22
npm install            # add packages with `npx npm@11 install <pkg>` (npm 10 hits an arborist bug here)
npm run dev            # http://localhost:3092 (PORT=3097 npm run dev for another port)
npm test               # node --test over the pure kernel: plan geometry, layout, state, context, kit coverage
npm run typecheck && npm run lint
npm run check:kit      # build every furniture kind headless and check its footprint
npm run bench:intent   # ~35 sentences x 2 homes through Haiku: pass rate, latency, cost
npm run bench:extract  # read every public/samples image through the plan reader and score it
npm run qa -- --port 3097     # Playwright QA tour against the running app (sentences, upload, reload, mobile)
```

`public/samples/desktop_2br.png` (a real listing screenshot) is gitignored. Drop your own listing
screenshot at that path to run the desktop case in `bench:extract` and the QA upload step.

## Layout

```
app/components/HomeScene.client.vue   canvas + HUD host; window.__ii for scripts
app/components/hud/                   bar, caption, room chip, plan panel, light popover, history, menu, whisper
app/composables/{useHome,useIntent,usePlan}.ts
app/home/{renderer,shell,lights,look,surfaces,color}.ts, app/home/kit/
shared/plan/{poly,schema,samples,score}.ts, shared/plan/geometry/{walls,rooms,entry}.ts
shared/home/{ops,types,kinds,select,state,context}.ts
shared/home/layout/{spots,arrange,fit,facing,site,resolve,clear,score}.ts
shared/{math,models}.ts
server/api/intent.post.ts, server/api/plan/extract.post.ts
server/utils/{gateway,opStream,aiModels,intent,planExtract}.ts
scripts/   draw-plan, bench-extract, kit-check, render-check, shoot, qa (+ lib/harness)
tests/     node --test; fixtures/ holds saved real-plan reads
docs/screenshots/, public/samples/ (plan images + SOURCES.md)
```

## Tuning dials

- `BLOCK_SHARE` in `shared/home/layout/clear.ts`: how much of a piece may overlap a walkway before the
  placement is refused or moved. Tight rooms refuse pieces rather than block a walkway, so a small kitchen
  may seat only one or two chairs at a round table.

## Project notes

`internal_docs/20261017_instant_interiors_v0/` holds the v0 brief and plan, the competitive research with
sources (`research.md`), the intent bench (`intent_bench.md`), plan-reader scores (`extract/`) and the QA
report.
