/**
 * Where people walk in a room: a clear strip inside every doorway and a lane between every pair of openings
 * (or, in a one-door room, from the door into the middle). Furniture placement keeps out of these, so a
 * sofa never blocks the way from the hall to the kitchen and a plant never stands in the only walking space.
 *
 * Everything is rectangles in the plan frame. A lane between two openings may bend: when a bed has to fill
 * the middle of a small two-door bedroom, walking round its foot is fine, so each pair carries a few routes
 * (straight, a parallel lane shifted to either side, through the room's middle) and only needs one kept clear.
 */
import { EPS, area, dist, distToPolygonEdge, pointInPolygon, signedArea } from '../poly.ts'
import type { Vec2 } from '../poly.ts'
import type { FloorPlan, Room } from '../schema.ts'
import { doorsOf, roomCenter } from './rooms.ts'
import type { RoomOpening } from './rooms.ts'
import { OUTSIDE } from './walls.ts'

/** Wide enough for one person with a bag through a doorway, and deep enough to step in and turn. */
export const ENTRY_WIDTH = 0.9
export const ENTRY_DEPTH = 1.1
/** A walking lane: 0.8 m is the usual minimum between furniture. */
export const LANE_WIDTH = 0.8
/**
 * Lanes start a stride inside each opening, not on the threshold: between two doors on the same wall the
 * lane then runs 0.4–1.2 m off the wall, which leaves a console's depth against it.
 */
export const LANE_INSET = 0.8
/** A one-door room's walk-in lane is only kept when the middle is at least this far past the doorway stride. */
const REACH_MIN = 0.6
/** Sideways shifts tried for a lane that something big has to sit on (walk round the foot of the bed). */
const LANE_SHIFTS = [0.6, -0.6, 1.2, -1.2, 1.8, -1.8]

export type CorridorKind = 'entry' | 'through' | 'reach'

/** One way to walk a corridor: its centreline segments and the rectangles they sweep. */
export interface Route {
  segs: [Vec2, Vec2][]
  rects: Vec2[][]
}

export interface Corridor {
  kind: CorridorKind
  /** What a piece standing here would block, as a phrase: "the way from the hall to the kitchen". */
  why: string
  width: number
  /** The opening an entry strip belongs to. */
  door?: string
  /** Ways to walk it, the straight one first. Keeping any one of them clear keeps the corridor. */
  routes: Route[]
}

/** The corridors of a room: (a) a strip inside every opening, (b) a lane between each pair, (c) door to middle when there is only one. */
export function corridors(plan: FloorPlan, room: Room): Corridor[] {
  const doors = doorsOf(plan, room)
  const out: Corridor[] = []
  const name = (o: RoomOpening) => (o.other === OUTSIDE ? 'front door' : plan.rooms.find(r => r.id === o.other)?.name.toLowerCase() ?? 'next room')
  for (const d of doors) {
    const end = step(d.at, d.inward, ENTRY_DEPTH)
    const what = d.other === OUTSIDE ? 'the front door' : `the ${d.kind === 'door' ? 'door' : 'opening'} to the ${name(d)}`
    out.push({ kind: 'entry', why: what, width: ENTRY_WIDTH, door: d.id, routes: [route([[d.at, end]], ENTRY_WIDTH, room, false)] })
  }
  const inset = (o: RoomOpening) => step(o.at, o.inward, LANE_INSET)
  for (let i = 0; i < doors.length; i++) {
    for (let j = i + 1; j < doors.length; j++) {
      const a = doors[i]!
      const b = doors[j]!
      const routes = lanes(inset(a), inset(b), room)
      if (routes.length) out.push({ kind: 'through', why: `the way from the ${name(a)} to the ${name(b)}`, width: LANE_WIDTH, routes })
    }
  }
  // In a room so small that the doorway strip already reaches the middle (a bathroom, a closet), there is no further way in to keep.
  if (doors.length === 1 && dist(inset(doors[0]!), roomCenter(room)) >= REACH_MIN) {
    const d = doors[0]!
    const routes = lanes(inset(d), roomCenter(room), room)
    if (routes.length) out.push({ kind: 'reach', why: `the way in from the ${name(d)}`, width: LANE_WIDTH, routes })
  }
  return out
}

/** Straight, then shifted parallel lanes, then through the middle; only those whose centreline stays inside the room. */
function lanes(p: Vec2, q: Vec2, room: Room): Route[] {
  const L = dist(p, q)
  if (L < 0.1) return []
  const n: Vec2 = [-(q[1] - p[1]) / L, (q[0] - p[0]) / L]
  const options: [Vec2, Vec2][][] = [[[p, q]]]
  for (const s of LANE_SHIFTS) {
    const p2 = step(p, n, s)
    const q2 = step(q, n, s)
    options.push([[p, p2], [p2, q2], [q2, q]])
  }
  const c = roomCenter(room)
  if (dist(c, p) > 0.3 && dist(c, q) > 0.3) options.push([[p, c], [c, q]])
  return options.filter(segs => segs.every(([a, b]) => walkable(a, b, room))).map(segs => route(segs, LANE_WIDTH, room, true))
}

/** A centreline someone can walk: inside the room and not scraping a wall (the ends sit in doorways, so they are let off). */
function walkable(a: Vec2, b: Vec2, room: Room): boolean {
  const L = dist(a, b)
  const n = Math.max(1, Math.ceil(L / 0.1))
  for (let k = 0; k <= n; k++) {
    const t = k / n
    const pt: Vec2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    if (!pointInPolygon(pt, room.polygon, 0)) return false
    const fromEnd = Math.min(t, 1 - t) * L
    if (fromEnd > 0.3 && distToPolygonEdge(pt, room.polygon) < 0.25) return false
  }
  return true
}

function route(segs: [Vec2, Vec2][], width: number, room: Room, capped: boolean): Route {
  const convex = isConvex(room.polygon)
  const rects = segs.filter(([a, b]) => dist(a, b) > EPS).map(([a, b]) => {
    // Lane segments run on half a width past each end so a bend has no notch in its corner.
    const r = rectAlong(a, b, width, capped ? width / 2 : 0)
    if (!convex) return r
    const clipped = clipConvex(r, room.polygon)
    return clipped.length >= 3 ? clipped : r
  })
  return { segs, rects }
}

/** The rectangle `width` wide swept from a to b, run on by `cap` at both ends. */
export function rectAlong(a: Vec2, b: Vec2, width: number, cap = 0): Vec2[] {
  const L = dist(a, b)
  const u: Vec2 = L > EPS ? [(b[0] - a[0]) / L, (b[1] - a[1]) / L] : [1, 0]
  const n: Vec2 = [-u[1], u[0]]
  const h = width / 2
  const a0 = step(a, u, -cap)
  const b0 = step(b, u, cap)
  return [step(a0, n, h), step(b0, n, h), step(b0, n, -h), step(a0, n, -h)]
}

function step(p: Vec2, d: Vec2, k: number): Vec2 {
  return [p[0] + d[0] * k, p[1] + d[1] * k]
}

function isConvex(poly: Vec2[]): boolean {
  let sign = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    const c = poly[(i + 2) % poly.length]!
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
    if (Math.abs(cross) < EPS) continue
    if (sign && Math.sign(cross) !== sign) return false
    sign = Math.sign(cross)
  }
  return true
}

/** The part of polygon `a` inside convex polygon `b` (Sutherland–Hodgman). `a` may be concave. */
export function clipConvex(a: Vec2[], b: Vec2[]): Vec2[] {
  const s = signedArea(b) >= 0 ? 1 : -1
  let out = a
  for (let i = 0; i < b.length && out.length; i++) {
    const p = b[i]!
    const q = b[(i + 1) % b.length]!
    const inside = (v: Vec2) => ((q[0] - p[0]) * (v[1] - p[1]) - (q[1] - p[1]) * (v[0] - p[0])) * s >= -EPS
    const input = out
    out = []
    for (let j = 0; j < input.length; j++) {
      const cur = input[j]!
      const prev = input[(j + input.length - 1) % input.length]!
      const ci = inside(cur)
      if (ci !== inside(prev)) out.push(intersect(prev, cur, p, q))
      if (ci) out.push(cur)
    }
  }
  return out.length < 3 ? [] : out
}

/** Area shared by polygon `a` and convex polygon `b`; boxes that don't touch skip the clip. */
export function sharedArea(a: Vec2[], b: Vec2[]): number {
  if (!boxesTouch(a, b)) return 0
  const c = clipConvex(a, b)
  return c.length ? area(c) : 0
}

function boxesTouch(a: Vec2[], b: Vec2[]): boolean {
  const A = bbox(a)
  const B = bbox(b)
  return A[0] <= B[2] + EPS && B[0] <= A[2] + EPS && A[1] <= B[3] + EPS && B[1] <= A[3] + EPS
}

function bbox(poly: Vec2[]): [number, number, number, number] {
  let x0 = Infinity
  let z0 = Infinity
  let x1 = -Infinity
  let z1 = -Infinity
  for (const p of poly) {
    x0 = Math.min(x0, p[0])
    z0 = Math.min(z0, p[1])
    x1 = Math.max(x1, p[0])
    z1 = Math.max(z1, p[1])
  }
  return [x0, z0, x1, z1]
}

function intersect(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): Vec2 {
  const d = (a1[0] - a2[0]) * (b1[1] - b2[1]) - (a1[1] - a2[1]) * (b1[0] - b2[0])
  if (Math.abs(d) < EPS) return a2
  const t = ((a1[0] - b1[0]) * (b1[1] - b2[1]) - (a1[1] - b1[1]) * (b1[0] - b2[0])) / d
  return [a1[0] + t * (a2[0] - a1[0]), a1[1] + t * (a2[1] - a1[1])]
}

/** Distance from a point to a corridor segment's centreline. */
export function distToSeg(p: Vec2, [a, b]: [Vec2, Vec2]): number {
  const L2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2
  const t = L2 < EPS ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / L2))
  return dist(p, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
}
