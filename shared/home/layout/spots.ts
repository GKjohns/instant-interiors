/**
 * Candidate poses for each kind of spot, best first. Streams are lazy: the caller takes the first that fits,
 * so a long sweep along a wall costs only what it needs.
 */
import { EPS, add, dist, dot, nearestEdge } from '../../plan/poly.ts'
import type { Vec2 } from '../../plan/poly.ts'
import { clamp } from '../../math.ts'
import { DOOR_CLEAR, WINDOW_SILL, freeAlong } from '../../plan/geometry.ts'
import type { Compass, RoomCorner, RoomWall, Stretch } from '../../plan/geometry.ts'
import type { Side } from '../ops.ts'
import { itemFootprint } from '../select.ts'
import type { Footprint } from '../select.ts'
import type { Item } from '../types.ts'
import { faceToward, frontOf, normYaw, sideOf, yawFacing } from './facing.ts'
import { itemLayer, layerOf } from './fit.ts'
import { alongLongest, backWall, distToSegment, hangOf, packs } from './site.ts'
import type { Cand, Place, Site } from './types.ts'

const TAU = Math.PI * 2
const STEP = 0.1
const WALL_GAP = 0.02
const NUDGE_RADII = [0.15, 0.3, 0.45, 0.6, 0.8, 1.0, 1.3, 1.6]

/** base, then outward in alternating steps, clamped to [lo, hi]. */
function* sweep(base: number, lo: number, hi: number, step = STEP): Generator<number> {
  if (lo > hi) {
    yield base
    return
  }
  const b = clamp(base, lo, hi)
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
export function* nudged(cands: Iterable<Cand>): Generator<Cand> {
  for (const c of cands) {
    yield c
    if (c.pinned) continue
    const x = sideOf(c.yaw)
    const z = frontOf(c.yaw)
    const dirs: Vec2[] = [x, [-x[0], -x[1]], z, [-z[0], -z[1]], add([0, 0], x, 0.707, z, 0.707), add([0, 0], x, -0.707, z, 0.707), add([0, 0], x, 0.707, z, -0.707), add([0, 0], x, -0.707, z, -0.707)]
    for (const r of NUDGE_RADII) for (const d of dirs) yield { ...c, pos: add(c.pos, d, r) }
  }
}

export function* candidates(site: Site, where: Place, side: Side | undefined, span: number): Generator<Cand> {
  switch (where) {
    case 'wall': return yield* wallCands(site, span, site.spot?.wall)
    case 'corner': return yield* cornerCands(site, span)
    case 'window': return yield* windowCands(site, span)
    case 'door': return yield* doorCands(site, span)
    case 'center': return yield* nudged(centerCands(site))
    case 'free': return yield* nudged(freeCands(site))
    case 'gaze': return yield* nudged(pointCands(site, site.ctx.gaze.point, span, 'gaze'))
    case 'here': return yield* nudged(pointCands(site, site.ctx.player.pos, span, 'here'))
    case 'near': return yield* nudged(nearCands(site, side, span))
  }
}

/** Free stretches of a wall for this piece: doors always excluded, windows too when the piece would stand in front of the glass. */
function stretchesFor(site: Site, rw: RoomWall): Stretch[] {
  const layer = layerOf(site.kind)
  const sill = Math.min(WINDOW_SILL, ...rw.windows.map(w => w.y0))
  const avoidWindows = layer === 'mounted' || (layer === 'floor' && site.fp.height > sill)
  return freeAlong(rw.length, avoidWindows ? rw.openings : rw.doors, DOOR_CLEAR)
}

function rankWalls(site: Site, compass?: Compass): RoomWall[] {
  const rank = (rw: RoomWall) => (rw.doors.length ? 2 : rw.windows.length ? 1 : 0)
  const longest = (rw: RoomWall) => Math.max(0, ...stretchesFor(site, rw).map(s => s.length))
  return site.walls
    .filter(rw => !compass || rw.side === compass)
    .sort((p, q) => rank(p) - rank(q) || longest(q) - longest(p))
}

function wallPose(site: Site, rw: RoomWall, along: number, gap: number): Cand {
  const point = add(rw.a, rw.dir, along)
  const mounted = site.kind.place === 'wall_mounted'
  return {
    pos: add(point, rw.inward, site.fp.width / 2 + (mounted ? 0 : gap)),
    yaw: yawFacing(rw.inward),
    room: site.room.id,
    ...(mounted ? { y: Math.max(0.05, hangOf(site) - site.fp.height / 2) } : {}),
    pinned: true
  }
}

function* wallCands(site: Site, span: number, compass?: Compass): Generator<Cand> {
  const gap = site.spot?.dist ?? WALL_GAP
  for (const rw of rankWalls(site, compass)) {
    for (const st of stretchesFor(site, rw)) {
      if (st.length < span) continue
      const lo = st.from + span / 2
      const hi = st.to - span / 2
      // Packing starts at a real corner of the room, not at the edge of a door.
      const fromCorner = st.from <= 0.01 ? lo : st.to >= rw.length - 0.01 ? hi : lo
      const base = packs(site.kind) ? fromCorner : (lo + hi) / 2
      for (const along of sweep(base, lo, hi)) yield wallPose(site, rw, along, gap)
    }
  }
}

/** Facing a wall from inside the room, which compass side is on your left. */
function leftOfWall(c: Compass): Compass {
  return c === 'north' ? 'west' : c === 'south' ? 'east' : c === 'east' ? 'north' : 'south'
}

function* cornerCands(site: Site, span: number): Generator<Cand> {
  const gap = site.spot?.dist ?? WALL_GAP
  const want = site.spot?.wall
  const other = want && site.spot?.side === 'left' ? leftOfWall(want) : want && site.spot?.side === 'right' ? leftOfWall(leftOfWall(leftOfWall(want))) : undefined
  const doorDist = (c: RoomCorner) => Math.min(Infinity, ...site.doors.map(d => dist(d.at, c.point)))
  const corners = site.corners
    .filter(c => !want || (c.walls.includes(want) && (!other || c.walls.includes(other))))
    .map(c => ({ c, score: Math.min(doorDist(c), 3) + site.rand() * 0.01 }))
    .sort((p, q) => q.score - p.score)
    .map(x => x.c)
  // Every corner proper before anything slides along a wall away from one.
  for (const slide of [0, 0.1, 0.2, 0.35, 0.5, 0.7]) {
    for (const c of corners) {
      const e0 = site.walls[c.edges[0]]!
      const e1 = site.walls[c.edges[1]]!
      const backs = e0.length >= e1.length ? [[e0, e1], [e1, e0]] : [[e1, e0], [e0, e1]]
      for (const [back, other] of backs as [RoomWall, RoomWall][]) {
        const pos = add(add(c.point, back.inward, site.fp.width / 2 + gap), other.inward, span / 2 + gap + slide)
        let yaw = yawFacing(back.inward)
        // A squarish room-facing piece (armchair, sectional corner) looks into the room rather than along one wall.
        if (site.kind.face === 'room' && Math.abs(site.fp.length - site.fp.width) < 0.25) yaw = faceToward(pos, site.center)
        yield { pos, yaw, room: site.room.id, pinned: true }
      }
    }
  }
}

function* windowCands(site: Site, span: number): Generator<Cand> {
  const gap = site.spot?.dist ?? WALL_GAP
  const windows = site.windows.filter(w => !site.spot?.wall || w.side === site.spot.wall)
  for (const w of windows) {
    const rw = site.walls[w.edge]!
    const stretch = freeAlong(rw.length, rw.doors, DOOR_CLEAR).find(s => s.from <= w.along && w.along <= s.to)
    const lo = (stretch?.from ?? 0) + span / 2
    const hi = (stretch?.to ?? rw.length) - span / 2
    for (const along of sweep(w.along, Math.max(lo, w.along - 1), Math.min(hi, w.along + 1))) yield wallPose(site, rw, along, gap)
  }
}

function* doorCands(site: Site, span: number): Generator<Cand> {
  const doors = [...site.doors]
    .filter(d => !site.spot?.wall || d.side === site.spot.wall)
    .sort((p, q) => Number(q.kind === 'door') - Number(p.kind === 'door') || Number(q.other === 'outside') - Number(p.other === 'outside'))
  const wallKind = site.kind.place === 'wall' || site.kind.place === 'wall_mounted' || site.kind.place === 'corner'
  for (const d of doors) {
    const rw = site.walls[d.edge]!
    if (wallKind) {
      const stretches = stretchesFor(site, rw)
      for (const sgn of [1, -1]) {
        for (const out of [0, 0.1, 0.2, 0.4, 0.6, 0.9]) {
          const along = d.along + sgn * (d.width / 2 + DOOR_CLEAR + 0.05 + out + span / 2)
          if (!stretches.some(s => s.from <= along - span / 2 + 1e-6 && along + span / 2 <= s.to + 1e-6)) continue
          yield wallPose(site, rw, along, site.spot?.dist ?? WALL_GAP)
        }
      }
    } else {
      const pos = add(d.at, rw.inward, site.fp.width / 2 + (site.spot?.dist ?? 0.4))
      yield { pos, yaw: yawFacing(rw.inward), room: site.room.id }
    }
  }
}

function* centerCands(site: Site): Generator<Cand> {
  let pos = site.center
  let yaw = alongLongest(site)
  // A rug with seating in the room goes under the seating group, not in the geometric middle.
  if (site.kind.tags.includes('textile')) {
    const seats = site.state.items.filter(i => i.room === site.room.id && i.tags.includes('seating') && itemLayer(i) === 'floor')
    if (seats.length) {
      const cx = seats.reduce((s, i) => s + i.pos[0], 0) / seats.length
      const cz = seats.reduce((s, i) => s + i.pos[1], 0) / seats.length
      pos = [(cx + site.center[0]) / 2, (cz + site.center[1]) / 2]
      yaw = [...seats].sort((p, q) => dist(p.pos, pos) - dist(q.pos, pos))[0]!.yaw
    }
  }
  // Standing in the middle of a small kitchen and asking for a table used to shove it against a wall (dodging
  // the viewer) with room for two chairs; the middle is the table's place, and walking has no furniture collision.
  yield { pos, yaw, room: site.room.id, middle: true }
}

/** Free-standing things keep out of the very middle: a seeded ring around the centre, facing in. */
function* freeCands(site: Site): Generator<Cand> {
  for (let k = 0; k < 6; k++) {
    const a = site.rand() * TAU
    const r = 0.6 + site.rand() * 1.2
    const pos: Vec2 = [site.center[0] + Math.cos(a) * r, site.center[1] + Math.sin(a) * r]
    yield { pos, yaw: site.kind.face === 'room' ? faceToward(pos, site.center) : alongLongest(site), room: site.room.id }
  }
  yield { pos: site.center, yaw: alongLongest(site), room: site.room.id }
}

/** "There" / "here": the point itself; wall pieces snap to the nearest wall when one is close. */
function* pointCands(site: Site, point: Vec2, span: number, mode: 'gaze' | 'here'): Generator<Cand> {
  const wallKind = site.kind.place === 'wall' || site.kind.place === 'wall_mounted'
  const e = nearestEdge(point, site.poly)
  if (wallKind && e.d <= 1.5) {
    const rw = site.walls[e.index]!
    const along = dot([point[0] - rw.a[0], point[1] - rw.a[1]], rw.dir)
    const st = stretchesFor(site, rw).sort((p, q) => Math.abs((p.from + p.to) / 2 - along) - Math.abs((q.from + q.to) / 2 - along))
    for (const s of st) {
      if (s.length < span) continue
      for (const a of sweep(along, s.from + span / 2, s.to - span / 2)) yield wallPose(site, rw, a, site.spot?.dist ?? WALL_GAP)
    }
  }
  const player = site.ctx.player
  const underfoot = site.kind.tags.includes('textile')
  const pos = mode === 'here' && !underfoot ? add(player.pos, frontOf(player.yaw), -(0.4 + site.fp.width / 2)) : point
  const yaw = site.kind.face === 'room' ? faceToward(pos, player.pos) : mode === 'here' ? normYaw(player.yaw + Math.PI) : alongLongest(site)
  yield { pos, yaw, room: site.room.id }
}

function gapFor(site: Site, side: Side | undefined): number {
  const d = site.spot?.dist
  if (d !== undefined) return site.kind.tags.includes('textile') ? d : Math.max(0, d)
  return side === 'front' || side === 'behind' ? 0.3 : side === 'on' ? 0 : 0.1
}

export function* nearCands(site: Site, side: Side | undefined, span: number): Generator<Cand> {
  const A = site.anchor!
  const fa = itemFootprint(A)
  const f = frontOf(A.yaw)
  const lft = sideOf(A.yaw)
  const g = gapFor(site, side)
  const room = A.room
  const facesAnchor = site.kind.face === 'anchor' || (site.kind.tags.includes('seating') && (side === 'front' || side === 'behind' || side === 'opposite'))
  const yawFor = (pos: Vec2) => (facesAnchor ? faceToward(pos, A.pos) : A.yaw)
  if (site.kind.place === 'ceiling') {
    yield { pos: A.pos, yaw: A.yaw, room }
    return
  }
  switch (side ?? 'beside') {
    case 'front':
    case 'behind': {
      if (side === 'behind' && site.kind.place === 'wall_mounted') return yield* behindOnWall(site, A, fa, span)
      const sgn = side === 'behind' ? -1 : 1
      const d0 = fa.width / 2 + g + site.fp.width / 2
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
      const order = side === 'left' ? [1, -1] : side === 'right' ? [-1, 1] : site.rand() < 0.5 ? [1, -1] : [-1, 1]
      for (const sgn of order) yield* sideCands(site, A, fa, sgn, span, g, yawFor)
      return
    }
    case 'opposite': return yield* oppositeCands(site, A, span)
    case 'on': return yield* onCands(site, A, fa, span)
  }
}

function* sideCands(site: Site, A: Item, fa: Footprint, sgn: number, span: number, g: number, yawFor: (p: Vec2) => number): Generator<Cand> {
  const lft = sideOf(A.yaw)
  const back = backWall(site, A)
  const snap = back && (site.kind.place === 'wall' || site.kind.place === 'wall_mounted')
  for (const extra of [0, 0.1, 0.2, 0.3, 0.5, 0.8]) {
    const pos = add(A.pos, lft, sgn * (fa.length / 2 + g + span / 2 + extra))
    if (snap) {
      // A nightstand beside a bed, a stove beside the counter: keep its back on the same wall as the anchor.
      const along = dot([pos[0] - back.a[0], pos[1] - back.a[1]], back.dir)
      // Same rules as any wall piece: a fridge beside the stove still never stands in front of the glass.
      if (!stretchesFor(site, back).some(st => st.from <= along - span / 2 + 1e-6 && along + span / 2 <= st.to + 1e-6)) continue
      yield wallPose(site, back, along, WALL_GAP)
    } else yield { pos, yaw: yawFor(pos), room: A.room }
  }
}

function* behindOnWall(site: Site, A: Item, fa: Footprint, span: number): Generator<Cand> {
  const f = frontOf(A.yaw)
  const back = add(A.pos, f, -fa.width / 2)
  const rw = backWall(site, A) ?? site.walls.filter(w => dot(w.inward, f) > 0.7).sort((p, q) => distToSegment(back, p) - distToSegment(back, q))[0]
  if (!rw) return
  const along = dot([A.pos[0] - rw.a[0], A.pos[1] - rw.a[1]], rw.dir)
  const st = stretchesFor(site, rw).sort((p, q) => Math.abs((p.from + p.to) / 2 - along) - Math.abs((q.from + q.to) / 2 - along))
  for (const s of st) {
    if (s.length < span) continue
    for (const a of sweep(along, s.from + span / 2, s.to - span / 2)) yield wallPose(site, rw, a, 0)
  }
}

/** Across the room from the anchor: where its front points meets a wall. */
function* oppositeCands(site: Site, A: Item, span: number): Generator<Cand> {
  const f = frontOf(A.yaw)
  let hit: { rw: RoomWall, t: number } | undefined
  for (const rw of site.walls) {
    const t = rayToSegment(A.pos, f, rw.a, rw.b)
    if (t !== null && t > 0.05 && (!hit || t < hit.t)) hit = { rw, t }
  }
  if (!hit) return
  const point = add(A.pos, f, hit.t)
  const along = dot([point[0] - hit.rw.a[0], point[1] - hit.rw.a[1]], hit.rw.dir)
  const st = stretchesFor(site, hit.rw).sort((p, q) => Math.abs((p.from + p.to) / 2 - along) - Math.abs((q.from + q.to) / 2 - along))
  for (const s of st) {
    if (s.length < span) continue
    for (const a of sweep(along, s.from + span / 2, s.to - span / 2)) yield wallPose(site, hit.rw, a, site.spot?.dist ?? WALL_GAP)
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
function* onCands(site: Site, A: Item, fa: Footprint, span: number): Generator<Cand> {
  const top = (A.y ?? 0) + fa.height
  const back = backWall(site, A)
  if (site.kind.hang && site.kind.kind !== 'tv' && back) {
    const along = dot([A.pos[0] - back.a[0], A.pos[1] - back.a[1]], back.dir)
    const y = Math.max(hangOf(site) - site.fp.height / 2, top + 0.05)
    for (const a of sweep(along, span / 2, back.length - span / 2)) yield { ...wallPose(site, back, a, 0), y }
    return
  }
  const lft = sideOf(A.yaw)
  const room = (fa.length - span) / 2
  for (const s of sweep(0, -room, room)) yield { pos: add(A.pos, lft, s), yaw: A.yaw, room: A.room, y: top, pinned: true }
}
