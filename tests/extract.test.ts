/**
 * The plan reader's deterministic half: normalizePlan over a LoosePlan the model actually returned for
 * public/samples/desktop_2br.png (saved by scripts/bench-extract.mjs), the unit conversion, and the two-read
 * scorer that picks between reads. No network.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizePlan } from '../shared/plan/schema.ts'
import type { LoosePlan } from '../shared/plan/schema.ts'
import { area, bounds } from '../shared/plan/poly.ts'
import { chooseRead, labelError, labelsOf, sealedRooms, tiling, walledOpenPlan } from '../shared/plan/score.ts'

const FT = 0.3048
const ftin = (f: number, i: number) => (f + i / 12) * FT
const loose = JSON.parse(readFileSync(new URL('./fixtures/desktop_2br.loose.json', import.meta.url), 'utf8')) as LoosePlan

function plan() {
  const r = normalizePlan(loose, { kind: 'upload', notes: [] })
  assert.ok(r.ok, r.ok ? '' : r.reason)
  return r.plan
}

test('desktop_2br fixture: enough rooms, and the labelled rooms within 15% of their printed size', () => {
  const p = plan()
  assert.ok(p.rooms.length >= 7, `${p.rooms.length} rooms`)
  const want: [RegExp, number][] = [
    [/bed(room)?[ _]?1/i, ftin(11, 5) * ftin(17, 1)],
    [/living/i, ftin(11, 4) * ftin(16, 10)],
    [/bed(room)?[ _]?2/i, ftin(10, 10) * ftin(10, 2)]
  ]
  for (const [rx, a] of want) {
    const room = p.rooms.find(r => rx.test(r.id) || rx.test(r.name))
    assert.ok(room, `no room matching ${rx}`)
    const got = area(room.polygon)
    assert.ok(Math.abs(got - a) / a <= 0.15, `${room.id}: ${got.toFixed(1)} m² vs ${a.toFixed(1)}`)
  }
  assert.equal(p.rooms.filter(r => r.type === 'bathroom').length, 2)
  assert.ok(p.rooms.some(r => r.type === 'kitchen'))
})

test('desktop_2br fixture: openings attach to real rooms; windows face outside or a balcony', () => {
  const p = plan()
  const ids = new Set(p.rooms.map(r => r.id))
  assert.ok(p.openings.length >= 8, `${p.openings.length} openings`)
  for (const o of p.openings) {
    assert.ok(ids.has(o.rooms[0]), `${o.id}: ${o.rooms[0]} is not a room`)
    assert.ok(o.rooms[1] === 'outside' || ids.has(o.rooms[1]), `${o.id}: ${o.rooms[1]} is not a room`)
    assert.ok(o.at.every(Number.isFinite))
  }
  const balcony = p.rooms.find(r => r.type === 'balcony')?.id
  for (const o of p.openings.filter(o => o.kind === 'window')) {
    assert.ok(o.rooms.includes('outside') || (balcony !== undefined && o.rooms.includes(balcony)), `${o.id} faces ${o.rooms.join('/')}`)
    assert.equal(o.sill, 0.9)
  }
  // The model's named pair wins when the point can be snapped onto a wall both rooms touch.
  const doors = p.openings.filter(o => o.kind === 'door').map(o => [...o.rooms].sort().join('-'))
  assert.ok(doors.includes('bedroom_1-living'), `doors: ${doors.join(', ')}`)
  assert.ok(doors.some(d => /bath/.test(d) && /bedroom_2|hall/.test(d)), `doors: ${doors.join(', ')}`)
})

test('normalizePlan tiles the fixture: coverage near 100%, no overlapping rooms, origin at the top-left', () => {
  const p = plan()
  const bb = bounds(p.rooms.flatMap(r => r.polygon))
  assert.deepEqual(bb.min, [0, 0])
  const sum = p.rooms.reduce((s, r) => s + area(r.polygon), 0)
  const coverage = sum / (bb.size[0] * bb.size[1])
  assert.ok(coverage > 0.9 && coverage <= 1.02, `coverage ${coverage.toFixed(2)}`)
  for (let i = 0; i < p.rooms.length; i++) {
    for (let j = i + 1; j < p.rooms.length; j++) {
      const a = bounds(p.rooms[i]!.polygon)
      const b = bounds(p.rooms[j]!.polygon)
      const w = Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0])
      const h = Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1])
      assert.ok(!(w > 0.05 && h > 0.05), `${p.rooms[i]!.id} overlaps ${p.rooms[j]!.id}`)
    }
  }
})

test('normalizePlan converts feet, keeps 1 m² closets, drops true slivers', () => {
  const r = normalizePlan({
    name: 'Feet test',
    units: 'ft',
    rooms: [
      { name: 'Bedroom', polygon: [[0, 0], [10, 0], [10, 10], [0, 10]] },
      { name: 'Mech.', polygon: [[10, 0], [13, 0], [13, 3], [10, 3]] },
      { name: 'Sliver', polygon: [[10, 3], [10.5, 3], [10.5, 5], [10, 5]] }
    ],
    openings: [{ kind: 'door', at: [10, 6], width: 3, rooms: ['Bedroom', 'outside'] }]
  })
  assert.ok(r.ok)
  const bed = r.plan.rooms.find(x => x.id === 'bedroom')!
  assert.ok(Math.abs(area(bed.polygon) - 9.29) < 0.1, `${area(bed.polygon)} m²`)
  assert.ok(r.plan.rooms.some(x => x.id === 'mech'), 'the 0.84 m² mech closet survives')
  assert.ok(!r.plan.rooms.some(x => x.id === 'sliver'))
  assert.ok(r.notes.some(n => /sliver/i.test(n)))
  const door = r.plan.openings[0]!
  assert.equal(door.kind, 'door')
  assert.ok(Math.abs(door.width - 0.914) < 0.01, 'opening widths convert too')
  assert.equal(door.rooms[1], 'outside')
})

// ---------- two reads, one answer ----------

const strict = (l: unknown) => {
  const r = normalizePlan(l, { kind: 'upload', notes: [] })
  assert.ok(r.ok, r.ok ? '' : r.reason)
  return r.plan
}
const clone = () => JSON.parse(JSON.stringify(loose)) as LoosePlan
const fx = () => strict(loose)

test('tiling: union coverage and doubly-claimed floor on a 10 cm raster', () => {
  const t = tiling(fx())
  assert.ok(t.coverage > 0.97, `coverage ${t.coverage}`)
  assert.ok(t.overlapM2 < 0.05, `overlap ${t.overlapM2}`)
  // Living drawn 1 m too deep: it now claims a metre strip of the kitchen.
  const l = clone()
  l.rooms.find(r => r.id === 'living')!.polygon = [[3.5, 0], [6.95, 0], [6.95, 6.15], [3.5, 6.15]]
  const o = tiling(strict(l))
  assert.ok(Math.abs(o.overlapM2 - 3.45) < 0.2, `overlap ${o.overlapM2}`)
})

test('labelError: printed sizes against room bounds, either orientation; feet convert; a missing room counts fully', () => {
  const p = fx()
  const ok = labelError(p, labelsOf({ ...clone(), units: 'ft', labels: [{ room: 'bedroom_1', width: 11 + 5 / 12, depth: 17 + 1 / 12 }, { room: 'Living/Dining', width: 16 + 10 / 12, depth: 11 + 4 / 12 }] }))!
  assert.ok(ok < 0.02, `exact read: ${ok}`)
  // A living room that swallowed the kitchen is 40 % too deep against its own label.
  const l = clone()
  l.rooms = l.rooms.filter(r => r.id !== 'kitchen')
  l.rooms.find(r => r.id === 'living')!.polygon = [[3.5, 0], [6.95, 0], [6.95, 7.4], [3.5, 7.4]]
  const bad = labelError(strict(l), [{ room: 'living', width: 3.45, depth: 5.13 }])!
  assert.ok(bad > 0.2, `swallowed: ${bad}`)
  assert.equal(labelError(p, [{ room: 'sunroom', width: 3, depth: 3 }]), 1)
  assert.equal(labelError(p, []), null)
})

test('chooseRead: the tidy read beats one with a hole, an overlap and invented doors; ties go to the first read', () => {
  const good = { plan: fx(), loose: clone(), interventions: 0 }
  const l = clone()
  l.rooms = l.rooms.filter(r => r.id !== 'bath_2')
  const holey = { plan: strict(l), loose: l, interventions: 2 }
  const pick = chooseRead([holey, good])
  assert.equal(pick.chosen, 1)
  assert.ok(pick.scores[0]!.total < pick.scores[1]!.total)
  assert.ok(pick.scores[0]!.why.includes('2 invented'), pick.scores[0]!.why.join('; '))
  assert.equal(chooseRead([good, { ...good }]).chosen, 0, 'identical reads: the first one')
  assert.deepEqual(chooseRead([null, good]).chosen, 1, 'a failed read never wins')
  assert.deepEqual(chooseRead([null, null]).chosen, -1)
})

test('chooseRead: labels from either read judge both; the read whose bounds match the printed sizes wins', () => {
  const labels = [{ room: 'living', width: 3.45, depth: 5.13 }, { room: 'bedroom_1', width: 3.48, depth: 5.21 }]
  const right = { plan: fx(), loose: { ...clone(), labels }, interventions: 0 }
  // The other read wrote no labels and drew the living room a metre short, the kitchen a metre long.
  const l = clone()
  l.rooms.find(r => r.id === 'living')!.polygon = [[3.5, 0], [6.95, 0], [6.95, 4.15], [3.5, 4.15]]
  l.rooms.find(r => r.id === 'kitchen')!.polygon = [[3.5, 4.15], [6.95, 4.15], [6.95, 7.4], [3.5, 7.4]]
  const wrong = { plan: strict(l), loose: l, interventions: 0 }
  const pick = chooseRead([wrong, right])
  assert.equal(pick.chosen, 1)
  // Living 4.15 deep against a 5.13 label: ~10 % off on that room, ~5 % averaged with the exact bedroom.
  assert.ok(pick.scores[0]!.labelErr! > 0.04 && pick.scores[1]!.labelErr! < 0.02, `${pick.scores[0]!.labelErr} vs ${pick.scores[1]!.labelErr}`)
})

test('chooseRead: reads one room apart prefer the one that found the tiny extra closet', () => {
  // Read b folds the W/D into the mech closet: same footprint, one room fewer.
  const l = clone()
  l.rooms = l.rooms.filter(r => r.id !== 'wd')
  l.rooms.find(r => r.id === 'mech')!.polygon = [[6.95, 5.6], [8, 5.6], [8, 7.4], [6.95, 7.4]]
  const pick = chooseRead([{ plan: strict(l), loose: l, interventions: 0 }, { plan: fx(), loose: clone(), interventions: 0 }])
  assert.equal(pick.chosen, 1)
  assert.ok(pick.scores[1]!.why.includes('found the extra wd'), pick.scores[1]!.why.join('; '))
  assert.equal(pick.scores[0]!.countBonus, 0)
})

test('sealedRooms: halls may be sealed; a balcony seen through glass is not', () => {
  const p = fx()
  assert.deepEqual(sealedRooms({ ...p, openings: p.openings.filter(o => !o.rooms.includes('kitchen') || o.kind === 'window') }).includes('kitchen'), true)
  assert.ok(!sealedRooms({ ...p, openings: p.openings.filter(o => o.kind === 'window') }).includes('balcony'))
})

test('walledOpenPlan: a kitchen left with a solid wall to the living room counts against the read; an open boundary does not', () => {
  // The fixture is a real read that drew no opening between them.
  assert.deepEqual(walledOpenPlan(fx()), ['kitchen|living'])
  const l = clone()
  l.openings = [...(l.openings ?? []), { kind: 'opening', at: [5.2, 5.15], width: 3.45, rooms: ['living', 'kitchen'] }]
  const open = { plan: strict(l), loose: l, interventions: 0 }
  assert.deepEqual(walledOpenPlan(open.plan), [])
  const pick = chooseRead([{ plan: fx(), loose: clone(), interventions: 0 }, open])
  assert.equal(pick.chosen, 1)
  assert.ok(pick.scores[0]!.why.includes('1 open plan walled off'), pick.scores[0]!.why.join('; '))
})
