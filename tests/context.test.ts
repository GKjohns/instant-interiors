/**
 * The model's view: trimScene over a hand-built HomeState on the sample plan, the context block, direction
 * words, and the lenient scene round trip. No kernel import (sprint A), so items are built by hand.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildContext, compass, relativeDir, roomAtPoint, sceneOf, trimScene, wallOf } from '../shared/home/context.ts'
import { TWO_BED_APARTMENT } from '../shared/plan/samples.ts'
import type { HomeState, Item, OpContext } from '../shared/home/types.ts'

const ctx = (over: Partial<OpContext> = {}): OpContext => ({ gaze: { point: [2.75, 1], room: 'living' }, player: { pos: [2.75, 3.5], yaw: 0, room: 'living' }, seed: 1, ...over })

let n = 1
const item = (kind: string, room: string, pos: [number, number], group: string, extra: Partial<Item> = {}): Item =>
  ({ id: `${kind}#${n++}`, kind, room, pos, yaw: 0, props: {}, group, tags: [], ...extra })

function home(): HomeState {
  n = 1
  const items = [
    item('sofa', 'living', [2.75, 0.55], 'g1', { yaw: Math.PI, props: { color: 'navy', material: 'velvet' }, tags: ['seating'] }),
    item('rug', 'living', [2.75, 2.2], 'g1', { tags: ['textile'] }),
    item('armchair', 'living', [4.6, 2.1], 'g1', { yaw: 1.3, tags: ['seating'] }),
    item('armchair', 'living', [0.9, 2.1], 'g1', { yaw: -1.3, tags: ['seating'] }),
    item('floor_lamp', 'living', [0.3, 0.3], 'g2', { props: { lit: 0 }, tags: ['light'] }),
    item('bed', 'primary', [4, 5.6], 'g3', { tags: ['bed'] }),
    ...Array.from({ length: 15 }, (_, i) => item('books', 'primary', [2.5 + i * 0.1, 7], 'g4', { tags: ['decor'] }))
  ]
  return {
    plan: TWO_BED_APARTMENT,
    items,
    light: { time: 'evening', lamps: true, warmth: 0.75 },
    log: [{ id: 'g4', label: 'a pile of books', ops: [], ctx: ctx(), at: 0 }],
    nextId: n,
    nextGroup: 5,
    lastGroup: 'g4'
  }
}

test('trimScene: rooms carry size, centre, window walls and where doors lead', () => {
  const scene = trimScene(home())
  assert.equal(scene.rooms.length, 8)
  const living = scene.rooms.find(r => r.id === 'living')!
  assert.deepEqual(living.size, [5.5, 4.5])
  assert.deepEqual(living.center, [2.8, 2.3])
  assert.deepEqual(living.windows, ['north', 'west'])
  assert.deepEqual(living.doors.map(d => `${d.to}/${d.wall}/${d.kind}`).sort(), ['hall/east/opening', 'kitchen/east/opening'])
  const hall = scene.rooms.find(r => r.id === 'hall')!
  assert.ok(hall.doors.some(d => d.to === 'outside' && d.wall === 'south' && d.kind === 'door'))
  const primary = scene.rooms.find(r => r.id === 'primary')!
  assert.deepEqual(primary.windows, ['south'])
  assert.ok(primary.doors.some(d => d.to === 'bathroom' && d.wall === 'west'))
})

test('trimScene: items are rounded, yaw in degrees, only set props kept; last batch label rides along', () => {
  const scene = trimScene(home())
  const sofa = scene.items.find(i => i.kind === 'sofa')!
  assert.deepEqual(sofa.pos, [2.8, 0.6])
  assert.equal(sofa.yaw, 180)
  assert.deepEqual(sofa.props, { color: 'navy', material: 'velvet' })
  assert.equal(scene.lastGroup, 'g4')
  assert.equal(scene.lastLabel, 'a pile of books')
  assert.deepEqual(scene.light, { time: 'evening', lamps: true, warmth: 0.75 })
  // The scene survives JSON (it is posted to /api/intent).
  assert.deepEqual(JSON.parse(JSON.stringify(scene)), scene)
})

test('wallOf names the compass wall of an opening for each room', () => {
  const bath = TWO_BED_APARTMENT.rooms.find(r => r.id === 'bathroom')!
  const primary = TWO_BED_APARTMENT.rooms.find(r => r.id === 'primary')!
  assert.equal(wallOf(bath, [2, 6]), 'east')
  assert.equal(wallOf(primary, [2, 6]), 'west')
  assert.equal(wallOf(primary, [4, 7.5]), 'south')
})

test('compass and relative directions follow yaw 0 = north, positive turns west', () => {
  assert.equal(compass(0), 'N')
  assert.equal(compass(Math.PI / 2), 'W')
  assert.equal(compass(-Math.PI / 2), 'E')
  assert.equal(compass(Math.PI), 'S')
  const c = ctx({ player: { pos: [0, 0], yaw: 0 } })
  assert.equal(relativeDir(c, [0, -5]), 'ahead')
  assert.equal(relativeDir(c, [-3, -3]), 'ahead-left')
  assert.equal(relativeDir(c, [4, 0]), 'right')
  assert.equal(relativeDir(c, [0, 4]), 'behind')
  assert.equal(relativeDir(ctx({ player: { pos: [0, 0], yaw: Math.PI / 2 } }), [-5, 0]), 'ahead')
  assert.equal(relativeDir(c, [0.1, 0.1]), 'here')
})

test('the context block: player room, gaze on an item, rooms with windows and doors, items by room, light', () => {
  const s = home()
  const sofa = s.items[0]!
  const block = buildContext(trimScene(s), ctx({ gaze: { point: sofa.pos, itemId: sofa.id, room: 'living' } }))
  const lines = block.split('\n')
  assert.equal(lines[0], 'player: in living (Living room), facing N')
  assert.match(lines[1]!, /^gaze: sofa#1 \(sofa, navy, velvet\) in living, 2\.9 m ahead$/)
  assert.match(block, /^last: g4 "a pile of books" → books ×15$/m)
  assert.match(block, /^- living: Living room 5\.5×4\.5 m, windows north\+west, doors → hall, kitchen$/m)
  assert.match(block, /^- hall: Hall 3×4\.5 m, doors → outside, living, kitchen, bedroom_2, primary, closet, balcony$/m)
  assert.match(block, /^- living: sofa \(navy, velvet\) · rug · armchair ×2 · floor_lamp \(off\)$/m)
  assert.match(block, /^- primary: bed · books ×15$/m)
  assert.match(block, /^- kitchen: empty$/m)
  assert.match(block, /^light: evening · lamps on · warmth 0\.8$/m)
  // Compact: no item ids outside the gaze line, well under the line budget.
  assert.equal(block.match(/#\d/g)?.length, 1)
  assert.ok(lines.length <= 25, `${lines.length} lines`)
  assert.ok(block.length < 1400, `${block.length} chars`)
})

test('the context block: gaze on the floor names the room; rooms fall back to bounding boxes', () => {
  const s = home()
  const scene = trimScene(s)
  const block = buildContext(scene, { gaze: { point: [7, 2] }, player: { pos: [7, 6], yaw: Math.PI / 2 }, seed: 1 })
  assert.match(block, /^player: in hall \(Hall\), facing W$/m)
  assert.match(block, /^gaze: floor of kitchen, 4 m right$/m)
  assert.equal(roomAtPoint(scene, [9.5, 6.5])?.id, 'balcony')
  assert.equal(roomAtPoint(scene, [40, 40]), undefined)
  const outside = buildContext(scene, { gaze: { point: [40, 40] }, player: { pos: [41, 41], yaw: 0 }, seed: 1 })
  assert.match(outside, /^player: outside any room/m)
  assert.match(outside, /^gaze: floor, outside any room/m)
})

test('per-room item lists truncate with "…and N more"', () => {
  const s = home()
  const kinds = ['vase', 'clock', 'picture', 'mirror', 'shelf', 'plant', 'tree', 'candles', 'side_table', 'ottoman', 'bench', 'stool', 'box', 'books']
  for (const k of kinds) s.items.push(item(k, 'hall', [7, 5], 'g9'))
  const block = buildContext(trimScene(s), ctx())
  const hall = block.split('\n').find(l => l.startsWith('- hall: vase'))!
  assert.match(hall, /…and 2 more$/)
  assert.equal(hall.split(' · ').length, 13)
})

test('a partial or empty posted scene still builds a block', () => {
  const block = buildContext(undefined, { gaze: { point: [0, 0] }, player: { pos: [0, 0], yaw: 0 }, seed: 1 })
  assert.match(block, /^player: outside any room, facing N$/m)
  assert.match(block, /^rooms: none$/m)
  assert.match(block, /^items: none/m)
  assert.match(block, /^light: afternoon · lamps off · warmth 0\.5$/m)
  const partial = sceneOf({ rooms: [{ id: 'den', name: 'Den', type: 'living', size: [4, 4], center: [2, 2], windows: [], doors: [] }] })
  assert.equal(partial.items.length, 0)
  assert.equal(partial.rooms[0]!.id, 'den')
})
