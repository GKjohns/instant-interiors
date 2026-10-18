/**
 * Intent bench: ~30 utterances × two small homes (bare and furnished) through the real model.
 *   node --env-file=.env bench/intent.ts                       # haiku
 *   node --env-file=.env bench/intent.ts sonnet --only sofa    # one model, cases whose name contains "sofa"
 *   node --env-file=.env bench/intent.ts --repeat 2 --md internal_docs/20261017_hearth_v0/intent_bench.md
 * Scenes are hand-built HomeStates over the sample plan (the kernel is another sprint, so checks are on
 * the strict ops: the expected op names and their key fields). Prints pass rate, first-op and done
 * latency, cost and which provider served it; `--md` also writes the results table.
 */
import { writeFileSync } from 'node:fs'
import { trimScene } from '../shared/home/context.ts'
import { KIT } from '../shared/home/kinds.ts'
import type { Op } from '../shared/home/ops.ts'
import type { HomeState, Item, OpContext } from '../shared/home/types.ts'
import { TWO_BED_APARTMENT } from '../shared/plan/samples.ts'
import { interpret } from '../server/utils/intent.ts'

// ---------- scenes ----------

/** Standing in the living room looking north at the floor in front of the sofa. */
const LIVING: OpContext = { gaze: { point: [2.75, 1.6], room: 'living' }, player: { pos: [2.75, 3.6], yaw: 0, room: 'living' }, seed: 7 }
const PRIMARY: OpContext = { gaze: { point: [4, 5.6], room: 'primary' }, player: { pos: [4, 7], yaw: 0, room: 'primary' }, seed: 7 }

function build(rows: [kind: string, room: string, pos: [number, number], group: string, props?: Item['props']][], light: HomeState['light'] = { time: 'afternoon', lamps: false, warmth: 0.5 }): HomeState {
  const items: Item[] = rows.map(([kind, room, pos, group, props], i) => ({ id: `${kind}#${i + 1}`, kind, room, pos, yaw: 0, props: props ?? {}, group, tags: KIT[kind]?.tags ?? [] }))
  const last = items[items.length - 1]?.group ?? null
  return { plan: TWO_BED_APARTMENT, items, light, log: [], nextId: items.length + 1, nextGroup: 9, lastGroup: last }
}

const SCENES = {
  bare: () => build([]),
  furnished: () => build([
    ['sofa', 'living', [2.75, 0.55], 'g1', { color: '#6b7b8c' }], ['rug', 'living', [2.75, 2.2], 'g1', { color: '#8c3b3b' }], ['coffee_table', 'living', [2.75, 1.9], 'g1'],
    ['armchair', 'living', [4.7, 2.2], 'g1'], ['armchair', 'living', [0.8, 2.2], 'g1'], ['tv_stand', 'living', [2.75, 4.2], 'g1'], ['tv', 'living', [2.75, 4.4], 'g1'],
    ['floor_lamp', 'living', [0.4, 0.4], 'g2'], ['plant', 'living', [5.1, 0.4], 'g2'],
    ['bed', 'primary', [4, 5.6], 'g3'], ['nightstand', 'primary', [2.9, 4.8], 'g3'], ['nightstand', 'primary', [5.1, 4.8], 'g3'], ['table_lamp', 'primary', [2.9, 4.8], 'g3'], ['table_lamp', 'primary', [5.1, 4.8], 'g3'],
    ['dresser', 'primary', [2.4, 6.8], 'g3'], ['rug', 'primary', [4, 6.6], 'g3'], ['plant', 'primary', [5.7, 7.2], 'g3'],
    ['counter', 'kitchen', [7, 0.35], 'g4'], ['sink', 'kitchen', [6.3, 0.35], 'g4'], ['stove', 'kitchen', [7.7, 0.35], 'g4'], ['fridge', 'kitchen', [8.1, 1.2], 'g4'], ['island', 'kitchen', [7, 1.8], 'g4'], ['bar_stool', 'kitchen', [6.6, 2.4], 'g4'], ['bar_stool', 'kitchen', [7.4, 2.4], 'g4'],
    ['plant', 'hall', [8.2, 7.2], 'g5']
  ], { time: 'evening', lamps: false, warmth: 0.5 })
} satisfies Record<string, () => HomeState>

/** Look straight at an item (the gaze ray hit it at speech start). */
function lookAt(state: HomeState, kind: string, base: OpContext = LIVING): OpContext {
  const it = state.items.find(e => e.kind === kind)
  if (!it) throw new Error(`lookAt: no ${kind}`)
  return { ...base, gaze: { point: it.pos, itemId: it.id, room: it.room } }
}

// ---------- colour checks ----------

const NAMED: Record<string, string> = { blue: '#0000ff', navy: '#000080', cobalt: '#0047ab', teal: '#008080', green: '#008000', sage: '#9caf88', olive: '#808000', forest: '#228b22', emerald: '#50c878' }

function hsl(color: string | undefined): [number, number, number] | null {
  if (!color) return null
  const hex = (NAMED[color.toLowerCase()] ?? color).replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null
  const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l]
  const s = d / (1 - Math.abs(2 * l - 1))
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h = (h * 60 + 360) % 360
  return [h, s, l]
}
const bluish = (c?: string) => {
  const v = hsl(c)
  return (!!v && v[0] >= 190 && v[0] <= 255 && v[1] > 0.2) || /blue|navy|cobalt|indigo/i.test(c ?? '')
}
const greenish = (c?: string) => {
  const v = hsl(c)
  return (!!v && v[0] >= 70 && v[0] <= 170 && v[1] > 0.08) || /green|sage|olive|forest|emerald|moss/i.test(c ?? '')
}

// ---------- cases ----------

type OpOf<N extends Op['op']> = Extract<Op, { op: N }>
interface Case {
  name: string
  text: string
  scene: keyof typeof SCENES
  ctx?: (s: HomeState) => OpContext
  check: (ops: Op[], ctx: OpContext) => true | string
}

const expect = (ok: boolean, why: string): true | string => ok ? true : why
const brief = (ops: Op[]) => ops.filter(o => o.op !== 'say').map(opBrief).join(' + ') || 'no ops'
function find<N extends Op['op']>(ops: Op[], op: N, pred: (o: OpOf<N>) => boolean = () => true): OpOf<N> | undefined {
  return ops.find((o): o is OpOf<N> => o.op === op && pred(o as OpOf<N>))
}
const has = (ops: Op[], op: Op['op']) => ops.some(o => o.op === op)
const oneSay = (ops: Op[]) => {
  const says = ops.filter(o => o.op === 'say')
  if (says.length !== 1) return `${says.length} say ops`
  if (ops[ops.length - 1]!.op !== 'say') return 'say is not last'
  const text = (says[0] as OpOf<'say'>).text
  if (text.split(/\s+/).length > 14) return `say too long: "${text}"`
  return true
}
const roomIs = (room: string | undefined, want: string) => room === undefined || room === 'here' || room === want
const kindIn = (kind: string, ...wanted: string[]) => wanted.includes(kind)
/** A target selector that reaches `kind` in `room`: by kind (+ that room or none), or by a tag the kind carries. */
const targets = (t: { ref?: string, kind?: string, tag?: string, room?: string } | undefined, kind: string, room: string) =>
  !!t && (t.kind === kind || (!!t.tag && (KIT[kind]?.tags as string[] | undefined)?.includes(t.tag))) && roomIs(t.room, room)

const CASES: Case[] = [
  // bare home: furnishing, first placements, finishes, light, navigation, questions
  { name: 'furnish: the living room', text: 'furnish the living room', scene: 'bare', check: ops => expect(!!find(ops, 'furnish', o => roomIs(o.room, 'living')) && !has(ops, 'place'), brief(ops)) },
  { name: 'furnish: bedroom 2 scandinavian', text: 'furnish bedroom 2 scandinavian', scene: 'bare', check: ops => expect(!!find(ops, 'furnish', o => o.room === 'bedroom_2' && /scandi/i.test(o.style ?? '')), brief(ops)) },
  { name: 'furnish: the whole place', text: 'furnish the whole place', scene: 'bare', check: ops => expect(!!find(ops, 'furnish', o => o.room === 'all') || ops.filter(o => o.op === 'furnish').length >= 6, brief(ops)) },
  { name: 'place: sofa on the north wall', text: 'put a sofa against the north wall', scene: 'bare', check: ops => expect(!!find(ops, 'place', o => o.kind === 'sofa' && o.at?.where === 'wall' && o.at.wall === 'north'), brief(ops)) },
  { name: 'place: dining set', text: 'a dining table with four chairs', scene: 'bare', check: ops => expect(!!find(ops, 'place', o => kindIn(o.kind, 'dining_table', 'round_table')) && !!find(ops, 'place', o => o.kind === 'dining_chair' && o.count === 4), brief(ops)) },
  { name: 'place: side table right there', text: 'put a side table right there', scene: 'bare', check: ops => expect(!!find(ops, 'place', o => o.kind === 'side_table' && o.at?.where === 'gaze'), brief(ops)) },
  { name: 'place: pendant over the island', text: 'hang a pendant over the kitchen island', scene: 'furnished', check: ops => expect(!!find(ops, 'place', o => kindIn(o.kind, 'pendant', 'chandelier') && (o.at?.of?.kind === 'island' || o.at?.room === 'kitchen')), brief(ops)) },
  { name: 'surface: paint the walls sage', text: 'paint the walls sage', scene: 'bare', check: ops => expect(!!find(ops, 'surface', o => o.part === 'walls' && roomIs(o.room, 'living') && greenish(o.set.color) && (o.set.pattern ?? 'plain') === 'plain'), brief(ops)) },
  { name: 'surface: herringbone oak everywhere', text: 'make the floors herringbone oak everywhere', scene: 'bare', check: ops => expect(!!find(ops, 'surface', o => o.room === 'all' && o.part === 'floor' && o.set.pattern === 'herringbone'), brief(ops)) },
  { name: 'surface: wallpaper the primary floral', text: 'wallpaper the primary bedroom in a soft green floral', scene: 'bare', check: ops => expect(!!find(ops, 'surface', o => o.room === 'primary' && o.part === 'walls' && o.set.pattern === 'floral' && (greenish(o.set.color) || greenish(o.set.accent))), brief(ops)) },
  { name: 'surface: kitchen floor checkerboard', text: 'give the kitchen a black and white checkerboard floor', scene: 'bare', check: ops => expect(!!find(ops, 'surface', o => o.room === 'kitchen' && o.part === 'floor' && o.set.pattern === 'checker'), brief(ops)) },
  { name: 'light: nighttime', text: 'nighttime', scene: 'bare', check: ops => expect(!!find(ops, 'light', o => o.time === 'night') && !has(ops, 'place'), brief(ops)) },
  { name: 'light: sunset question', text: 'what would it look like at sunset?', scene: 'bare', check: ops => expect(!!find(ops, 'light', o => o.time === 'golden' || o.time === 'evening'), brief(ops)) },
  { name: 'goto: the kitchen', text: 'take me to the kitchen', scene: 'bare', check: ops => expect(!!find(ops, 'goto', o => o.room === 'kitchen') && !has(ops, 'move'), brief(ops)) },
  { name: 'say: how big is the living room', text: 'how big is the living room?', scene: 'bare', check: ops => expect(ops.length === 1 && ops[0]!.op === 'say' && /5\.5|4\.5/.test((ops[0] as OpOf<'say'>).text), `${brief(ops)} “${(find(ops, 'say')?.text) ?? ''}”`) },
  { name: 'reset: start over', text: 'start over', scene: 'furnished', check: ops => expect(has(ops, 'reset') && !has(ops, 'remove'), brief(ops)) },

  // furnished home: moves, references, swaps, sets, light, undo, style
  { name: 'move: sofa under the window', text: 'move the sofa under the window', scene: 'furnished', check: ops => expect(!!find(ops, 'move', o => targets(o.target, 'sofa', 'living') && o.at.where === 'window'), brief(ops)) },
  { name: 'move: armchairs by the window', text: 'put the armchairs by the window', scene: 'furnished', check: ops => expect(!!find(ops, 'move', o => targets(o.target, 'armchair', 'living') && o.at.where === 'window') && !has(ops, 'place'), brief(ops)) },
  { name: 'ref: lamp next to it (gaze sofa)', text: 'put a lamp next to it', scene: 'furnished', ctx: s => lookAt(s, 'sofa'), check: ops => expect(!!find(ops, 'place', o => kindIn(o.kind, 'floor_lamp', 'table_lamp') && o.at?.where === 'near' && (o.at.of?.ref === 'gaze' || o.at.of?.kind === 'sofa')), brief(ops)) },
  { name: 'ref: I don\'t like this chair (gaze)', text: 'I don\'t like this chair', scene: 'furnished', ctx: s => lookAt(s, 'armchair'), check: ops => expect(!!find(ops, 'remove', o => o.target.ref === 'gaze') && !has(ops, 'place'), brief(ops)) },
  { name: 'swap: rug for a blue one', text: 'swap the rug for a blue one', scene: 'furnished', check: (ops) => {
    const re = find(ops, 'restyle', o => targets(o.target, 'rug', 'living') && bluish(o.set.color))
    const swap = !!find(ops, 'remove', o => targets(o.target, 'rug', 'living')) && !!find(ops, 'place', o => o.kind === 'rug' && bluish(o.set?.color))
    return expect(!!re || swap, brief(ops))
  } },
  { name: 'restyle: sofa green velvet', text: 'make the sofa green velvet', scene: 'furnished', check: ops => expect(!!find(ops, 'restyle', o => targets(o.target, 'sofa', 'living') && greenish(o.set.color) && o.set.material === 'velvet'), brief(ops)) },
  { name: 'restyle: a bigger bed', text: 'a bigger bed', scene: 'furnished', ctx: () => PRIMARY, check: (ops) => {
    const grew = find(ops, 'restyle', o => targets(o.target, 'bed', 'primary') && (o.set.scale ?? 0) > 1 && o.relative === true)
    const king = !!find(ops, 'place', o => o.kind === 'king_bed')
    return expect(!!grew || king, brief(ops))
  } },
  { name: 'remove: all the plants', text: 'remove all the plants', scene: 'furnished', check: ops => expect(!!find(ops, 'remove', o => (o.target.tag === 'plant' || o.target.kind === 'plant') && (o.target.ref === 'all' || !o.target.room)), brief(ops)) },
  { name: 'remove: get rid of the tv', text: 'get rid of the tv', scene: 'furnished', check: ops => expect(!!find(ops, 'remove', o => targets(o.target, 'tv', 'living')), brief(ops)) },
  { name: 'remove: clear the living room', text: 'clear the living room', scene: 'furnished', check: ops => expect(!!find(ops, 'remove', o => o.target.ref === 'all' && o.target.room === 'living' && !o.target.kind && !o.target.tag) && !has(ops, 'reset'), brief(ops)) },
  { name: 'place: two armchairs across from the sofa', text: 'two armchairs across from the sofa', scene: 'furnished', check: ops => expect(!!find(ops, 'place', o => o.kind === 'armchair' && o.count === 2 && o.at?.where === 'near' && o.at.of?.kind === 'sofa' && o.at.side === 'opposite'), brief(ops)) },
  { name: 'place: picture above the bed', text: 'hang a picture above the bed', scene: 'furnished', ctx: () => PRIMARY, check: ops => expect(!!find(ops, 'place', o => o.kind === 'picture' && ((o.at?.where === 'near' && o.at.of?.kind === 'bed' && (o.at.side === 'behind' || o.at.side === 'on')) || o.at?.where === 'wall')), brief(ops)) },
  { name: 'light: too dark in here', text: 'it\'s too dark in here', scene: 'furnished', check: ops => expect(!!find(ops, 'light', o => o.lamps === true) && !has(ops, 'place'), brief(ops)) },
  { name: 'light: turn off the lamps', text: 'turn off the lamps', scene: 'furnished', check: ops => expect(!!find(ops, 'light', o => o.lamps === false) && !has(ops, 'remove'), brief(ops)) },
  { name: 'light: make it cozy', text: 'make it cozy in here', scene: 'furnished', check: ops => expect(!!find(ops, 'light', o => (o.warmth ?? 0) >= 0.6 || o.lamps === true), brief(ops)) },
  { name: 'undo', text: 'undo', scene: 'furnished', check: ops => expect(has(ops, 'undo') && ops.length <= 2, brief(ops)) },
  { name: 'goto: the sofa', text: 'take me to the sofa', scene: 'furnished', check: ops => expect(!!find(ops, 'goto', o => o.target?.kind === 'sofa') && !has(ops, 'move'), brief(ops)) },
  { name: 'style: make it mid-century', text: 'make it mid-century', scene: 'furnished', check: ops => expect((!!find(ops, 'surface', o => roomIs(o.room, 'living')) || !!find(ops, 'restyle', o => roomIs(o.target.room, 'living'))) && !has(ops, 'remove') && !has(ops, 'furnish'), brief(ops)) },
  { name: 'style: furnish empty bedroom 2 japandi', text: 'make bedroom 2 japandi', scene: 'furnished', check: ops => expect(!!find(ops, 'furnish', o => o.room === 'bedroom_2' && /japandi/i.test(o.style ?? '')) || !!find(ops, 'surface', o => o.room === 'bedroom_2'), brief(ops)) }
]

// ---------- runner ----------

const argv = process.argv.slice(2)
const flag = (k: string) => {
  const i = argv.indexOf(k)
  return i >= 0 ? argv[i + 1] : undefined
}
const flagVals = new Set(['--only', '--repeat', '--conc', '--md'].flatMap(k => argv.includes(k) ? [flag(k)] : []))
const models = argv.filter(a => !a.startsWith('--') && !flagVals.has(a))
const only = flag('--only')
const repeat = Number(flag('--repeat') ?? 1)
const conc = Number(flag('--conc') ?? 4)
const mdPath = flag('--md')
const cases = CASES.filter(c => !only || only.split(',').some(o => c.name.includes(o)))

interface Row { model: string, name: string, text: string, pass: boolean, why: string, ms: number, first: number, provider?: string, cost: number, cacheRead: number, out: number, ops: Op[], dropped: number, error?: string }

async function runCase(model: string, c: Case): Promise<Row> {
  const before = SCENES[c.scene]()
  const ctx = c.ctx ? c.ctx(before) : LIVING
  const res = await interpret({ text: c.text, scene: trimScene(before), ctx, model })
  const base = { model: res.model, name: c.name, text: c.text, ms: res.ms, first: res.firstOpMs ?? res.ms, provider: res.provider, cost: res.costUsd ?? 0, cacheRead: res.usage?.cacheRead ?? 0, out: res.usage?.output ?? 0, ops: res.ops, dropped: res.dropped.length, error: res.error }
  if (res.error) return { ...base, pass: false, why: `call failed: ${res.error}` }
  let verdict: true | string
  try {
    verdict = c.check(res.ops, ctx)
    if (verdict === true) verdict = oneSay(res.ops)
  } catch (err) {
    verdict = `check threw: ${(err as Error).message}`
  }
  const why = verdict === true ? (res.dropped.length ? `passed with ${res.dropped.length} dropped: ${res.dropped.map(d => d.reason).join('; ')}` : '') : `${verdict}${res.dropped.length ? ` · dropped: ${res.dropped.map(d => d.reason).join('; ')}` : ''}`
  return { ...base, pass: verdict === true, why }
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i]!)
    }
  }))
  return out
}

function pct(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))] ?? 0
}

function opBrief(o: Op): string {
  switch (o.op) {
    case 'place': return `place ${o.kind}${o.count ? `×${o.count}` : ''}${o.at ? ` @${JSON.stringify(o.at)}` : ''}${o.set ? ` ${JSON.stringify(o.set)}` : ''}`
    case 'move': return `move ${JSON.stringify(o.target)} → ${JSON.stringify(o.at)}`
    case 'remove': return `remove ${JSON.stringify(o.target)}`
    case 'restyle': return `restyle ${JSON.stringify(o.target)} ${JSON.stringify(o.set)}${o.relative ? ' rel' : ''}`
    case 'surface': return `surface ${o.room} ${o.part} ${JSON.stringify(o.set)}`
    case 'light': return `light${o.time ? ` ${o.time}` : ''}${o.lamps !== undefined ? ` lamps ${o.lamps}` : ''}${o.warmth !== undefined ? ` warmth ${o.warmth}` : ''}`
    case 'furnish': return `furnish ${o.room}${o.style ? ` (${o.style})` : ''}`
    case 'goto': return `goto ${o.room ?? JSON.stringify(o.target)}`
    default: return o.op
  }
}

const started = Date.now()
const runModels = models.length ? models : ['haiku']
console.log(`Hearth intent bench · ${new Date().toISOString().slice(0, 16)} · ${cases.length} cases × ${repeat} · models ${runModels.join(', ')}\n`)
const summary: string[] = []
const md: string[] = [`# Intent bench · ${new Date().toISOString().slice(0, 10)}`, '', `${cases.length} utterances × ${repeat} over two homes (bare, furnished) on TWO_BED_APARTMENT; checks are on the strict ops (expected op + key fields) plus exactly one short \`say\` last.`, '']
for (const model of runModels) {
  const jobs = Array.from({ length: repeat }, () => cases).flat()
  const rows = await pool(jobs, conc, c => runCase(model, c))
  md.push(`## ${model}`, '', '| # | case | sentence | ok | first / done ms | ops | say |', '|---|---|---|---|---|---|---|')
  rows.forEach((r, i) => {
    const say = find(r.ops, 'say')?.text ?? ''
    console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.model.padEnd(6)} ${String(r.first).padStart(5)}/${String(r.ms).padStart(5)}ms ${String(r.out).padStart(4)}tok  ${r.name.padEnd(40)} ${brief(r.ops)}${say ? `  “${say}”` : ''}`)
    if (r.why) console.log(`       ↳ ${r.why}`)
    md.push(`| ${i + 1} | ${r.name} | ${r.text} | ${r.pass ? 'pass' : `**fail**: ${r.why.replace(/\|/g, '\\|')}`} | ${r.first} / ${r.ms} | \`${brief(r.ops).replace(/\|/g, '\\|')}\` | ${say} |`)
  })
  const ms = rows.map(r => r.ms)
  const first = rows.map(r => r.first)
  const providers = [...new Set(rows.map(r => r.provider ?? '?'))].join('/')
  const passed = rows.filter(r => r.pass).length
  const cost = rows.reduce((s, r) => s + r.cost, 0)
  const cached = rows.filter(r => r.cacheRead > 0).length
  const line = `${model}: ${passed}/${rows.length} pass (${Math.round(100 * passed / rows.length)}%) · first op median ${pct(first, 0.5)} ms, p90 ${pct(first, 0.9)} ms · done median ${pct(ms, 0.5)} ms, p90 ${pct(ms, 0.9)} ms · cost $${cost.toFixed(4)} ($${(cost / rows.length).toFixed(5)}/call) · cache hits ${cached}/${rows.length} · provider ${providers}`
  summary.push(line)
  md.push('', `**${line}**`, '')
  console.log(`\n${line}\n`)
}
console.log('Summary')
for (const s of summary) console.log(`  ${s}`)
console.log(`  wall ${((Date.now() - started) / 1000).toFixed(1)} s`)
if (mdPath) {
  writeFileSync(mdPath, `${md.join('\n')}\n`)
  console.log(`  wrote ${mdPath}`)
}
