/** What a placement asks of its room: hang heights, which pieces pack from a corner, which wall a piece backs onto. */
import { clamp } from '../../math.ts'
import { add, dist, dot } from '../../plan/poly.ts'
import type { Vec2 } from '../../plan/poly.ts'
import { wallSegmentsOf } from '../../plan/geometry.ts'
import type { RoomWall } from '../../plan/geometry.ts'
import type { KindDescriptor } from '../kinds.ts'
import { itemFootprint } from '../select.ts'
import type { Item } from '../types.ts'
import { frontOf, normYaw } from './facing.ts'
import type { Site } from './types.ts'

/** Centre height for hung pieces: the sentence's `hang`, else the kind's, else eye level. */
export function hangOf(site: Site): number {
  return site.props.hang ?? site.kind.hang ?? 1.5
}

/** Storage, appliances and fixtures pack from a wall's end; seating, beds and art sit centred on it. */
export function packs(kind: KindDescriptor): boolean {
  return !kind.tags.some(t => t === 'seating' || t === 'bed' || t === 'art' || t === 'decor' || t === 'textile')
}

/** A free piece lines up with the room's longest wall, so it reads as placed rather than dropped. */
export function alongLongest(site: Site): number {
  const d = [...site.walls].sort((p, q) => q.length - p.length)[0]!.dir
  return normYaw(Math.atan2(-d[1], d[0]))
}

/** The room wall an item's back rests against (within 15 cm), if any. */
export function backWall(site: Site, item: Item): RoomWall | undefined {
  const walls = item.room === site.room.id ? site.walls : wallSegmentsOf(site.plan, site.plan.rooms.find(r => r.id === item.room) ?? site.room)
  const f = frontOf(item.yaw)
  const back = add(item.pos, f, -itemFootprint(item).width / 2)
  return walls.find(rw => dot(rw.inward, f) > 0.9 && distToSegment(back, rw) < 0.15)
}

export function distToSegment(p: Vec2, rw: RoomWall): number {
  const t = clamp(dot([p[0] - rw.a[0], p[1] - rw.a[1]], rw.dir), 0, rw.length)
  return dist(p, add(rw.a, rw.dir, t))
}
