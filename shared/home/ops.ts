/**
 * The home language: the single seam between the model, the kernel and the renderer.
 *
 * Models never do coordinate math. They emit one flat op shape per change, naming rooms by id, things by
 * kind (plus room / gaze / last), and places by a Spot ("against the north wall of the living room",
 * "by the window", "beside the sofa", "where I'm looking"). The kernel (shared/home/state.ts +
 * layout.ts) resolves every Spot into metres deterministically, seeded from the sentence.
 *
 * `OpsEnvelope` is loose (so one odd field never loses a sentence); `parseOps` is strict per op and drops
 * the bad ones with a reason.
 */
import { z } from 'zod'
import { clamp } from '../math.ts'
import { PATTERNS } from '../plan/schema.ts'

export const OP_NAMES = ['place', 'move', 'remove', 'restyle', 'surface', 'light', 'furnish', 'goto', 'undo', 'reset', 'say'] as const
export type OpName = typeof OP_NAMES[number]

export const MATERIALS = ['fabric', 'leather', 'velvet', 'wood', 'metal', 'glass', 'marble', 'stone', 'rattan', 'plastic'] as const
export type Material = typeof MATERIALS[number]

export const WALLS = ['north', 'south', 'east', 'west'] as const
export type WallSide = typeof WALLS[number]

/** Where in a room a thing goes. The kernel turns this into metres. */
export const WHERES = ['center', 'wall', 'corner', 'window', 'door', 'near', 'gaze', 'here'] as const
export type Where = typeof WHERES[number]

export const SIDES = ['left', 'right', 'front', 'behind', 'opposite', 'on', 'beside'] as const
export type Side = typeof SIDES[number]

export const FACINGS = ['room', 'wall', 'window', 'player', 'of', 'north', 'south', 'east', 'west'] as const
export type Facing = typeof FACINGS[number]

/** Times of day the sun follows. `lamps` and `warmth` ride alongside in the light op. */
export const TIMES = ['dawn', 'morning', 'noon', 'afternoon', 'golden', 'evening', 'night'] as const
export type TimeOfDay = typeof TIMES[number]

export const ARRANGEMENTS = ['row', 'around', 'pair', 'cluster'] as const
export type Arrangement = typeof ARRANGEMENTS[number]

export const MAX_COUNT = 24

const num = (min: number, max: number, int = false) => z.preprocess(
  v => (typeof v === 'number' && Number.isFinite(v) ? clamp(int ? Math.round(v) : v, min, max) : v),
  z.number()
)
const POS = 0.01
const color = z.string().trim().min(1).max(32)
const ident = z.string().trim().min(1).max(48).transform(normalizeKind)

// ---------- props (furniture appearance) ----------

export const PropsSchema = z.object({
  color: color.optional(),
  trim: color.optional(),
  material: z.enum(MATERIALS).optional(),
  /** Uniform size multiplier (1 = the kind's natural size). */
  scale: num(POS, 4).optional(),
  /** Explicit footprint in metres for sized kinds (rug, table, bed, counter, shelf): length along the front, width (depth) away from it. */
  length: num(POS, 12).optional(),
  width: num(POS, 12).optional(),
  height: num(POS, 4).optional(),
  /** Lamps and fixtures: on/off and brightness (0 = off, 1 = normal, 2 = bright). */
  lit: num(0, 2).optional(),
  /** Wall art / TV / mirror: how high the centre hangs (metres). */
  hang: num(0.3, 3).optional()
})
export type Props = z.infer<typeof PropsSchema>

// ---------- selectors and spots ----------

export const SelectorSchema = z.object({
  /** gaze = the thing I'm looking at; last = what the last sentence placed; all = everything (narrowed by the other fields). */
  ref: z.enum(['gaze', 'last', 'all']).optional(),
  kind: ident.optional(),
  /** A tag the kind carries (seating, table, storage, light, bed, plant, art, appliance, fixture). */
  tag: z.string().trim().min(1).max(32).transform(s => s.toLowerCase()).optional(),
  /** A room id (from the context's room list); the kernel also accepts a room name or type. */
  room: z.string().trim().min(1).max(40).optional(),
  near: z.enum(['gaze', 'player']).optional(),
  within: num(POS, 50).optional(),
  limit: num(1, 200, true).optional()
})
export type Selector = z.infer<typeof SelectorSchema>

export const SpotSchema = z.object({
  /** Room id. Omitted = the room the player is in (or the target's room, for moves). */
  room: z.string().trim().min(1).max(40).optional(),
  where: z.enum(WHERES).optional(),
  /** With where=wall or corner: which wall (corner: the two walls, e.g. wall 'north' + side 'left' = north-west). */
  wall: z.enum(WALLS).optional(),
  /** With where=near (or side alone): the thing to place relative to. */
  of: SelectorSchema.optional(),
  side: z.enum(SIDES).optional(),
  /** Metres from the anchor (near: the gap from the thing; wall: the gap from the wall). Negative tucks a rug under the front of a bed or sofa. */
  dist: num(-5, 20).optional(),
  facing: z.enum(FACINGS).optional()
})
export type Spot = z.infer<typeof SpotSchema>

// ---------- the loose envelope ----------

export const LooseOpSchema = z.object({
  op: z.enum(OP_NAMES),
  kind: z.string().optional(),
  count: z.number().optional(),
  arrange: z.string().optional(),
  at: SpotSchema.optional(),
  set: z.record(z.string(), z.unknown()).optional(),
  relative: z.boolean().optional(),
  target: SelectorSchema.optional(),
  room: z.string().optional(),
  part: z.string().optional(),
  time: z.string().optional(),
  lamps: z.boolean().optional(),
  warmth: z.number().optional(),
  style: z.string().optional(),
  text: z.string().optional()
})
export type LooseOp = z.infer<typeof LooseOpSchema>
export const OpsEnvelope = z.object({ ops: z.array(LooseOpSchema) })

// ---------- strict per-op schemas ----------

const RelativePropsSchema = PropsSchema

/** Put a thing (or `count` of them) somewhere. No `at` = the kind's natural spot in the room (sofas on a wall, rugs in the middle…). */
const PlaceOp = z.object({
  op: z.literal('place'),
  kind: ident,
  count: num(1, MAX_COUNT, true).optional(),
  arrange: z.enum(ARRANGEMENTS).optional(),
  at: SpotSchema.optional(),
  set: PropsSchema.optional()
})

const MoveOp = z.object({ op: z.literal('move'), target: SelectorSchema, at: SpotSchema })
const RemoveOp = z.object({ op: z.literal('remove'), target: SelectorSchema })

const RestyleOp = z.object({
  op: z.literal('restyle'),
  target: SelectorSchema,
  set: RelativePropsSchema.refine(s => Object.keys(s).length > 0, 'set is empty'),
  /** scale / length / width / height multiply the current value instead of replacing it. */
  relative: z.boolean().optional()
})

/** A room's finish: walls (paint or wallpaper), floor or ceiling. room 'all' = every room. */
const SurfaceOp = z.object({
  op: z.literal('surface'),
  room: z.string().trim().min(1).max(40).default('here'),
  part: z.enum(['walls', 'floor', 'ceiling']),
  set: z.object({
    color: color.optional(),
    pattern: z.enum(PATTERNS).optional(),
    accent: color.optional()
  }).refine(s => Object.keys(s).length > 0, 'set is empty')
})

const LightOp = z.object({
  op: z.literal('light'),
  time: z.enum(TIMES).optional(),
  /** Every lamp and fixture on or off. */
  lamps: z.boolean().optional(),
  /** 0 = cool white, 1 = candle-warm. */
  warmth: num(0, 1).optional()
}).refine(a => Object.keys(a).some(k => k !== 'op'), 'light needs at least one field')

/** Fill a room (or every room) with the furniture its type calls for; `style` is a hint for colours. */
const FurnishOp = z.object({
  op: z.literal('furnish'),
  room: z.string().trim().min(1).max(40).default('here'),
  style: z.string().trim().max(60).optional()
})

/** Walk the player to a room or a thing. */
const GotoOp = z.object({
  op: z.literal('goto'),
  room: z.string().trim().min(1).max(40).optional(),
  target: SelectorSchema.optional()
}).refine(g => g.room || g.target, 'goto needs a room or a target')

const UndoOp = z.object({ op: z.literal('undo') })
/** "Start over": the plan's furniture and finishes back to their defaults. Never logged. */
const ResetOp = z.object({ op: z.literal('reset') })
const SayOp = z.object({ op: z.literal('say'), text: z.string().trim().min(1).max(280) })

const STRICT = {
  place: PlaceOp,
  move: MoveOp,
  remove: RemoveOp,
  restyle: RestyleOp,
  surface: SurfaceOp,
  light: LightOp,
  furnish: FurnishOp,
  goto: GotoOp,
  undo: UndoOp,
  reset: ResetOp,
  say: SayOp
} as const

export type PlaceOp = z.infer<typeof PlaceOp>
export type MoveOp = z.infer<typeof MoveOp>
export type RemoveOp = z.infer<typeof RemoveOp>
export type RestyleOp = z.infer<typeof RestyleOp>
export type SurfaceOp = z.infer<typeof SurfaceOp>
export type LightOp = z.infer<typeof LightOp>
export type FurnishOp = z.infer<typeof FurnishOp>
export type GotoOp = z.infer<typeof GotoOp>
export type UndoOp = z.infer<typeof UndoOp>
export type ResetOp = z.infer<typeof ResetOp>
export type SayOp = z.infer<typeof SayOp>
/** A strictly validated op. The kernel only ever sees these. */
export type Op = PlaceOp | MoveOp | RemoveOp | RestyleOp | SurfaceOp | LightOp | FurnishOp | GotoOp | UndoOp | ResetOp | SayOp

export interface DroppedOp {
  index: number
  raw: unknown
  reason: string
}

/**
 * Strict per-op parse. Accepts `{ ops: [...] }` (also with `ops` as a JSON string), a bare array, or a single
 * op object; never throws. Invalid ops come back in `dropped` and the valid siblings still apply.
 */
export function parseOps(raw: unknown): { ops: Op[], dropped: DroppedOp[] } {
  if (raw && typeof raw === 'object' && typeof (raw as { ops?: unknown }).ops === 'string') {
    const inner = leadingJsonArray((raw as { ops: string }).ops)
    if (inner) raw = { ops: inner }
  }
  let list: unknown[]
  if (Array.isArray(raw)) list = raw
  else if (raw && typeof raw === 'object' && Array.isArray((raw as { ops?: unknown }).ops)) list = (raw as { ops: unknown[] }).ops
  else if (raw && typeof raw === 'object' && 'op' in raw) list = [raw]
  else return { ops: [], dropped: [{ index: -1, raw, reason: 'expected { ops: [...] } or an array of ops' }] }

  const ops: Op[] = []
  const dropped: DroppedOp[] = []
  list.forEach((item, index) => {
    const name = item && typeof item === 'object' ? (item as { op?: unknown }).op : undefined
    const schema = typeof name === 'string' ? STRICT[name as OpName] : undefined
    if (!schema) {
      dropped.push({ index, raw: item, reason: `unknown op ${JSON.stringify(name)}` })
      return
    }
    const res = schema.safeParse(item)
    if (res.success) ops.push(stripUndefined(res.data) as Op)
    else dropped.push({ index, raw: item, reason: res.error.issues.map(i => `${i.path.join('.') || name}: ${i.message}`).join('; ') })
  })
  for (const d of dropped) console.warn(`[instant-interiors] dropped op #${d.index}: ${d.reason}`)
  return { ops, dropped }
}

function leadingJsonArray(text: string): unknown[] | null {
  const start = text.indexOf('[')
  if (start < 0) return null
  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (ch === '\\') i++
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '[' || ch === '{') depth++
    else if (ch === ']' || ch === '}') {
      depth--
      if (depth === 0) {
        try {
          const v = JSON.parse(text.slice(start, i + 1))
          return Array.isArray(v) ? v : null
        } catch {
          return null
        }
      }
    }
  }
  return null
}

/** 'Coffee Table' → 'coffee_table'. Kinds are ids, so they get one spelling. */
export function normalizeKind(kind: string): string {
  return kind.trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '')
}

function stripUndefined<T>(v: T): T {
  if (Array.isArray(v)) return v.map(stripUndefined) as T
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, stripUndefined(x)])) as T
  }
  return v
}
