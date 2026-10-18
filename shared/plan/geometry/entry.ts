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
/** Who a room is joined to, best first: a hall or the living room is how real plans reach a room. */
const LINK_RANK: Record<string, number> = { hall: 0, living: 0, dining: 1, kitchen: 2, bedroom: 3, balcony: 5 }

/**
 * Living, kitchen and dining run into each other, and a hall runs into them, without a door on real plans.
 * A boundary the reader left shut between two of these is an open plan it missed, so it is opened along the
 * whole shared wall rather than walled off with a hole cut in it.
 */
function openPair(a: Room, b: Room): boolean {
  return (OPEN_PLAN.has(a.type) || a.type === 'hall') && (OPEN_PLAN.has(b.type) || b.type === 'hall') && !(a.type === 'hall' && b.type === 'hall')
}

/**
 * A read that leaves rooms with no way in (the reader missed a door or an open boundary) makes a home you
 * can't walk. Conservative on purpose, because every opening added here is something the drawing may not
 * show, and each one gets a sentence in the notes the Plan panel lists:
 * 1. A room with NO door or opening at all gets one, on its wall to a hall or living room (else the best
 *    neighbour that has a way in itself; the longest wall breaks ties).
 * 2. A group of rooms that has doors among itself but none to the rest of the home (a bedroom, its hall
 *    and its bath) gets one link, from the group's hall if it has one, to the reachable room beside it.
 * Open-plan pairs (`openPair`) are opened across the whole shared wall; anything else gets a 0.85 m door.
 */
export function connectRooms(plan: FloorPlan): { plan: FloorPlan, added: string[], notes: string[] } {
  let p = plan
  const added: string[] = []
  const notes: string[] = []
  const byId = (id: string) => p.rooms.find(r => r.id === id)!
  const linked = (id: string) => walls(p).some(w => w.rooms.includes(id) && w.openings.some(o => o.kind !== 'window'))
  const otherOf = (w: Wall, id: string) => byId(w.rooms[0] === id ? w.rooms[1] : w.rooms[0])
  const inner = (id: string) => walls(p).filter(x => !x.exterior && x.rooms.includes(id) && x.length >= 0.9)
  const link = (room: Room, w: Wall, island: boolean) => {
    const other = otherOf(w, room.id)
    const open = openPair(room, other)
    const kind: OpeningKind = open ? 'opening' : 'door'
    const at: Vec2 = [+((w.a[0] + w.b[0]) / 2).toFixed(3), +((w.a[1] + w.b[1]) / 2).toFixed(3)]
    const width = open ? +w.length.toFixed(3) : Math.min(0.85, w.length - 0.2)
    p = { ...p, openings: [...p.openings, { id: `link_${added.length + 1}`, kind, at, width, height: 2.05, rooms: [room.id, other.id] }] }
    added.push(`${kind} ${room.id}↔${other.id}`)
    const why = island ? 'no way in from the rest of the home was drawn into' : `no ${open ? 'opening' : 'door'} was drawn ${room.type === 'balcony' ? 'onto' : 'into'}`
    notes.push(`${why} ${room.name}; ${open ? `left it open to ${article(other)}` : `added a door from ${article(other)}`}`)
  }

  // 1. Rooms with no way in, judged by what the reader drew (not by doors this pass added next door).
  // Hubs first (halls, the living room), so a sealed bedroom then joins its sealed hall, not the kitchen behind it.
  for (const room of plan.rooms.filter(r => !linked(r.id)).sort((a, b) => (LINK_RANK[a.type] ?? 4) - (LINK_RANK[b.type] ?? 4))) {
    if (linked(room.id)) continue
    const rank = (w: Wall) => {
      const other = otherOf(w, room.id)
      return (openPair(room, other) ? -1 : 0) + (LINK_RANK[other.type] ?? 4) + (linked(other.id) ? 0 : 10)
    }
    const w = inner(room.id).sort((a, b) => rank(a) - rank(b) || b.length - a.length)[0]
    if (w) link(room, w, false)
  }

  // 2. Groups with doors among themselves but no way from the arrival: one link per group, hall side first.
  for (let guard = 0; guard < plan.rooms.length; guard++) {
    const seen = reachable(p)
    if (seen.size === p.rooms.length) break
    const rank = (w: Wall) => {
      const out = byId(w.rooms.find(id => !seen.has(id))!)
      const into = byId(w.rooms.find(id => seen.has(id))!)
      return (out.type === 'hall' ? 0 : 5) + (openPair(out, into) ? -1 : 0) + (LINK_RANK[into.type] ?? 4)
    }
    const w = walls(p).filter(x => !x.exterior && x.length >= 0.9 && seen.has(x.rooms[0]) !== seen.has(x.rooms[1]))
      .sort((a, b) => rank(a) - rank(b) || b.length - a.length)[0]
    if (!w) break
    link(byId(w.rooms.find(id => !seen.has(id))!), w, true)
  }
  return { plan: p, added, notes }
}

/** Rooms you can walk to from the arrival through doors and openings. */
function reachable(plan: FloorPlan): Set<string> {
  const seen = new Set([entry(plan).room])
  const queue = [...seen]
  while (queue.length) {
    const id = queue.shift()
    const room = plan.rooms.find(r => r.id === id)
    for (const d of room ? doorsOf(plan, room) : []) {
      if (d.other === OUTSIDE || seen.has(d.other)) continue
      seen.add(d.other)
      queue.push(d.other)
    }
  }
  return seen
}

/** "the hall", "the living room", "Bedroom 2": generic rooms read with "the", named ones by their name. */
function article(room: Room): string {
  return /\d/.test(room.name) ? room.name : `the ${room.name.toLowerCase()}`
}
