/**
 * The plan reader: a floor-plan image → a LoosePlan (Sonnet vision through the Vercel AI Gateway) →
 * `normalizePlan` → a strict FloorPlan. Structured output first (`generateText` + `Output.object`); if the
 * gateway or Anthropic refuses the schema, the same prompt runs again as JSON-in-text and `parseLooseJson`
 * recovers the object. Two reads run side by side and `chooseRead` (shared/plan/score.ts) keeps the better,
 * because one read alone varies run to run. Plain module (explicit imports, no Nitro globals) so
 * `scripts/bench-extract.mjs` runs it directly. Never throws: every failure is `{ ok: false, reason }`.
 */
import { generateText, Output } from 'ai'
import { connectRooms } from '../../shared/plan/geometry.ts'
import { LoosePlanSchema, normalizePlan, ROOM_TYPES } from '../../shared/plan/schema.ts'
import { chooseRead } from '../../shared/plan/score.ts'
import type { ReadScore } from '../../shared/plan/score.ts'
import type { FloorPlan, LoosePlan } from '../../shared/plan/schema.ts'
import { PLAN_MODEL } from '../../shared/models.ts'
import { costUsd, resolveModel } from './aiModels.ts'
import type { Usage } from './aiModels.ts'
import type { Reasoning } from './gateway.ts'
import { parseLooseJson } from './opStream.ts'

export type ExtractPath = 'object' | 'text'

export type ReadId = 'a' | 'b'

export type ExtractResult
  = | {
    ok: true
    plan: FloorPlan
    loose: LoosePlan
    notes: string[]
    ms: number
    /** Every attempt of every read. */
    costUsd: number
    usage: Usage
    path: ExtractPath
    model: string
    /** How many reads ran, which one was kept, and how each scored (null = that read failed). */
    reads: 1 | 2
    chosen: ReadId
    scores: Partial<Record<ReadId, ReadScore | null>>
  }
  | { ok: false, reason: string, ms: number, costUsd?: number, path?: ExtractPath }

export interface ExtractOptions {
  /** A data URL, bare base64, or the raw bytes. */
  image: string | Buffer
  /** What the user said about the plan ("a 2-bedroom apartment; labels are feet"). */
  hint?: string
  model?: string
  /** Force one path (the bench compares them); default tries structured output first. */
  path?: ExtractPath
  /** Sonnet's default (adaptive) thinking can eat the whole output budget on a vision read; 'minimal' keeps the tokens for the JSON. */
  reasoning?: Reasoning
  /** 2 (default): two concurrent reads, the better kept by `chooseRead`. 1: a single read (the bench's baseline). */
  reads?: 1 | 2
  signal?: AbortSignal
}

/** Decoded bytes above this are rejected: the client downsizes, this is the backstop. */
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024
const CALL_TIMEOUT_MS = 55_000

export const PLAN_ROLE = 'You are an architectural draughtsman who turns floor-plan drawings into exact room geometry. You read dimension labels, count walls and openings carefully, and you answer with JSON only: no prose, no code fences.'

/** The instructions, identical for every image (so the gateway can cache them); the hint rides at the end. */
export function planPrompt(hint?: string): string {
  const body = `Read this floor plan and return one JSON object describing it.

## Frame
- Origin = the top-left corner of the drawn plan. x increases to the RIGHT, z increases DOWN the drawing. Units: metres ("units": "m"). Round to 0.05 m.
- The top of the drawing is north unless a compass is drawn; set "north" (degrees clockwise from north for the top of the drawing) only when a compass shows otherwise, else 0.

## Scale: how to read the labels
- In a label like 11'5" x 17'1" the FIRST number is the horizontal (x, left-to-right) extent of that room and the SECOND is the vertical (z, top-to-bottom) extent, unless the drawn shape clearly contradicts it (a room drawn wide and shallow with a label 11'1" x 4'7" is 11'1" wide). 1 ft = 0.3048 m, so 11'5" = 3.48 m, 16'10" = 5.13 m.
- A labelled room is EXACTLY its labelled size (within 0.2 m). It never stretches past its label to swallow the unlabelled space drawn next to it: a Living/Dining labelled 16'10" deep that starts at z = 0 ENDS at z = 5.13, and whatever is drawn below it (a kitchen, a bath, a hall) is a different room from there down.
- No labels at all? Estimate from a door (0.9 m wide), a bathtub (1.7 m), a queen bed (1.6 x 2.0 m) and say so in "notes" (units still "m").

## Procedure (think it through before writing)
1. List every printed label with its size in metres (they go in "labels").
2. Group the rooms into vertical COLUMNS (rooms stacked above each other share x-lines). Column width = the width of its labelled room. x-lines: x0 = 0, x1 = width of column 1, x2 = x1 + width of column 2, and so on: columns are CONTIGUOUS (the next one starts exactly where the previous one ends; wall thickness is ignored, so the plan comes out a few cm narrower than reality, which is fine).
3. Down each column, z-lines come from the labelled depths; the unlabelled rooms below or above a labelled one take the remaining depth of that column, split by their drawn proportion (a bath drawn half as deep as the bedroom above it is half as deep). Rooms stacked in a column are contiguous too (the next starts exactly where the previous ends). The plan's total depth = the deepest column; every column reaches the same bottom edge unless the drawing clearly steps.
4. A short corridor between a bedroom and its bath or closets (often holding a mech / W/D closet) is a room of type hall: give it its rectangle so the doors off it have somewhere to go.
5. Check: the sum of your room areas must be within 10% of the bounding box area, with no two rooms overlapping and no gaps between neighbours. An unassigned rectangle goes to the hall or the nearest room; never leave a hole and never let two polygons share interior area.

## Rooms
- Every enclosed space is a room: bedrooms, living, kitchen, dining, every bath, hall / foyer / corridor, every closet (incl. walk-in), W/D or laundry, mech / utility, pantry, balcony / terrace. Walls themselves are never rooms. Any LABELLED closet ("Mech.", "W/D", "WIC", "Pantry") is always its own room, even at 1 m²: never fold it into the hall or a bedroom, not even to simplify.
- A kitchen is the space with the counters, sink and stove symbols along its walls: a full room, typically 2.5-4 m wide, never a thin strip. If it is open to the living room, the living room ends where its label says and the kitchen starts there.
- Each room is ONE axis-aligned polygon ([x, z] vertices, clockwise, 4 to 12 vertices; use an L-shape when the room is L-shaped). Interior wall thickness is ignored: neighbouring rooms share their boundary line exactly, so reuse the same x or z value for every edge on the same wall line. Rooms TILE the plan: no gaps, no overlaps.
- One label = one room: a space labelled "Living/Dining" is ONE room even though it has two uses. A kitchen (counters, sink, stove, island) open to the living room is still its OWN room, even with no wall between them: draw both and join them with an open boundary (see Openings). Likewise an unlabelled corridor or entry that opens off the living room or kitchen without a wall is its own hall room joined by an open boundary.
- "name" = the label text as printed ("Bedroom 1", "Living/Dining", "W/D", "Mech."); unlabelled spaces get a plain name ("Hall", "Closet", "Bath 2"). "id" = short snake_case ("bedroom_1", "living", "bath_2", "wd", "mech"). "type" is one of: ${ROOM_TYPES.join(', ')} (W/D → laundry, mech/utility → other, walk-in closet → closet, foyer/corridor → hall, Living/Dining → living, inset balcony → balcony).

## Openings
- "door": a door leaf with its quarter-circle swing arc, or a sliding/pocket door. width 0.8-0.9 m (closets 0.6-0.8, entry 0.9-1.0, a double door 1.5). Trace each arc to the two spaces it joins and record every door separately: a bedroom often reaches its bath through a walk-in closet or a short hall, so that is two doors (bedroom-closet, closet-bath), not one.
- "opening": a gap in a DRAWN wall between two rooms with no door leaf (a cased opening, an archway): width as drawn.
- OPEN BOUNDARIES: where two rooms are open to each other on the drawing (no wall line between them: an open kitchen beside the living room, a half wall, a counter or island, a change of floor material only), record ONE "opening" between them whose "width" is the FULL length of the edge they share (the whole open span) and whose "at" is the middle of that edge. Add a note for each ("living is open to the kitchen").
- Never invent a wall, door or divider the drawing does not show. No wall line drawn = an open boundary, never a door.
- "window": the thin, pale double-line segments set into an EXTERIOR wall (the outer boundary of the plan). width as drawn (0.6-3 m). Count them along the top, left, right and bottom boundaries. An INSET balcony has its own outer edge on the boundary; the glass wall between the balcony and EACH room behind it is an opening to record: a door where a door is drawn, otherwise a window, with rooms ["<room>", "<balcony id>"] (not outside).
- For each: "at" = the [x, z] centre of the opening ON the shared wall line (one coordinate equals that wall's x or z line exactly), "rooms" = the two room ids either side, or ["<room>", "outside"] for exterior walls (windows, the entry door). The two rooms you name MUST share that wall line at that point; if they don't touch, a room is missing between them (a hall or closet): add it and split the door in two.
- Do not invent openings; do not skip the ones you can see. Every bedroom and bathroom has a door; every bedroom and the living room normally have a window on an exterior wall. The entry door is on the exterior wall, usually into the hall or kitchen/living.
- Before answering, walk it: every room must be reachable from the entry door through your doors and openings. A corridor that serves a bedroom and its bath almost always opens onto the living room or kitchen (an open boundary when no wall line or door is drawn there).

## Also
- "name": a short title for the plan (use any printed title, else "2 bed / 2 bath" style).
- "ceiling": only if printed (metres).
- "labels": one entry per printed dimension label: {"room": "<room id>", "width": <x extent>, "depth": <z extent>} in metres, as you applied it to that room (11'5" x 17'1" read as 11'5" wide → width 3.48, depth 5.21). Omit when the plan prints no sizes.
- "confidence": 0-1 for the whole read. "notes": short strings about each open boundary and anything unsure (an illegible label, a guessed wall line, an assumed window).

## Output shape
{"name":"…","units":"m","north":0,"rooms":[{"id":"bedroom_1","name":"Bedroom 1","type":"bedroom","polygon":[[0,0],[3.5,0],[3.5,5.2],[0,5.2]]},…],"openings":[{"kind":"door","at":[3.5,4.6],"width":0.85,"rooms":["bedroom_1","living"]},{"kind":"opening","at":[5.2,5.15],"width":3.45,"rooms":["living","kitchen"]},{"kind":"window","at":[1.75,0],"width":1.6,"rooms":["bedroom_1","outside"]},…],"labels":[{"room":"bedroom_1","width":3.48,"depth":5.21},…],"confidence":0.8,"notes":["living is open to the kitchen","…"]}`
  return hint?.trim() ? `${body}\n\nThe user says: ${hint.trim().slice(0, 300)}` : body
}

// ---------- image handling ----------

function decodeImage(image: string | Buffer): { data: Buffer, mediaType: string } | { error: string } {
  if (Buffer.isBuffer(image)) return { data: image, mediaType: sniff(image) }
  if (typeof image !== 'string' || !image.trim()) return { error: 'no image' }
  const m = /^data:(image\/[a-z+.-]+);base64,(.*)$/is.exec(image.trim())
  const b64 = m ? m[2]! : image.trim()
  let data: Buffer
  try {
    data = Buffer.from(b64, 'base64')
  } catch {
    return { error: 'image is not valid base64' }
  }
  if (!data.length) return { error: 'image is empty' }
  return { data, mediaType: m?.[1] ?? sniff(data) }
}

/** Magic bytes, because a data URL's declared type is sometimes wrong and a Buffer carries none. */
function sniff(b: Buffer): string {
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png'
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg'
  if (b[0] === 0x47 && b[1] === 0x49) return 'image/gif'
  if (b.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  return 'image/png'
}

// ---------- the call ----------

interface Attempt { loose?: unknown, usage: Usage, error?: string, raw?: string }

function toUsage(u: { inputTokens?: number, outputTokens?: number, inputTokenDetails?: { cacheReadTokens?: number, cacheWriteTokens?: number } } | undefined): Usage {
  return { input: u?.inputTokens ?? 0, output: u?.outputTokens ?? 0, cacheRead: u?.inputTokenDetails?.cacheReadTokens ?? 0, cacheWrite: u?.inputTokenDetails?.cacheWriteTokens ?? 0 }
}

async function callModel(path: ExtractPath, modelId: string, prompt: string, img: { data: Buffer, mediaType: string }, reasoning: Reasoning, signal: AbortSignal): Promise<Attempt> {
  const base = {
    model: modelId,
    instructions: PLAN_ROLE,
    messages: [{
      role: 'user' as const,
      content: [
        // 'file' with an image mediaType: the 'image' part is deprecated in ai@7.
        { type: 'file' as const, data: img.data, mediaType: img.mediaType },
        { type: 'text' as const, text: prompt }
      ]
    }],
    maxOutputTokens: 6000,
    reasoning,
    maxRetries: 1,
    abortSignal: signal,
    // Pin Anthropic: `order` alone loses to the gateway's session affinity and a Bedrock fallback changes the output format.
    providerOptions: { gateway: { only: ['anthropic'] } }
  }
  try {
    if (path === 'object') {
      const r = await generateText({ ...base, output: Output.object({ schema: LoosePlanSchema, name: 'floor_plan', description: 'Rooms as polygons and the openings on their walls.' }) })
      return { loose: r.output, usage: toUsage(r.usage), raw: r.text }
    }
    const r = await generateText(base)
    const loose = parseLooseJson(r.text)
    return { loose, usage: toUsage(r.usage), raw: r.text, error: loose === undefined ? `unparseable answer: ${r.text.slice(0, 200)}` : undefined }
  } catch (err) {
    return { usage: { input: 0, output: 0 }, error: ((err as Error)?.message ?? String(err)).slice(0, 400) }
  }
}

interface Read {
  ok: boolean
  reason?: string
  costUsd: number
  path: ExtractPath
  usage?: Usage
  loose?: LoosePlan
  /** What the reader drew, normalized; `plan` is it after `connectRooms`. */
  drawn?: FloorPlan
  plan?: FloorPlan
  notes?: string[]
  added?: string[]
}

/** One read: structured output, JSON-in-text when that fails, then normalize and make it walkable. Never throws. */
async function readOnce(opts: ExtractOptions, id: string, prompt: string, img: { data: Buffer, mediaType: string }, signal: AbortSignal): Promise<Read> {
  let spent = 0
  let path: ExtractPath = opts.path ?? 'object'
  try {
    const reasoning: Reasoning = opts.reasoning ?? 'minimal'
    let attempt = await callModel(path, id, prompt, img, reasoning, signal)
    spent += costUsd(id, attempt.usage)
    if (path === 'object' && !opts.path && (attempt.error || attempt.loose === undefined) && !signal.aborted) {
      // Anything short of an abort gets the text path: a refused schema, a truncated object, an empty output.
      console.warn(`[plan] structured output failed (${(attempt.error ?? 'empty structured output').slice(0, 120)}); falling back to JSON-in-text`)
      path = 'text'
      attempt = await callModel('text', id, prompt, img, reasoning, signal)
      spent += costUsd(id, attempt.usage)
    }
    if (attempt.error && attempt.loose === undefined) return { ok: false, reason: attempt.error, costUsd: spent, path }
    const parsed = LoosePlanSchema.safeParse(attempt.loose)
    if (!parsed.success) return { ok: false, reason: `plan shape: ${parsed.error.issues.slice(0, 5).map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`, costUsd: spent, path }
    const norm = normalizePlan(parsed.data, { kind: 'upload', notes: [] })
    if (!norm.ok) return { ok: false, reason: norm.reason, costUsd: spent, path }
    // A room with no way in is unwalkable; connectRooms gives it one door and says so in the notes.
    const linked = connectRooms(norm.plan)
    const plan = linked.notes.length && linked.plan.source ? { ...linked.plan, source: { ...linked.plan.source, notes: [...linked.plan.source.notes, ...linked.notes] } } : linked.plan
    return { ok: true, costUsd: spent, path, usage: attempt.usage, loose: parsed.data, drawn: norm.plan, plan, notes: [...norm.notes, ...linked.notes], added: linked.added }
  } catch (err) {
    return { ok: false, reason: ((err as Error)?.message ?? String(err)).slice(0, 300), costUsd: spent, path }
  }
}

/**
 * Image → FloorPlan. Two reads run concurrently on the same prompt (the gateway ignores temperature and seed
 * for Sonnet, but reads vary run to run on their own) and `chooseRead` keeps the better one by a deterministic
 * score, so one bad read no longer decides the home. `reads: 1` is the single read. Cost covers every attempt.
 */
export async function extractPlan(opts: ExtractOptions): Promise<ExtractResult> {
  const started = Date.now()
  const ms = () => Date.now() - started
  const img = decodeImage(opts.image)
  if ('error' in img) return { ok: false, reason: img.error, ms: ms() }
  if (img.data.length > MAX_IMAGE_BYTES) return { ok: false, reason: `image is ${(img.data.length / 1048576).toFixed(1)} MB; the limit is 6 MB`, ms: ms() }

  const { alias, id } = resolveModel(opts.model, PLAN_MODEL)
  const prompt = planPrompt(opts.hint)
  const ctrl = new AbortController()
  const onOuter = () => ctrl.abort(opts.signal?.reason ?? new Error('aborted'))
  if (opts.signal?.aborted) onOuter()
  else opts.signal?.addEventListener('abort', onOuter, { once: true })
  const timer = setTimeout(() => ctrl.abort(new Error(`no answer in ${CALL_TIMEOUT_MS} ms`)), CALL_TIMEOUT_MS)
  try {
    const n = opts.reads === 1 ? 1 : 2
    const ids: ReadId[] = (['a', 'b'] as const).slice(0, n)
    const reads = await Promise.all(ids.map(() => readOnce(opts, id, prompt, img, ctrl.signal)))
    const spent = reads.reduce((s, r) => s + r.costUsd, 0)
    const { chosen, scores } = chooseRead(reads.map(r => (r.ok && r.drawn && r.loose ? { plan: r.drawn, loose: r.loose, interventions: r.added?.length ?? 0 } : null)))
    const best = reads[chosen]
    if (chosen < 0 || !best?.ok || !best.plan || !best.loose || !best.usage) {
      const why = ctrl.signal.aborted && ctrl.signal.reason instanceof Error ? ctrl.signal.reason.message : reads[0]!.reason ?? 'no usable read'
      return { ok: false, reason: why.slice(0, 300), ms: ms(), costUsd: spent, path: reads[0]!.path }
    }
    if (n > 1) console.info(`[plan] reads ${ids.map((k, i) => `${k} ${scores[i] ? `${scores[i]!.total} (${scores[i]!.rooms} rooms)` : 'failed'}`).join(' · ')} → ${ids[chosen]}`)
    return {
      ok: true,
      plan: best.plan,
      loose: best.loose,
      notes: best.notes ?? [],
      ms: ms(),
      costUsd: spent,
      usage: best.usage,
      path: best.path,
      model: alias,
      reads: n,
      chosen: ids[chosen]!,
      scores: Object.fromEntries(ids.map((k, i) => [k, scores[i] ?? null]))
    }
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onOuter)
  }
}
