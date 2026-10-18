/**
 * Plan geometry over TWO_BED_APARTMENT: walls deduped across shared edges and split where the neighbour
 * changes, openings cut into header / apron pieces, room lookups, and the entry pose.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cornersOf, doorsOf, entry, planBounds, roomAt, roomCenter, wallSegmentsOf, walls, windowsOf } from '../shared/plan/geometry.ts'
import { pointInPolygon } from '../shared/plan/poly.ts'
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
