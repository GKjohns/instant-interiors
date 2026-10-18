/**
 * The floor plan: rooms as polygons in the plan frame (metres; x right, z down the drawing), plus the
 * openings (doors, windows, cased openings) that sit on their walls. Walls are DERIVED from the room
 * polygons (shared/plan/geometry.ts), never stored: two rooms that share an edge share a wall.
 *
 * `FloorPlanSchema` is the strict shape the app runs on. `LoosePlanSchema` is what the plan reader
 * (a vision model) is allowed to return; `normalizePlan` turns it into a strict plan or explains why not.
 */
import { z } from 'zod'
import { area, cleanPolygon, closestOnSegment, signedArea, snapPolygon } from './poly.ts'
import type { Vec2 } from './poly.ts'

export const ROOM_TYPES = ['living', 'bedroom', 'kitchen', 'dining', 'bathroom', 'office', 'hall', 'closet', 'laundry', 'garage', 'balcony', 'other'] as const
export type RoomType = typeof ROOM_TYPES[number]

/** Procedural finish patterns the renderer can draw (app/home/surfaces.ts). */
export const PATTERNS = ['plain', 'stripes', 'floral', 'damask', 'tile', 'checker', 'plank', 'herringbone', 'carpet', 'concrete', 'brick', 'subway', 'terrazzo'] as const
export type Pattern = typeof PATTERNS[number]

export const OPENING_KINDS = ['door', 'window', 'opening'] as const
export type OpeningKind = typeof OPENING_KINDS[number]

export const SURFACE_PARTS = ['walls', 'floor', 'ceiling'] as const
export type SurfacePart = typeof SURFACE_PARTS[number]

const num = (min: number, max: number) => z.preprocess(
  v => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : v),
  z.number()
)
const vec2 = z.array(z.number()).length(2).transform(v => [v[0]!, v[1]!] as Vec2)
const color = z.string().trim().min(1).max(32)
const id = z.string().trim().min(1).max(40).transform(normalizeId)

export const SurfaceSchema = z.object({
  color: color,
  pattern: z.enum(PATTERNS).default('plain'),
  /** Second colour for two-tone patterns (stripes, checker, floral motif, tile grout). */
  accent: color.optional()
})
export type Surface = z.infer<typeof SurfaceSchema>

export const RoomSchema = z.object({
  id,
  name: z.string().trim().min(1).max(40),
  type: z.enum(ROOM_TYPES).default('other'),
  polygon: z.array(vec2).min(3).max(32),
  floor: SurfaceSchema,
  walls: SurfaceSchema,
  ceiling: SurfaceSchema.optional()
})
export type Room = z.infer<typeof RoomSchema>

export const OpeningSchema = z.object({
  id,
  kind: z.enum(OPENING_KINDS),
  /** Centre of the opening, on (or within a few cm of) a room edge. */
  at: vec2,
  width: num(0.4, 6),
  /** Door / opening: the head height. Window: the top of the glass. */
  height: num(0.5, 3.5).optional(),
  /** Window: the sill height. */
  sill: num(0, 2).optional(),
  /** The rooms either side; `outside` for an exterior wall. Order doesn't matter. */
  rooms: z.tuple([id.or(z.literal('outside')), id.or(z.literal('outside'))])
})
export type Opening = z.infer<typeof OpeningSchema>

export const FloorPlanSchema = z.object({
  id,
  name: z.string().trim().min(1).max(60),
  /** Ceiling height in metres, for every room. */
  ceiling: num(2.2, 4.5).default(2.7),
  /** Compass bearing of the top of the drawing, degrees clockwise from north (0 = top is north). Drives the sun. */
  north: num(0, 360).default(0),
  rooms: z.array(RoomSchema).min(1).max(40),
  openings: z.array(OpeningSchema).default([]),
  /** Where the plan reader got this from, for the HUD ("read from your upload · 2 rooms unsure"). */
  source: z.object({ kind: z.enum(['sample', 'upload', 'import']), notes: z.array(z.string()).default([]), confidence: num(0, 1).optional() }).optional()
})
export type FloorPlan = z.infer<typeof FloorPlanSchema>

export function normalizeId(s: string): string {
  return s.trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '').slice(0, 40) || 'room'
}

// ---------- default finishes ----------

/** The finishes a room starts with, by type: calm, realistic, easy to talk over. */
export function defaultSurfaces(type: RoomType): { floor: Surface, walls: Surface, ceiling: Surface } {
  const ceiling: Surface = { color: '#f4f1ea', pattern: 'plain' }
  switch (type) {
    case 'kitchen': return { floor: { color: '#c9c3b8', pattern: 'tile', accent: '#b8b1a4' }, walls: { color: '#eee9df', pattern: 'plain' }, ceiling }
    case 'bathroom': return { floor: { color: '#d8d8d4', pattern: 'checker', accent: '#8a8f94' }, walls: { color: '#dfe7ea', pattern: 'subway', accent: '#c9d3d7' }, ceiling }
    case 'bedroom': return { floor: { color: '#b08d6a', pattern: 'plank' }, walls: { color: '#e9e1d4', pattern: 'plain' }, ceiling }
    case 'office': return { floor: { color: '#9c7a58', pattern: 'plank' }, walls: { color: '#d9d4c7', pattern: 'plain' }, ceiling }
    case 'laundry': return { floor: { color: '#c7c2b9', pattern: 'tile', accent: '#b5afa5' }, walls: { color: '#eceae3', pattern: 'plain' }, ceiling }
    case 'garage': return { floor: { color: '#9a9a96', pattern: 'concrete' }, walls: { color: '#d7d5cf', pattern: 'plain' }, ceiling }
    case 'balcony': return { floor: { color: '#a8a39a', pattern: 'concrete' }, walls: { color: '#cfc8bc', pattern: 'brick', accent: '#b9a999' }, ceiling }
    case 'closet': return { floor: { color: '#a98a68', pattern: 'carpet' }, walls: { color: '#eae4d8', pattern: 'plain' }, ceiling }
    case 'hall': return { floor: { color: '#ad8b66', pattern: 'plank' }, walls: { color: '#ece6da', pattern: 'plain' }, ceiling }
    case 'dining': return { floor: { color: '#a67f5c', pattern: 'herringbone' }, walls: { color: '#e4dccd', pattern: 'plain' }, ceiling }
    case 'living':
    default: return { floor: { color: '#b48f6b', pattern: 'plank' }, walls: { color: '#ece5d8', pattern: 'plain' }, ceiling }
  }
}

/** A room type from a label ("Master Bdrm" → bedroom, "WIC" → closet, "Bath 2" → bathroom). */
export function roomTypeOf(label: string): RoomType {
  const s = label.toLowerCase()
  if (/\b(bed|bdrm|br|master|primary|guest\s*room|nursery)\b/.test(s)) return 'bedroom'
  if (/\b(bath|wc|toilet|powder|ensuite|en-suite|shower)\b/.test(s)) return 'bathroom'
  if (/\b(kitchen|kit|pantry)\b/.test(s)) return 'kitchen'
  if (/\b(dining|din|breakfast|nook)\b/.test(s)) return 'dining'
  if (/\b(living|lounge|family|great\s*room|den|sitting|parlou?r|salon)\b/.test(s)) return 'living'
  if (/\b(office|study|library)\b/.test(s)) return 'office'
  if (/\b(closet|wic|wardrobe|storage|store)\b/.test(s)) return 'closet'
  if (/\b(laundry|utility|mud)\b/.test(s)) return 'laundry'
  if (/\b(garage|carport)\b/.test(s)) return 'garage'
  if (/\b(balcony|terrace|patio|deck|porch)\b/.test(s)) return 'balcony'
  if (/\b(hall|hallway|foyer|entry|entrance|corridor|landing|vestibule)\b/.test(s)) return 'hall'
  return 'other'
}

// ---------- the loose plan a vision model returns, and its normalisation ----------

/**
 * What the plan reader writes. Everything beyond names and polygons is optional; finishes are never asked
 * for (defaults by room type). Coordinates may be in metres or feet (`units`); `normalizePlan` converts.
 */
export const LoosePlanSchema = z.object({
  name: z.string().optional(),
  units: z.enum(['m', 'ft']).optional(),
  ceiling: z.number().optional(),
  north: z.number().optional(),
  rooms: z.array(z.object({
    id: z.string().optional(),
    name: z.string(),
    type: z.string().optional(),
    polygon: z.array(z.array(z.number()))
  })),
  openings: z.array(z.object({
    kind: z.string(),
    at: z.array(z.number()),
    width: z.number().optional(),
    rooms: z.array(z.string()).optional()
  })).optional(),
  confidence: z.number().optional(),
  notes: z.array(z.string()).optional()
})
export type LoosePlan = z.infer<typeof LoosePlanSchema>

const FT = 0.3048
/** Gaps up to this wide between two facing walls are a misread wall line, not a real void (a chase is wider and drawn). */
const WELD_GAP = 0.25
/** Only walls that face each other for this long are the same wall; a corner brushing past isn't. */
const WELD_OVERLAP = 0.6

/**
 * Label-less plans come back with slivers between rooms (each room's polygon traced a little inside its
 * walls). Where a room's edge faces a bigger room's edge across a gap of at most WELD_GAP, along at least
 * WELD_OVERLAP, move the smaller room's edge onto the bigger one's line, so the two share one wall. Only
 * gaps (never overlaps), only parallel edges, the bigger room never moves. Returns how many edges moved.
 */
export function weldGaps(rooms: Room[]): number {
  let n = 0
  const order = rooms.map((r, i) => ({ r, i, a: area(r.polygon) })).sort((p, q) => p.a - q.a || p.i - q.i)
  for (const small of order) {
    for (const big of order) {
      if (big.a < small.a || big === small || (big.a === small.a && big.i < small.i)) continue
      const sp = small.r.polygon
      for (let i = 0; i < sp.length; i++) {
        const a = sp[i]!
        const b = sp[(i + 1) % sp.length]!
        const len = Math.hypot(b[0] - a[0], b[1] - a[1])
        if (len < WELD_OVERLAP) continue
        const d: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len]
        // Polygons are positive-area here, so the right-hand perpendicular points out of the room.
        const out: Vec2 = [d[1], -d[0]]
        const bp = big.r.polygon
        for (let j = 0; j < bp.length; j++) {
          const c = bp[j]!
          const e = bp[(j + 1) % bp.length]!
          const elen = Math.hypot(e[0] - c[0], e[1] - c[1])
          if (elen < WELD_OVERLAP) continue
          const ed: Vec2 = [(e[0] - c[0]) / elen, (e[1] - c[1]) / elen]
          if (Math.abs(d[0] * ed[1] - d[1] * ed[0]) > 1e-3 || d[0] * ed[0] + d[1] * ed[1] > -0.999) continue
          const gap = (c[0] - a[0]) * out[0] + (c[1] - a[1]) * out[1]
          if (gap <= 0.01 || gap > WELD_GAP + 1e-6) continue
          const t = (p: Vec2) => p[0] * d[0] + p[1] * d[1]
          const overlap = Math.min(t(b), t(c)) - Math.max(t(a), t(e))
          if (overlap < WELD_OVERLAP - 1e-6) continue
          const move = (p: Vec2): Vec2 => [+(p[0] + out[0] * gap).toFixed(3), +(p[1] + out[1] * gap).toFixed(3)]
          sp[i] = move(a)
          sp[(i + 1) % sp.length] = move(b)
          n++
          break
        }
      }
      small.r.polygon = cleanPolygon(sp)
    }
  }
  return n
}

/**
 * Loose → strict. Converts feet, drops degenerate rooms (< 0.5 m²), snaps vertices to 5 cm so shared walls
 * coincide, makes every polygon the same winding, assigns ids, fills finishes by room type, and attaches
 * each opening to the two rooms whose edges it touches (or `outside`). Never throws: a plan with no usable
 * room comes back as `{ ok: false, reason }`.
 */
export function normalizePlan(loose: unknown, source: FloorPlan['source'] = { kind: 'upload', notes: [] }): { ok: true, plan: FloorPlan, notes: string[] } | { ok: false, reason: string } {
  const parsed = LoosePlanSchema.safeParse(loose)
  if (!parsed.success) return { ok: false, reason: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') }
  const lp = parsed.data
  const notes = [...(lp.notes ?? [])]
  const k = lp.units === 'ft' ? FT : 1
  const used = new Set<string>()
  const rooms: Room[] = []
  /** What the model called each room (id and name) → the id it got, so its `openings[].rooms` resolve. */
  const idMap = new Map<string, string>()
  for (const r of lp.rooms) {
    let poly = cleanPolygon(r.polygon.filter(p => p.length >= 2 && p.every(Number.isFinite)).map(p => [p[0]! * k, p[1]! * k] as Vec2))
    poly = snapPolygon(poly)
    poly = cleanPolygon(poly)
    // 0.5 m²: a mech or W/D closet on a real listing is 0.8–1 m² and must survive.
    if (poly.length < 3 || area(poly) < 0.5) {
      notes.push(`dropped "${r.name}": not a usable room shape`)
      continue
    }
    if (signedArea(poly) < 0) poly.reverse()
    const type = (ROOM_TYPES as readonly string[]).includes(r.type ?? '') ? (r.type as RoomType) : roomTypeOf(r.name)
    let rid = normalizeId(r.id ?? r.name)
    let n = 2
    while (used.has(rid)) rid = `${normalizeId(r.id ?? r.name)}_${n++}`
    used.add(rid)
    if (r.id) idMap.set(normalizeId(r.id), rid)
    if (!idMap.has(normalizeId(r.name))) idMap.set(normalizeId(r.name), rid)
    const fin = defaultSurfaces(type)
    rooms.push({ id: rid, name: r.name.trim().slice(0, 40) || rid, type, polygon: poly, floor: fin.floor, walls: fin.walls, ceiling: fin.ceiling })
  }
  if (!rooms.length) return { ok: false, reason: 'no usable rooms' }
  const welded = weldGaps(rooms)
  if (welded) notes.push(`closed ${welded} thin gap${welded === 1 ? '' : 's'} between rooms`)

  // Shift so the plan's top-left corner sits at the origin (the renderer centres it anyway; this keeps numbers small).
  let minX = Infinity
  let minZ = Infinity
  for (const r of rooms) for (const [x, z] of r.polygon) {
    minX = Math.min(minX, x)
    minZ = Math.min(minZ, z)
  }
  for (const r of rooms) r.polygon = r.polygon.map(([x, z]) => [+(x - minX).toFixed(3), +(z - minZ).toFixed(3)] as Vec2)

  const openings: Opening[] = []
  let oi = 1
  for (const o of lp.openings ?? []) {
    const kind: OpeningKind = /win/i.test(o.kind) ? 'window' : /door/i.test(o.kind) ? 'door' : 'opening'
    if (o.at.length < 2 || !o.at.every(Number.isFinite)) continue
    const at: Vec2 = [o.at[0]! * k - minX, o.at[1]! * k - minZ]
    const nearest = (r: Room, p: Vec2) => {
      let best = { d: Infinity, point: p }
      for (let i = 0; i < r.polygon.length; i++) {
        const c = closestOnSegment(p, r.polygon[i]!, r.polygon[(i + 1) % r.polygon.length]!)
        if (c.d < best.d) best = { d: c.d, point: c.point }
      }
      return best
    }
    // The model's topology (which two rooms a door joins) is more reliable than its coordinates: when it names
    // a pair we can honour, snap `at` onto the first room's boundary where the second room (or the outside) is
    // within reach. Otherwise fall back to geometry: the two closest rooms (within 30 cm) own it.
    let a: { id: string, point: Vec2 } | undefined
    let b: { id: string } | undefined
    const named = (o.rooms ?? []).map(n => n === 'outside' ? 'outside' : idMap.get(normalizeId(n)))
    if (named.length === 2 && named[0] && named[1]) {
      const [ra, rb] = named[0] === 'outside' ? [named[1], named[0]] : [named[0], named[1]]
      const roomA = rooms.find(r => r.id === ra)
      const roomB = rb === 'outside' ? undefined : rooms.find(r => r.id === rb)
      if (roomA && (rb === 'outside' || roomB)) {
        const pa = nearest(roomA, at)
        const reach = roomB ? nearest(roomB, pa.point).d : 0
        if (pa.d <= 1 && reach <= 0.5) {
          a = { id: roomA.id, point: pa.point }
          b = { id: rb! }
        }
      }
    }
    if (!a) {
      const touching: { id: string, d: number, point: Vec2 }[] = []
      for (const r of rooms) {
        const best = nearest(r, at)
        if (best.d <= 0.3) touching.push({ id: r.id, d: best.d, point: best.point })
      }
      touching.sort((x, y) => x.d - y.d)
      if (!touching.length) {
        notes.push(`dropped a ${kind}: not on any wall`)
        continue
      }
      a = touching[0]!
      b = touching[1]
    }
    // Widths share the plan's units, so they convert with the coordinates.
    const width = Math.min(6, Math.max(0.4, o.width !== undefined ? o.width * k : (kind === 'window' ? 1.2 : 0.9)))
    openings.push({
      id: `${kind}_${oi++}`,
      kind,
      at: [+a.point[0].toFixed(3), +a.point[1].toFixed(3)],
      width,
      ...(kind === 'window' ? { sill: 0.9, height: 2.1 } : { height: 2.05 }),
      rooms: [a.id, b?.id ?? 'outside']
    })
  }

  const plan: FloorPlan = {
    id: normalizeId(lp.name ?? 'plan'),
    name: (lp.name ?? 'Floor plan').trim().slice(0, 60),
    ceiling: Math.min(4.5, Math.max(2.2, (lp.ceiling ?? 2.7) * (lp.units === 'ft' ? FT : 1))),
    north: ((lp.north ?? 0) % 360 + 360) % 360,
    rooms,
    openings,
    source: { ...source, notes: [...(source?.notes ?? []), ...notes], ...(lp.confidence !== undefined ? { confidence: Math.min(1, Math.max(0, lp.confidence)) } : {}) }
  }
  const strict = FloorPlanSchema.safeParse(plan)
  if (!strict.success) return { ok: false, reason: strict.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') }
  return { ok: true, plan: strict.data, notes }
}
