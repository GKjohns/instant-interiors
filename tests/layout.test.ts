/**
 * Placement and selection: sofas against walls, beds with nightstands, chairs round a table, rugs under
 * things, de-overlap, wall-mounted and ceiling heights, and the selector / room resolution rules.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { distToPolygonEdge, pointInPolygon } from '../shared/plan/poly.ts'
import type { Vec2 } from '../shared/plan/poly.ts'
import { corridors, wallSegmentsOf } from '../shared/plan/geometry.ts'
import type { Corridor } from '../shared/plan/geometry.ts'
import { SAMPLES, TWO_BED_APARTMENT as P } from '../shared/plan/samples.ts'
import type { FloorPlan } from '../shared/plan/schema.ts'
import { KIT } from '../shared/home/kinds.ts'
import { clearanceAround, faceToward, frontOf, itemLayer, overlapArea, resolveSpot, sideOf } from '../shared/home/layout.ts'
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

const floorItems = (s: HomeState, roomId: string) => s.items.filter(i => i.room === roomId && itemLayer(i) === 'floor')
const rectArea = (r: Vec2[]) => overlapArea(r, r)

/** Share of a corridor's best route not covered by floor pieces (sum of overlaps, so a conservative figure). */
function clearShare(cor: Corridor, items: Item[]): number {
  return Math.max(...cor.routes.map((route) => {
    const total = route.rects.reduce((t, r) => t + rectArea(r), 0)
    const covered = route.rects.reduce((t, r) => t + items.reduce((u, i) => u + overlapArea(itemCorners(i), r), 0), 0)
    return 1 - covered / total
  }))
}

/** The worst door-to-door (and door-to-middle) corridor of a room, as its clear share. */
function throughClear(s: HomeState, roomId: string, plan: FloorPlan = s.plan): number {
  const r = plan.rooms.find(x => x.id === roomId)!
  const cors = corridors(plan, r).filter(c => c.kind !== 'entry')
  return Math.min(1, ...cors.map(c => clearShare(c, floorItems(s, roomId))))
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

test('a full counter wall: the stove and fridge go on another wall or a corner of the kitchen, with a soft note', () => {
  const run1 = applyBatch(createHome(P), [{ op: 'furnish', room: 'kitchen' }], 'furnish', ctx({ player: { pos: [7, 1.5], yaw: 0, room: 'kitchen' } }))
  const s = run1.state
  const kinds = s.items.filter(i => i.room === 'kitchen').map(i => i.kind)
  for (const k of ['counter', 'sink', 'stove', 'fridge']) assert.ok(kinds.includes(k), `kitchen has a ${k}: ${kinds}`)
  const counter = byKind(s, 'counter')[0]!
  const fridge = byKind(s, 'fridge')[0]!
  assert.ok(dotDir(frontOf(fridge.yaw), frontOf(counter.yaw)) < 0.5, 'the fridge is on a different wall from the counter')
  for (const i of s.items) assert.ok(inside(i, 'kitchen'), `${i.id} inside`)
  assert.ok(run1.effects.notes.some(n => /put the stove on the (north|south|east|west) wall instead/.test(n)), `softened note: ${run1.effects.notes}`)
  assert.ok(!run1.effects.notes.some(n => /no stove to put/.test(n)), 'nothing downstream of the stove is lost')
  // Deterministic: the same sentence twice lands the same kitchen.
  const again = applyBatch(createHome(P), [{ op: 'furnish', room: 'kitchen' }], 'furnish', ctx({ player: { pos: [7, 1.5], yaw: 0, room: 'kitchen' } })).state
  assert.deepEqual(again.items, s.items)
})

test('a nightstand that cannot sit beside its bed is skipped, not exiled to another wall', () => {
  // Updated: bedroom 2's furnish now turns the bed so both nightstands fit. A bed on its north wall keeps one
  // side open (the west), so its east side is against the wall and the right-hand nightstand has nowhere to go.
  const c = ctx({ gaze: { point: [9.75, 2], room: 'bedroom_2' }, player: { pos: [50, 50], yaw: 0 } })
  const r = run(createHome(P), [
    { op: 'place', kind: 'bed', at: { room: 'bedroom_2', where: 'wall', wall: 'north' } },
    { op: 'place', kind: 'nightstand', at: { room: 'bedroom_2', where: 'near', of: { kind: 'bed' }, side: 'left' } },
    { op: 'place', kind: 'nightstand', at: { room: 'bedroom_2', where: 'near', of: { kind: 'bed' }, side: 'right' } }
  ], c)
  const bed = byKind(r.state, 'bed')[0]!
  const stands = byKind(r.state, 'nightstand')
  assert.equal(stands.length, 1)
  assert.ok(backGap(stands[0]!) < 0.05 && Math.abs(stands[0]!.pos[1] - bed.pos[1]) < 1.1, 'the one that fits is on the bed wall beside the headboard')
  assert.ok(r.effects.notes.some(n => /no room to the right of the bed/.test(n)), `${r.effects.notes}`)
})

test('"four dining chairs near the table" (no arrange) means around it', () => {
  const s = run(createHome(P), [
    { op: 'place', kind: 'round_table', at: { room: 'living', where: 'center' } },
    { op: 'place', kind: 'dining_chair', count: 4, at: { room: 'living', where: 'near', of: { kind: 'round_table' } } }
  ]).state
  const table = byKind(s, 'round_table')[0]!
  const chairs = byKind(s, 'dining_chair')
  assert.equal(chairs.length, 4)
  const r = chairs.map(ch => Math.hypot(ch.pos[0] - table.pos[0], ch.pos[1] - table.pos[1]))
  assert.ok(Math.max(...r) - Math.min(...r) < 0.01, `a ring: ${r.map(x => x.toFixed(2))}`)
  for (const ch of chairs) assert.ok(dotDir(frontOf(ch.yaw), [table.pos[0] - ch.pos[0], table.pos[1] - ch.pos[1]]) > 0.99, 'facing the table')
  // Two of anything near a table is still a pair/row, not a ring.
  const two = run(createHome(P), [
    { op: 'place', kind: 'dining_table', at: { room: 'living', where: 'center' } },
    { op: 'place', kind: 'dining_chair', count: 2, at: { room: 'living', where: 'near', of: { kind: 'dining_table' }, side: 'front' } }
  ]).state
  const pairOf = byKind(two, 'dining_chair')
  const t = byKind(two, 'dining_table')[0]!
  const f = frontOf(t.yaw)
  assert.ok(pairOf.every(ch => (ch.pos[0] - t.pos[0]) * f[0] + (ch.pos[1] - t.pos[1]) * f[1] > 0.3), 'both in front')
})

test('a named wall that is full falls back to the kind\'s natural place, with a soft note; a move to where it stands says so', () => {
  const home = createHome(P, { furnish: true })
  const c = ctx({ player: { pos: [2.75, 2.25], yaw: Math.PI, room: 'living' } })
  const r = run(home, [{ op: 'remove', target: { kind: 'sofa', room: 'living' } }, { op: 'place', kind: 'sectional', at: { where: 'wall', wall: 'north' } }], c)
  assert.equal(byKind(r.state, 'sectional').length, 1)
  assert.ok(inside(byKind(r.state, 'sectional')[0]!, 'living'))
  assert.ok(r.effects.notes.some(n => /sectional.*instead/.test(n)), `${r.effects.notes}`)
  const m = run(home, [{ op: 'move', target: { kind: 'bed', room: 'primary' }, at: { where: 'wall', wall: 'north' } }, { op: 'say', text: 'Bed on the north wall.' }], ctx({ player: { pos: [4, 6], yaw: 0, room: 'primary' } }))
  assert.ok(m.effects.notes.some(n => /already there/.test(n)))
  assert.match(m.effects.say[0]!, /^I couldn't: the bed \(queen\) is already there\.$/)
})

test('a round table in a tight furnished kitchen keeps off the way from the living room to the hall and seats what fits', () => {
  // Updated: it used to sit in the middle and seat 3; the middle of this 3 × 3 m kitchen is the only way
  // from the living-room opening to the hall, so the table now stands clear of it and says how many chairs fit.
  const c = ctx({ gaze: { point: [7, 1.5], room: 'kitchen' }, player: { pos: [7, 2.7], yaw: 0, room: 'kitchen' } })
  const r = run(createHome(P, { furnish: true }), [{ op: 'place', kind: 'round_table' }, { op: 'place', kind: 'dining_chair', count: 4, arrange: 'around', at: { where: 'near', of: { kind: 'round_table', room: 'kitchen' } } }], c)
  const chairs = byKind(r.state, 'dining_chair').length
  assert.ok(chairs >= 1, `${chairs} chairs`)
  assert.match(r.effects.notes.join(' '), new RegExp(`only room for ${chairs} of 4`))
  assert.ok(throughClear(r.state, 'kitchen') >= 0.8, 'the way through the kitchen stays open')
})

test('a mirror "over the console" in a hall with no console still hangs on the hall wall, with a note; a nightstand with no bed does not', () => {
  const c = ctx({ gaze: { point: [7, 5], room: 'hall' }, player: { pos: [7, 5.5], yaw: 0, room: 'hall' } })
  const home = createHome(P, { furnish: true })
  const r = run(home, [{ op: 'place', kind: 'mirror', at: { where: 'near', of: { kind: 'console_table', room: 'hall' }, side: 'on' } }], c)
  const mirror = byKind(r.state, 'mirror').find(m => m.room === 'hall')
  assert.ok(mirror, 'a mirror in the hall')
  assert.ok(r.effects.notes.some(n => /no console table in the hall, so the mirror went on the wall/.test(n)), `${r.effects.notes}`)
  const bare = run(createHome(P), [{ op: 'place', kind: 'nightstand', at: { room: 'primary', where: 'near', of: { kind: 'bed' }, side: 'beside' } }], c)
  assert.equal(byKind(bare.state, 'nightstand').length, 0)
})

test('a table asked for the middle of the kitchen lands the same whether or not you stand there, and never on the walk-through', () => {
  // Updated: this pinned the table to the exact middle; that spot blocks the way from the living room to the
  // hall, so it slides off it. What it still guards: the viewer standing in the middle doesn't push it about.
  const at = (player: Vec2) => {
    const c = ctx({ gaze: { point: [7, 0.8], room: 'kitchen' }, player: { pos: player, yaw: 0, room: 'kitchen' } })
    return run(createHome(P, { furnish: true }), [
      { op: 'place', kind: 'round_table', at: { room: 'kitchen', where: 'center' } },
      { op: 'place', kind: 'dining_chair', count: 4, arrange: 'around', at: { room: 'kitchen', where: 'near', of: { kind: 'round_table', room: 'kitchen' } } }
    ], c)
  }
  const standing = at([7, 1.5])
  assert.deepEqual(byKind(standing.state, 'round_table')[0]!.pos, byKind(at([6.2, 2.6]).state, 'round_table')[0]!.pos)
  assert.ok(byKind(standing.state, 'dining_chair').length >= 1)
  assert.ok(throughClear(standing.state, 'kitchen') >= 0.8)
})

test('a lamp "on the nightstand" skips the one that already has a lamp; a pair of lamps "on" the nightstands sits on top, never on the floor', () => {
  const c = ctx({ gaze: { point: [4, 5.5], itemId: 'bed#2', room: 'primary' }, player: { pos: [4, 6], yaw: Math.PI, room: 'primary' } })
  const home = createHome(P, { furnish: true })
  const before = byKind(home, 'table_lamp').filter(l => l.room === 'primary').length
  const one = run(home, [{ op: 'place', kind: 'table_lamp', at: { where: 'near', of: { kind: 'nightstand', room: 'primary' }, side: 'on' } }], c)
  assert.equal(byKind(one.state, 'table_lamp').filter(l => l.room === 'primary').length, before + 1, `${one.effects.notes}`)
  const two = run(createHome(P), [
    { op: 'place', kind: 'bed', at: { room: 'primary', where: 'wall', wall: 'north' } },
    { op: 'place', kind: 'nightstand', count: 2, arrange: 'pair', at: { where: 'near', of: { kind: 'bed', room: 'primary' }, side: 'beside' } },
    { op: 'place', kind: 'table_lamp', count: 2, arrange: 'pair', at: { where: 'near', of: { kind: 'nightstand', room: 'primary' }, side: 'on' } }
  ], c)
  const stands = byKind(two.state, 'nightstand')
  const lamps = byKind(two.state, 'table_lamp')
  assert.equal(lamps.length, 2)
  for (const l of lamps) {
    assert.ok((l.y ?? 0) > 0.3, `lamp ${l.id} is up on something, y ${l.y}`)
    assert.ok(stands.some(n => Math.hypot(n.pos[0] - l.pos[0], n.pos[1] - l.pos[1]) < 0.15), `lamp ${l.id} sits on a nightstand`)
  }
})

test('"move the bed to the other wall" (south, facing the room) lands square on the south wall, even said from the hall', () => {
  const home = createHome(P, { furnish: true })
  for (const player of [{ pos: [4, 6] as Vec2, yaw: 0, room: 'primary' }, { pos: [7, 6] as Vec2, yaw: 0, room: 'hall' }]) {
    const r = run(home, [{ op: 'move', target: { kind: 'bed', room: 'primary' }, at: { where: 'wall', wall: 'south', facing: 'room' } }], ctx({ player, gaze: { point: [4, 5.5], room: 'primary' } }))
    const bed = byKind(r.state, 'bed').find(b => b.room === 'primary')!
    assert.deepEqual(r.effects.notes, [], `from ${player.room}`)
    assert.ok(bed.pos[1] > 6, `on the south half, ${bed.pos}`)
    assert.ok(Math.abs(Math.abs(bed.yaw) - Math.PI) < 0.01, `square to the wall, yaw ${bed.yaw}`)
    assert.ok(backGap(bed) < 0.05 && inside(bed, 'primary'))
  }
})

test('"a big mirror over the console" in the hall: no console and no wall for 1.5×, so the usual size on the wall, with notes that say both', () => {
  const c = ctx({ gaze: { point: [6.5, 6.2], room: 'hall' }, player: { pos: [7.2, 6.2], yaw: Math.PI / 2, room: 'hall' } })
  const r = run(createHome(P, { furnish: true }), [{ op: 'place', kind: 'mirror', at: { room: 'hall', where: 'near', of: { kind: 'console_table', room: 'hall' }, side: 'on' }, set: { scale: 1.5 } }], c)
  const mirror = byKind(r.state, 'mirror').find(m => m.room === 'hall')
  assert.ok(mirror, `${r.effects.notes}`)
  assert.equal(mirror.props.scale, undefined)
  assert.match(r.effects.notes.join(' '), /usual size.*no console table in the hall/)
})

// ---------- circulation and livability ----------

test('corridors: a strip inside each opening, a lane between each pair, and door-to-middle in a one-door room', () => {
  const living = corridors(P, room('living'))
  assert.deepEqual(living.map(c => c.kind), ['entry', 'entry', 'through'])
  assert.match(living[2]!.why, /the way from the kitchen to the hall/)
  const strip = living.find(c => /hall/.test(c.why) && c.kind === 'entry')!.routes[0]!.rects[0]!
  assert.ok(Math.abs(rectArea(strip) - 0.9 * 1.1) < 1e-6, '0.9 × 1.1 m')
  assert.deepEqual(corridors(P, room('bedroom_2')).map(c => c.kind), ['entry', 'reach'])
  // Two doors facing across a 3 m bedroom: the straight lane plus ways round, so a bed can fill the middle.
  assert.ok(corridors(P, room('primary')).find(c => c.kind === 'through')!.routes.length > 1)
})

test('the furnished living room never gets a floor piece in the hall-opening strip', () => {
  const s = createHome(P, { furnish: true })
  const strip = corridors(P, room('living')).find(c => c.kind === 'entry' && /hall/.test(c.why))!.routes[0]!.rects[0]!
  for (const i of floorItems(s, 'living')) {
    const fp = itemFootprint(i)
    assert.ok(overlapArea(itemCorners(i), strip) <= 0.1 * fp.length * fp.width + 1e-6, `${i.id} stands in the hall opening (${i.pos})`)
  }
  // Before circulation the bookshelf packed into the south-east corner, right in that strip.
  const shelf = byKind(s, 'bookshelf').find(b => b.room === 'living')!
  assert.ok(overlapArea(itemCorners(shelf), strip) === 0, `bookshelf at ${shelf.pos}`)
})

test('furnish puts the living-room sofa off the door path, back to a blank wall, facing the room and the window', () => {
  const s = createHome(P, { furnish: true })
  const sofa = byKind(s, 'sofa')[0]!
  assert.ok(backGap(sofa) < 0.05)
  const toCenter: Vec2 = [2.75 - sofa.pos[0], 2.25 - sofa.pos[1]]
  assert.ok(dotDir(frontOf(sofa.yaw), toCenter) > 0.9, 'faces into the room')
  assert.ok(dotDir(frontOf(sofa.yaw), [0, -1]) > 0.99, 'toward the north window')
  for (const cor of corridors(P, room('living'))) {
    for (const r of cor.routes[0]!.rects) assert.equal(overlapArea(itemCorners(sofa), r), 0, `off ${cor.why}`)
  }
  const legroom = clearanceAround(sofa)!.zones[0]!
  for (const i of floorItems(s, 'living').filter(x => x.id !== sofa.id && x.kind !== 'coffee_table')) {
    assert.ok(overlapArea(itemCorners(i), legroom) < 0.01, `${i.id} in the sofa's legroom`)
  }
})

test('a plant asked for "the corner by the door" goes in another corner, with a note that says why', () => {
  const c = ctx({ gaze: { point: [9.75, 2], room: 'bedroom_2' }, player: { pos: [50, 50], yaw: 0 } })
  // Facing the west wall of bedroom 2, the left-hand corner is the south-west one, right at the door from the hall.
  const r = run(createHome(P), [{ op: 'place', kind: 'plant', at: { room: 'bedroom_2', where: 'corner', wall: 'west', side: 'left' } }], c)
  const plant = byKind(r.state, 'plant')[0]!
  assert.ok(plant && inside(plant, 'bedroom_2'))
  assert.ok(Math.hypot(plant.pos[0] - 8.5, plant.pos[1] - 4.2) > 1.5, `not by the door (${plant.pos})`)
  assert.ok(r.effects.notes.some(n => /in another corner instead.*would block the door to the hall/.test(n)), `${r.effects.notes}`)
})

test('a plant asked for in front of the sofa is refused: that is the sofa\'s legroom', () => {
  const r = run(createHome(P), [
    { op: 'place', kind: 'sofa', at: { room: 'living' } },
    { op: 'place', kind: 'coffee_table', at: { room: 'living', where: 'near', of: { kind: 'sofa' }, side: 'front', dist: 0.5 } },
    { op: 'place', kind: 'plant', at: { room: 'living', where: 'near', of: { kind: 'sofa' }, side: 'front', dist: 0.05 } }
  ])
  const sofa = byKind(r.state, 'sofa')[0]!
  const legroom = clearanceAround(sofa)!.zones[0]!
  assert.equal(byKind(r.state, 'coffee_table').length, 1, 'the coffee table belongs there')
  for (const p of byKind(r.state, 'plant')) assert.ok(overlapArea(itemCorners(p), legroom) < 0.025, `plant in the legroom (${p.pos})`)
})

test('a bed\'s only open side stays clear after a dresser is added', () => {
  const c = ctx({ gaze: { point: [9.75, 2], room: 'bedroom_2' }, player: { pos: [50, 50], yaw: 0 } })
  // On the north wall of the 2.5 m wide bedroom the bed can keep one long side open: the west, toward the door.
  const r = run(createHome(P), [
    { op: 'place', kind: 'bed', at: { room: 'bedroom_2', where: 'wall', wall: 'north' } },
    { op: 'place', kind: 'dresser', at: { room: 'bedroom_2', where: 'wall', wall: 'west' } }
  ], c)
  const bed = byKind(r.state, 'bed')[0]!
  const dresser = byKind(r.state, 'dresser')[0]!
  assert.ok(dresser, `${r.effects.notes}`)
  const open = clearanceAround(bed)!.zones.filter(z => overlapArea(room('bedroom_2').polygon, z) > 0.85 * rectArea(z))
  assert.equal(open.length, 1, 'one long side inside the room')
  for (const i of floorItems(r.state, 'bedroom_2').filter(x => x.id !== bed.id)) assert.ok(overlapArea(itemCorners(i), open[0]!) < 0.05, `${i.id} on the open side (${i.pos})`)
  // Packed from the corner it used to stand right along that side; now it says where it went instead.
  assert.ok(r.effects.notes.some(n => /dresser .* instead .*open side of the bed/.test(n)), `${r.effects.notes}`)
})

test('two sofas asked for in a small room (the 3 × 3 m kitchen) yield one, with a note', () => {
  const c = ctx({ gaze: { point: [7, 1.5], room: 'kitchen' }, player: { pos: [50, 50], yaw: 0 } })
  const r = run(createHome(P), [{ op: 'place', kind: 'sofa', count: 2, at: { room: 'kitchen' } }], c)
  assert.equal(byKind(r.state, 'sofa').length, 1)
  assert.match(r.effects.notes.join(' '), /only room for 1 of 2 sofas/)
  assert.ok(throughClear(r.state, 'kitchen') >= 0.8)
})

test('one sentence gets one main seat per room unless it asks for a count', () => {
  const r = run(createHome(P), [{ op: 'place', kind: 'sofa', at: { room: 'living' } }, { op: 'place', kind: 'loveseat', at: { room: 'living' } }])
  assert.equal(r.state.items.filter(i => ['sofa', 'loveseat', 'sectional'].includes(i.kind)).length, 1)
  assert.ok(r.effects.notes.some(n => /one main seat per room/.test(n)), `${r.effects.notes}`)
  // A later sentence can still add one: the rule is about duplicates within a sentence.
  const later = run(r.state, [{ op: 'place', kind: 'loveseat', at: { room: 'living' } }])
  assert.equal(byKind(later.state, 'loveseat').length, 1, `${later.effects.notes}`)
})

test('furnishing every sample leaves every door-to-door corridor at least 80 % clear, deterministically', () => {
  for (const plan of SAMPLES) {
    const s = createHome(plan, { furnish: true })
    for (const r of plan.rooms) {
      for (const cor of corridors(plan, r).filter(c => c.kind !== 'entry')) {
        // A one-door room's way in may end at its bed or table (that is where it leads); door-to-door lanes count everything.
        const items = floorItems(s, r.id).filter(i => cor.kind === 'through' || !(i.tags.includes('bed') || ['dining_table', 'round_table', 'island', 'car'].includes(i.kind)))
        const share = clearShare(cor, items)
        assert.ok(share >= 0.8, `${plan.name} / ${r.name}: ${cor.why} only ${(share * 100).toFixed(0)} % clear`)
      }
    }
    assert.deepEqual(createHome(plan, { furnish: true }).items, s.items, 'same plan, same furniture')
  }
})
