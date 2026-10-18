/**
 * Livability: when the sentence names no wall, every wall stretch and corner that fits is scored and the best
 * wins, instead of the first that fits. Higher is better; ties go to the site's seeded rng, so a replay lands
 * the same room.
 *
 * | term                                                  | weight | applies to                         |
 * |-------------------------------------------------------|--------|------------------------------------|
 * | backs onto a wall with a door or opening              |  -2.0  | all but tall storage               |
 * | stands in front of a window                           |  -0.5  | all but desks                      |
 * | distance from the nearest walking lane, 0–2 m → 0–1   |  +1.0  | all                                |
 * | looks at a window or the TV wall                      |  +1.5  | room-facing seating                |
 * | can see a door / has every door behind it             | +0.5 / -1.0 | room-facing seating           |
 * | headboard under a window                              |  -3.0  | beds                               |
 * | door opens onto the foot of the bed                   |  -2.0  | beds                               |
 * | both long sides open (not just one)                   |  +1.0  | beds                               |
 * | under a window / window on the wall beside it         | +2.0 / +1.0 | desks                         |
 * | distance from the nearest door, 0–3 m → 0–1           |  +2.0  | plants, trees, floor lamps         |
 * | within 1.5 m of a door                                |  -1.0  | plants, trees, floor lamps         |
 * | nearness to the door, 5–0 m → 0–1 (behind you as you enter) | +2.0 | tall storage (≥ 1.5 m), door-wall penalty waived |
 */
import { dist, dot } from '../../plan/poly.ts'
import type { Vec2 } from '../../plan/poly.ts'
import { distToSeg } from '../../plan/geometry.ts'
import type { RoomWall } from '../../plan/geometry.ts'
import { boxCorners } from '../select.ts'
import { openSides } from './clear.ts'
import { frontOf, sideOf } from './facing.ts'
import { MAX_TRIES, layerOf } from './fit.ts'
import type { Blocker, Cand, Place, Site } from './types.ts'

const W = {
  doorWall: -2,
  windowWall: -0.5,
  path: 1,
  seatView: 1.5,
  seatSeesDoor: 0.5,
  seatBackToDoor: -1,
  bedUnderWindow: -3,
  bedDoorAtFoot: -2,
  bedBothSides: 1,
  deskUnderWindow: 2,
  deskWindowBeside: 1,
  cornerFromDoor: 2,
  cornerByDoor: -1,
  tallNearDoor: 2
}

/**
 * Only free choices of floor pieces are scored: a named wall, an anchor or a point is the sentence's call,
 * and hung art keeps the old order (centred over what is there), since walking lanes don't reach it.
 */
export function scored(site: Site, where: Place): boolean {
  return (where === 'wall' || where === 'corner') && !site.spot?.wall && !site.anchor && layerOf(site.kind) === 'floor'
}

/** The wall a candidate backs onto: its own for a wall pose, the one behind it for a corner pose. */
function backOf(site: Site, c: Cand): RoomWall | undefined {
  if (c.wall !== undefined) return site.walls[c.wall]
  const corner = c.corner !== undefined ? site.corners[c.corner] : undefined
  if (!corner) return undefined
  const f = frontOf(c.yaw)
  return corner.edges.map(e => site.walls[e]!).find(rw => dot(rw.inward, f) > 0.9)
}

/** Does a window on this wall overlap the piece's span along it? */
function underWindow(rw: RoomWall, c: Cand, length: number): boolean {
  const along = dot([c.pos[0] - rw.a[0], c.pos[1] - rw.a[1]], rw.dir)
  return rw.windows.some(w => Math.abs(w.along - along) < w.width / 2 + length / 2)
}

export function livability(site: Site, c: Cand, extra: Blocker[] = []): number {
  const k = site.kind
  const fp = site.fp
  const back = backOf(site, c)
  const f = frontOf(c.yaw)
  const box = boxCorners(c.pos, c.yaw, fp.length, fp.width)
  const doorD = Math.min(Infinity, ...site.doors.map(d => dist(d.at, c.pos)))
  const tall = k.tags.includes('storage') && fp.height >= 1.5
  let s = 0
  if (back?.doors.length && !tall) s += W.doorWall
  if (back && !k.tags.includes('desk') && underWindow(back, c, fp.length)) s += W.windowWall
  let path = Infinity
  for (const cor of site.corridors) {
    for (const seg of cor.routes[0]!.segs) for (const p of [c.pos, ...box]) path = Math.min(path, distToSeg(p, seg) - cor.width / 2)
  }
  if (path !== Infinity) s += W.path * Math.min(Math.max(path, 0), 2) / 2
  if (k.tags.includes('seating') && k.face === 'room') s += seating(site, c, f)
  if (k.tags.includes('bed')) {
    if (back && underWindow(back, c, fp.length)) s += W.bedUnderWindow
    const side = sideOf(c.yaw)
    const atFoot = site.doors.some((d) => {
      const v: Vec2 = [d.at[0] - c.pos[0], d.at[1] - c.pos[1]]
      return dot(v, f) > fp.width / 2 && Math.abs(dot(v, side)) < fp.length / 2 + 0.2
    })
    if (atFoot) s += W.bedDoorAtFoot
    if (openSides(site, c, extra) >= 2) s += W.bedBothSides
  }
  if (k.tags.includes('desk')) {
    if (back && underWindow(back, c, fp.length)) s += W.deskUnderWindow
    else if (site.windows.some(w => w.edge !== back?.index && dist(w.at, c.pos) < 1.5 + fp.length / 2)) s += W.deskWindowBeside
  }
  if (k.tags.includes('plant') || k.kind === 'floor_lamp') {
    s += W.cornerFromDoor * Math.min(doorD, 3) / 3
    if (doorD < 1.5) s += W.cornerByDoor
  }
  if (tall && site.doors.length) s += W.tallNearDoor * (1 - Math.min(doorD, 5) / 5)
  return s
}

/** Seating looks at the view (a window, the TV) and keeps the door in sight rather than at its back. */
function seating(site: Site, c: Cand, f: Vec2): number {
  let s = 0
  const ahead = (p: Vec2) => {
    const v: Vec2 = [p[0] - c.pos[0], p[1] - c.pos[1]]
    const d = Math.hypot(v[0], v[1]) || 1
    return dot(v, f) / d
  }
  // Only a window or TV on the wall it looks at counts: one glimpsed at 45° over the shoulder is not a view.
  const tv = site.state.items.some(i => i.room === site.room.id && (i.kind === 'tv' || i.kind === 'tv_stand') && dot(frontOf(i.yaw), f) < -0.7 && ahead(i.pos) > 0.5)
  const view = tv || site.windows.some(w => dot(w.inward, f) < -0.7 && ahead(w.at) > 0.5)
  if (view) s += W.seatView
  if (site.doors.length) {
    const facing = site.doors.map(d => ahead(d.at))
    if (facing.some(x => x > 0.2)) s += W.seatSeesDoor
    else if (facing.every(x => x < -0.2)) s += W.seatBackToDoor
  }
  return s
}

/**
 * The candidate to take: the first that `evaluate` accepts, or with `score`, the best of the first accepted
 * per slot (a wall stretch, a corner). Lazy streams stay cheap: a slot that has its answer is skipped.
 */
export function pick<T>(site: Site, cands: Iterable<Cand>, evaluate: (c: Cand) => T | null, score?: (t: T) => number): T | null {
  let tries = 0
  if (!score) {
    for (const c of cands) {
      if (++tries > MAX_TRIES) break
      const t = evaluate(c)
      if (t) return t
    }
    return null
  }
  const done = new Set<string>()
  let best: T | null = null
  let bestScore = -Infinity
  for (const c of cands) {
    if (c.slot && done.has(c.slot)) continue
    if (++tries > MAX_TRIES * 3) break
    const t = evaluate(c)
    if (!t) continue
    if (c.slot) done.add(c.slot)
    const sc = score(t) + site.rand() * 1e-3
    if (sc > bestScore) {
      best = t
      bestScore = sc
    }
  }
  return best
}
