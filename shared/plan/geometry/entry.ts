/** Where you arrive in a plan, and the openings a sloppy read needs before every room can be walked to. */
import { clamp } from '../../math.ts'
import { area, pointInPolygon, yawToward } from '../poly.ts'
import type { Vec2 } from '../poly.ts'
import type { FloorPlan, OpeningKind, Room } from '../schema.ts'
import { doorsOf, largestRoom, roomCenter, windowsOf } from './rooms.ts'
import type { RoomOpening } from './rooms.ts'
import { OUTSIDE, walls } from './walls.ts'
import type { Wall } from './walls.ts'

export interface Pose {
  pos: Vec2
  yaw: number
  room: string
}

/** Rooms you can't stand in and look around: a W/D or mech closet behind the front door is a doorway, not an arrival. */
const TINY_ROOM = 3.5

function passThrough(room: Room): boolean {
  // A terrace's front hall is narrow and small (0.6 × 3.6 m) but it is where you arrive, not a closet.
  if (room.type === 'hall') return false
  return area(room.polygon) < TINY_ROOM || room.type === 'closet' || room.type === 'laundry'
}

/** 0.9 m inside `room` from the opening at `at` (0.5 m when the room is too shallow), facing in. */
function stepIn(room: Room, at: Vec2, inward: Vec2): Vec2 {
  const step = pointInPolygon([at[0] + inward[0] * 0.9, at[1] + inward[1] * 0.9], room.polygon) ? 0.9 : 0.5
  return [at[0] + inward[0] * step, at[1] + inward[1] * step]
}

/**
 * Where you arrive: just inside the front door (a real door to 'outside'), facing in. When that door opens
 * into a closet-sized room (real listings put the W/D by the door), step through its biggest inner door
 * into the room beyond, so the first view is a room and not a wall a metre away. With no front door, the
 * middle of the largest room facing its largest window (or a door).
 */
export function entry(plan: FloorPlan): Pose & { door?: string } {
  const fronts = walls(plan).flatMap((w) => {
    const door = w.exterior ? w.openings.find(o => o.kind === 'door') : undefined
    const room = door && plan.rooms.find(r => r.id === w.rooms[0])
    return door && room ? [{ w, door, room }] : []
  })
  // A front door into a real room beats one into a closet (a service door, a misread).
  fronts.sort((p, q) => Number(passThrough(p.room)) - Number(passThrough(q.room)))
  const front = fronts[0]
  if (front) {
    const { w, door, room } = front
    if (passThrough(room)) {
      const through = doorsOf(plan, room)
        .filter(d => d.other !== OUTSIDE && d.id !== door.id)
        .map(d => ({ d, next: plan.rooms.find(r => r.id === d.other) }))
        .filter((x): x is { d: RoomOpening, next: Room } => !!x.next)
        .sort((p, q) => area(q.next.polygon) - area(p.next.polygon))[0]
      if (through) {
        const far = doorsOf(plan, through.next).find(d => d.id === through.d.id)
        const inward: Vec2 = far?.inward ?? [-through.d.inward[0], -through.d.inward[1]]
        const pos = stepIn(through.next, through.d.at, inward)
        return { pos, yaw: yawToward(through.d.at, pos) || 0, room: through.next.id, door: door.id }
      }
    }
    // A read can centre the front door on a corner (half of it in the next room's wall); step in from where
    // the whole leaf fits on this wall, or you arrive standing inside the partition.
    const half = Math.min(door.width / 2 + 0.1, w.length / 2)
    const along = clamp(door.along, half, w.length - half)
    const at: Vec2 = [w.a[0] + ((w.b[0] - w.a[0]) / w.length) * along, w.a[1] + ((w.b[1] - w.a[1]) / w.length) * along]
    const pos = stepIn(room, at, [-w.normal[0], -w.normal[1]])
    return { pos, yaw: yawToward(at, pos) || 0, room: room.id, door: door.id }
  }
  const room = largestRoom(plan)
  const pos = roomCenter(room)
  const look = windowsOf(plan, room)[0] ?? doorsOf(plan, room)[0]
  return { pos, yaw: look ? yawToward(pos, look.at) || 0 : 0, room: room.id }
}

const OPEN_PLAN = new Set(['living', 'kitchen', 'dining'])
const LINK_RANK: Record<string, number> = { hall: 0, living: 1, dining: 2, kitchen: 3 }

/**
 * A read that seals rooms off (the reader missed a door, or drew a wall through an open-plan living/kitchen)
 * makes a home you can't walk. Adds what is missing, one opening at a time: a cased opening on a long
 * living/kitchen/dining wall that has none, then for every room unreachable from the arrival a door on its
 * wall to a reachable room (hall, then living side first; the longest wall). Returns the plan and what it added.
 */
export function connectRooms(plan: FloorPlan): { plan: FloorPlan, added: string[] } {
  let p = plan
  const added: string[] = []
  const add = (w: Wall, kind: OpeningKind) => {
    const at: Vec2 = [+((w.a[0] + w.b[0]) / 2).toFixed(3), +((w.a[1] + w.b[1]) / 2).toFixed(3)]
    p = { ...p, openings: [...p.openings, { id: `link_${added.length + 1}`, kind, at, width: kind === 'opening' ? Math.min(1.6, w.length - 0.3) : Math.min(0.85, w.length - 0.2), height: 2.05, rooms: [w.rooms[0], w.rooms[1]] }] }
    added.push(`${kind} ${w.rooms[0]}↔${w.rooms[1]}`)
  }
  const typeOf = (id: string) => p.rooms.find(r => r.id === id)?.type ?? 'other'
  for (const w of walls(p)) {
    const linked = walls(p).some(x => x.openings.some(o => o.kind !== 'window') && x.rooms.includes(w.rooms[0]) && x.rooms.includes(w.rooms[1]))
    if (!w.exterior && w.length >= 1.5 && !linked && OPEN_PLAN.has(typeOf(w.rooms[0])) && OPEN_PLAN.has(typeOf(w.rooms[1]))) add(w, 'opening')
  }
  for (let guard = 0; guard < plan.rooms.length; guard++) {
    const seen = new Set([entry(p).room])
    const queue = [...seen]
    while (queue.length) {
      const id = queue.shift()
      const room = p.rooms.find(r => r.id === id)
      for (const d of room ? doorsOf(p, room) : []) {
        if (d.other === OUTSIDE || seen.has(d.other)) continue
        seen.add(d.other)
        queue.push(d.other)
      }
    }
    const rank = (w: Wall) => LINK_RANK[typeOf(w.rooms.find(id => seen.has(id))!)] ?? 4
    const w = walls(p).filter(x => !x.exterior && x.length >= 0.9 && seen.has(x.rooms[0]) !== seen.has(x.rooms[1])).sort((a, b) => rank(a) - rank(b) || b.length - a.length)[0]
    if (!w) break
    add(w, OPEN_PLAN.has(typeOf(w.rooms[0])) && OPEN_PLAN.has(typeOf(w.rooms[1])) ? 'opening' : 'door')
  }
  return { plan: p, added }
}
