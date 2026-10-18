/** Queries over a room: where it is, its walls by compass side with their free stretches, corners, windows and doors. */
import { area, bounds, centroid, closestOnSegment, compassOf, dist, distToPolygonEdge, pointInPolygon, signedArea } from '../poly.ts'
import type { Compass, Vec2 } from '../poly.ts'
import type { FloorPlan, OpeningKind, Room } from '../schema.ts'
import { DOOR_CLEAR, LINE_TOL, OUTSIDE, roomEdges, walls } from './walls.ts'
import type { Wall, WallOpening } from './walls.ts'

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
