/**
 * Placement and selection: sofas against walls, beds with nightstands, chairs round a table, rugs under
 * things, de-overlap, wall-mounted and ceiling heights, and the selector / room resolution rules.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { distToPolygonEdge, pointInPolygon } from '../shared/plan/poly.ts'
import type { Vec2 } from '../shared/plan/poly.ts'
import { wallSegmentsOf } from '../shared/plan/geometry.ts'
import { TWO_BED_APARTMENT as P } from '../shared/plan/samples.ts'
import { KIT } from '../shared/home/kinds.ts'
import { faceToward, frontOf, overlapArea, resolveSpot, sideOf } from '../shared/home/layout.ts'
import { boxCorners, itemCorners, itemFootprint, resolveRoom, select } from '../shared/home/select.ts'
import { applyBatch, createHome } from '../shared/home/state.ts'
import type { HomeState, Item, OpContext } from '../shared/home/types.ts'

const room = (id: string) => P.rooms.find(r => r.id === id)!

function ctx(over: Partial<OpContext> = {}): OpContext {
  return { gaze: { point: [2.75, 2.25], room: 'living' }, player: { pos: [2.75, 3.2], yaw: 0, room: 'living' }, seed: 42, ...over }
}

function run(state: HomeState, ops: unknown, c = ctx(), label = 'test') {
  return applyBatch(state, ops, label, c)
}

const byKind = (s: HomeState, kind: string) => s.items.filter(i => i.kind === kind)
const inside = (i: Item, id: string) => itemCorners(i).every(c => pointInPolygon(c, room(id).polygon, 0.03))
const dotDir = (a: Vec2, b: Vec2) => (a[0] * b[0] + a[1] * b[1]) / (Math.hypot(a[0], a[1]) * Math.hypot(b[0], b[1]))

/** Distance from the item's back face centre to the nearest room edge. */
function backGap(i: Item): number {
  const f = frontOf(i.yaw)
  const w = itemFootprint(i).width
  return distToPolygonEdge([i.pos[0] - f[0] * w / 2, i.pos[1] - f[1] * w / 2], room(i.room).polygon)
}

function overlapRatio(a: Item, b: Item): number {
  const fa = itemFootprint(a)
  const fb = itemFootprint(b)
  return overlapArea(itemCorners(a), itemCorners(b)) / Math.min(fa.length * fa.width, fb.length * fb.width)
}

test('faceToward turns a front (+z local) at the target', () => {
  for (const target of [[0, -5], [5, 0], [0, 5], [-5, 0], [3, 3]] as Vec2[]) {
    const yaw = faceToward([0, 0], target)
    assert.ok(dotDir(frontOf(yaw), target) > 0.999, `facing ${target}`)
  }
  // The local +x side of something facing south (+z) is +x... its own left when it looks out of its front.
  assert.deepEqual(sideOf(0).map(v => +v.toFixed(6)), [1, 0])
})

test('a sofa in the living room lands against a wall, inside, clear of every window and door', () => {
  const s = run(createHome(P), [{ op: 'place', kind: 'sofa', at: { room: 'living', where: 'wall' } }]).state
  const sofa = byKind(s, 'sofa')[0]!
  assert.ok(inside(sofa, 'living'))
  assert.ok(backGap(sofa) < 0.05, `back against the wall (${backGap(sofa).toFixed(3)})`)
  // Which edge is it on, and does its span cross an opening there?
  const wall = wallSegmentsOf(P, room('living')).find(w => dotDir(w.inward, frontOf(sofa.yaw)) > 0.99)!
  const along = (sofa.pos[0] - wall.a[0]) * wall.dir[0] + (sofa.pos[1] - wall.a[1]) * wall.dir[1]
  const half = itemFootprint(sofa).length / 2
  for (const o of wall.openings) assert.ok(along + half <= o.along - o.width / 2 || along - half >= o.along + o.width / 2, `clear of ${o.id}`)
  assert.equal(wall.side, 'south', 'the only wall with no openings and room for 2.1 m')
  assert.ok(dotDir(frontOf(sofa.yaw), [0, -1]) > 0.99, 'front looks into the room')
})

test('a bed against a wall gets a nightstand either side, both inside the room and on the same wall', () => {
  const c = ctx({ gaze: { point: [4, 6], room: 'primary' }, player: { pos: [4, 6.5], yaw: 0, room: 'primary' } })
  const s = run(createHome(P), [
    { op: 'place', kind: 'bed', at: { room: 'primary', where: 'wall' } },
    { op: 'place', kind: 'nightstand', at: { room: 'primary', where: 'near', of: { kind: 'bed' }, side: 'left' } },
    { op: 'place', kind: 'nightstand', at: { room: 'primary', where: 'near', of: { kind: 'bed' }, side: 'right' } }
  ], c).state
  const bed = byKind(s, 'bed')[0]!
  const stands = byKind(s, 'nightstand')
  assert.equal(stands.length, 2)
  assert.ok(inside(bed, 'primary') && backGap(bed) < 0.05)
  const side = sideOf(bed.yaw)
  const offsets = stands.map(n => (n.pos[0] - bed.pos[0]) * side[0] + (n.pos[1] - bed.pos[1]) * side[1])
  assert.ok(offsets[0]! > 0.9 && offsets[1]! < -0.9, `one each side: ${offsets.map(o => o.toFixed(2))}`)
  for (const n of stands) {
    assert.ok(inside(n, 'primary'))
    assert.ok(backGap(n) < 0.05, 'nightstand back on the same wall as the headboard')
    assert.equal(overlapRatio(n, bed), 0)
  }
})

test('four chairs around a dining table face it, two per long side, without overlapping', () => {
  const s = run(createHome(P), [
    { op: 'place', kind: 'dining_table', at: { room: 'living', where: 'center' } },
    { op: 'place', kind: 'dining_chair', count: 4, arrange: 'around', at: { room: 'living', where: 'near', of: { kind: 'dining_table' } } }
  ]).state
  const table = byKind(s, 'dining_table')[0]!
  const chairs = byKind(s, 'dining_chair')
  assert.equal(chairs.length, 4)
  const f = frontOf(table.yaw)
  let front = 0
  let back = 0
  for (const ch of chairs) {
    assert.ok(inside(ch, 'living'))
    // Chairs sit square to their side of the table, so an off-centre chair looks at the table, not at its exact middle.
    assert.ok(dotDir(frontOf(ch.yaw), [table.pos[0] - ch.pos[0], table.pos[1] - ch.pos[1]]) > 0.8, 'faces the table')
    assert.ok(Math.abs(Math.sin(2 * (ch.yaw - table.yaw))) < 0.01, 'square to the table (yaws are stored to 3 decimals)')
    assert.equal(overlapRatio(ch, table), 0)
    const d = (ch.pos[0] - table.pos[0]) * f[0] + (ch.pos[1] - table.pos[1]) * f[1]
    if (d > 0.3) front++
    else if (d < -0.3) back++
  }
  assert.deepEqual([front, back], [2, 2])
  for (let i = 0; i < chairs.length; i++) for (let j = i + 1; j < chairs.length; j++) assert.equal(overlapRatio(chairs[i]!, chairs[j]!), 0)
})

test('new pieces slide or nudge out of the way of what is already there', () => {
  let s = run(createHome(P), [{ op: 'place', kind: 'bookshelf', count: 3, at: { room: 'living', where: 'wall', wall: 'south' } }]).state
  s = run(s, [{ op: 'place', kind: 'sofa', at: { room: 'living', where: 'wall', wall: 'south' } }]).state
  s = run(s, [{ op: 'place', kind: 'armchair', count: 5, at: { room: 'living', where: 'center' } }]).state
  const floor = s.items
  assert.equal(floor.length, 9)
  for (let i = 0; i < floor.length; i++) {
    for (let j = i + 1; j < floor.length; j++) {
      assert.ok(overlapRatio(floor[i]!, floor[j]!) < 0.01, `${floor[i]!.id} overlaps ${floor[j]!.id}`)
    }
  }
  for (const i of floor) assert.ok(inside(i, 'living'), `${i.id} inside`)
  const sofa = byKind(s, 'sofa')[0]!
  assert.ok(backGap(sofa) < 0.05, 'the sofa still found wall space (the south wall is full, so another wall)')
})

test('a rug goes under the front of a bed or a sofa (negative dist) and never counts as an overlap', () => {
  const s = run(createHome(P), [
    { op: 'place', kind: 'sofa', at: { room: 'living', where: 'wall' } },
    { op: 'place', kind: 'rug', at: { room: 'living', where: 'near', of: { kind: 'sofa' }, side: 'front', dist: -0.3 } },
    { op: 'place', kind: 'coffee_table', at: { room: 'living', where: 'near', of: { kind: 'sofa' }, side: 'front', dist: 0.5 } }
  ]).state
  const sofa = byKind(s, 'sofa')[0]!
  const rug = byKind(s, 'rug')[0]!
  const table = byKind(s, 'coffee_table')[0]!
  assert.ok(overlapArea(itemCorners(rug), itemCorners(sofa)) > 0.3, 'the rug slips under the sofa front')
  const f = frontOf(sofa.yaw)
  assert.ok((rug.pos[0] - sofa.pos[0]) * f[0] + (rug.pos[1] - sofa.pos[1]) * f[1] > 0, 'rug centre in front of the sofa')
  assert.ok(overlapArea(itemCorners(table), itemCorners(rug)) > 0.5, 'the coffee table sits on the rug')
  assert.equal(overlapRatio(table, sofa), 0)
  assert.ok(inside(rug, 'living'))
})

test('wall pieces hang at their height, TVs stand on their stand, pendants hang from the ceiling', () => {
  const s = run(createHome(P), [
    { op: 'place', kind: 'sofa', at: { room: 'living', where: 'wall' } },
    { op: 'place', kind: 'tv_stand', at: { room: 'living', where: 'near', of: { kind: 'sofa' }, side: 'opposite' } },
    { op: 'place', kind: 'tv', at: { room: 'living', where: 'near', of: { kind: 'tv_stand' }, side: 'on' } },
    { op: 'place', kind: 'picture', at: { room: 'living', where: 'wall' } },
    { op: 'place', kind: 'pendant', at: { room: 'living' } },
    { op: 'place', kind: 'vanity', at: { room: 'bathroom', where: 'wall' } },
    { op: 'place', kind: 'mirror', at: { room: 'bathroom', where: 'near', of: { kind: 'vanity' }, side: 'on' } }
  ]).state
  const sofa = byKind(s, 'sofa')[0]!
  const stand = byKind(s, 'tv_stand')[0]!
  const tv = byKind(s, 'tv')[0]!
  assert.ok(stand.pos[1] < 0.5 && Math.abs(stand.pos[0] - sofa.pos[0]) < 0.3, 'opposite = across the room on the facing wall')
  assert.ok(dotDir(frontOf(stand.yaw), [sofa.pos[0] - stand.pos[0], sofa.pos[1] - stand.pos[1]]) > 0.99, 'facing the sofa')
  assert.deepEqual(tv.pos, stand.pos)
  assert.equal(tv.y, 0.5, 'on the stand top')
  const pic = byKind(s, 'picture')[0]!
  assert.equal(pic.y, 1.25, 'hang 1.55 minus half its 0.6 height')
  assert.ok(backGap(pic) < 0.01, 'flush on the wall')
  const pendant = byKind(s, 'pendant')[0]!
  assert.equal(pendant.y, 2.2, 'ceiling 2.7 minus its 0.5 drop')
  const mirror = byKind(s, 'mirror')[0]!
  const vanity = byKind(s, 'vanity')[0]!
  assert.equal(mirror.y, 1.0)
  assert.ok(backGap(mirror) < 0.01 && Math.hypot(mirror.pos[0] - vanity.pos[0], mirror.pos[1] - vanity.pos[1]) < 0.4, 'on the wall over the vanity')
})

test('"there" puts a chair at the gaze point facing you; wall kinds snap to the nearest wall', () => {
  const c = ctx({ gaze: { point: [1.2, 1.6], room: 'living' } })
  const s = run(createHome(P), [
    { op: 'place', kind: 'armchair', at: { where: 'gaze' } },
    { op: 'place', kind: 'bookshelf', at: { where: 'gaze' } }
  ], c).state
  const chair = byKind(s, 'armchair')[0]!
  assert.ok(Math.hypot(chair.pos[0] - 1.2, chair.pos[1] - 1.6) < 0.3)
  assert.equal(chair.room, 'living')
  assert.ok(dotDir(frontOf(chair.yaw), [c.player.pos[0] - chair.pos[0], c.player.pos[1] - chair.pos[1]]) > 0.99)
  const shelf = byKind(s, 'bookshelf')[0]!
  assert.ok(backGap(shelf) < 0.05, 'snapped to the west wall')
  assert.ok(shelf.pos[0] < 0.5)
})

test('resolveSpot is deterministic for a seed and honest when nothing fits', () => {
  const s = createHome(P)
  const opts = { index: 0, count: 5, seed: 7, existing: [] as Item[] }
  const a = resolveSpot(s, { room: 'living', where: 'center' }, KIT.armchair!, ctx(), opts)
  const b = resolveSpot(s, { room: 'living', where: 'center' }, KIT.armchair!, ctx(), opts)
  assert.deepEqual(a, b)
  const car = resolveSpot(s, { room: 'closet' }, KIT.car!, ctx(), { ...opts, count: 1 })
  assert.ok('fail' in car && /no room for the car in the closet/.test(car.fail))
  const noAnchor = resolveSpot(s, { where: 'near', of: { kind: 'piano' }, side: 'beside' }, KIT.stool!, ctx(), { ...opts, count: 1 })
  assert.ok('fail' in noAnchor && /no piano/.test(noAnchor.fail))
  const noRoom = resolveSpot(s, { room: 'attic' }, KIT.box!, ctx(), { ...opts, count: 1 })
  assert.ok('fail' in noRoom && /attic/.test(noRoom.fail))
})

test('a 2.4 m row of bar stools in front of the island, and curtains cut to the window', () => {
  const c = ctx({ gaze: { point: [7, 1.5], room: 'kitchen' }, player: { pos: [7, 2.5], yaw: 0, room: 'kitchen' } })
  const s = run(createHome(P), [
    { op: 'place', kind: 'island', at: { room: 'kitchen', where: 'center' } },
    { op: 'place', kind: 'bar_stool', count: 2, at: { room: 'kitchen', where: 'near', of: { kind: 'island' }, side: 'front', dist: 0.1 } },
    { op: 'place', kind: 'curtains', at: { room: 'living', where: 'window' } }
  ], c).state
  const stools = byKind(s, 'bar_stool')
  assert.equal(stools.length, 2)
  assert.ok(Math.hypot(stools[0]!.pos[0] - stools[1]!.pos[0], stools[0]!.pos[1] - stools[1]!.pos[1]) > 0.5)
  const curtains = byKind(s, 'curtains')[0]!
  assert.deepEqual([curtains.room, +curtains.pos[0].toFixed(2)], ['living', 2.75], 'centred on the largest window')
  assert.ok(curtains.pos[1] < 0.2)
})

// ---------- selectors ----------

test('resolveRoom: here, all, id, name, type, numbered, primary and fuzzy', () => {
  const c = ctx({ player: { pos: [7, 1.5], yaw: 0, room: 'kitchen' } })
  const id = (r: ReturnType<typeof resolveRoom>) => (r && r !== 'all' ? r.id : r)
  assert.equal(id(resolveRoom(P, undefined, c)), 'kitchen')
  assert.equal(id(resolveRoom(P, 'here', c)), 'kitchen')
  assert.equal(id(resolveRoom(P, 'all', c)), 'all')
  assert.equal(id(resolveRoom(P, 'bedroom_2', c)), 'bedroom_2')
  assert.equal(id(resolveRoom(P, 'Living Room', c)), 'living')
  assert.equal(id(resolveRoom(P, 'bedroom', c)), 'primary', 'largest of the type')
  assert.equal(id(resolveRoom(P, 'bedroom 2', c)), 'bedroom_2')
  assert.equal(id(resolveRoom(P, 'second bedroom', c)), 'bedroom_2')
  assert.equal(id(resolveRoom(P, 'master', c)), 'primary')
  assert.equal(id(resolveRoom(P, 'primary bedroom', c)), 'primary')
  assert.equal(id(resolveRoom(P, 'guest room', c)), 'bedroom_2')
  assert.equal(id(resolveRoom(P, 'the lounge', c)), 'living')
  assert.equal(id(resolveRoom(P, 'bath', c)), 'bathroom')
  assert.equal(id(resolveRoom(P, 'terrace', c)), 'balcony')
  assert.equal(resolveRoom(P, 'garage', c), undefined)
  // Nowhere in particular: the player's position, then the gaze, then the largest room.
  assert.equal(id(resolveRoom(P, 'here', ctx({ player: { pos: [9, 6.5], yaw: 0 } }))), 'balcony')
  assert.equal(id(resolveRoom(P, 'here', ctx({ player: { pos: [50, 50], yaw: 0 }, gaze: { point: [50, 50] } }))), 'living')
})

test('select: kind through aliases, tag, room, gaze, last, near/within, limit', () => {
  const home = createHome(P, { furnish: true })
  const c = ctx()
  assert.ok(select(home, { kind: 'couch' }, c).length >= 1)
  assert.equal(select(home, { kind: 'sofas' }, c).length, select(home, { kind: 'sofa' }, c).length)
  assert.ok(select(home, { tag: 'seating' }, c).length > 3)
  assert.ok(select(home, { tag: 'seating', room: 'living' }, c).every(i => i.room === 'living'))
  assert.equal(select(home, { kind: 'bed', room: 'bedroom 2' }, c).length, 1)
  assert.equal(select(home, { kind: 'bed', room: 'attic' }, c).length, 0)
  assert.equal(select(home, { kind: 'lamp' }, c).filter(i => i.kind === 'floor_lamp').length, select(home, { kind: 'floor_lamp' }, c).length, 'lamp → floor_lamp alias first')
  const sofa = select(home, { kind: 'sofa' }, c)[0]!
  assert.deepEqual(select(home, { ref: 'gaze' }, ctx({ gaze: { point: sofa.pos, itemId: sofa.id } })).map(i => i.id), [sofa.id])
  assert.deepEqual(select(home, { ref: 'gaze' }, ctx({ gaze: { point: sofa.pos } })).map(i => i.id), [sofa.id], 'the footprint under the gaze point')
  assert.equal(select(home, { ref: 'gaze', kind: 'rug' }, ctx({ gaze: { point: sofa.pos, itemId: sofa.id } })).length, 1, 'looking at the sofa but asking for the rug: the nearest rug')
  assert.equal(select(home, { ref: 'last' }, c).length, home.items.length, 'everything came from the furnish batch')
  const near = select(home, { near: 'gaze', within: 1.5 }, ctx({ gaze: { point: sofa.pos } }))
  assert.ok(near.length >= 2 && near[0]!.id === sofa.id, 'sorted by distance to the gaze')
  assert.equal(select(home, { tag: 'light', limit: 2 }, c).length, 2)
})

test('footprints: props resize sized kinds and scale everything; corners rotate with yaw', () => {
  const sofa: Item = { id: 'sofa#1', kind: 'sofa', room: 'living', pos: [0, 0], yaw: 0, props: { length: 3, scale: 2 }, group: 'g1', tags: [] }
  assert.deepEqual(itemFootprint(sofa), { length: 6, width: 1.8, height: 1.7 })
  const chair: Item = { ...sofa, kind: 'armchair', props: { length: 3 } }
  assert.equal(itemFootprint(chair).length, 0.9, 'length ignored on an unsized kind')
  const box = boxCorners([1, 1], Math.PI / 2, 2, 1)
  // Rotated a quarter turn, the 2 m length runs along z.
  const zs = box.map(p => +p[1].toFixed(3))
  assert.equal(Math.max(...zs) - Math.min(...zs), 2)
})
