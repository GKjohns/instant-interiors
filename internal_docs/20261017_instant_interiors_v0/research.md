# Is anyone doing this? (2026-10-17)

The question: paste a floor plan, get a house you can walk through, then change it by talking ("move
this", "wallpaper that", "show me it at sunset"). Three searches plus reading the two closest product pages.

## Verdict

Nobody ships the full loop. The pieces exist separately:

| Capability | Who has it | Notes |
|---|---|---|
| Floor plan image → 3D model | WalkMyHome, Strukt AI, Ritn3D, Aginera, Luw.ai, Getfloorplan, Houzz Pro | Vendor claims; most show an editable model, some only video. Ritn3D makes you review the detected layout first (a good pattern). |
| First-person walk | WalkMyHome, Strukt, Ritn3D (Pro), Luw.ai (1.6 m eye height, doors open on a key) | Standard. |
| Change furniture / finishes | All of the above by click/drag; Planner 5D, Coohom, HomeByMe as full editors | Catalog pickers, "restyle in 1 click" presets. |
| Lighting / time of day | WalkMyHome (sun study with date, time, latitude, north) | A render setting, not a request you can make in words. |
| Natural-language editing of a LIVE 3D room | Luw.ai "Archiagent" (closest), Coohom "AI Home Design chat mode" (unverified) | Luw.ai: an in-editor agent with "40+ browser-side tools… every editor action is a typed, validated tool call, atomic and undoable", pattern library covers wallpaper, parquet, marble. No published examples of "move the sofa"; no voice. |
| Conversational photo redesign | Spacely AI, Remodel AI, Roomagen, InteriorGPT, Collov | 2D image-to-image; not a walkable model. |
| Research prototypes | Chat2Layout (multimodal LLM, iterative furniture layout), LLplace (Llama 3, add/remove by dialogue), INTERIORAGENT, SpatialGrammar (a DSL for LLM scene generation) | Text in, layout out; none start from a drawn plan or run in a browser you walk around in. |

The gap is exactly the Conjure shape: a deterministic op language under a fast model, streamed into a
scene you are standing in, with the plan as the ground truth. Luw.ai is the one to watch; they have the
tool-call architecture but sell it as an editor assistant, not as the way you experience the home.

## Sources

- Luw.ai Studio: https://luw.ai/studio-ai/
- WalkMyHome: https://walkmyhome.ai/
- Strukt AI: https://www.struktai.work/blog/generate-3d-model-from-floor-plan
- Ritn3D: https://www.ritn3d.com/2d-floor-plan-to-3d/
- Aginera floor plan to video: https://aginera.ai/tools/floor-plan-to-video
- Getfloorplan: https://getfloorplan.com/
- Houzz Pro 3D floor plans: https://pro.houzz.com/for-pros/feature-3d-floor-plan
- MeltFlex comparison (vendor-written): https://www.meltflexai.com/blog/best-ai-interior-design-tools-compared
- Remodel AI's free app roundup (vendor-written): https://www.remodelai.io/blog/best-free-ai-3d-floor-plan-apps
- Ritn3D's tool roundup (vendor-written): https://www.ritn3d.com/blog/best-ai-tools-floor-plan-to-3d/
- Planner 5D vs HomeByMe (Capterra): https://www.capterra.com/compare/163482-164022/Homebyme-vs-Planner-5D
- Coohom review (competitor-written): https://genroom.io/blog/coohom-review-best-alternatives
- Chat2Layout: https://www.promptlayer.com/research-papers/chat2layout-interactive-3d-furniture-layout-with-a-multimodal-llm
- LLplace: https://arxiv.org/abs/2406.03866
- INTERIORAGENT: https://cseweb.ucsd.edu/~ravir/kunal_3dv.pdf
- SpatialGrammar: https://arxiv.org/pdf/2604.27555
- Roomagen conversational tool: https://roomagen.com/tools/conversational-ai-interior-design
- InteriorGPT: https://www.interiorgpt.ai/
