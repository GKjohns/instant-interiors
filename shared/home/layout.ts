/**
 * The placement resolver: a Spot ("against the north wall", "beside the sofa", "where I'm looking") plus a
 * kind and a count → positions and yaws in metres. The model never does this maths. Every choice is
 * deterministic for a seed, so replaying the log lands everything where it was.
 *
 * Yaw convention: 0 faces -z, positive turns toward -x (three.js rotation.y). A kit piece's FRONT is its
 * local +z face, so `faceToward` is the one helper for "turn its front to X"; poly.ts's `yawToward` points
 * the local -z (the camera's forward) and is for the player.
 */
import { EPS, area, dirOf, dist, distToPolygonEdge, nearestEdge, pointInPolygon, signedArea, yawToward } from '../plan/poly.ts'
import type { Vec2 } from '../plan/poly.ts'
import type { FloorPlan, Room } from '../plan/schema.ts'
import { DOOR_CLEAR, DOOR_HEAD, WINDOW_SILL, cornersOf, doorsOf, freeAlong, roomAt, roomCenter, wallSegmentsOf, windowsOf } from '../plan/geometry.ts'
import type { Compass, RoomCorner, RoomOpening, RoomWall, Stretch } from '../plan/geometry.ts'
import type { KindDescriptor } from './kinds.ts'
import type { Arrangement, Props, Selector, Side, Spot, Where } from './ops.ts'
import { boxCorners, footprintOf, hereRoom, itemCorners, itemFootprint, kindOfItem, resolveRoom, select } from './select.ts'
import type { Footprint } from './select.ts'
import type { HomeState, Item, OpContext } from './types.ts'

export interface Placed {
  pos: Vec2
  yaw: number
  room: string
  /** Bottom of the piece above the floor: omitted on the floor, the anchor's top when placed on it, the hang height for wall pieces, the ceiling for hung fixtures. */
  y?: number
}

export interface LayoutOpts {
  /** The op's index in its batch: part of the seed, so two sofas in one sentence don't share jitter. */
  index: number
  count: number
  arrange?: Arrangement
  seed: number
  existing: Item[]
  props?: Props
}

export type LayoutResult = Placed[] | { fail: string }

/** Which things can share floor space: rugs go under everything, hung pieces only clash with what reaches them. */
export type Layer = 'floor' | 'under' | 'mounted' | 'ceiling' | 'top'

const TAU = Math.PI * 2
const STEP = 0.1
const WALL_GAP = 0.02
const ROW_GAP = 0.15
/** Touching footprints are fine; this much shared area (m², a 3 cm square) is a real overlap. */
const OVERLAP_TOL = 0.001
const MAX_TRIES = 900
const NUDGE_RADII = [0.15, 0.3, 0.45, 0.6, 0.8, 1.0, 1.3, 1.6]

// ---------- seeded randomness and angles ----------

export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hashSeed(...parts: (string | number)[]): number {
  let h = 2166136261
  for (const ch of parts.join('|')) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function normYaw(yaw: number): number {
  const y = Math.atan2(Math.sin(yaw), Math.cos(yaw))
  return Object.is(y, -0) ? 0 : y
}

/** The yaw that turns a piece's front (local +z) toward `target`. */
export function faceToward(pos: Vec2, target: Vec2): number {
  return normYaw(yawToward(pos, target) + Math.PI)
}

/** The yaw whose front points along `dir`. */
export function yawFacing(dir: Vec2): number {
  return normYaw(Math.atan2(dir[0], dir[1]))
}

/** Unit vector of a piece's front (local +z) in the plan frame. */
export function frontOf(yaw: number): Vec2 {
  return [Math.sin(yaw), Math.cos(yaw)]
}

/** Unit vector of a piece's local +x: its own left-hand side when it looks out of its front. */
export function sideOf(yaw: number): Vec2 {
  return [Math.cos(yaw), -Math.sin(yaw)]
}

function add(p: Vec2, d1: Vec2, k1: number, d2: Vec2 = [0, 0], k2 = 0): Vec2 {
  return [p[0] + d1[0] * k1 + d2[0] * k2, p[1] + d1[1] * k1 + d2[1] * k2]
}

function dot(a: Vec2, b: Vec2): number {
  return a[0] * b[0] + a[1] * b[1]
}

// ---------- footprint overlap ----------

/** Area shared by two convex polygons (Sutherland–Hodgman clip of `a` by `b`). */
export function overlapArea(a: Vec2[], b: Vec2[]): number {
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
  return out.length < 3 ? 0 : area(out)
}

function intersect(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): Vec2 {
  const d = (a1[0] - a2[0]) * (b1[1] - b2[1]) - (a1[1] - a2[1]) * (b1[0] - b2[0])
  if (Math.abs(d) < EPS) return a2
  const t = ((a1[0] - b1[0]) * (b1[1] - b2[1]) - (a1[1] - b1[1]) * (b1[0] - b2[0])) / d
  return [a1[0] + t * (a2[0] - a1[0]), a1[1] + t * (a2[1] - a1[1])]
}

export function layerOf(kind: KindDescriptor, y?: number): Layer {
  if (kind.place === 'ceiling') return 'ceiling'
  if (kind.place === 'wall_mounted') return 'mounted'
  if (kind.tags.includes('textile')) return 'under'
  if (y !== undefined && y > 0.05) return 'top'
  return 'floor'
}

export function itemLayer(item: Item): Layer {
  const kind = kindOfItem(item)
  return kind ? layerOf(kind, item.y) : 'floor'
}

interface Blocker {
  id: string
  box: Vec2[]
  layer: Layer
  y: number
  top: number
}

function blockerOf(item: Item): Blocker {
  const y = item.y ?? 0
  return { id: item.id, box: itemCorners(item), layer: itemLayer(item), y, top: y + itemFootprint(item).height }
}

/** Do two things fight for the same space? Rugs never do; hung and ceiling pieces only with what reaches their height. */
function conflicts(c: Blocker, b: Blocker): boolean {
  if (c.layer === 'under' || b.layer === 'under') return false
  if (c.layer === 'ceiling' || b.layer === 'ceiling') return c.layer === b.layer && overlaps(c.box, b.box)
  if (c.layer === 'top' || b.layer === 'top') return c.layer === b.layer && Math.abs(c.y - b.y) < 0.1 && overlaps(c.box, b.box)
  if (c.layer === 'mounted' || b.layer === 'mounted') return Math.min(c.top, b.top) - Math.max(c.y, b.y) > 0.02 && overlaps(c.box, b.box)
  return overlaps(c.box, b.box)
}

function overlaps(a: Vec2[], b: Vec2[]): boolean {
  return overlapArea(a, b) > OVERLAP_TOL
}

// ---------- the scene a placement is resolved in ----------

interface Cand extends Placed {
  /** Against a wall or in a row: swept along, never nudged off its line or pulled toward the centre. */
  pinned?: boolean
}

interface Scene {
  state: HomeState
  plan: FloorPlan
  ctx: OpContext
  room: Room
  poly: Vec2[]
  center: Vec2
  walls: RoomWall[]
  corners: RoomCorner[]
  windows: RoomOpening[]
  doors: RoomOpening[]
  kind: KindDescriptor
  fp: Footprint
  props: Props
  spot: Spot | undefined
  anchor?: Item
  anchors: Item[]
  blockers: Blocker[]
  rand: () => number
  ceiling: number
}

type Place = Where | 'free'

function makeScene(state: HomeState, room: Room, kind: KindDescriptor, spot: Spot | undefined, ctx: OpContext, opts: LayoutOpts, anchors: Item[], rand: () => number): Scene {
  const props = opts.props ?? {}
  let fp = footprintOf(kind, props)
  // Curtains are cut to their window unless the sentence sized them.
  if (kind.kind === 'curtains' && !props.length) {
    const w = windowsOf(state.plan, room).find(x => x.side === spot?.wall) ?? windowsOf(state.plan, room)[0]
    if (w) fp = { ...fp, length: w.width + 0.4 }
  }
  const blockers = opts.existing.filter(i => i.room === room.id).map(blockerOf)
  for (const d of doorsOf(state.plan, room)) {
    if (d.kind !== 'door') continue
    const c = add(d.at, d.inward, d.width / 2)
    blockers.push({ id: `swing:${d.id}`, box: boxCorners(c, yawFacing(d.inward), d.width, d.width), layer: 'floor', y: 0, top: DOOR_HEAD })
  }
  if (roomAt(state.plan, ctx.player.pos)?.id === room.id) {
    blockers.push({ id: 'player', box: boxCorners(ctx.player.pos, 0, 0.5, 0.5), layer: 'floor', y: 0, top: 1.8 })
  }
  return {
    state,
    plan: state.plan,
    ctx,
    room,
    poly: room.polygon,
    center: roomCenter(room),
    walls: wallSegmentsOf(state.plan, room),
    corners: cornersOf(room).filter(c => c.convex),
    windows: windowsOf(state.plan, room),
    doors: doorsOf(state.plan, room),
    kind,
    fp,
    props,
    spot,
    anchor: anchors[0],
    anchors,
    blockers,
    rand,
    ceiling: state.plan.ceiling
  }
}

function hangOf(sc: Scene): number {
  return sc.props.hang ?? sc.kind.hang ?? 1.5
}

/** Storage, appliances and fixtures pack from a wall's end; seating, beds and art sit centred on it. */
function packs(kind: KindDescriptor): boolean {
  return !kind.tags.some(t => t === 'seating' || t === 'bed' || t === 'art' || t === 'decor' || t === 'textile')
}

function alongLongest(sc: Scene): number {
  const d = [...sc.walls].sort((p, q) => q.length - p.length)[0]!.dir
  return normYaw(Math.atan2(-d[1], d[0]))
}

/** The room wall an item's back rests against (within 15 cm), if any. */
function backWall(sc: Scene, item: Item): RoomWall | undefined {
  const walls = item.room === sc.room.id ? sc.walls : wallSegmentsOf(sc.plan, sc.plan.rooms.find(r => r.id === item.room) ?? sc.room)
  const f = frontOf(item.yaw)
  const back = add(item.pos, f, -itemFootprint(item).width / 2)
  return walls.find(rw => dot(rw.inward, f) > 0.9 && distToSegment(back, rw) < 0.15)
}

function distToSegment(p: Vec2, rw: RoomWall): number {
  const t = Math.max(0, Math.min(rw.length, dot([p[0] - rw.a[0], p[1] - rw.a[1]], rw.dir)))
  return dist(p, add(rw.a, rw.dir, t))
}

// ---------- validation ----------

function fits(sc: Scene, cand: Cand, extra: Blocker[]): Cand | null {
  const layer = layerOf(sc.kind, cand.y)
  let c: Cand | null = cand
  if (layer !== 'top') c = keepInside(sc, cand)
  if (!c) return null
  const y = c.y ?? 0
  const me: Blocker = { id: '', box: boxCorners(c.pos, c.yaw, sc.fp.length, sc.fp.width), layer, y, top: y + sc.fp.height }
  for (const b of sc.blockers) {
    // You can stand where a wall piece goes (step aside); only free placements keep off the viewer.
    if (b.id === 'player' && (c.pinned || layer !== 'floor')) continue
    if (conflicts(me, b)) return null
  }
  for (const b of extra) if (conflicts(me, b)) return null
  return c
}

/** Shrink toward the room's centre until the whole footprint is inside; pinned candidates must already be. */
function keepInside(sc: Scene, c: Cand): Cand | null {
  const inside = (p: Vec2) => boxCorners(p, c.yaw, sc.fp.length, sc.fp.width).every(k => pointInPolygon(k, sc.poly, 0.03))
  if (inside(c.pos)) return c
  if (c.pinned) return null
  const d = dist(c.pos, sc.center)
  if (d < EPS) return null
  const dir: Vec2 = [(sc.center[0] - c.pos[0]) / d, (sc.center[1] - c.pos[1]) / d]
  for (let k = 1; k <= 40; k++) {
    const p = add(c.pos, dir, k * 0.05)
    if (inside(p)) return { ...c, pos: p }
  }
  return null
}

function finish(sc: Scene, c: Cand): Cand {
  let out = c
  if (sc.kind.place === 'ceiling') out = { ...out, y: sc.ceiling - sc.fp.height }
  else if (sc.kind.place === 'wall_mounted' && out.y === undefined) out = { ...out, y: Math.max(0.05, hangOf(sc) - sc.fp.height / 2) }
  return applyFacing(sc, out)
}

function applyFacing(sc: Scene, c: Cand): Cand {
  const f = sc.spot?.facing
  if (!f) return c
  switch (f) {
    case 'room': return { ...c, yaw: faceToward(c.pos, sc.center) }
    case 'wall': {
      const e = nearestEdge(c.pos, sc.poly)
      return { ...c, yaw: yawFacing([-e.normal[0], -e.normal[1]]) }
    }
    case 'window': return sc.windows[0] ? { ...c, yaw: faceToward(c.pos, sc.windows[0].at) } : c
    case 'player': return { ...c, yaw: faceToward(c.pos, sc.ctx.player.pos) }
    case 'of': return sc.anchor ? { ...c, yaw: faceToward(c.pos, sc.anchor.pos) } : c
    default: return { ...c, yaw: yawFacing(dirOf(f)) }
  }
}

function firstFit(sc: Scene, cands: Iterable<Cand>, extra: Blocker[]): Cand | null {
  let tries = 0
  for (const c of cands) {
    if (++tries > MAX_TRIES) break
    const f = fits(sc, finish(sc, c), extra)
    if (f) return f
  }
  return null
}

function toBlocker(sc: Scene, c: Cand): Blocker {
  const y = c.y ?? 0
  return { id: '', box: boxCorners(c.pos, c.yaw, sc.fp.length, sc.fp.width), layer: layerOf(sc.kind, c.y), y, top: y + sc.fp.height }
}

// ---------- candidate streams, best first ----------

/** base, then outward in alternating steps, clamped to [lo, hi]. */
function* sweep(base: number, lo: number, hi: number, step = STEP): Generator<number> {
  if (lo > hi) {
    yield base
    return
  }
  const b = Math.min(hi, Math.max(lo, base))
  yield b
  for (let k = 1; ; k++) {
    const up = b + k * step
    const down = b - k * step
    const okUp = up <= hi + 1e-9
    const okDown = down >= lo - 1e-9
    if (!okUp && !okDown) return
    if (okUp) yield up
    if (okDown) yield down
  }
}

/** The candidate itself, then a widening spiral around it (axis-aligned to its yaw first). */
function* nudged(cands: Iterable<Cand>): Generator<Cand> {
  for (const c of cands) {
    yield c
    if (c.pinned) continue
    const x = sideOf(c.yaw)
    const z = frontOf(c.yaw)
    const dirs: Vec2[] = [x, [-x[0], -x[1]], z, [-z[0], -z[1]], add([0, 0], x, 0.707, z, 0.707), add([0, 0], x, -0.707, z, 0.707), add([0, 0], x, 0.707, z, -0.707), add([0, 0], x, -0.707, z, -0.707)]
    for (const r of NUDGE_RADII) for (const d of dirs) yield { ...c, pos: add(c.pos, d, r) }
  }
}

function* candidates(sc: Scene, where: Place, side: Side | undefined, span: number): Generator<Cand> {
  switch (where) {
    case 'wall': return yield* wallCands(sc, span, sc.spot?.wall)
    case 'corner': return yield* cornerCands(sc, span)
    case 'window': return yield* windowCands(sc, span)
    case 'door': return yield* doorCands(sc, span)
    case 'center': return yield* nudged(centerCands(sc))
    case 'free': return yield* nudged(freeCands(sc))
    case 'gaze': return yield* nudged(pointCands(sc, sc.ctx.gaze.point, span, 'gaze'))
    case 'here': return yield* nudged(pointCands(sc, sc.ctx.player.pos, span, 'here'))
    case 'near': return yield* nudged(nearCands(sc, side, span))
  }
}

/** Free stretches of a wall for this piece: doors always excluded, windows too when the piece would stand in front of the glass. */
function stretchesFor(sc: Scene, rw: RoomWall): Stretch[] {
  const layer = layerOf(sc.kind)
  const sill = Math.min(WINDOW_SILL, ...rw.windows.map(w => w.y0))
  const avoidWindows = layer === 'mounted' || (layer === 'floor' && sc.fp.height > sill)
  return freeAlong(rw.length, avoidWindows ? rw.openings : rw.doors, DOOR_CLEAR)
}

function rankWalls(sc: Scene, compass?: Compass): RoomWall[] {
  const rank = (rw: RoomWall) => (rw.doors.length ? 2 : rw.windows.length ? 1 : 0)
  const longest = (rw: RoomWall) => Math.max(0, ...stretchesFor(sc, rw).map(s => s.length))
  return sc.walls
    .filter(rw => !compass || rw.side === compass)
    .sort((p, q) => rank(p) - rank(q) || longest(q) - longest(p))
}

function wallPose(sc: Scene, rw: RoomWall, along: number, gap: number): Cand {
  const point = add(rw.a, rw.dir, along)
  const mounted = sc.kind.place === 'wall_mounted'
  return {
    pos: add(point, rw.inward, sc.fp.width / 2 + (mounted ? 0 : gap)),
    yaw: yawFacing(rw.inward),
    room: sc.room.id,
    ...(mounted ? { y: Math.max(0.05, hangOf(sc) - sc.fp.height / 2) } : {}),
    pinned: true
  }
}

function* wallCands(sc: Scene, span: number, compass?: Compass): Generator<Cand> {
  const gap = sc.spot?.dist ?? WALL_GAP
  for (const rw of rankWalls(sc, compass)) {
    for (const st of stretchesFor(sc, rw)) {
      if (st.length < span) continue
      const lo = st.from + span / 2
      const hi = st.to - span / 2
      // Packing starts at a real corner of the room, not at the edge of a door.
      const fromCorner = st.from <= 0.01 ? lo : st.to >= rw.length - 0.01 ? hi : lo
      const base = packs(sc.kind) ? fromCorner : (lo + hi) / 2
      for (const along of sweep(base, lo, hi)) yield wallPose(sc, rw, along, gap)
    }
  }
}

/** Facing a wall from inside the room, which compass side is on your left. */
function leftOfWall(c: Compass): Compass {
  return c === 'north' ? 'west' : c === 'south' ? 'east' : c === 'east' ? 'north' : 'south'
}

function* cornerCands(sc: Scene, span: number): Generator<Cand> {
  const gap = sc.spot?.dist ?? WALL_GAP
  const want = sc.spot?.wall
  const other = want && sc.spot?.side === 'left' ? leftOfWall(want) : want && sc.spot?.side === 'right' ? leftOfWall(leftOfWall(leftOfWall(want))) : undefined
  const doorDist = (c: RoomCorner) => Math.min(Infinity, ...sc.doors.map(d => dist(d.at, c.point)))
  const corners = sc.corners
    .filter(c => !want || (c.walls.includes(want) && (!other || c.walls.includes(other))))
    .map(c => ({ c, score: Math.min(doorDist(c), 3) + sc.rand() * 0.01 }))
    .sort((p, q) => q.score - p.score)
    .map(x => x.c)
  // Every corner proper before anything slides along a wall away from one.
  for (const slide of [0, 0.1, 0.2, 0.35, 0.5, 0.7]) {
    for (const c of corners) {
      const e0 = sc.walls[c.edges[0]]!
      const e1 = sc.walls[c.edges[1]]!
      const backs = e0.length >= e1.length ? [[e0, e1], [e1, e0]] : [[e1, e0], [e0, e1]]
      for (const [back, other] of backs as [RoomWall, RoomWall][]) {
        const pos = add(add(c.point, back.inward, sc.fp.width / 2 + gap), other.inward, span / 2 + gap + slide)
        let yaw = yawFacing(back.inward)
        // A squarish room-facing piece (armchair, sectional corner) looks into the room rather than along one wall.
        if (sc.kind.face === 'room' && Math.abs(sc.fp.length - sc.fp.width) < 0.25) yaw = faceToward(pos, sc.center)
        yield { pos, yaw, room: sc.room.id, pinned: true }
      }
    }
  }
}

function* windowCands(sc: Scene, span: number): Generator<Cand> {
  const gap = sc.spot?.dist ?? WALL_GAP
  const windows = sc.windows.filter(w => !sc.spot?.wall || w.side === sc.spot.wall)
  for (const w of windows) {
    const rw = sc.walls[w.edge]!
    const stretch = freeAlong(rw.length, rw.doors, DOOR_CLEAR).find(s => s.from <= w.along && w.along <= s.to)
    const lo = (stretch?.from ?? 0) + span / 2
    const hi = (stretch?.to ?? rw.length) - span / 2
    for (const along of sweep(w.along, Math.max(lo, w.along - 1), Math.min(hi, w.along + 1))) yield wallPose(sc, rw, along, gap)
  }
}

function* doorCands(sc: Scene, span: number): Generator<Cand> {
  const doors = [...sc.doors]
    .filter(d => !sc.spot?.wall || d.side === sc.spot.wall)
    .sort((p, q) => Number(q.kind === 'door') - Number(p.kind === 'door') || Number(q.other === 'outside') - Number(p.other === 'outside'))
  const wallKind = sc.kind.place === 'wall' || sc.kind.place === 'wall_mounted' || sc.kind.place === 'corner'
  for (const d of doors) {
    const rw = sc.walls[d.edge]!
    if (wallKind) {
      const stretches = stretchesFor(sc, rw)
      for (const sgn of [1, -1]) {
        for (const out of [0, 0.1, 0.2, 0.4, 0.6, 0.9]) {
          const along = d.along + sgn * (d.width / 2 + DOOR_CLEAR + 0.05 + out + span / 2)
          if (!stretches.some(s => s.from <= along - span / 2 + 1e-6 && along + span / 2 <= s.to + 1e-6)) continue
          yield wallPose(sc, rw, along, sc.spot?.dist ?? WALL_GAP)
        }
      }
    } else {
      const pos = add(d.at, rw.inward, sc.fp.width / 2 + (sc.spot?.dist ?? 0.4))
      yield { pos, yaw: yawFacing(rw.inward), room: sc.room.id }
    }
  }
}

function* centerCands(sc: Scene): Generator<Cand> {
  let pos = sc.center
  let yaw = alongLongest(sc)
  // A rug with seating in the room goes under the seating group, not in the geometric middle.
  if (sc.kind.tags.includes('textile')) {
    const seats = sc.state.items.filter(i => i.room === sc.room.id && i.tags.includes('seating') && itemLayer(i) === 'floor')
    if (seats.length) {
      const cx = seats.reduce((s, i) => s + i.pos[0], 0) / seats.length
      const cz = seats.reduce((s, i) => s + i.pos[1], 0) / seats.length
      pos = [(cx + sc.center[0]) / 2, (cz + sc.center[1]) / 2]
      yaw = [...seats].sort((p, q) => dist(p.pos, pos) - dist(q.pos, pos))[0]!.yaw
    }
  }
  yield { pos, yaw, room: sc.room.id }
}

/** Free-standing things keep out of the very middle: a seeded ring around the centre, facing in. */
function* freeCands(sc: Scene): Generator<Cand> {
  for (let k = 0; k < 6; k++) {
    const a = sc.rand() * TAU
    const r = 0.6 + sc.rand() * 1.2
    const pos: Vec2 = [sc.center[0] + Math.cos(a) * r, sc.center[1] + Math.sin(a) * r]
    yield { pos, yaw: sc.kind.face === 'room' ? faceToward(pos, sc.center) : alongLongest(sc), room: sc.room.id }
  }
  yield { pos: sc.center, yaw: alongLongest(sc), room: sc.room.id }
}

/** "There" / "here": the point itself; wall pieces snap to the nearest wall when one is close. */
function* pointCands(sc: Scene, point: Vec2, span: number, mode: 'gaze' | 'here'): Generator<Cand> {
  const wallKind = sc.kind.place === 'wall' || sc.kind.place === 'wall_mounted'
  const e = nearestEdge(point, sc.poly)
  if (wallKind && e.d <= 1.5) {
    const rw = sc.walls[e.index]!
    const along = dot([point[0] - rw.a[0], point[1] - rw.a[1]], rw.dir)
    const st = stretchesFor(sc, rw).sort((p, q) => Math.abs((p.from + p.to) / 2 - along) - Math.abs((q.from + q.to) / 2 - along))
    for (const s of st) {
      if (s.length < span) continue
      for (const a of sweep(along, s.from + span / 2, s.to - span / 2)) yield wallPose(sc, rw, a, sc.spot?.dist ?? WALL_GAP)
    }
  }
  const player = sc.ctx.player
  const underfoot = sc.kind.tags.includes('textile')
  const pos = mode === 'here' && !underfoot ? add(player.pos, frontOf(player.yaw), -(0.4 + sc.fp.width / 2)) : point
  const yaw = sc.kind.face === 'room' ? faceToward(pos, player.pos) : mode === 'here' ? normYaw(player.yaw + Math.PI) : alongLongest(sc)
  yield { pos, yaw, room: sc.room.id }
}

function gapFor(sc: Scene, side: Side | undefined): number {
  const d = sc.spot?.dist
  if (d !== undefined) return sc.kind.tags.includes('textile') ? d : Math.max(0, d)
  return side === 'front' || side === 'behind' ? 0.3 : side === 'on' ? 0 : 0.1
}

function* nearCands(sc: Scene, side: Side | undefined, span: number): Generator<Cand> {
  const A = sc.anchor!
  const fa = itemFootprint(A)
  const f = frontOf(A.yaw)
  const lft = sideOf(A.yaw)
  const g = gapFor(sc, side)
  const room = A.room
  const facesAnchor = sc.kind.face === 'anchor' || (sc.kind.tags.includes('seating') && (side === 'front' || side === 'behind' || side === 'opposite'))
  const yawFor = (pos: Vec2) => (facesAnchor ? faceToward(pos, A.pos) : A.yaw)
  if (sc.kind.place === 'ceiling') {
    yield { pos: A.pos, yaw: A.yaw, room }
    return
  }
  switch (side ?? 'beside') {
    case 'front':
    case 'behind': {
      if (side === 'behind' && sc.kind.place === 'wall_mounted') return yield* behindOnWall(sc, A, fa, span)
      const sgn = side === 'behind' ? -1 : 1
      const d0 = fa.width / 2 + g + sc.fp.width / 2
      for (const extra of [0, 0.2, 0.4, 0.7, 1.0]) {
        for (const s of sweep(0, -fa.length / 2, fa.length / 2, 0.15)) {
          const pos = add(A.pos, f, sgn * (d0 + extra), lft, s)
          yield { pos, yaw: yawFor(pos), room }
        }
      }
      return
    }
    case 'left':
    case 'right':
    case 'beside': {
      // The asked side first; the other side is better than nothing.
      const order = side === 'left' ? [1, -1] : side === 'right' ? [-1, 1] : sc.rand() < 0.5 ? [1, -1] : [-1, 1]
      for (const sgn of order) yield* sideCands(sc, A, fa, sgn, span, g, yawFor)
      return
    }
    case 'opposite': return yield* oppositeCands(sc, A, span)
    case 'on': return yield* onCands(sc, A, fa, span)
  }
}

function* sideCands(sc: Scene, A: Item, fa: Footprint, sgn: number, span: number, g: number, yawFor: (p: Vec2) => number): Generator<Cand> {
  const lft = sideOf(A.yaw)
  const back = backWall(sc, A)
  const snap = back && (sc.kind.place === 'wall' || sc.kind.place === 'wall_mounted')
  for (const extra of [0, 0.1, 0.2, 0.3, 0.5, 0.8]) {
    const pos = add(A.pos, lft, sgn * (fa.length / 2 + g + span / 2 + extra))
    if (snap) {
      // A nightstand beside a bed, a stove beside the counter: keep its back on the same wall as the anchor.
      const along = dot([pos[0] - back.a[0], pos[1] - back.a[1]], back.dir)
      yield wallPose(sc, back, along, WALL_GAP)
    } else yield { pos, yaw: yawFor(pos), room: A.room }
  }
}

function* behindOnWall(sc: Scene, A: Item, fa: Footprint, span: number): Generator<Cand> {
  const f = frontOf(A.yaw)
  const back = add(A.pos, f, -fa.width / 2)
  const rw = backWall(sc, A) ?? sc.walls.filter(w => dot(w.inward, f) > 0.7).sort((p, q) => distToSegment(back, p) - distToSegment(back, q))[0]
  if (!rw) return
  const along = dot([A.pos[0] - rw.a[0], A.pos[1] - rw.a[1]], rw.dir)
  const st = stretchesFor(sc, rw).sort((p, q) => Math.abs((p.from + p.to) / 2 - along) - Math.abs((q.from + q.to) / 2 - along))
  for (const s of st) {
    if (s.length < span) continue
    for (const a of sweep(along, s.from + span / 2, s.to - span / 2)) yield wallPose(sc, rw, a, 0)
  }
}

/** Across the room from the anchor: where its front points meets a wall. */
function* oppositeCands(sc: Scene, A: Item, span: number): Generator<Cand> {
  const f = frontOf(A.yaw)
  let hit: { rw: RoomWall, t: number } | undefined
  for (const rw of sc.walls) {
    const t = rayToSegment(A.pos, f, rw.a, rw.b)
    if (t !== null && t > 0.05 && (!hit || t < hit.t)) hit = { rw, t }
  }
  if (!hit) return
  const point = add(A.pos, f, hit.t)
  const along = dot([point[0] - hit.rw.a[0], point[1] - hit.rw.a[1]], hit.rw.dir)
  const st = stretchesFor(sc, hit.rw).sort((p, q) => Math.abs((p.from + p.to) / 2 - along) - Math.abs((q.from + q.to) / 2 - along))
  for (const s of st) {
    if (s.length < span) continue
    for (const a of sweep(along, s.from + span / 2, s.to - span / 2)) yield wallPose(sc, hit.rw, a, sc.spot?.dist ?? WALL_GAP)
  }
}

function rayToSegment(o: Vec2, d: Vec2, a: Vec2, b: Vec2): number | null {
  const e: Vec2 = [b[0] - a[0], b[1] - a[1]]
  const den = d[0] * e[1] - d[1] * e[0]
  if (Math.abs(den) < EPS) return null
  const ao: Vec2 = [a[0] - o[0], a[1] - o[1]]
  const t = (ao[0] * e[1] - ao[1] * e[0]) / den
  const u = (ao[0] * d[1] - ao[1] * d[0]) / den
  return t >= 0 && u >= -1e-6 && u <= 1 + 1e-6 ? t : null
}

/**
 * On top of the anchor for most things; hung on the wall above a wall-backed anchor for hang kinds (mirror
 * over the vanity, cabinets over the counter). A TV is the exception: it stands on its stand.
 */
function* onCands(sc: Scene, A: Item, fa: Footprint, span: number): Generator<Cand> {
  const top = (A.y ?? 0) + fa.height
  const back = backWall(sc, A)
  if (sc.kind.hang && sc.kind.kind !== 'tv' && back) {
    const along = dot([A.pos[0] - back.a[0], A.pos[1] - back.a[1]], back.dir)
    const y = Math.max(hangOf(sc) - sc.fp.height / 2, top + 0.05)
    for (const a of sweep(along, span / 2, back.length - span / 2)) yield { ...wallPose(sc, back, a, 0), y }
    return
  }
  const lft = sideOf(A.yaw)
  const room = (fa.length - span) / 2
  for (const s of sweep(0, -room, room)) yield { pos: add(A.pos, lft, s), yaw: A.yaw, room: A.room, y: top, pinned: true }
}

// ---------- groups ----------

type Arr = Arrangement | 'each'

function defaultArrange(where: Place, side: Side | undefined): Arr {
  if (where === 'wall' || where === 'window' || where === 'door') return 'row'
  if (where === 'corner') return 'each'
  if (where === 'near') return side === 'on' || side === 'beside' || side === 'opposite' ? 'each' : 'row'
  return 'cluster'
}

function row(sc: Scene, where: Place, side: Side | undefined, n: number, gap = ROW_GAP): Cand[] {
  const L = sc.fp.length
  const span = n * L + (n - 1) * gap
  let tries = 0
  for (const c of candidates(sc, where, side, span)) {
    if (++tries > MAX_TRIES) break
    const base = finish(sc, c)
    const axis = sideOf(base.yaw)
    const group: Cand[] = []
    const extra: Blocker[] = []
    for (let i = 0; i < n; i++) {
      const p: Cand = { ...base, pos: add(base.pos, axis, (i - (n - 1) / 2) * (L + gap)), pinned: true }
      const f = fits(sc, p, extra)
      if (!f) break
      group.push(f)
      extra.push(toBlocker(sc, f))
    }
    if (group.length === n) return group
  }
  return each(sc, where, side, n)
}

/** One at a time, each avoiding the ones before: as many as the room takes. */
function each(sc: Scene, where: Place, side: Side | undefined, n: number): Cand[] {
  const out: Cand[] = []
  const extra: Blocker[] = []
  for (let i = 0; i < n; i++) {
    const anchor = sc.anchors[i % Math.max(1, sc.anchors.length)]
    const scene = anchor && anchor !== sc.anchor ? { ...sc, anchor } : sc
    const f = firstFit(scene, candidates(scene, where, side, sc.fp.length), extra)
    if (!f) break
    out.push(f)
    extra.push(toBlocker(sc, f))
  }
  return out
}

function cluster(sc: Scene, where: Place, side: Side | undefined, n: number): Cand[] {
  const base = firstFit(sc, candidates(sc, where, side, sc.fp.length), [])
  if (!base) return []
  const out = [base]
  const extra = [toBlocker(sc, base)]
  const R = 0.45 * Math.sqrt(n) * Math.max(sc.fp.length, sc.fp.width) + 0.25
  for (let i = 1; i < n; i++) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const a = sc.rand() * TAU
      const r = R * Math.sqrt(sc.rand())
      const pos: Vec2 = [base.pos[0] + Math.cos(a) * r, base.pos[1] + Math.sin(a) * r]
      const yaw = sc.kind.face === 'room' ? faceToward(pos, base.pos) : normYaw(base.yaw + (sc.rand() - 0.5) * 0.6)
      const f = firstFit(sc, nudged([{ ...base, pos, yaw, pinned: false }]), extra)
      if (!f) continue
      out.push(f)
      extra.push(toBlocker(sc, f))
      break
    }
  }
  return out
}

function pair(sc: Scene): Cand[] {
  const out: Cand[] = []
  const extra: Blocker[] = []
  for (const side of ['left', 'right'] as const) {
    const f = firstFit(sc, nudged(nearCands(sc, side, sc.fp.length)), extra)
    if (!f) continue
    out.push(f)
    extra.push(toBlocker(sc, f))
  }
  return out
}

/** Chairs round a table: long sides first, evenly spread, each facing straight in. Round tables get a ring. */
function around(sc: Scene, n: number): Cand[] {
  const A = sc.anchor!
  const fa = itemFootprint(A)
  const gap = sc.spot?.dist ?? 0.05
  const out: Cand[] = []
  const extra: Blocker[] = []
  const take = (c: Cand) => {
    const f = fits(sc, applyFacing(sc, c), extra)
    if (!f) return
    out.push(f)
    extra.push(toBlocker(sc, f))
  }
  if (A.kind === 'round_table' || Math.abs(fa.length - fa.width) < 0.05) {
    const r = fa.length / 2 + gap + sc.fp.width / 2
    const start = sc.rand() * TAU
    for (let i = 0; i < n; i++) {
      const a = start + (i * TAU) / n
      const pos: Vec2 = [A.pos[0] + Math.cos(a) * r, A.pos[1] + Math.sin(a) * r]
      take({ pos, yaw: faceToward(pos, A.pos), room: A.room, pinned: true })
    }
    return out
  }
  const f = frontOf(A.yaw)
  const lft = sideOf(A.yaw)
  const sides = [
    { dir: f, axis: lft, len: fa.length, depth: fa.width / 2 },
    { dir: [-f[0], -f[1]] as Vec2, axis: lft, len: fa.length, depth: fa.width / 2 },
    { dir: lft, axis: f, len: fa.width, depth: fa.length / 2 },
    { dir: [-lft[0], -lft[1]] as Vec2, axis: f, len: fa.width, depth: fa.length / 2 }
  ].map(s => ({ ...s, cap: Math.max(0, Math.floor((s.len + 0.1) / (sc.fp.length + 0.1))), seats: 0 }))
  // Long sides fill first, split evenly; the ends take what is left.
  const long = Math.min(n, sides[0]!.cap + sides[1]!.cap)
  sides[0]!.seats = Math.min(sides[0]!.cap, Math.ceil(long / 2))
  sides[1]!.seats = Math.min(sides[1]!.cap, long - sides[0]!.seats)
  const ends = n - sides[0]!.seats - sides[1]!.seats
  sides[2]!.seats = Math.min(sides[2]!.cap, Math.ceil(ends / 2))
  sides[3]!.seats = Math.min(sides[3]!.cap, ends - sides[2]!.seats)
  for (const s of sides) {
    for (let j = 0; j < s.seats; j++) {
      const off = ((j + 0.5) / s.seats - 0.5) * s.len
      const pos = add(A.pos, s.dir, s.depth + gap + sc.fp.width / 2, s.axis, off)
      take({ pos, yaw: yawFacing([-s.dir[0], -s.dir[1]]), room: A.room, pinned: true })
    }
  }
  return out
}

// ---------- entry point ----------

/**
 * Resolve a Spot for `count` pieces of `kind`. Returns every pose that fits (fewer than asked when the
 * room is tight; the caller notes the difference) or why none did. Deterministic for (seed, index, kind).
 */
export function resolveSpot(state: HomeState, spot: Spot | undefined, kind: KindDescriptor, ctx: OpContext, opts: LayoutOpts): LayoutResult {
  const rand = rng(hashSeed(opts.seed, opts.index, kind.kind))
  let anchors: Item[] = []
  if (spot?.of) {
    anchors = pickAnchors(state, spot, ctx)
    if (!anchors.length) return { fail: `no ${describeSel(spot.of)} to put the ${kind.label} near` }
  }
  const room = roomFor(state, spot, ctx, anchors[0])
  if (!room) return { fail: spot?.room ? `I don't know a room called “${spot.room}”` : 'no room to put it in' }
  const sc = makeScene(state, room, kind, spot, ctx, opts, anchors, rand)
  const where = whereOf(spot, kind, sc.anchor)
  const side = spot?.side ?? (where === 'near' ? 'beside' : undefined)
  const n = Math.max(1, Math.round(opts.count))
  const placed = n === 1 ? [firstFit(sc, candidates(sc, where, side, sc.fp.length), [])].filter((c): c is Cand => !!c) : group(sc, where, side, n, opts.arrange)
  if (!placed.length) return { fail: failMessage(sc, where, side) }
  return placed.map(p => ({ pos: [round3(p.pos[0]), round3(p.pos[1])] as Vec2, yaw: round3(p.yaw), room: p.room, ...(p.y !== undefined ? { y: round3(p.y) } : {}) }))
}

function group(sc: Scene, where: Place, side: Side | undefined, n: number, arrange: Arrangement | undefined): Cand[] {
  const arr: Arr = arrange ?? defaultArrange(where, side)
  switch (arr) {
    case 'around': return sc.anchor ? around(sc, n) : cluster(sc, where, side, n)
    case 'pair': return sc.anchor && where === 'near' && n === 2 ? pair(sc) : row(sc, where, side, n, 0.4)
    case 'row': return row(sc, where, side, n)
    case 'cluster': return cluster(sc, where, side, n)
    case 'each': return each(sc, where, side, n)
  }
}

function whereOf(spot: Spot | undefined, kind: KindDescriptor, anchor: Item | undefined): Place {
  if (spot?.where && spot.where !== 'near') return spot.where
  if (anchor) return 'near'
  if (spot?.where === 'near') return 'gaze'
  if (spot?.wall) return spot.side && spot.where !== 'wall' ? 'corner' : 'wall'
  switch (kind.place) {
    case 'wall':
    case 'wall_mounted': return 'wall'
    case 'corner': return 'corner'
    case 'window': return 'window'
    case 'free': return 'free'
    default: return 'center'
  }
}

/** Anchors in the spot's room when it names one; the one you look at first, then the nearest to your gaze. */
function pickAnchors(state: HomeState, spot: Spot, ctx: OpContext): Item[] {
  let pool = select(state, spot.of!, ctx)
  if (spot.room) {
    const r = resolveRoom(state.plan, spot.room, ctx)
    if (r && r !== 'all') pool = pool.filter(i => i.room === r.id)
  }
  return [...pool].sort((p, q) => Number(q.id === ctx.gaze.itemId) - Number(p.id === ctx.gaze.itemId) || dist(p.pos, ctx.gaze.point) - dist(q.pos, ctx.gaze.point))
}

function roomFor(state: HomeState, spot: Spot | undefined, ctx: OpContext, anchor: Item | undefined): Room | undefined {
  const plan = state.plan
  if (spot?.room) {
    const r = resolveRoom(plan, spot.room, ctx)
    if (!r) return undefined
    if (r !== 'all') return r
  }
  if (anchor) return plan.rooms.find(r => r.id === anchor.room) ?? hereRoom(plan, ctx)
  if (spot?.where === 'gaze') return plan.rooms.find(r => r.id === ctx.gaze.room) ?? roomAt(plan, ctx.gaze.point) ?? hereRoom(plan, ctx)
  return hereRoom(plan, ctx)
}

export function describeSel(sel: Selector): string {
  if (sel.kind) return sel.kind.replace(/_/g, ' ')
  if (sel.tag) return sel.tag
  return sel.ref === 'gaze' ? 'thing you are looking at' : sel.ref === 'last' ? 'last thing' : 'thing'
}

function failMessage(sc: Scene, where: Place, side: Side | undefined): string {
  const what = sc.kind.label
  const room = sc.room.name.toLowerCase()
  switch (where) {
    case 'wall': return `no free wall for the ${what} in the ${room}`
    case 'corner': return `no free corner for the ${what} in the ${room}`
    case 'window': return sc.windows.length ? `no room by the window for the ${what}` : `the ${room} has no window`
    case 'door': return sc.doors.length ? `no room by the door for the ${what}` : `the ${room} has no door`
    case 'near': {
      const rel = side === 'left' ? 'to the left of' : side === 'right' ? 'to the right of' : side === 'front' ? 'in front of' : side ?? 'beside'
      return `no room ${rel} the ${sc.anchor ? kindOfItem(sc.anchor)?.label ?? sc.anchor.kind : 'anchor'} for the ${what}`
    }
    default: return `no room for the ${what} in the ${room}`
  }
}

/** Where to stand to look at a thing: `gap` metres in front of it, kept inside its room, facing it. */
export function poseBefore(plan: FloorPlan, item: Item, gap = 1.2): { pos: Vec2, yaw: number, room: string } {
  const fp = itemFootprint(item)
  const f = frontOf(item.yaw)
  const room = plan.rooms.find(r => r.id === item.room)
  let pos = add(item.pos, f, fp.width / 2 + gap)
  if (room) {
    const clear = (p: Vec2) => pointInPolygon(p, room.polygon) && distToPolygonEdge(p, room.polygon) >= 0.3
    for (let k = 0; k < 12 && !clear(pos); k++) pos = add(pos, f, -0.15)
  }
  return { pos: [round3(pos[0]), round3(pos[1])], yaw: round3(yawToward(pos, item.pos)), room: item.room }
}

function round3(v: number): number {
  const r = Math.round(v * 1000) / 1000
  return Object.is(r, -0) ? 0 : r
}
