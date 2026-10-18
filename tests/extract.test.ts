/**
 * The plan reader's deterministic half: normalizePlan over a LoosePlan the model actually returned for
 * public/samples/desktop_2br.png (saved by scripts/bench-extract.mjs), plus the unit conversion. No network.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizePlan } from '../shared/plan/schema.ts'
import { area, bounds } from '../shared/plan/poly.ts'

const FT = 0.3048
const ftin = (f: number, i: number) => (f + i / 12) * FT
const loose = JSON.parse(readFileSync(new URL('./fixtures/desktop_2br.loose.json', import.meta.url), 'utf8')) as unknown

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
