/**
 * Everything the app derives from a FloorPlan: the walls (one per shared polygon edge, with openings cut
 * into pieces the renderer and collision can use as they are), each room's walls by compass side with
 * their free stretches, corners, windows, doors, and the entry pose. Pure, no three.js.
 *
 * Plan frame: metres, x right, z down the drawing, so -z is north. Polygons wind with positive signed
 * area; an edge's outward normal is its right-hand perpendicular. Walls are centred on the shared edge.
 */
import { EPS, area, bounds, centroid, closestOnSegment, compassOf, dist, distToPolygonEdge, pointInPolygon, signedArea, yawToward } from './poly.ts'
import type { Vec2 } from './poly.ts'
import type { FloorPlan, OpeningKind, Room } from './schema.ts'

export const INTERIOR_WALL = 0.12
export const EXTERIOR_WALL = 0.25
export const DOOR_HEAD = 2.05
export const WINDOW_SILL = 0.9
export const WINDOW_HEAD = 2.1
/** Clearance kept either side of a door along its wall (frame, hinge, handle). */
export const DOOR_CLEAR = 0.1
export const OUTSIDE = 'outside'
/** Two vertices closer than this (metres) lie on the same wall line; plans snap to 5 cm, so 3 cm never merges distinct walls. */
const LINE_TOL = 0.03

export type Compass = 'north' | 'south' | 'east' | 'west'

export interface WallOpening {
  id: string
  kind: OpeningKind
  at: Vec2
  width: number
  /** Metres from the wall's `a` end to the opening's centre. */
  along: number
  /** Bottom and top of the hole (a door starts at the floor; a window at its sill). */
  y0: number
  y1: number
}

export interface WallPiece {
  kind: 'solid' | 'door_header' | 'window_header' | 'window_apron'
  /** Extent along the wall, metres from `a`, and the same two points in the plan frame. */
  from: number
  to: number
  a: Vec2
  b: Vec2
  y0: number
  y1: number
}

export interface Wall {
  id: string
  a: Vec2
  b: Vec2
  length: number
  thickness: number
  exterior: boolean
  /** The rooms either side; `rooms[1]` is 'outside' on an exterior wall. */
  rooms: [string, string]
  /** Unit normal pointing out of `rooms[0]`, toward `rooms[1]`. */
  normal: Vec2
  openings: WallOpening[]
  pieces: WallPiece[]
}

export interface Stretch {
  from: number
  to: number
  length: number
}

/** One polygon edge of a room, seen from inside: its compass side, the walls on it, and where it is free. */
export interface RoomWall {
  index: number
  a: Vec2
  b: Vec2
  length: number
  /** Unit direction from `a` to `b`. */
  dir: Vec2
  side: Compass
  normal: Vec2
  inward: Vec2
  walls: Wall[]
  /** Every opening on this edge, `along` measured from `a`. */
  openings: WallOpening[]
  doors: WallOpening[]
  windows: WallOpening[]
  /** Stretches not taken by a door or passage (windows are left in; callers decide per item height). */
  free: Stretch[]
}

export interface RoomCorner {
  point: Vec2
  /** The compass sides of the two walls that meet here, in polygon order. */
  walls: [Compass, Compass]
  edges: [number, number]
  /** Unit bisector pointing into the room. */
  inward: Vec2
  convex: boolean
}

export interface RoomOpening extends WallOpening {
  side: Compass
  inward: Vec2
  /** The room on the other side, or 'outside'. */
  other: string
  edge: number
}

export interface Pose {
  pos: Vec2
  yaw: number
  room: string
}

// ---------- walls ----------

interface Edge {
  room: string
  order: number
  a: Vec2
  b: Vec2
  normal: Vec2
}

interface Line {
  d: Vec2
  c: number
  edges: Edge[]
}

interface Span {
  e: Edge
  t0: number
  t1: number
}

const cache = new WeakMap<FloorPlan, Wall[]>()

/** The plan's walls, deduped across rooms: a shared edge is one wall that knows both rooms. Cached per plan object. */
export function walls(plan: FloorPlan): Wall[] {
  const hit = cache.get(plan)
  if (hit) return hit
  const edges = plan.rooms.flatMap((r, order) => roomEdges(r).map(e => ({ ...e, order })))
  const out = groupByLine(edges).flatMap(line => wallsOnLine(line))
  attachOpenings(out, plan)
  out.forEach((w, i) => {
    w.id = `w${i + 1}`
    w.pieces = cutPieces(w, plan.ceiling)
  })
  cache.set(plan, out)
  return out
}

function roomEdges(room: Room): Edge[] {
  const poly = room.polygon
  const flip = signedArea(poly) < 0
  return poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length]!
    const len = dist(a, b) || 1
    let normal: Vec2 = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len]
    if (flip) normal = [-normal[0], -normal[1]]
    return { room: room.id, order: 0, a, b, normal }
  })
}

/** Edges that lie on the same infinite line, so overlaps can be found by 1-D interval arithmetic. */
function groupByLine(edges: Edge[]): Line[] {
  const lines: Line[] = []
  for (const e of edges) {
    const len = dist(e.a, e.b)
    if (len < EPS) continue
    let d: Vec2 = [(e.b[0] - e.a[0]) / len, (e.b[1] - e.a[1]) / len]
    // One canonical direction per line, so opposite-wound edges of neighbouring rooms land in the same group.
    if (d[0] < -1e-9 || (Math.abs(d[0]) <= 1e-9 && d[1] < 0)) d = [-d[0], -d[1]]
    const c = -e.a[0] * d[1] + e.a[1] * d[0]
    const line = lines.find(l => Math.abs(l.d[0] * d[1] - l.d[1] * d[0]) < 1e-3 && Math.abs(l.c - c) < LINE_TOL)
    if (line) line.edges.push(e)
    else lines.push({ d, c, edges: [e] })
  }
  return lines
}

function wallsOnLine(line: Line): Wall[] {
  const t = (p: Vec2) => p[0] * line.d[0] + p[1] * line.d[1]
  const spans: Span[] = line.edges.map(e => ({ e, t0: Math.min(t(e.a), t(e.b)), t1: Math.max(t(e.a), t(e.b)) }))
  const cuts = [...new Set(spans.flatMap(s => [s.t0, s.t1]).map(v => Math.round(v * 1000) / 1000))].sort((a, b) => a - b)
  const out: Wall[] = []
  let open: { key: string, t0: number, t1: number, covering: Span[] } | null = null
  const flush = () => {
    if (open) out.push(makeWall(open.covering, open.t0, open.t1, line))
    open = null
  }
  for (let i = 0; i + 1 < cuts.length; i++) {
    const t0 = cuts[i]!
    const t1 = cuts[i + 1]!
    if (t1 - t0 < 0.01) continue
    const mid = (t0 + t1) / 2
    const covering = spans.filter(s => s.t0 - 1e-6 <= mid && mid <= s.t1 + 1e-6).sort((p, q) => p.e.order - q.e.order)
    if (!covering.length) {
      flush()
      continue
    }
    // Adjacent intervals with the same rooms either side are one wall; a change of neighbour splits it.
    const key = covering.map(s => s.e.room).join('|')
    if (open && open.key === key) open.t1 = t1
    else {
      flush()
      open = { key, t0, t1, covering }
    }
  }
  flush()
  return out
}

function makeWall(covering: Span[], t0: number, t1: number, line: Line): Wall {
  const first = covering[0]!.e
  const base: Vec2 = [-line.d[1] * line.c, line.d[0] * line.c]
  let a: Vec2 = [base[0] + line.d[0] * t0, base[1] + line.d[1] * t0]
  let b: Vec2 = [base[0] + line.d[0] * t1, base[1] + line.d[1] * t1]
  // a→b runs the way rooms[0] winds, so `along` offsets read in that room's order.
  if ((first.b[0] - first.a[0]) * line.d[0] + (first.b[1] - first.a[1]) * line.d[1] < 0) [a, b] = [b, a]
  const other = covering[1]?.e.room ?? OUTSIDE
  const exterior = other === OUTSIDE
  return {
    id: '',
    a: round(a),
    b: round(b),
    length: t1 - t0,
    thickness: exterior ? EXTERIOR_WALL : INTERIOR_WALL,
    exterior,
    rooms: [first.room, other],
    normal: first.normal,
    openings: [],
    pieces: []
  }
}

/** Each opening joins the wall it sits on: same two rooms first, else the nearest wall within 30 cm. */
function attachOpenings(ws: Wall[], plan: FloorPlan): void {
  for (const o of plan.openings) {
    const pair = new Set(o.rooms)
    const scored = ws.map(w => ({ w, c: closestOnSegment(o.at, w.a, w.b), match: pair.has(w.rooms[0]) && pair.has(w.rooms[1]) }))
      .filter(s => s.c.d <= 0.3)
      .sort((p, q) => Number(q.match) - Number(p.match) || p.c.d - q.c.d)
    const best = scored[0]
    if (!best) continue
    const window = o.kind === 'window'
    best.w.openings.push({
      id: o.id,
      kind: o.kind,
      at: o.at,
      width: o.width,
      along: best.c.t * best.w.length,
      y0: window ? o.sill ?? WINDOW_SILL : 0,
      y1: o.height ?? (window ? WINDOW_HEAD : DOOR_HEAD)
    })
  }
  for (const w of ws) w.openings.sort((p, q) => p.along - q.along)
}

function cutPieces(w: Wall, ceiling: number): WallPiece[] {
  const pieces: WallPiece[] = []
  const push = (kind: WallPiece['kind'], from: number, to: number, y0: number, y1: number) => {
    if (to - from < 0.005 || y1 - y0 < 0.005) return
    pieces.push({ kind, from, to, a: lerp(w, from), b: lerp(w, to), y0, y1 })
  }
  let cursor = 0
  for (const o of w.openings) {
    const from = Math.max(cursor, o.along - o.width / 2)
    const to = Math.min(w.length, o.along + o.width / 2)
    if (to <= from) continue
    push('solid', cursor, from, 0, ceiling)
    if (o.kind === 'window') {
      push('window_apron', from, to, 0, o.y0)
      push('window_header', from, to, o.y1, ceiling)
    } else push('door_header', from, to, o.y1, ceiling)
    cursor = to
  }
  push('solid', cursor, w.length, 0, ceiling)
  return pieces
}

function lerp(w: Wall, along: number): Vec2 {
  const t = w.length ? along / w.length : 0
  return round([w.a[0] + (w.b[0] - w.a[0]) * t, w.a[1] + (w.b[1] - w.a[1]) * t])
}

function round(p: Vec2): Vec2 {
  return [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000]
}

// ---------- the plan as a whole ----------

export function planBounds(plan: FloorPlan): { min: Vec2, max: Vec2, size: Vec2, center: Vec2 } {
  const b = bounds(plan.rooms.flatMap(r => r.polygon))
  return { ...b, center: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2] }
}

/** The room under a point; on a shared edge the smaller room wins so closets and halls stay addressable. */
export function roomAt(plan: FloorPlan, point: Vec2): Room | undefined {
  let best: Room | undefined
  for (const r of plan.rooms) {
    if (!pointInPolygon(point, r.polygon)) continue
    if (!best || area(r.polygon) < area(best.polygon)) best = r
  }
  return best
}

export function largestRoom(plan: FloorPlan): Room {
  return [...plan.rooms].sort((p, q) => area(q.polygon) - area(p.polygon))[0]!
}

/** A point well inside the room: the centroid when it is, else the inside point farthest from any wall (L-shapes). */
export function roomCenter(room: Room): Vec2 {
  const poly = room.polygon
  const c = centroid(poly)
  if (pointInPolygon(c, poly) && distToPolygonEdge(c, poly) >= 0.3) return c
  const b = bounds(poly)
  const step = Math.max(0.1, Math.min(b.size[0], b.size[1]) / 20)
  let best = c
  let bestD = -1
  for (let x = b.min[0] + step / 2; x < b.max[0]; x += step) {
    for (let z = b.min[1] + step / 2; z < b.max[1]; z += step) {
      const p: Vec2 = [x, z]
      if (!pointInPolygon(p, poly)) continue
      const d = distToPolygonEdge(p, poly)
      if (d > bestD) {
        bestD = d
        best = p
      }
    }
  }
  return best
}

export function longestEdge(room: Room): number {
  const poly = room.polygon
  return Math.max(...poly.map((a, i) => dist(a, poly[(i + 1) % poly.length]!)))
}

// ---------- a room's walls, corners and openings ----------

export function wallSegmentsOf(plan: FloorPlan, room: Room): RoomWall[] {
  const all = walls(plan)
  return roomEdges(room).map((e, index) => {
    const length = dist(e.a, e.b)
    const dir: Vec2 = length ? [(e.b[0] - e.a[0]) / length, (e.b[1] - e.a[1]) / length] : [1, 0]
    const onEdge = all.filter(w => w.rooms.includes(room.id) && closestOnSegment(w.a, e.a, e.b).d < LINE_TOL && closestOnSegment(w.b, e.a, e.b).d < LINE_TOL)
    const openings = onEdge.flatMap(w => w.openings.map(o => ({ ...o, along: (o.at[0] - e.a[0]) * dir[0] + (o.at[1] - e.a[1]) * dir[1] })))
      .sort((p, q) => p.along - q.along)
    const doors = openings.filter(o => o.kind !== 'window')
    return {
      index,
      a: e.a,
      b: e.b,
      length,
      dir,
      side: compassOf(e.normal),
      normal: e.normal,
      inward: [-e.normal[0], -e.normal[1]],
      walls: onEdge,
      openings,
      doors,
      windows: openings.filter(o => o.kind === 'window'),
      free: freeAlong(length, doors, DOOR_CLEAR)
    }
  })
}

/** The parts of [0, length] not covered by `blocked` (each widened by `clear`), shortest ones dropped. */
export function freeAlong(length: number, blocked: WallOpening[], clear = DOOR_CLEAR, minLength = 0.2): Stretch[] {
  const out: Stretch[] = []
  let cursor = 0
  for (const o of [...blocked].sort((p, q) => p.along - q.along)) {
    const from = o.along - o.width / 2 - clear
    const to = o.along + o.width / 2 + clear
    if (from - cursor >= minLength) out.push({ from: cursor, to: from, length: from - cursor })
    cursor = Math.max(cursor, to)
  }
  if (length - cursor >= minLength) out.push({ from: cursor, to: length, length: length - cursor })
  return out
}

export function cornersOf(room: Room): RoomCorner[] {
  const poly = room.polygon
  const edges = roomEdges(room)
  const sign = signedArea(poly) < 0 ? -1 : 1
  return poly.map((point, i) => {
    const prev = edges[(i + poly.length - 1) % poly.length]!
    const next = edges[i]!
    const d1: Vec2 = [prev.b[0] - prev.a[0], prev.b[1] - prev.a[1]]
    const d2: Vec2 = [next.b[0] - next.a[0], next.b[1] - next.a[1]]
    const convex = (d1[0] * d2[1] - d1[1] * d2[0]) * sign > 0
    let inward: Vec2 = [-(prev.normal[0] + next.normal[0]), -(prev.normal[1] + next.normal[1])]
    const len = Math.hypot(inward[0], inward[1]) || 1
    inward = [inward[0] / len, inward[1] / len]
    if (!convex) inward = [-inward[0], -inward[1]]
    return { point, walls: [compassOf(prev.normal), compassOf(next.normal)], edges: [(i + poly.length - 1) % poly.length, i], inward, convex }
  })
}

function openingsOf(plan: FloorPlan, room: Room, kinds: OpeningKind[]): RoomOpening[] {
  return wallSegmentsOf(plan, room).flatMap(rw => rw.openings
    .filter(o => kinds.includes(o.kind))
    .map((o) => {
      const w = rw.walls.find(x => x.openings.some(y => y.id === o.id))
      const other = w ? (w.rooms[0] === room.id ? w.rooms[1] : w.rooms[0]) : OUTSIDE
      return { ...o, side: rw.side, inward: rw.inward, other, edge: rw.index }
    }))
}

export function windowsOf(plan: FloorPlan, room: Room): RoomOpening[] {
  return openingsOf(plan, room, ['window']).sort((p, q) => q.width - p.width)
}

/** Doors and cased passages, with the room on the far side. */
export function doorsOf(plan: FloorPlan, room: Room): RoomOpening[] {
  return openingsOf(plan, room, ['door', 'opening'])
}

/**
 * Where you arrive: just inside the front door (a real door to 'outside'), facing in. With no such door,
 * the middle of the largest room facing north.
 */
export function entry(plan: FloorPlan): Pose & { door?: string } {
  for (const w of walls(plan)) {
    if (!w.exterior) continue
    const door = w.openings.find(o => o.kind === 'door')
    if (!door) continue
    const room = plan.rooms.find(r => r.id === w.rooms[0])
    if (!room) continue
    const inward: Vec2 = [-w.normal[0], -w.normal[1]]
    const step = pointInPolygon([door.at[0] + inward[0] * 0.9, door.at[1] + inward[1] * 0.9], room.polygon) ? 0.9 : 0.5
    const pos: Vec2 = [door.at[0] + inward[0] * step, door.at[1] + inward[1] * step]
    return { pos, yaw: yawToward(door.at, pos) || 0, room: room.id, door: door.id }
  }
  const room = largestRoom(plan)
  return { pos: roomCenter(room), yaw: 0, room: room.id }
}
