/**
 * The kernel: batches, furnish, undo, replay / export / import, surfaces, light, goto, reset, say honesty.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pointInPolygon } from '../shared/plan/poly.ts'
import { TWO_BED_APARTMENT as P, TWO_BED_APARTMENT, SAMPLES } from '../shared/plan/samples.ts'
import { windowsOf } from '../shared/plan/geometry.ts'
import { KIT } from '../shared/home/kinds.ts'
import { itemLayer, overlapArea } from '../shared/home/layout.ts'
import { parseOps } from '../shared/home/ops.ts'
import { itemCorners, itemFootprint } from '../shared/home/select.ts'
import { applyBatch, applyOp, createHome, defaultContext, diffItems, exportHome, extendLastBatch, honestSay, importHome, replayLog, undo } from '../shared/home/state.ts'
import type { HomeState, Item, OpContext } from '../shared/home/types.ts'

const room = (id: string) => P.rooms.find(r => r.id === id)!

function ctx(over: Partial<OpContext> = {}): OpContext {
  return { gaze: { point: [2.75, 2.25], room: 'living' }, player: { pos: [2.75, 3.2], yaw: 0, room: 'living' }, seed: 42, ...over }
}

function run(state: HomeState, ops: unknown, c = ctx(), label = 'test') {
  return applyBatch(state, ops, label, c)
}

const byKind = (s: HomeState, kind: string) => s.items.filter(i => i.kind === kind)

/** Floor-standing pieces only: rugs go under, hung and ceiling pieces are above, things on stands share their anchor. */
function floorPieces(items: Item[]): Item[] {
  return items.filter(i => itemLayer(i) === 'floor')
}

function worstOverlap(items: Item[]): { ratio: number, pair: string } {
  let worst = { ratio: 0, pair: '' }
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!
      const b = items[j]!
      const fa = itemFootprint(a)
      const fb = itemFootprint(b)
      const ratio = overlapArea(itemCorners(a), itemCorners(b)) / Math.min(fa.length * fa.width, fb.length * fb.width)
      if (ratio > worst.ratio) worst = { ratio, pair: `${a.id} × ${b.id}` }
    }
  }
  return worst
}

test('parseOps drops a bad op and keeps the rest', () => {
  const { ops, dropped } = parseOps({ ops: [
    { op: 'place', kind: 'Sofa' },
    { op: 'place' },
    { op: 'explode', kind: 'sofa' },
    { op: 'restyle', target: { kind: 'sofa' }, set: {} },
    { op: 'light', time: 'noon' },
    { op: 'say', text: 'Done.' }
  ] })
  assert.deepEqual(ops.map(o => o.op), ['place', 'light', 'say'])
  assert.deepEqual(dropped.map(d => d.index), [1, 2, 3])
  const res = run(createHome(P), [{ op: 'place', kind: 'sofa', at: { room: 'living' } }, { op: 'place' }, { op: 'say', text: 'A sofa.' }])
  assert.equal(res.dropped.length, 1)
  assert.deepEqual(res.state.items.map(i => i.id), ['sofa#1'])
  assert.deepEqual(res.effects.say, ['A sofa.'])
})

test('createHome with furnish gives every sample room at least 3 pieces, all inside, none overlapping', () => {
  for (const plan of SAMPLES) {
    const home = createHome(plan, { furnish: true })
    assert.equal(home.log.length, 1)
    assert.equal(home.log[0]!.label, 'furnished')
    assert.equal(home.log[0]!.id, 'g1')
    for (const r of plan.rooms) {
      const items = home.items.filter(i => i.room === r.id)
      assert.ok(items.length >= 3, `${plan.id}/${r.id} has ${items.length} pieces`)
      for (const i of items) assert.ok(itemCorners(i).every(c => pointInPolygon(c, r.polygon, 0.03)), `${i.id} inside ${r.id}`)
      const worst = worstOverlap(floorPieces(items))
      assert.ok(worst.ratio <= 0.05, `${r.id}: ${worst.pair} overlap ${(worst.ratio * 100).toFixed(1)}%`)
    }
    for (const i of home.items) {
      assert.deepEqual(i.tags, KIT[i.kind]!.tags)
      assert.equal(i.group, 'g1')
    }
    assert.ok(home.items.some(i => i.kind === 'tv' && i.y === 0.5), 'the TV stands on its stand')
    assert.ok(home.items.some(i => i.kind === 'table_lamp' && i.y === 0.6), 'a lamp on a nightstand')
    assert.ok(home.items.filter(i => i.kind === 'nightstand' && i.room === 'primary').length === 2)
  }
})

test('ids count per kind, unknown kinds are a note, and only changed batches are logged', () => {
  let res = run(createHome(P), [{ op: 'place', kind: 'armchair', count: 2, at: { room: 'living' } }, { op: 'place', kind: 'hot_tub', at: { room: 'living' } }])
  assert.deepEqual(res.state.items.map(i => i.id), ['armchair#1', 'armchair#2'])
  assert.match(res.effects.notes[0]!, /don't have a hot tub yet/)
  assert.equal(res.state.log.length, 1)
  res = run(res.state, [{ op: 'place', kind: 'hot_tub' }])
  assert.equal(res.state.log.length, 1, 'a batch that did nothing is not logged')
  assert.equal(res.batch, undefined)
  res = run(res.state, [{ op: 'place', kind: 'armchair', at: { room: 'living' } }])
  assert.equal(res.state.items[2]!.id, 'armchair#3')
  assert.deepEqual(res.effects.placed, ['armchair#3'])
})

test('undo pops the last batch and restores the previous state exactly', () => {
  const home = createHome(P, { furnish: true })
  const placed = run(home, [{ op: 'place', kind: 'ottoman', at: { room: 'living', where: 'center' } }]).state
  assert.equal(byKind(placed, 'ottoman').length, 1)
  const back = run(placed, [{ op: 'undo' }])
  assert.deepEqual(back.state.items, home.items)
  assert.deepEqual(back.state.plan, home.plan)
  assert.equal(back.state.log.length, 1, 'the undo itself is not logged')
  assert.deepEqual(back.effects.removed, ['ottoman#1'])
  assert.match(back.effects.notes[0]!, /undid g2/)
  const again = undo(back.state)
  assert.equal(again.state.items.length, 0, 'undoing the furnishing empties the home')
  assert.equal(undo(again.state).effects.notes[0], 'nothing to undo')
  // A surface change undoes back to the original finish.
  const painted = run(home, [{ op: 'surface', room: 'living', part: 'walls', set: { color: '#334455' } }]).state
  assert.equal(painted.plan.rooms[0]!.walls.color, '#334455')
  assert.equal(run(painted, [{ op: 'undo' }]).state.plan.rooms[0]!.walls.color, room('living').walls.color)
})

test('replaying the export rebuilds the identical home', () => {
  let s = createHome(P, { furnish: true })
  s = run(s, [{ op: 'place', kind: 'armchair', count: 3, at: { room: 'living', where: 'center' } }], ctx({ seed: 9 }), 'three chairs').state
  s = run(s, [{ op: 'restyle', target: { kind: 'sofa' }, set: { color: 'teal', scale: 1.2 } }], ctx({ seed: 10 })).state
  s = run(s, [{ op: 'surface', room: 'primary', part: 'floor', set: { pattern: 'herringbone' } }, { op: 'light', time: 'night' }], ctx({ seed: 11 })).state
  s = run(s, [{ op: 'move', target: { kind: 'armchair', limit: 1 }, at: { room: 'living', where: 'window' } }], ctx({ seed: 12 })).state
  const saved = JSON.parse(JSON.stringify(exportHome(s)))
  assert.equal(saved.v, 1)
  assert.deepEqual(saved.plan, P, 'the plan as loaded, not the recoloured one')
  const loaded = importHome(saved)!
  assert.ok(loaded)
  assert.deepEqual(loaded.items, s.items)
  assert.deepEqual(loaded.plan, s.plan)
  assert.deepEqual(loaded.light, s.light)
  assert.deepEqual(loaded.log.map(b => [b.id, b.label, b.ops.length]), s.log.map(b => [b.id, b.label, b.ops.length]))
  assert.deepEqual(replayLog(P, s.log).items, s.items)
  assert.equal(importHome({ nope: true }), null)
  assert.equal(importHome('junk'), null)
})

test('surface "all" recolours every room, in a copied plan', () => {
  const home = createHome(P)
  const res = run(home, [{ op: 'surface', room: 'all', part: 'walls', set: { color: '#9ab', pattern: 'floral', accent: '#fff' } }])
  assert.equal(res.effects.surfaces.length, P.rooms.length)
  assert.ok(res.effects.surfaces.every(s => s.endsWith(':walls')))
  for (const r of res.state.plan.rooms) assert.deepEqual(r.walls, { color: '#9ab', pattern: 'floral', accent: '#fff' })
  assert.notEqual(res.state.plan, home.plan)
  assert.equal(home.plan.rooms[0]!.walls.color, room('living').walls.color, 'the input plan is untouched')
  assert.equal(res.state.base, P)
  const one = run(res.state, [{ op: 'surface', room: 'kitchen', part: 'floor', set: { color: 'black' } }])
  assert.deepEqual(one.effects.surfaces, ['kitchen:floor'])
  assert.equal(one.state.plan.rooms.find(r => r.id === 'kitchen')!.floor.pattern, 'tile', 'merge keeps the pattern')
  const bad = run(res.state, [{ op: 'surface', room: 'attic', part: 'floor', set: { color: 'black' } }])
  assert.match(bad.effects.notes[0]!, /attic/)
})

test('light: night turns the lamps on unless told otherwise; merges fields', () => {
  const home = createHome(P)
  const night = run(home, [{ op: 'light', time: 'night' }])
  assert.deepEqual(night.state.light, { time: 'night', lamps: true, warmth: 0.5 })
  assert.equal(night.effects.light, true)
  const dark = run(home, [{ op: 'light', time: 'night', lamps: false }])
  assert.equal(dark.state.light.lamps, false)
  const warm = run(night.state, [{ op: 'light', warmth: 1 }])
  assert.deepEqual(warm.state.light, { time: 'night', lamps: true, warmth: 1 })
  assert.equal(run(warm.state, [{ op: 'light', warmth: 1 }]).batch, undefined, 'no change, no batch')
})

test('goto a room lands in it facing its window; goto a thing stands in front of it', () => {
  const home = createHome(P, { furnish: true })
  const toRoom = run(home, [{ op: 'goto', room: 'primary' }])
  const g = toRoom.effects.goto!
  assert.ok(g && pointInPolygon(g.pos, room('primary').polygon))
  assert.equal(g.room, 'primary')
  // The primary's window is on the south wall: forward (-sin, -cos) should point +z.
  assert.ok(-Math.cos(g.yaw) > 0.9, 'facing the window')
  assert.equal(toRoom.state.log.length, 1, 'goto alone is not logged')
  const sofa = byKind(home, 'sofa')[0]!
  const toSofa = run(home, [{ op: 'goto', target: { kind: 'sofa' } }]).effects.goto!
  assert.ok(pointInPolygon(toSofa.pos, room('living').polygon))
  const d = Math.hypot(toSofa.pos[0] - sofa.pos[0], toSofa.pos[1] - sofa.pos[1])
  assert.ok(d > 1.4 && d < 1.9, `1.2 m in front of the sofa's face (${d.toFixed(2)})`)
  const fwd = [-Math.sin(toSofa.yaw), -Math.cos(toSofa.yaw)]
  const to = [(sofa.pos[0] - toSofa.pos[0]) / d, (sofa.pos[1] - toSofa.pos[1]) / d]
  assert.ok(fwd[0]! * to[0]! + fwd[1]! * to[1]! > 0.99, 'looking at it')
  const hall = run(home, [{ op: 'goto', room: 'hall' }]).effects.goto!
  assert.ok(pointInPolygon(hall.pos, room('hall').polygon), 'the L-shaped hall still gets an inside pose')
  assert.match(run(home, [{ op: 'goto', target: { kind: 'piano' } }]).effects.notes[0]!, /nothing matches piano/)
})

test('move re-resolves the spot and keeps the facing rules; remove and restyle', () => {
  let s = createHome(P, { furnish: true })
  const before = byKind(s, 'sofa')[0]!
  const moved = run(s, [{ op: 'move', target: { kind: 'sofa' }, at: { room: 'living', where: 'window' } }])
  const sofa = byKind(moved.state, 'sofa')[0]!
  // The rug, coffee table and armchair were placed by the sofa, so they come along; the TV stand across the room does not.
  assert.deepEqual(moved.effects.moved, [before.id, 'rug#1', 'coffee_table#1', 'armchair#1'])
  // The TV stand already sits under the north window, so the west window is the one that is free.
  assert.ok(sofa.pos[0] < 0.6 && Math.abs(sofa.pos[1] - 2.25) < 0.3, `under the west window (${sofa.pos})`)
  assert.ok(Math.abs(sofa.yaw - Math.PI / 2) < 0.01, 'back to the window wall, front into the room')
  assert.equal(sofa.id, before.id)
  s = moved.state
  const styled = run(s, [{ op: 'restyle', target: { kind: 'sofa' }, set: { scale: 2 }, relative: true }, { op: 'restyle', target: { kind: 'sofa' }, set: { scale: 1.5, color: 'red' }, relative: true }])
  assert.deepEqual(byKind(styled.state, 'sofa')[0]!.props, { scale: 3, color: 'red' })
  assert.deepEqual(styled.effects.modified, [before.id])
  const gone = run(styled.state, [{ op: 'remove', target: { tag: 'seating', room: 'living' } }])
  assert.equal(gone.state.items.filter(i => i.room === 'living' && i.tags.includes('seating')).length, 0)
  assert.ok(gone.effects.removed.includes(before.id))
  assert.match(run(gone.state, [{ op: 'remove', target: { kind: 'sofa', room: 'living' } }]).effects.notes[0]!, /nothing matches/)
})

test('furnish a room with a style recolours its soft things and finishes; bare furnish uses defaults', () => {
  const home = createHome(P)
  const res = run(home, [{ op: 'furnish', room: 'living', style: 'mid-century modern' }])
  const living = res.state.items.filter(i => i.room === 'living')
  assert.ok(living.length >= 5)
  assert.ok(res.state.items.every(i => i.room === 'living'), 'only the named room')
  assert.equal(living.find(i => i.kind === 'sofa')!.props.color, '#c9742b')
  assert.equal(res.state.plan.rooms[0]!.floor.color, '#9a6a44')
  assert.ok(res.effects.surfaces.includes('living:walls') && res.effects.surfaces.includes('living:floor'))
  const again = run(res.state, [{ op: 'furnish', room: 'living' }])
  assert.equal(again.state.items.filter(i => i.room === 'living' && i.props.color).length, 0, 'refurnishing replaces the room')
  assert.match(run(home, [{ op: 'furnish', room: 'here', style: 'brutalist' }]).effects.notes[0]!, /no "brutalist" palette/)
})

test('reset goes back to the furnished plan with a fresh log and is never logged', () => {
  let s = createHome(P, { furnish: true })
  s = run(s, [{ op: 'place', kind: 'ottoman', at: { room: 'living', where: 'center' } }]).state
  s = run(s, [{ op: 'surface', room: 'all', part: 'walls', set: { color: 'pink' } }]).state
  const res = run(s, [{ op: 'reset' }, { op: 'say', text: 'Fresh start.' }])
  const fresh = createHome(P, { furnish: true })
  assert.equal(res.effects.reset, true)
  assert.deepEqual(res.state.items, fresh.items)
  assert.deepEqual(res.state.plan, P)
  assert.equal(res.state.log.length, 1)
  assert.equal(res.state.log[0]!.label, 'furnished')
  assert.deepEqual(res.effects.say, ['Fresh start.'])
  assert.ok(res.effects.removed.includes('ottoman#1'))
  // Reset then build in one sentence: only what follows stands, as the second batch.
  const built = run(s, [{ op: 'reset' }, { op: 'place', kind: 'ottoman', at: { room: 'living', where: 'center' } }], ctx(), 'start over with a piano')
  assert.equal(built.state.log.length, 2)
  assert.equal(byKind(built.state, 'ottoman').length, 1)
})

test('extendLastBatch joins a later op to the sentence and replay agrees', () => {
  const home = createHome(P, { furnish: true })
  const first = run(home, [{ op: 'place', kind: 'ottoman', at: { room: 'living', where: 'center' } }], ctx({ seed: 5 }), 'an ottoman and a stool')
  const ext = extendLastBatch(first.state, first.batch!.id, 1, [{ op: 'place', kind: 'stool', at: { room: 'living', where: 'near', of: { kind: 'ottoman' }, side: 'front', dist: 0.1 } }, { op: 'say', text: 'And a stool.' }])!
  assert.ok(ext)
  assert.equal(ext.state.log.length, 2)
  assert.equal(ext.batch!.ops.length, 2)
  assert.equal(ext.batch!.id, first.batch!.id)
  assert.equal(byKind(ext.state, 'stool')[0]!.group, first.batch!.id)
  assert.deepEqual(ext.effects.placed, ['stool#1'])
  assert.deepEqual(ext.effects.say, ['And a stool.'])
  assert.deepEqual(replayLog(P, ext.state.log).items, ext.state.items)
  assert.equal(extendLastBatch(ext.state, 'g99', 2, [{ op: 'place', kind: 'stool' }]), null)
})

test('say only claims what happened', () => {
  const home = createHome(P)
  const ok = run(home, [{ op: 'place', kind: 'sofa', at: { room: 'living' } }, { op: 'say', text: 'A sofa, as you wished.' }])
  assert.deepEqual(ok.effects.say, ['A sofa, as you wished.'])
  const fib = run(home, [{ op: 'place', kind: 'car', at: { room: 'closet' } }, { op: 'say', text: 'A car in the closet.' }])
  assert.match(fib.effects.say[0]!, /^I couldn't: no room for the car in the closet/)
  const honest = run(home, [{ op: 'place', kind: 'car', at: { room: 'closet' } }, { op: 'say', text: 'No room for a car there.' }])
  assert.deepEqual(honest.effects.say, ['No room for a car there.'])
  const walk = run(home, [{ op: 'goto', room: 'kitchen' }, { op: 'say', text: 'The kitchen.' }])
  assert.deepEqual(walk.effects.say, ['The kitchen.'])
})

test('applyOp is pure; diffItems tells placed, moved, modified and removed apart', () => {
  const home = createHome(P)
  const { state, effects } = applyOp(home, { op: 'place', kind: 'sofa', count: 2, at: { room: 'living', where: 'wall' } }, ctx())
  assert.equal(home.items.length, 0)
  assert.equal(state.items.length, 2)
  assert.deepEqual(effects.placed, ['sofa#1', 'sofa#2'])
  const [a, b] = state.items as [Item, Item]
  const d = diffItems(state.items, [{ ...a, pos: [a.pos[0] + 1, a.pos[1]] }, { ...b, props: { color: 'red' } }, { ...a, id: 'sofa#9' }])
  assert.deepEqual(d, { placed: ['sofa#9'], moved: ['sofa#1'], modified: ['sofa#2'], removed: [] })
  assert.deepEqual(diffItems(state.items, [{ ...a, group: 'g7' }]), { placed: ['sofa#1'], moved: [], modified: [], removed: ['sofa#1', 'sofa#2'] })
})

test('honestSay: a half-done sentence carries the op note; furnish skips stay quiet', () => {
  assert.equal(honestSay('Two nightstands.', true, ['only room for 1 of 2 nightstands']), 'Two nightstands. (only room for 1 of 2 nightstands)')
  assert.equal(honestSay('A sectional instead.', true, ['place: no free wall for the sectional sofa in the living room']), 'A sectional instead. (no free wall for the sectional sofa in the living room)')
  assert.equal(honestSay('Bedroom 2, calm.', true, ['Bedroom 2: no room to the left of the bed for the nightstand']), 'Bedroom 2, calm.')
  assert.equal(honestSay('Only one fit.', true, ['only room for 1 of 2 nightstands']), 'Only one fit.')
  assert.equal(honestSay('Sofa moved.', false, ['move: nothing matches sofa']), 'I couldn\'t: nothing matches sofa.')
})

// ---------- group moves and swaps ----------
// Scenes are built from ops, not from furnish, so these hold however the starter layouts change.

const bedroomCtx = (seed = 7) => ctx({ gaze: { point: [4, 6], room: 'primary' }, player: { pos: [4, 6.5], yaw: 0, room: 'primary' }, seed })
const sameYaw = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 0.01

/** Is `a` resting on `b` (centre over its footprint, bottom on its top)? */
function sitsOn(a: Item, b: Item): boolean {
  return pointInPolygon(a.pos, itemCorners(b), 0.01) && Math.abs((a.y ?? 0) - ((b.y ?? 0) + itemFootprint(b).height)) < 0.02
}

/** `p` in `a`'s frame: [along its length, toward its front]. */
function local(a: Item, p: [number, number]): [number, number] {
  const dx = p[0] - a.pos[0]
  const dz = p[1] - a.pos[1]
  return [dx * Math.cos(a.yaw) - dz * Math.sin(a.yaw), dx * Math.sin(a.yaw) + dz * Math.cos(a.yaw)]
}

/** A primary bedroom set from sentences: bed on the north wall, a nightstand each side with a lamp on it, a picture over the bed. */
function bedroomSet(): HomeState {
  let s = createHome(P)
  s = run(s, [{ op: 'place', kind: 'bed', at: { room: 'primary', where: 'wall', wall: 'north' } }], bedroomCtx(1)).state
  s = run(s, [
    { op: 'place', kind: 'nightstand', at: { room: 'primary', where: 'near', of: { kind: 'bed' }, side: 'left' } },
    { op: 'place', kind: 'nightstand', at: { room: 'primary', where: 'near', of: { kind: 'bed' }, side: 'right' } }
  ], bedroomCtx(2)).state
  s = run(s, [{ op: 'place', kind: 'table_lamp', count: 2, at: { room: 'primary', where: 'near', of: { kind: 'nightstand' }, side: 'on' } }], bedroomCtx(3)).state
  return run(s, [{ op: 'place', kind: 'picture', at: { room: 'primary', where: 'near', of: { kind: 'bed' }, side: 'behind' } }], bedroomCtx(4)).state
}

/** "Move the bed to the other wall": the first wall the layout lets it go to. */
function moveBedAway(s: HomeState, seed = 5) {
  for (const wall of ['south', 'east', 'west'] as const) {
    const res = run(s, [{ op: 'move', target: { kind: 'bed', room: 'primary' }, at: { room: 'primary', where: 'wall', wall } }], bedroomCtx(seed))
    if (res.effects.moved.includes('bed#1')) return res
  }
  assert.fail('the bed fits no other wall of the primary bedroom')
}

test('moving the bed to the other wall carries its nightstands, lamps and picture, all inside the room', () => {
  const home = bedroomSet()
  assert.equal(home.items.filter(i => i.anchor?.id === 'bed#1').length, 3, 'two nightstands and the picture belong to the bed')
  assert.equal(home.items.filter(i => i.kind === 'table_lamp' && i.anchor?.id.startsWith('nightstand#')).length, 2, 'each lamp belongs to its nightstand')
  const res = moveBedAway(home)
  const s = res.state
  const bed0 = home.items.find(i => i.id === 'bed#1')!
  const bed = s.items.find(i => i.id === 'bed#1')!
  assert.ok(Math.hypot(bed.pos[0] - bed0.pos[0], bed.pos[1] - bed0.pos[1]) > 0.5 && !sameYaw(bed.yaw, bed0.yaw), `the bed really moved (${bed0.pos} → ${bed.pos})`)
  const fb = itemFootprint(bed)
  const stands = byKind(s, 'nightstand')
  assert.equal(stands.length, 2)
  for (const n of stands) {
    const [x, z] = local(bed, n.pos)
    assert.equal(n.anchor?.id, bed.id, `${n.id} still belongs to the bed`)
    assert.ok(sameYaw(n.yaw, bed.yaw), `${n.id} turned with the bed`)
    assert.ok(Math.abs(x) > fb.length / 2 && Math.abs(x) < fb.length / 2 + 1.2, `${n.id} beside the bed (${x.toFixed(2)} along it)`)
    assert.ok(z < -fb.width / 2 + 0.6, `${n.id} at the head end, on the bed's new wall (${z.toFixed(2)})`)
    assert.ok(res.effects.moved.includes(n.id))
  }
  for (const l of byKind(s, 'table_lamp')) {
    assert.ok(stands.some(n => sitsOn(l, n)), `${l.id} on a nightstand (${l.pos}, y ${l.y})`)
    assert.ok(res.effects.moved.includes(l.id))
  }
  // Over the headboard when that wall is blank; the south wall's window sits there, so it slides along the same wall.
  const pic = byKind(s, 'picture')[0]!
  const [px, pz] = local(bed, pic.pos)
  const onHeadWall = pz < -fb.width / 2 + 0.1
  const r = room('primary')
  const onGlass = windowsOf(s.plan, r).some(w => Math.abs((pic.pos[0] - w.at[0]) * w.inward[0] + (pic.pos[1] - w.at[1]) * w.inward[1]) < 0.4
    && Math.abs((pic.pos[0] - w.at[0]) * w.inward[1] - (pic.pos[1] - w.at[1]) * w.inward[0]) < w.width / 2 + 0.3)
  assert.ok(!onGlass, `picture not on a window (${pic.pos})`)
  assert.ok(onHeadWall || res.effects.notes.some(n => /picture/.test(n)), `picture on the headboard wall or an honest note (${px.toFixed(2)}, ${pz.toFixed(2)})`)
  for (const i of s.items) assert.ok(itemCorners(i).every(c => pointInPolygon(c, r.polygon, 0.03)), `${i.id} inside`)
  const worst = worstOverlap(floorPieces(s.items))
  assert.ok(worst.ratio <= 0.05, `${worst.pair} overlap ${(worst.ratio * 100).toFixed(1)}%`)
})

/** A living room set from sentences: sofa on the south wall, a coffee table in front, an armchair to one side. */
function livingSet(): HomeState {
  let s = createHome(P)
  s = run(s, [{ op: 'place', kind: 'sofa', at: { room: 'living', where: 'wall', wall: 'south' } }], ctx({ seed: 1 })).state
  return run(s, [
    { op: 'place', kind: 'coffee_table', at: { room: 'living', where: 'near', of: { kind: 'sofa' }, side: 'front', dist: 0.5 } },
    { op: 'place', kind: 'armchair', at: { room: 'living', where: 'near', of: { kind: 'sofa' }, side: 'left', dist: 0.4 } }
  ], ctx({ seed: 2 })).state
}

test('remove the sofa and place a sectional in one sentence: the sectional takes the sofa’s spot and keeps its company', () => {
  const home = livingSet()
  const sofa = byKind(home, 'sofa')[0]!
  const res = run(home, [{ op: 'remove', target: { kind: 'sofa' } }, { op: 'place', kind: 'sectional', at: { room: 'living' } }])
  const sec = byKind(res.state, 'sectional')[0]!
  assert.ok(sec)
  assert.deepEqual(res.effects.notes, [])
  assert.ok(sameYaw(sec.yaw, sofa.yaw), 'same facing')
  // The sectional is 0.9 m deeper than the sofa: its back stays on the sofa's wall, so the centre moves half that into the room.
  const [x, z] = local(sofa, sec.pos)
  assert.ok(Math.abs(x) < 0.3, `same place along the wall (${x.toFixed(2)})`)
  assert.ok(Math.abs(z - 0.45) < 0.05, `back edge where the sofa's was (${z.toFixed(2)})`)
  for (const id of ['coffee_table#1', 'armchair#1']) {
    assert.equal(res.state.items.find(i => i.id === id)!.anchor?.id, sec.id, `${id} re-anchored`)
    assert.ok(res.effects.moved.includes(id), `${id} made room for the deeper piece`)
  }
  assert.ok(worstOverlap(floorPieces(res.state.items)).ratio <= 0.05)
  // Streamed in as a later op of the same sentence it does the same.
  const first = run(home, [{ op: 'remove', target: { kind: 'sofa' } }])
  const ext = extendLastBatch(first.state, first.batch!.id, 1, [{ op: 'place', kind: 'sectional' }])!
  assert.deepEqual(byKind(ext.state, 'sectional')[0]!.pos, sec.pos)
  assert.deepEqual(replayLog(P, ext.state.log).items, ext.state.items)
  // A later sentence is not a swap.
  const later = run(first.state, [{ op: 'place', kind: 'sectional', at: { room: 'living' } }])
  assert.ok(!byKind(later.state, 'sectional')[0]?.pos.every((v, i) => v === sec.pos[i]))
})

test('a king bed replacing the bed keeps its nightstands and lamps anchored', () => {
  const home = bedroomSet()
  const bed = byKind(home, 'bed')[0]!
  const res = run(home, [{ op: 'remove', target: { kind: 'bed', room: 'primary' } }, { op: 'place', kind: 'king_bed' }], bedroomCtx())
  const king = byKind(res.state, 'king_bed')[0]!
  assert.ok(king && Math.hypot(king.pos[0] - bed.pos[0], king.pos[1] - bed.pos[1]) < 0.1, `king in the bed's spot (${king?.pos})`)
  const stands = byKind(res.state, 'nightstand')
  assert.equal(stands.length, 2)
  for (const n of stands) assert.equal(n.anchor?.id, king.id, `${n.id} anchored to the king bed`)
  assert.equal(byKind(res.state, 'picture')[0]!.anchor?.id, king.id)
  const worst = worstOverlap(floorPieces(res.state.items))
  assert.ok(worst.ratio <= 0.05, `the wider bed pushed its nightstands out (${worst.pair})`)
  for (const l of byKind(res.state, 'table_lamp')) assert.ok(stands.some(n => sitsOn(l, n)), `${l.id} still on its nightstand`)
  // A longer king pushes them out again rather than swallowing them.
  const bigger = run(res.state, [{ op: 'restyle', target: { kind: 'king_bed' }, set: { length: 2.1 } }], bedroomCtx(8))
  const w = worstOverlap(floorPieces(bigger.state.items))
  assert.ok(w.ratio <= 0.05, `restyle carried the nightstands (${w.pair})`)
  assert.ok(stands.every(n => bigger.effects.moved.includes(n.id)))
})

test('a nightstand moved on its own stops following the bed; removing an anchor frees its dependants', () => {
  let s = bedroomSet()
  // Into the other bedroom, so it can't be what stops the bed moving.
  s = run(s, [{ op: 'move', target: { kind: 'nightstand', room: 'primary', limit: 1, near: 'gaze' }, at: { room: 'bedroom_2', where: 'wall' } }], bedroomCtx(3)).state
  const loose = byKind(s, 'nightstand').filter(i => !i.anchor)
  assert.equal(loose.length, 1, 'the moved one lost its anchor')
  const before = loose[0]!
  const res = moveBedAway(s, 4)
  const after = res.state.items.find(i => i.id === before.id)!
  assert.deepEqual([after.pos, after.yaw], [before.pos, before.yaw], 'stayed put')
  assert.ok(!res.effects.moved.includes(before.id))
  assert.ok(byKind(res.state, 'nightstand').some(n => n.anchor?.id === 'bed#1' && res.effects.moved.includes(n.id)), 'the other one still follows')
  const gone = run(res.state, [{ op: 'remove', target: { kind: 'bed', room: 'primary' } }], bedroomCtx(5))
  assert.ok(gone.state.items.every(i => i.anchor?.id !== 'bed#1'), 'no one points at the removed bed')
  assert.deepEqual(gone.effects.moved, [], 'its nightstands stay where they are')
})

test('replay of the export equals the state after group moves and swaps', () => {
  let s = bedroomSet()
  s = moveBedAway(s, 1).state
  s = run(s, [{ op: 'place', kind: 'sofa', at: { room: 'living', where: 'wall', wall: 'south' } }, { op: 'place', kind: 'coffee_table', at: { room: 'living', where: 'near', of: { kind: 'sofa' }, side: 'front' } }], ctx({ seed: 2 })).state
  s = run(s, [{ op: 'remove', target: { kind: 'sofa' } }, { op: 'place', kind: 'sectional' }], ctx({ seed: 3 })).state
  s = run(s, [{ op: 'remove', target: { kind: 'bed', room: 'primary' } }, { op: 'place', kind: 'king_bed' }], bedroomCtx(4)).state
  s = run(s, [{ op: 'move', target: { kind: 'nightstand', room: 'primary', limit: 1, near: 'gaze' }, at: { room: 'primary', where: 'corner' } }], bedroomCtx(5)).state
  s = run(s, [{ op: 'restyle', target: { kind: 'king_bed' }, set: { scale: 1.1 } }], bedroomCtx(6)).state
  s = run(s, [{ op: 'move', target: { kind: 'sectional' }, at: { room: 'living', where: 'window' } }], ctx({ seed: 7 })).state
  assert.ok(s.items.some(i => i.anchor), 'anchors survive')
  const loaded = importHome(JSON.parse(JSON.stringify(exportHome(s))))!
  assert.deepEqual(loaded.items, s.items)
  assert.deepEqual(replayLog(P, s.log).items, s.items)
})

test('a picture carried with its bed never lands on a window', () => {
  const ctx = defaultContext(TWO_BED_APARTMENT)
  let s = createHome(TWO_BED_APARTMENT)
  s = applyBatch(s, { ops: [
    { op: 'place', kind: 'bed', at: { room: 'primary', where: 'wall', wall: 'north' } },
    { op: 'place', kind: 'picture', at: { room: 'primary', where: 'near', of: { kind: 'bed', room: 'primary' }, side: 'behind' } }
  ] }, 'bed + picture', ctx).state
  s = applyBatch(s, { ops: [{ op: 'move', target: { kind: 'bed', room: 'primary' }, at: { room: 'primary', where: 'wall', wall: 'south' } }] }, 'bed to the window wall', ctx).state
  const pic = s.items.find(i => i.kind === 'picture')
  assert.ok(pic, 'the picture is still there')
  for (const w of windowsOf(s.plan, s.plan.rooms.find(r => r.id === 'primary')!)) {
    const along = Math.abs((pic!.pos[0] - w.at[0]) * w.inward[1] - (pic!.pos[1] - w.at[1]) * w.inward[0])
    const off = Math.abs((pic!.pos[0] - w.at[0]) * w.inward[0] + (pic!.pos[1] - w.at[1]) * w.inward[1])
    assert.ok(!(off < 0.4 && along < w.width / 2 + 0.3), `picture at ${pic!.pos} sits on the window at ${w.at}`)
  }
})
