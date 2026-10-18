/**
 * Plan geometry over TWO_BED_APARTMENT: walls deduped across shared edges and split where the neighbour
 * changes, openings cut into header / apron pieces, room lookups, and the entry pose.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connectRooms, cornersOf, doorsOf, entry, planBounds, roomAt, roomCenter, wallSegmentsOf, walls, windowsOf } from '../shared/plan/geometry.ts'
import { readFileSync } from 'node:fs'
import { area, distToPolygonEdge, pointInPolygon } from '../shared/plan/poly.ts'
import { normalizePlan } from '../shared/plan/schema.ts'
import { TWO_BED_APARTMENT as P } from '../shared/plan/samples.ts'

const room = (id: string) => P.rooms.find(r => r.id === id)!

test('shared edges become one wall each; partial overlaps split where the neighbour changes', () => {
  const ws = walls(P)
  // 34 polygon edges collapse to 26 walls: 12 exterior, 14 shared.
  assert.equal(ws.length, 26)
  assert.equal(ws.filter(w => w.exterior).length, 12)
  const pair = (a: string, b: string) => ws.filter(w => w.rooms.includes(a) && w.rooms.includes(b))
  assert.equal(pair('living', 'kitchen').length, 1)
  assert.equal(pair('kitchen', 'hall').length, 1)
  // The living room's east edge (4.5 m) meets the kitchen for 3 m and the hall for 1.5 m.
  assert.equal(pair('living', 'hall')[0]!.length, 1.5)
  assert.equal(pair('living', 'kitchen')[0]!.length, 3)
  // The living room's south edge is shared by three rooms, in three pieces.
  assert.deepEqual([pair('living', 'bathroom')[0]!.length, pair('living', 'primary')[0]!.length, pair('hall', 'primary').map(w => w.length).sort()], [2, 3.5, [0.5, 3]])
  for (const w of ws) {
    assert.equal(w.thickness, w.exterior ? 0.25 : 0.12)
    assert.ok(Math.abs(Math.hypot(w.normal[0], w.normal[1]) - 1) < 1e-9)
  }
  // Every interior wall's normal points from rooms[0] toward rooms[1].
  for (const w of ws.filter(w => !w.exterior)) {
    const mid: [number, number] = [(w.a[0] + w.b[0]) / 2 + w.normal[0] * 0.1, (w.a[1] + w.b[1]) / 2 + w.normal[1] * 0.1]
    assert.equal(roomAt(P, mid)?.id, w.rooms[1], `${w.id} normal points into ${w.rooms[1]}`)
  }
})

test('openings attach to their wall and cut it into solid, header and apron pieces', () => {
  const ws = walls(P)
  const north = ws.find(w => w.rooms[0] === 'living' && w.exterior && w.a[1] === 0 && w.b[1] === 0)!
  assert.equal(north.openings.length, 1)
  assert.equal(north.openings[0]!.along, 2.75)
  assert.deepEqual(north.pieces.map(p => [p.kind, +p.from.toFixed(2), +p.to.toFixed(2), p.y0, p.y1]), [
    ['solid', 0, 1.55, 0, 2.7],
    ['window_apron', 1.55, 3.95, 0, 0.9],
    ['window_header', 1.55, 3.95, 2.1, 2.7],
    ['solid', 3.95, 5.5, 0, 2.7]
  ])
  const front = ws.find(w => w.rooms[0] === 'hall' && w.exterior && w.openings.some(o => o.kind === 'door'))!
  assert.deepEqual(front.pieces.map(p => [p.kind, p.y0, p.y1]), [['solid', 0, 2.7], ['door_header', 2.05, 2.7], ['solid', 0, 2.7]])
  // Piece endpoints are real plan points on the wall line.
  for (const p of front.pieces) assert.equal(p.a[1], 7.5)
  assert.equal(ws.flatMap(w => w.openings).length, P.openings.length, 'every opening found a wall')
})

test('roomAt, planBounds and roomCenter', () => {
  assert.equal(roomAt(P, [1, 1])?.id, 'living')
  assert.equal(roomAt(P, [7, 6])?.id, 'hall')
  assert.equal(roomAt(P, [20, 20]), undefined)
  // On a shared edge the smaller room wins.
  assert.equal(roomAt(P, [5.5, 1])?.id, 'kitchen')
  const b = planBounds(P)
  assert.deepEqual([b.min, b.max, b.center], [[0, 0], [11, 7.5], [5.5, 3.75]])
  const hall = room('hall')
  assert.ok(pointInPolygon(roomCenter(hall), hall.polygon), 'the L-shaped hall gets an interior centre')
})

test('entry is just inside the front door, facing in', () => {
  const e = entry(P)
  assert.equal(e.room, 'hall')
  assert.equal(e.door, 'door_1')
  assert.ok(pointInPolygon(e.pos, room('hall').polygon))
  assert.ok(e.pos[1] < 7.5 && e.pos[1] > 6.4, 'a step inside the south wall')
  assert.equal(e.yaw, 0, 'looking north, into the flat')
})

test('a room sees its walls by compass side with free stretches around the doors', () => {
  const living = wallSegmentsOf(P, room('living'))
  assert.deepEqual(living.map(w => w.side), ['north', 'east', 'south', 'west'])
  const east = living.find(w => w.side === 'east')!
  assert.equal(east.doors.length, 2, 'two cased openings')
  assert.equal(east.windows.length, 0)
  // Free stretches avoid the openings (plus 10 cm clearance) but windows stay in `free`.
  assert.deepEqual(east.free.map(s => [+s.from.toFixed(2), +s.to.toFixed(2)]), [[0, 0.5], [2.5, 3.05]])
  const north = living.find(w => w.side === 'north')!
  assert.equal(north.windows.length, 1)
  assert.deepEqual(north.free, [{ from: 0, to: 5.5, length: 5.5 }])
  const south = living.find(w => w.side === 'south')!
  assert.equal(south.walls.length, 2, 'the south edge is backed by two walls (bathroom and primary)')
  for (const w of living) {
    assert.ok(Math.abs(w.inward[0] + w.normal[0]) < 1e-9 && Math.abs(w.inward[1] + w.normal[1]) < 1e-9)
    assert.ok(pointInPolygon([w.a[0] + (w.b[0] - w.a[0]) / 2 + w.inward[0] * 0.1, w.a[1] + (w.b[1] - w.a[1]) / 2 + w.inward[1] * 0.1], room('living').polygon), 'inward points into the room')
  }
})

test('corners name the two walls that meet, and the hall has one reflex corner', () => {
  const corners = cornersOf(room('living'))
  assert.equal(corners.length, 4)
  assert.deepEqual(corners.map(c => c.walls), [['west', 'north'], ['north', 'east'], ['east', 'south'], ['south', 'west']])
  assert.ok(corners.every(c => c.convex))
  for (const c of corners) assert.ok(pointInPolygon([c.point[0] + c.inward[0] * 0.3, c.point[1] + c.inward[1] * 0.3], room('living').polygon))
  const hall = cornersOf(room('hall'))
  assert.equal(hall.filter(c => !c.convex).length, 1)
  assert.deepEqual(hall.find(c => !c.convex)!.point, [6, 4.5])
})

test('windows and doors of a room know their side and the room beyond', () => {
  const primary = room('primary')
  assert.deepEqual(windowsOf(P, primary).map(w => [w.side, w.width, w.other]), [['south', 2, 'outside']])
  assert.deepEqual(doorsOf(P, primary).map(d => [d.side, d.other]).sort(), [['east', 'hall'], ['west', 'bathroom']])
  assert.deepEqual(windowsOf(P, room('living')).map(w => w.width), [2.4, 1.6], 'largest first')
  assert.deepEqual(doorsOf(P, room('hall')).map(d => d.other).sort(), ['balcony', 'bedroom_2', 'closet', 'kitchen', 'living', 'outside', 'primary'])
})

// ---------- the arrival pose on awkward plans ----------

function plan(loose: Parameters<typeof normalizePlan>[0]) {
  const r = normalizePlan(loose, { kind: 'sample', notes: [] })
  if (!r.ok) throw new Error(r.reason)
  return r.plan
}

test('a front door into a 1 m² closet steps through into the room beyond, 0.9 m in, facing in', () => {
  const p = plan({
    name: 'closet entry',
    units: 'm',
    rooms: [
      { id: 'living', name: 'Living', type: 'living', polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] },
      { id: 'wd', name: 'W/D', type: 'laundry', polygon: [[1, 4], [2, 4], [2, 5], [1, 5]] }
    ],
    openings: [
      { kind: 'door', at: [1.5, 5], width: 0.8, rooms: ['wd', 'outside'] },
      { kind: 'door', at: [1.5, 4], width: 0.8, rooms: ['wd', 'living'] }
    ]
  })
  const e = entry(p)
  assert.equal(e.room, 'living')
  assert.ok(Math.abs(e.pos[0] - 1.5) < 1e-9 && Math.abs(e.pos[1] - 3.1) < 1e-9, `0.9 m north of the inner door: ${e.pos}`)
  assert.equal(e.yaw, 0, 'looking north, away from the closet')
})

test('no front door at all: the largest room, at its centre, facing its largest window', () => {
  const p = plan({
    name: 'no door',
    units: 'm',
    rooms: [
      { id: 'living', name: 'Living', type: 'living', polygon: [[0, 0], [5, 0], [5, 4], [0, 4]] },
      { id: 'bed', name: 'Bedroom', type: 'bedroom', polygon: [[5, 0], [8, 0], [8, 4], [5, 4]] }
    ],
    openings: [{ kind: 'window', at: [0, 2], width: 1.5, rooms: ['living', 'outside'] }]
  })
  const e = entry(p)
  assert.equal(e.room, 'living')
  assert.deepEqual(e.pos, [2.5, 2])
  assert.ok(Math.abs(e.yaw - Math.PI / 2) < 1e-9, 'facing west, at the window')
})

test('the real desktop_2br read: the arrival is never the W/D closet, even when the front door is read onto it', () => {
  const loose = JSON.parse(readFileSync(new URL('./fixtures/desktop_2br.loose.json', import.meta.url), 'utf8'))
  const asRead = plan(loose)
  assert.notEqual(entry(asRead).room, 'wd')
  // The live read that shipped the bug put the front door on the W/D's outer wall.
  const front = loose.openings.find((o: { rooms: string[] }) => o.rooms.includes('outside') && o.rooms.includes('kitchen'))
  front.at = [7.45, 7.4]
  front.rooms = ['wd', 'outside']
  loose.openings.push({ kind: 'door', at: [7.45, 6.4], width: 0.8, rooms: ['wd', 'mech'] }, { kind: 'door', at: [8, 6.9], width: 0.8, rooms: ['wd', 'bath_2'] })
  const p = plan(loose)
  const e = entry(p)
  assert.notEqual(e.room, 'wd')
  assert.ok(area(p.rooms.find(r => r.id === e.room)!.polygon) >= 3.5, `spawned in ${e.room}`)
  assert.ok(pointInPolygon(e.pos, p.rooms.find(r => r.id === e.room)!.polygon))
})

// ---------- welding slivers between rooms ----------

test('a 0.15 m sliver between two rooms is welded onto the larger room wall', () => {
  const r = normalizePlan({
    name: 'sliver',
    units: 'm',
    rooms: [
      { id: 'big', name: 'Living', polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] },
      { id: 'small', name: 'Bedroom', polygon: [[4.15, 0], [7, 0], [7, 3], [4.15, 3]] }
    ]
  })
  assert.ok(r.ok)
  const big = r.plan.rooms.find(x => x.id === 'big')!
  const small = r.plan.rooms.find(x => x.id === 'small')!
  assert.deepEqual(big.polygon, [[0, 0], [4, 0], [4, 4], [0, 4]], 'the larger room never moves')
  assert.deepEqual(small.polygon, [[4, 0], [7, 0], [7, 3], [4, 3]])
  const shared = walls(r.plan).filter(w => w.rooms.includes('big') && w.rooms.includes('small'))
  assert.equal(shared.length, 1)
  assert.equal(shared[0]!.length, 3)
  assert.ok(r.notes.some(n => /closed 1 thin gap/.test(n)))
})

test('the weld leaves real gaps, short brushes and overlaps alone', () => {
  const r = normalizePlan({
    name: 'no weld',
    units: 'm',
    rooms: [
      { id: 'a', name: 'Living', polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] },
      // 0.4 m away: a real chase, kept.
      { id: 'b', name: 'Bedroom', polygon: [[4.4, 0], [7, 0], [7, 3], [4.4, 3]] },
      // 0.1 m below a, but facing it for only 0.5 m.
      { id: 'c', name: 'Closet', polygon: [[3.5, 4.1], [4.4, 4.1], [4.4, 5], [3.5, 5]] }
    ]
  })
  assert.ok(r.ok)
  assert.deepEqual(r.plan.rooms.find(x => x.id === 'b')!.polygon[0], [4.4, 0])
  assert.deepEqual(r.plan.rooms.find(x => x.id === 'c')!.polygon[0], [3.5, 4.1])
})

test('plans that already tile come through the weld unchanged (area snapshot)', () => {
  const areas = (p: typeof P) => Object.fromEntries(p.rooms.map(x => [x.id, +area(x.polygon).toFixed(2)]))
  assert.deepEqual(areas(P), { living: 24.75, kitchen: 9, bedroom_2: 10.5, hall: 12, bathroom: 6, primary: 12, closet: 3.25, balcony: 5 })
  const desk = normalizePlan(JSON.parse(readFileSync(new URL('./fixtures/desktop_2br.loose.json', import.meta.url), 'utf8')))
  assert.ok(desk.ok)
  assert.deepEqual(areas(desk.plan), { bedroom_1: 18.2, bath_1: 7.7, living: 17.77, kitchen: 7.76, balcony: 4.76, bedroom_2: 10.54, hall: 3.74, mech: 0.84, wd: 1.05, bath_2: 4.23 })
  assert.ok(!desk.notes.some(n => /thin gap/.test(n)))
  assert.ok(!(P.source?.notes ?? []).some(n => /thin gap/.test(n)))
})

test('connectRooms: only rooms with no way in get one, from the hall or living room, each with a note; a sound plan is untouched', () => {
  assert.deepEqual(connectRooms(P), { plan: P, added: [], notes: [] })
  // Kitchen, bedroom 2 and the bathroom lose every door and opening they had.
  const sealed = { ...P, openings: P.openings.filter(o => !['opening_3', 'opening_4', 'door_5', 'door_7'].includes(o.id)) }
  const { plan, added, notes } = connectRooms(sealed)
  assert.deepEqual(added, ['opening kitchen↔living', 'door bedroom_2↔hall', 'door bathroom↔living'])
  // The kitchen beside the living room is opened along the whole shared wall: no invented wall with a hole in it.
  const kl = walls(plan).find(w => w.rooms.includes('kitchen') && w.rooms.includes('living'))!
  assert.equal(kl.open, true)
  assert.deepEqual(kl.pieces, [])
  assert.deepEqual(notes, [
    'no opening was drawn into Kitchen; left it open to the living room',
    'no door was drawn into Bedroom 2; added a door from the hall',
    'no door was drawn into Bathroom; added a door from the living room'
  ])
  const seen = new Set([entry(plan).room])
  const queue = [...seen]
  while (queue.length) {
    const id = queue.shift()
    for (const d of doorsOf(plan, plan.rooms.find(r => r.id === id)!)) {
      if (d.other !== 'outside' && !seen.has(d.other)) {
        seen.add(d.other)
        queue.push(d.other)
      }
    }
  }
  assert.deepEqual(plan.rooms.filter(r => !seen.has(r.id)).map(r => r.id), [], `added ${added}`)
})

test('connectRooms leaves a room that has any opening alone, even when it is not the best-connected', () => {
  // Bedroom 2 keeps only its door to the closet (no hall door): it has a way in, so nothing is invented.
  const partial = { ...P, openings: P.openings.filter(o => o.id !== 'door_5') }
  const bed2 = partial.rooms.find(r => r.id === 'bedroom_2')!
  const withCloset = { ...partial, openings: [...partial.openings, { id: 'door_x', kind: 'door' as const, at: [9.75, 4.2] as [number, number], width: 0.8, height: 2.05, rooms: [bed2.id, 'closet'] as [string, string] }] }
  assert.deepEqual(connectRooms(withCloset).added, [])
})

test('connectRooms: a suite with doors only among itself gets one link, from its hall; a sealed hall opens onto the living room', () => {
  // Bedroom 2 → closet → (nothing): the closet's hall door is gone, so bedroom 2 and the closet are an island.
  const island = { ...P, openings: P.openings.filter(o => !['door_5', 'door_8'].includes(o.id)) }
  const bed2 = island.rooms.find(r => r.id === 'bedroom_2')!
  const withCloset = { ...island, openings: [...island.openings, { id: 'door_x', kind: 'door' as const, at: [9.75, 4.2] as [number, number], width: 0.8, height: 2.05, rooms: [bed2.id, 'closet'] as [string, string] }] }
  const { added, notes } = connectRooms(withCloset)
  assert.equal(added.length, 1, `${added}`)
  assert.match(notes[0]!, /^no way in from the rest of the home was drawn into (Bedroom 2|Closet); added a door from the (hall|kitchen)$/)
  // A hall with no openings at all next to the living room: an open boundary, not a door.
  const hallSealed = { ...P, openings: P.openings.filter(o => !o.rooms.includes('hall') || o.kind === 'window') }
  const r = connectRooms(hallSealed)
  assert.match(r.added[0]!, /^opening hall↔(living|kitchen)$/, `${r.added}`)
  assert.match(r.notes[0]!, /^no opening was drawn into Hall; left it open to the (living room|kitchen)$/)
  assert.ok(r.added.includes('door bedroom_2↔hall'), `then the bedroom joins the hall: ${r.added}`)
})

// ---------- open-plan boundaries ----------

test('a cased opening spanning ≥ 85 % of its wall is open: no pieces, the derived opening spans the wall', () => {
  const p = plan({
    name: 'open plan',
    units: 'm',
    rooms: [
      { id: 'living', name: 'Living', type: 'living', polygon: [[0, 0], [4, 0], [4, 5], [0, 5]] },
      { id: 'kitchen', name: 'Kitchen', type: 'kitchen', polygon: [[0, 5], [4, 5], [4, 7.5], [0, 7.5]] },
      { id: 'bed', name: 'Bedroom', type: 'bedroom', polygon: [[4, 0], [7, 0], [7, 5], [4, 5]] }
    ],
    openings: [
      { kind: 'opening', at: [2, 5], width: 3.5, rooms: ['living', 'kitchen'] },
      // 0.9 / 1.0 would be 90 %, but a door is a door: it keeps its wall and its leaf.
      { kind: 'opening', at: [4, 2], width: 1.6, rooms: ['living', 'bed'] }
    ]
  })
  const ws = walls(p)
  const lk = ws.find(w => w.rooms.includes('living') && w.rooms.includes('kitchen'))!
  assert.equal(lk.open, true)
  assert.deepEqual(lk.pieces, [], 'no header, no stubs')
  assert.deepEqual([lk.openings[0]!.open, lk.openings[0]!.width, lk.openings[0]!.along], [true, 4, 2])
  const lb = ws.find(w => w.rooms.includes('living') && w.rooms.includes('bed'))!
  assert.equal(lb.open, false, '1.6 m of a 5 m wall is a cased opening in a real wall')
  assert.deepEqual(lb.pieces.map(x => x.kind), ['solid', 'door_header', 'solid'])
  // Living's south edge has no free stretch left to back furniture onto.
  const south = wallSegmentsOf(p, p.rooms.find(r => r.id === 'living')!).find(w => w.side === 'south')!
  assert.deepEqual(south.free, [])
})

test('a full-width opening into a bedroom is a misread: it becomes a door where the reader put it, with a note', () => {
  const r = normalizePlan({
    name: 'wrong pair',
    units: 'm',
    rooms: [
      { id: 'living', name: 'Living', type: 'living', polygon: [[0, 0], [4, 0], [4, 5], [0, 5]] },
      { id: 'bedroom_2', name: 'Bedroom 2', type: 'bedroom', polygon: [[4, 0], [7, 0], [7, 3.2], [4, 3.2]] }
    ],
    openings: [{ kind: 'opening', at: [4, 1.6], width: 3.2, rooms: ['living', 'bedroom_2'] }]
  })
  assert.ok(r.ok)
  assert.deepEqual(r.plan.openings.map(o => [o.kind, o.width, o.at]), [['door', 0.85, [4, 1.6]]])
  assert.ok(walls(r.plan).every(w => !w.open))
  assert.ok(r.notes.some(n => /left Bedroom 2 wide open to Living; made it a door/.test(n)), r.notes.join(' | '))
  assert.ok(r.plan.source!.notes.some(n => /made it a door/.test(n)), 'the Plan panel sees it too')
})

test('doors and exterior openings are never open, however much of their wall they fill', () => {
  const p = plan({
    name: 'tight',
    units: 'm',
    rooms: [
      { id: 'hall', name: 'Hall', type: 'hall', polygon: [[0, 0], [3, 0], [3, 1], [0, 1]] },
      { id: 'wd', name: 'W/D', type: 'laundry', polygon: [[3, 0], [4, 0], [4, 1], [3, 1]] }
    ],
    openings: [
      { kind: 'door', at: [3, 0.5], width: 0.95, rooms: ['hall', 'wd'] },
      { kind: 'opening', at: [0, 0.5], width: 1, rooms: ['hall', 'outside'] }
    ]
  })
  for (const w of walls(p)) {
    assert.equal(w.open, false, w.id)
    assert.ok(w.openings.every(o => !o.open))
  }
})

test('normalizePlan clamps an opening to its wall: a cased opening wider than the wall becomes exactly the wall', () => {
  const p = plan({
    name: 'too wide',
    units: 'ft',
    rooms: [
      { id: 'living', name: 'Living', type: 'living', polygon: [[0, 0], [12, 0], [12, 17], [0, 17]] },
      { id: 'kitchen', name: 'Kitchen', type: 'kitchen', polygon: [[0, 17], [10, 17], [10, 25], [0, 25]] },
      { id: 'bath', name: 'Bath', type: 'bathroom', polygon: [[10, 17], [12, 17], [12, 25], [10, 25]] }
    ],
    // The reader measured the living room's whole south side (12 ft), but the kitchen shares only 10 ft of it.
    openings: [
      { kind: 'opening', at: [6, 17], width: 12, rooms: ['living', 'kitchen'] },
      { kind: 'door', at: [11, 17], width: 3, rooms: ['bath', 'living'] }
    ]
  })
  // Vertices snap to 5 cm, so 10 ft of shared wall is 3.05 m.
  const wall = walls(p).find(w => w.rooms.includes('kitchen') && w.rooms.includes('living'))!
  assert.equal(wall.length, 3.05)
  const lk = p.openings.find(o => o.rooms.includes('kitchen'))!
  assert.equal(lk.width, 3.05)
  assert.deepEqual(lk.at, [1.525, 5.2], 'centred on the shared wall, not the living room side')
  assert.equal(wall.open, true)
  const door = p.openings.find(o => o.kind === 'door')!
  assert.equal(door.width, 0.6, 'the 3 ft door on a 2 ft wall is clamped to the wall')
})

test('a front door read onto a corner still lands you inside the room it opens into, not in the partition', () => {
  // A real read (QA 2026-10-18): door_4 centred at the kitchen / hall_2 corner of the exterior wall.
  const plan = JSON.parse(readFileSync(new URL('./fixtures/desktop_2br_corner_door.plan.json', import.meta.url), 'utf8')) as typeof P
  const e = entry(plan)
  assert.equal(e.room, 'kitchen')
  assert.equal(roomAt(plan, e.pos)?.id, 'kitchen', `spawn ${e.pos}`)
  const kitchen = plan.rooms.find(r => r.id === 'kitchen')!
  assert.ok(distToPolygonEdge(e.pos, kitchen.polygon) > 0.4, `clear of the walls: ${e.pos}`)
})

test('a narrow front hallway is the arrival, not a closet to step through (a real terrace read)', () => {
  const plan = JSON.parse(readFileSync(new URL('./fixtures/tyneside_narrow_hall.plan.json', import.meta.url), 'utf8')) as typeof P
  const e = entry(plan)
  assert.equal(e.room, 'hallway', `spawn ${e.room} at ${e.pos}`)
  assert.equal(roomAt(plan, e.pos)?.id, 'hallway')
})
