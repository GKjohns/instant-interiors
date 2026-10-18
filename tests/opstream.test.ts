/** The incremental op scanner that lets the intent stream apply ops as they close, and the strict parse behind it. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { opScanner, parseLooseJson } from '../server/utils/opStream.ts'
import { parseOps } from '../shared/home/ops.ts'

function feed(text: string, step = 3): unknown[][] {
  const s = opScanner()
  const out: unknown[][] = []
  for (let i = 0; i < text.length; i += step) out.push(s.push(text.slice(i, i + step)))
  return out
}

test('opScanner: yields each envelope op as soon as it closes', () => {
  const text = '{"ops":[{"op":"place","kind":"sofa","at":{"where":"window"}},{"op":"say","text":"A } sofa [under] the window."}]}'
  const chunks = feed(text)
  const all = chunks.flat()
  assert.equal(all.length, 2)
  assert.deepEqual(all[0], { op: 'place', kind: 'sofa', at: { where: 'window' } })
  assert.deepEqual(all[1], { op: 'say', text: 'A } sofa [under] the window.' })
  // The first op arrives before the stream ends.
  const firstAt = chunks.findIndex(c => c.length)
  assert.ok(firstAt < chunks.length - 5)
})

test('opScanner: bare arrays with nested arrays, fences and escapes', () => {
  const text = '```json\n[{"op":"surface","room":"all","part":"floor","set":{"pattern":"herringbone"}},{"op":"say","text":"He said \\"oak\\"]"}]\n```'
  const all = feed(text, 5).flat()
  assert.equal(all.length, 2)
  assert.equal((all[0] as { room: string }).room, 'all')
  assert.equal((all[1] as { text: string }).text, 'He said "oak"]')
})

test('opScanner: a stringified envelope yields nothing; parseLooseJson recovers it', () => {
  const text = '{"ops":"[{\\"op\\":\\"undo\\"}]"}'
  const s = opScanner()
  assert.equal(s.push(text).length, 0)
  assert.deepEqual(parseLooseJson(s.text()), { ops: '[{"op":"undo"}]' })
  // …and parseOps unwraps the stringified ops.
  assert.deepEqual(parseOps(parseLooseJson(s.text())).ops, [{ op: 'undo' }])
})

test('parseOps: each streamed op is validated on its own; bad ones are dropped with a reason', () => {
  const good = parseOps([{ op: 'move', target: { kind: 'Sofa' }, at: { where: 'window' } }])
  assert.equal(good.dropped.length, 0)
  assert.deepEqual(good.ops[0], { op: 'move', target: { kind: 'sofa' }, at: { where: 'window' } })
  const bad = parseOps([{ op: 'move', target: { kind: 'sofa' } }, { op: 'light' }, { op: 'teleport' }, { op: 'surface', part: 'walls', set: { color: 'sage' } }])
  assert.equal(bad.ops.length, 1)
  assert.deepEqual(bad.ops[0], { op: 'surface', room: 'here', part: 'walls', set: { color: 'sage' } })
  assert.equal(bad.dropped.length, 3)
  assert.match(bad.dropped[0]!.reason, /at/)
  assert.match(bad.dropped[1]!.reason, /light needs at least one field/)
  assert.match(bad.dropped[2]!.reason, /unknown op "teleport"/)
})
