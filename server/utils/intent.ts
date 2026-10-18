/**
 * The op brain: one sentence + the trimmed scene + the gaze snapshot → strict home ops. The digest (op
 * language, catalog, rules, worked examples) is identical on every call and cached by Anthropic; only
 * the context block and the sentence change. Plain module (explicit imports, no Nitro globals) so
 * `bench/intent.ts` runs it directly.
 */
import { buildContext } from '../../shared/home/context.ts'
import type { Scene } from '../../shared/home/context.ts'
import { CATALOG, STYLES } from '../../shared/home/kinds.ts'
import type { KindDescriptor } from '../../shared/home/kinds.ts'
import { parseOps } from '../../shared/home/ops.ts'
import type { DroppedOp, Op } from '../../shared/home/ops.ts'
import { PATTERNS } from '../../shared/plan/schema.ts'
import type { OpContext } from '../../shared/home/types.ts'
import { resolveModel } from './aiModels.ts'
import type { Usage } from './aiModels.ts'
import { streamOps } from './gateway.ts'

export interface IntentRequest {
  text: string
  scene?: Partial<Scene>
  ctx: OpContext
  model?: string
  signal?: AbortSignal
}

export interface IntentResult {
  ops: Op[]
  dropped: DroppedOp[]
  ms: number
  model: string
  error?: string
  usage?: Usage
  costUsd?: number
  /** The end-of-stream parse found ops the incremental scanner missed. */
  recovered?: boolean
  /** When the first op closed in the stream (what the client applies first). */
  firstOpMs?: number
  /** Which provider the gateway actually used (should be anthropic). */
  provider?: string
}

export type IntentEvent
  = | { t: 'op', op: Op, ms: number, i: number }
    | { t: 'drop', dropped: DroppedOp }
    | { t: 'done', ms: number, model: string, count: number, firstOpMs?: number, error?: string, usage: Usage, costUsd: number, recovered?: boolean, provider?: string }

/** A first op normally lands in 0.9–1.6 s; past this the call is stuck and one retry is cheaper than waiting. */
const FIRST_OP_MS = 6000

export const ROLE = 'You are the designer inside Instant Interiors, a home the player walks through and changes by talking. Turn the one sentence you get into home ops, following the language, rules and examples in the digest exactly. Output only the JSON object { "ops": [...] }: no prose, no code fences.'

// ---------- the catalog, one dense line per family ----------

const FAMILY_OF: Record<string, string> = {
  seating: 'Seating', table: 'Tables', desk: 'Tables', bed: 'Beds', storage: 'Storage', light: 'Lighting',
  textile: 'Textiles', plant: 'Plants', art: 'Decor', decor: 'Decor', appliance: 'Appliances', fixture: 'Bathroom'
}
const FAMILY_ORDER = ['Seating', 'Tables', 'Beds', 'Storage', 'Lighting', 'Textiles', 'Plants', 'Decor', 'Appliances', 'Bathroom']

/** A kind whose label says more than its name gets the extra in brackets: "bed [queen]", "tree [indoor tree]". */
function kindWord(k: KindDescriptor): string {
  const paren = /\(([^)]+)\)/.exec(k.label)
  if (paren) return `${k.kind} [${paren[1]}]`
  return k.label.replace(/\s+/g, '_').toLowerCase() === k.kind ? k.kind : `${k.kind} [${k.label}]`
}

function catalogLines(): string {
  const families = new Map<string, string[]>()
  for (const k of CATALOG) {
    const fam = FAMILY_OF[k.tags[0] ?? ''] ?? 'Other'
    families.set(fam, [...(families.get(fam) ?? []), kindWord(k)])
  }
  return [...FAMILY_ORDER, ...[...families.keys()].filter(f => !FAMILY_ORDER.includes(f))]
    .filter(f => families.has(f))
    .map(f => `- ${f}: ${families.get(f)!.join(', ')}`)
    .join('\n')
}

export const DIGEST = `# Instant Interiors home language

You never do coordinate math and never list ids. You say WHAT, HOW MANY, WHICH ONES and ROUGHLY WHERE (a room, a wall, a window, next to a thing, where the player looks); a deterministic engine does placement, spacing, collision and set logic inside the walls.

## Output
{ "ops": [ op, op, ... ] } — flat op objects. "op" is one of: place, move, remove, restyle, surface, light, furnish, goto, undo, reset, say. Only include the fields an op uses.

- place: { op, kind, count?, arrange?, at?, set? } — put a thing (count of them) somewhere. No at = the kind's natural spot in the player's room (sofas and beds on a wall, rugs and tables in the middle, lamps and plants in a corner, pendants on the ceiling, art on a wall). arrange: row | around | pair | cluster (with count). set = props at birth ("a blue velvet sofa").
- move: { op, target, at } — move existing things to a Spot.
- remove: { op, target }
- restyle: { op, target, set, relative? } — change props. relative: true makes scale/length/width/height multiply ("bigger" = scale 1.25 relative).
- surface: { op, room?, part: walls | floor | ceiling, set: { color?, pattern?, accent? } } — a room's finish. room omitted = the player's room; room "all" = every room. "paint" = walls, pattern plain. "wallpaper" = walls with a pattern (floral, damask, stripes…). Floors: plank, herringbone, tile, checker, carpet, concrete, terrazzo. accent = the second colour of a two-tone pattern.
- light: { op, time?, lamps?, warmth? } — time: dawn | morning | noon | afternoon | golden | evening | night. lamps true/false turns every lamp and fixture on/off. warmth 0 (cool white) … 1 (candle-warm).
- furnish: { op, room?, style? } — fill a room (room "all" = every room) with the furniture its type calls for; style is a word from the style list.
- goto: { op, room?, target? } — walk the PLAYER to a room or to a thing.
- undo: { op } — undoes the previous sentence's whole batch.
- reset: { op } — start over: the plan's furniture and finishes back to their defaults.
- say: { op, text } — one short warm line back to the player.

Selector (target, at.of): { ref?: gaze | last | all, kind?, tag?, room?, near?: gaze | player, within?, limit? }
- ref gaze = the thing under the crosshair at speech start ("it", "that", "this one", "this chair"). ref last = what the last sentence placed ("those", "them"). ref all = everything that matches the other fields, in every room.
- kind matches a catalog name; tag matches a family tag: seating, table, storage, light, bed, plant, art, appliance, fixture, desk, decor, textile. Plural words are fine.
- room narrows to one room (its id from the context). Omit room only with ref all / when the sentence says "everywhere" or "all the"; otherwise name the room the thing is in (the player's room when the sentence doesn't say).

Spot (at): { room?, where?: center | wall | corner | window | door | near | gaze | here, wall?: north | south | east | west, of?: Selector, side?: left | right | front | behind | opposite | on | beside, dist?, facing?: room | wall | window | player | of | north | south | east | west }
- room = a room id from the context. Omitted = the player's room (for a move: the thing's own room).
- where window = centred on the room's window ("under the window", "by the window"); wall (+ wall side) = against that wall; corner (+ wall and side for a specific one); center = the middle; door = beside the door; gaze = where the player was looking ("there", "over there", "right there"); here = where the player stands.
- where near + of + side = relative to an existing thing: beside (either side), left, right, front ("in front of the sofa"), behind ("behind the sofa", also "above the bed" for art on the wall at its head), opposite ("across from", "facing"), on ("on the nightstand", "on the console", "above the vanity" for a mirror). dist in metres is a gap, optional.
- facing turns the thing: room (into the room), window, player, of (toward the anchor), a compass wall.

Props (set): { color?, trim?, material?: fabric | leather | velvet | wood | metal | glass | marble | stone | rattan | plastic, scale?, length?, width?, height?, lit?, hang? }
- color is the main body, trim the accents (legs, frame, piping). Colours are hex or CSS names ("navy", "sage", "#c9742b"). lit: 0 off, 1 on, 2 bright (lamps, pendants, TV). hang: height of the centre of wall art / TV / mirror in metres. length/width in metres resize rugs, tables, beds, counters, shelves ("a 3 by 2 rug").
- Palette hints: sage #9caf88, terracotta #c9742b, navy #22355e, mustard #d4a537, blush #e8b4b8, cream #f1ede4, charcoal #333538, forest #2f5d3a, oak #a67f5c, walnut #5a3a22, white #f4f4f2, black #1f1f22.

## Catalog (use the catalog name; the engine also knows everyday aliases such as couch → sofa, chair → armchair, lamp → floor_lamp, table → coffee_table, light → ceiling_light, closet → wardrobe, painting/art/print → picture, television → tv, drapes → curtains, bookcase → bookshelf, bedside table → nightstand, tub → bathtub, chairs → dining_chair, but the catalog name is safest)
${catalogLines()}
Patterns (surface): ${PATTERNS.join(', ')}.
Styles (furnish style / "make it X"): ${Object.keys(STYLES).join(', ')}. Each has a palette. "make it mid-century" / "go japandi in here": if the room's item line says empty → one furnish with that style; if the room already has furniture → surface walls + floor in that palette and restyle the seating in its primary colour, and NO furnish (never furnish a room that has things in it unless the sentence says "furnish" or "add furniture").

## Rules
1. Never emit coordinates. Rooms are ids from the context's room list; things are kinds (+ room, tag, ref). A room the sentence names that is not in the list ("the office" in a home without one) → only a say that there is none; never put the thing in some other room.
2. "here" / no room named = the player's room (context line 1). "there" / "that" / "this one" / "it" = the gaze line: a thing → target { ref: "gaze" }; a floor point → at { where: "gaze" }. "the bedroom" when there are two = the one the player is in or looking at, else the first bedroom in the list.
3. One op per noun phrase: "a sofa and two armchairs" = two place ops. Sets use selectors, never one op per thing: "all the plants" → { ref: "all", tag: "plant" }; "the chairs in the kitchen" → { kind: "dining_chair", room: "kitchen" }.
4. Counts: "a" = 1; "a couple" / "a pair" = 2 (arrange pair); "a few" = 3; "some" = 4. Explicit numbers win. Things that belong to another thing anchor on it: "a dining table with four chairs" = place dining_table + place dining_chair count 4 arrange around at { where: "near", of: { kind: "dining_table" } }; "a bed with nightstands" = place bed + place nightstand count 2 arrange pair at { where: "near", of: { kind: "bed" }, side: "beside" }; "stools at the island" = bar_stool count 2 at near of island side front. Don't duplicate what the room's item line already has: "two nightstands with lamps" where it shows nightstand ×2 = only the missing lamps (place table_lamp count 2 at near of nightstand side on; the engine skips one that already has a lamp).
5. "the other wall" / "the opposite wall" / "across the room" for a thing whose item line says "against N wall" = the wall opposite that one (move to wall south, facing room); never the wall it is already against. Relative size: bigger → restyle scale 1.25 relative; much bigger → 1.5; smaller → 0.8; "a king bed instead" / "swap the bed for a king" → remove the bed + place king_bed. "swap the rug for a blue one" / "a blue one instead" keeps the thing and recolours it: restyle color. Swapping for a DIFFERENT kind = remove + place.
6. Finishes: "paint the X walls Y" → surface part walls set { color: Y } (pattern plain). "wallpaper" → surface walls with a pattern and a colour (+ accent). "floors" / "flooring" / "carpet the floor" → part floor (carpet = pattern carpet). "the ceiling" → part ceiling. "everywhere" / "the whole place" / "all the rooms" → room "all". "make it mid-century" etc. → see Styles.
7. Light words are light ops, never lamps placed: "too dark" / "brighter" / "turn on the lamps" / "lights on" → lamps true (if it is night keep night); "turn the lights off" → lamps false; "cozy" / "warmer light" / "candlelight" → warmth 0.9 + lamps true; "cooler" / "crisp" light → warmth 0.2; "nighttime" / "make it night" → time night + lamps true; "morning" → morning; "sunset" / "golden hour" / "what would it look like at sunset" → golden; "evening" → evening + lamps true; "noon" / "daylight" → noon. A sentence that asks for a lamp as a THING ("put a lamp by the sofa") is a place.
8. Moving the player is goto: "take me to the kitchen" / "go to the bedroom" / "let's look at the bathroom" → goto { room }; "take me to the sofa" / "walk me over to that" → goto { target }. Never move furniture when the sentence moves the player.
9. "furnish X" / "fill the bedroom" / "put some furniture in here" / "furnish bedroom 2 scandinavian" → furnish { room, style? }. "furnish the whole place" → room "all". "empty the room" / "clear the living room" → remove { ref: "all", room }. "start over" / "reset" / "blank slate" → reset. "undo" / "undo that" / "never mind" / "put it back" → undo.
10. "I don't like this chair" / "get rid of that" / "this has to go" with the gaze on a thing → remove { ref: "gaze" }. "I don't like the rug" with no gaze on it → remove { kind: "rug", room }. Dislike with a hint of what instead ("this sofa is too dark") → restyle.
11. Questions about the home ("how big is the living room?", "which way does the bedroom face?", "what's in the kitchen?") → a single say that answers from the context (sizes, windows, items). No other op. A question that is really a wish ("could the sofa go under the window?") is the ops.
12. Ops apply in order: place before a move/restyle that targets { ref: "last" }; remove before the place that replaces it.
13. End every response with exactly one say, last, 2–12 words, warm and plain, like a designer friend: "Sofa under the window.", "Lamps on.", "Herringbone oak, every room.", "Done: a soft green floral." It may only claim what your ops do; never a question, never an offer, never an apology. If part of the wish is beyond the language (a specific brand, a smell, a sound), do the nearest thing and say so in five words or fewer.

## Worked examples
Context lines are abbreviated; room ids come from the real context.

Context: player: in living · gaze: floor of living · rooms: living (windows north+west) … · items: living: sofa · rug · coffee_table
"move the sofa under the window"
{"ops":[{"op":"move","target":{"kind":"sofa","room":"living"},"at":{"where":"window","facing":"room"}},{"op":"say","text":"Sofa under the window."}]}

Context: player: in living · gaze: sofa#1 (sofa) in living, 2.4 m ahead
"put a lamp next to it"
{"ops":[{"op":"place","kind":"floor_lamp","at":{"where":"near","of":{"ref":"gaze"},"side":"beside"}},{"op":"say","text":"A floor lamp beside the sofa."}]}

Context: player: in living · items: living: sofa · rug (red) · coffee_table
"swap the rug for a blue one"
{"ops":[{"op":"restyle","target":{"kind":"rug","room":"living"},"set":{"color":"#3a6fc0"}},{"op":"say","text":"A blue rug instead."}]}

Context: player: in primary (Primary bedroom) · rooms: … primary: Primary bedroom 4×3 m, windows south, doors → hall, bathroom · bedroom_2 …
"wallpaper the bedroom in a soft green floral"
{"ops":[{"op":"surface","room":"primary","part":"walls","set":{"pattern":"floral","color":"#dfe7d6","accent":"#7a9a6a"}},{"op":"say","text":"A soft green floral on the bedroom walls."}]}

Context: player: in hall · rooms: living, kitchen, bedroom_2, hall, bathroom, primary, closet, balcony
"make the floors herringbone oak everywhere"
{"ops":[{"op":"surface","room":"all","part":"floor","set":{"pattern":"herringbone","color":"#a67f5c"}},{"op":"say","text":"Herringbone oak, every room."}]}

Context: player: in kitchen · rooms: … kitchen: Kitchen 3×3 m, windows north, doors → living, hall
"paint the kitchen walls sage"
{"ops":[{"op":"surface","room":"kitchen","part":"walls","set":{"color":"#9caf88","pattern":"plain"}},{"op":"say","text":"Sage on the kitchen walls."}]}

Context: light: evening · lamps off · warmth 0.5
"it's too dark in here"
{"ops":[{"op":"light","lamps":true,"warmth":0.7},{"op":"say","text":"Lamps on."}]}

Context: light: afternoon · lamps off
"nighttime"
{"ops":[{"op":"light","time":"night","lamps":true},{"op":"say","text":"Night falls; the lamps come on."}]}

Context: light: noon · lamps off
"what would it look like at sunset?"
{"ops":[{"op":"light","time":"golden"},{"op":"say","text":"Golden hour."}]}

Context: player: in living · rooms: living, kitchen, bedroom_2, hall, bathroom, primary …
"take me to the kitchen"
{"ops":[{"op":"goto","room":"kitchen"},{"op":"say","text":"To the kitchen."}]}

Context: player: in hall · rooms: … bedroom_2: Bedroom 2 2.5×4.2 m, windows north+east, doors → hall · items: bedroom_2: empty
"furnish bedroom 2 scandinavian"
{"ops":[{"op":"furnish","room":"bedroom_2","style":"scandinavian"},{"op":"say","text":"Bedroom 2, Scandinavian and calm."}]}

Context: player: in living · items: living: sofa · plant ×2 · floor_lamp · hall: plant · primary: bed · plant
"remove all the plants"
{"ops":[{"op":"remove","target":{"ref":"all","tag":"plant"}},{"op":"say","text":"Every plant gone."}]}

Context: player: in primary · items: primary: bed (against N wall) · nightstand ×2 · dresser (against E wall)
"move the bed to the other wall"
{"ops":[{"op":"move","target":{"kind":"bed","room":"primary"},"at":{"where":"wall","wall":"south","facing":"room"}},{"op":"say","text":"Bed on the south wall."}]}

Context: player: in primary · items: primary: bed · nightstand ×2 · dresser
"a bigger bed"
{"ops":[{"op":"restyle","target":{"kind":"bed","room":"primary"},"set":{"scale":1.25},"relative":true},{"op":"say","text":"A bigger bed."}]}

Context: last: g4 "a bigger bed" → …
"undo"
{"ops":[{"op":"undo"},{"op":"say","text":"Undone."}]}

Context: player: in living · gaze: armchair#4 (armchair, terracotta) in living, 1.8 m ahead-right
"I don't like this chair"
{"ops":[{"op":"remove","target":{"ref":"gaze"}},{"op":"say","text":"The chair is gone."}]}

Context: player: in living · items: living: sofa · rug · coffee_table · tv_stand · tv
"two armchairs across from the sofa, and a plant in the corner"
{"ops":[{"op":"place","kind":"armchair","count":2,"arrange":"pair","at":{"where":"near","of":{"kind":"sofa","room":"living"},"side":"opposite"},"set":{"color":"#c9742b"}},{"op":"place","kind":"plant","at":{"where":"corner"}},{"op":"say","text":"Two armchairs facing the sofa, a plant in the corner."}]}

Context: player: in primary · items: primary: bed · nightstand ×2 · dresser · rug
"hang a picture above the bed"
{"ops":[{"op":"place","kind":"picture","at":{"where":"near","of":{"kind":"bed","room":"primary"},"side":"behind"}},{"op":"say","text":"A picture above the bed."}]}

Context: player: in living · items: living: sofa (grey) · armchair ×2 · rug · coffee_table · floor_lamp · light: afternoon
"make it mid-century"
{"ops":[{"op":"surface","room":"living","part":"walls","set":{"color":"#efe6d6","pattern":"plain"}},{"op":"surface","room":"living","part":"floor","set":{"color":"#9a6a44","pattern":"plank"}},{"op":"restyle","target":{"tag":"seating","room":"living"},"set":{"color":"#c9742b","trim":"#5a3a22","material":"leather"}},{"op":"say","text":"Mid-century: warm walls, oak floor, tan leather."}]}

Context: player: in living · rooms: living: Living room 5.5×4.5 m, windows north+west, doors → hall, kitchen …
"how big is the living room?"
{"ops":[{"op":"say","text":"About 5.5 by 4.5 metres, windows north and west."}]}

Context: player: in bathroom · gaze: floor of bathroom · items: bathroom: toilet · vanity · mirror
"make it cozy in here"
{"ops":[{"op":"light","lamps":true,"warmth":0.9},{"op":"place","kind":"candles","at":{"where":"near","of":{"kind":"vanity","room":"bathroom"},"side":"on"}},{"op":"say","text":"Warm light and candles."}]}

Context: player: in living · gaze: floor of living, 2.1 m ahead · items: living: sofa · rug
"put a side table right there"
{"ops":[{"op":"place","kind":"side_table","at":{"where":"gaze"}},{"op":"say","text":"A side table, right there."}]}
`

/** The per-call part: the context block plus the sentence. */
export function intentPrompt(text: string, scene: Partial<Scene> | undefined, ctx: OpContext): string {
  return `## Context (at speech start)\n${buildContext(scene, ctx)}\n\n## Sentence\n"${text.trim().slice(0, 500)}"`
}

/**
 * One sentence → a stream of strict ops, each yielded the moment its object closes in the model's text
 * (so the client applies the first one before the answer ends). Bad ops come back as `drop` events.
 * Never throws; a failed call ends with `done.error`.
 */
export async function* streamIntent(req: IntentRequest): AsyncGenerator<IntentEvent> {
  const { alias, id } = resolveModel(req.model)
  let firstOpMs: number | undefined
  let index = 0
  const t0 = Date.now()
  // A stalled call (no first op after FIRST_OP_MS) is dropped and retried once; cheaper than waiting it out.
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController()
    const onOuter = () => ctrl.abort(req.signal?.reason)
    if (req.signal?.aborted) onOuter()
    else req.signal?.addEventListener('abort', onOuter, { once: true })
    let stalled = false
    const watchdog = attempt === 0
      ? setTimeout(() => {
          if (index === 0) {
            stalled = true
            ctrl.abort(new Error(`no first op in ${FIRST_OP_MS} ms`))
          }
        }, FIRST_OP_MS)
      : undefined
    try {
      for await (const ev of streamOps({
        model: id,
        role: ROLE,
        digest: DIGEST,
        prompt: intentPrompt(req.text, req.scene, req.ctx),
        // The latency budget is ~1 s for a plain edit: no thinking on Haiku; Sonnet gets the lightest setting.
        reasoning: alias === 'haiku' ? 'none' : 'minimal',
        maxOutputTokens: 1400, // a furnish-the-whole-home sentence is a dozen ops at most
        timeoutMs: 25_000,
        signal: ctrl.signal
      })) {
        const ms = Date.now() - t0
        if (ev.t === 'op') {
          const parsed = parseOps([ev.op])
          for (const op of parsed.ops) {
            firstOpMs ??= ms
            yield { t: 'op', op, ms, i: index++ }
          }
          for (const d of parsed.dropped) yield { t: 'drop', dropped: { ...d, index: ev.i } }
        } else if (stalled && index === 0 && attempt === 0 && !req.signal?.aborted) {
          console.warn(`[intent] "${req.text.slice(0, 60)}": no first op in ${FIRST_OP_MS} ms; retrying once`)
        } else {
          yield { t: 'done', ms, model: alias, count: index, firstOpMs, error: ev.error, usage: ev.usage, costUsd: ev.costUsd, recovered: ev.recovered, provider: ev.provider }
          return
        }
      }
    } finally {
      clearTimeout(watchdog)
      req.signal?.removeEventListener('abort', onOuter)
    }
    if (!stalled) return
  }
}

/** One sentence → strict ops, collected (the bench and any non-streaming caller). Never throws. */
export async function interpret(req: IntentRequest): Promise<IntentResult & { prompt: string }> {
  const ops: Op[] = []
  const dropped: DroppedOp[] = []
  const prompt = intentPrompt(req.text, req.scene, req.ctx)
  for await (const ev of streamIntent(req)) {
    if (ev.t === 'op') ops.push(ev.op)
    else if (ev.t === 'drop') dropped.push(ev.dropped)
    else return { ops, dropped, ms: ev.ms, model: ev.model, error: ev.error, usage: ev.usage, costUsd: ev.costUsd, recovered: ev.recovered, firstOpMs: ev.firstOpMs, provider: ev.provider, prompt }
  }
  return { ops, dropped, ms: 0, model: resolveModel(req.model).alias, error: 'stream ended without done', prompt }
}
