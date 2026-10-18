/**
 * Plan-reader bench: every image in public/samples/ through extractPlan (no dev server), with and without a
 * hint, scored against ground truth where we have it (the drawn samples = shared/plan/samples.ts; the real
 * listing desktop_2br.png = the labels printed on it). Results land in internal_docs/20261017_instant_interiors_v0/extract/.
 *   node --env-file=.env scripts/bench-extract.mjs [--only desktop] [--model sonnet] [--hint-only|--no-hint] [--hint "…"]
 *     [--path object|text] [--reasoning minimal|low] [--conc 2] [--repeat 3] [--reads 1|2] [--label "before"]
 * `--repeat N` runs every (image, hint) N times and reports the spread (room count, total area, and on desktop_2br
 * whether the living room comes back open to the kitchen), because a reader that is right once is not stable.
 * `--reads 1` is the single-read path; the default (2) is what the app ships: two reads, the better one kept.
 * Each run appends a dated section to the README in the output folder.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, extname, resolve } from 'node:path'
import { extractPlan } from '../server/utils/planExtract.ts'
import { SAMPLES } from '../shared/plan/samples.ts'
import { doorsOf, entry, walls } from '../shared/plan/geometry.ts'
import { area, bounds, centroid, dist } from '../shared/plan/poly.ts'
import { flags } from './lib/harness.mjs'
import { mdTable } from './lib/table.mjs'

const { opt, has } = flags()
const only = opt('--only')
const forcePath = opt('--path')
const reasoning = opt('--reasoning')
const model = opt('--model')
const conc = Number(opt('--conc', 2))
const hints = has('--hint-only') ? [true] : has('--no-hint') ? [false] : [false, true]
const HINT = opt('--hint', 'A 2-bedroom apartment listing plan; the dimension labels are feet and inches.')
const repeat = Math.max(1, Number(opt('--repeat', 1)))
const reads = opt('--reads') ? Number(opt('--reads')) : undefined
const label = opt('--label', '')

const samplesDir = resolve(import.meta.dirname, '../public/samples')
const outDir = resolve(import.meta.dirname, '../internal_docs/20261017_instant_interiors_v0/extract')
mkdirSync(outDir, { recursive: true })

const FT = 0.3048
const ftin = (f, i) => (f + i / 12) * FT

// ---------- ground truth ----------

/** The real listing screenshot: what its labels say, and what any sane read must contain. */
const DESKTOP_TRUTH = {
  rooms: [
    { match: /bed(room)?[ _]?1|primary|master/i, type: 'bedroom', w: ftin(11, 5), d: ftin(17, 1), label: 'Bedroom 1' },
    { match: /living/i, type: 'living', w: ftin(11, 4), d: ftin(16, 10), label: 'Living/Dining' },
    { match: /bed(room)?[ _]?2/i, type: 'bedroom', w: ftin(10, 10), d: ftin(10, 2), label: 'Bedroom 2' },
    { match: /balcony/i, type: 'balcony', w: ftin(11, 1), d: ftin(4, 7), label: 'Balcony' }
  ],
  minRooms: 7,
  counts: { bathroom: 2, kitchen: 1, laundry: 1 },
  /** Door adjacencies that must exist (by room type / name regex pairs). */
  doors: [
    ['bedroom 1', r => /bed(room)?[ _]?1|primary|master/i.test(r.id + r.name), 'bath', r => r.type === 'bathroom'],
    ['bedroom 2', r => /bed(room)?[ _]?2/i.test(r.id + r.name), 'bath', r => r.type === 'bathroom'],
    ['bedroom 1', r => /bed(room)?[ _]?1|primary|master/i.test(r.id + r.name), 'living/hall', r => r.type === 'living' || r.type === 'hall'],
    ['bedroom 2', r => /bed(room)?[ _]?2/i.test(r.id + r.name), 'living/hall', r => r.type === 'living' || r.type === 'hall']
  ],
  /** Rooms that must have an exterior window. */
  windows: [['bedroom 1', r => /bed(room)?[ _]?1|primary|master/i.test(r.id + r.name)], ['living', r => r.type === 'living'], ['bedroom 2 / balcony', r => /bed(room)?[ _]?2/i.test(r.id + r.name) || r.type === 'balcony']]
}

const truthFor = (file) => {
  const id = basename(file, extname(file))
  const sample = SAMPLES.find(p => p.id === id)
  if (sample) return { kind: 'sample', plan: sample }
  if (id === 'desktop_2br') return { kind: 'desktop', truth: DESKTOP_TRUTH }
  return null
}

// ---------- scoring ----------

const roomSize = (r) => {
  const b = bounds(r.polygon)
  return { w: b.size[0], d: b.size[1], a: area(r.polygon) }
}
const pctErr = (got, want) => Math.abs(got - want) / want
const pct = x => `${(100 * x).toFixed(0)}%`

/** Tiling: how much of the bounding box the rooms cover, and how many room pairs overlap. */
function tiling(plan) {
  const all = plan.rooms.flatMap(r => r.polygon)
  const bb = bounds(all)
  const sum = plan.rooms.reduce((s, r) => s + area(r.polygon), 0)
  const coverage = sum / (bb.size[0] * bb.size[1])
  let overlaps = 0
  const pairs = []
  for (let i = 0; i < plan.rooms.length; i++) {
    for (let j = i + 1; j < plan.rooms.length; j++) {
      const a = bounds(plan.rooms[i].polygon)
      const b = bounds(plan.rooms[j].polygon)
      const w = Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0])
      const h = Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1])
      if (w > 0 && h > 0 && w * h > 0.3) {
        overlaps++
        pairs.push(`${plan.rooms[i].id}×${plan.rooms[j].id} ${(w * h).toFixed(1)}m²`)
      }
    }
  }
  return { coverage, overlaps, pairs, bb }
}

const NONE = { id: '', name: '', type: 'none' }
const roomOf = (plan, id) => plan.rooms.find(r => r.id === id) ?? NONE
/** Rooms reachable from `a` through doors/openings; one extra hop via a closet or hall is allowed (bedroom → WIC → bath). */
function doorBetween(plan, a, b) {
  const doors = plan.openings.filter(o => o.kind === 'door' || o.kind === 'opening')
  const starts = plan.rooms.filter(a)
  const seen = new Set()
  const queue = starts.map(r => [r.id, 0])
  while (queue.length) {
    const [id, hops] = queue.shift()
    if (seen.has(id)) continue
    seen.add(id)
    const here = roomOf(plan, id)
    if (hops > 0 && b(here)) return true
    if (hops === 1 && !(here.type === 'closet' || here.type === 'hall')) continue
    if (hops >= 2) continue
    for (const d of doors) {
      if (d.rooms[0] === id && d.rooms[1] !== 'outside') queue.push([d.rooms[1], hops + 1])
      if (d.rooms[1] === id && d.rooms[0] !== 'outside') queue.push([d.rooms[0], hops + 1])
    }
  }
  return false
}

/** A pass/fail list: `check(ok, what)` records a line, `result()` the tally. */
function scorecard() {
  const lines = []
  let pass = 0
  const check = (ok, what) => {
    if (ok) pass++
    lines.push(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  }
  return { check, result: () => ({ pass, total: lines.length, lines }) }
}

function scoreDesktop(plan, truth) {
  const { check, result } = scorecard()
  check(plan.rooms.length >= truth.minRooms, `rooms ≥ ${truth.minRooms} (got ${plan.rooms.length})`)
  for (const [type, n] of Object.entries(truth.counts)) {
    const got = plan.rooms.filter(r => r.type === type).length
    check(got >= n, `${type} ×${n} (got ${got})`)
  }
  for (const t of truth.rooms) {
    const r = plan.rooms.find(r => t.match.test(r.name) || t.match.test(r.id))
    if (!r) {
      check(false, `${t.label}: not found`)
      continue
    }
    const s = roomSize(r)
    const want = t.w * t.d
    check(pctErr(s.a, want) <= 0.15, `${t.label} area ${s.a.toFixed(1)} m² vs ${want.toFixed(1)} (${pct(pctErr(s.a, want))} off; ${s.w.toFixed(2)}×${s.d.toFixed(2)} vs ${t.w.toFixed(2)}×${t.d.toFixed(2)})`)
  }
  for (const [an, a, bn, b] of truth.doors) check(doorBetween(plan, a, b), `door ${an} ↔ ${bn}`)
  for (const [n, pick] of truth.windows) {
    // An inset balcony counts as "outside" for the room behind it (its glass faces the balcony, not the street).
    const ext = id => id === 'outside' || roomOf(plan, id).type === 'balcony'
    const ok = plan.openings.some(o => o.kind === 'window' && ((ext(o.rooms[1]) && pick(roomOf(plan, o.rooms[0]))) || (ext(o.rooms[0]) && pick(roomOf(plan, o.rooms[1])))))
    check(ok, `exterior window on ${n}`)
  }
  const t = tiling(plan)
  check(t.coverage >= 0.85 && t.coverage <= 1.05, `coverage ${pct(t.coverage)} (0.85–1.05)`)
  check(t.overlaps === 0, `overlaps ${t.overlaps}${t.pairs.length ? ` (${t.pairs.join(', ')})` : ''}`)
  return result()
}

function scoreSample(plan, truth) {
  const { check, result } = scorecard()
  check(plan.rooms.length === truth.rooms.length, `room count ${plan.rooms.length} vs ${truth.rooms.length}`)
  const sum = p => p.rooms.reduce((s, r) => s + area(r.polygon), 0)
  check(pctErr(sum(plan), sum(truth)) <= 0.15, `total area ${sum(plan).toFixed(1)} vs ${sum(truth).toFixed(1)} m² (${pct(pctErr(sum(plan), sum(truth)))} off)`)
  // per-room: same type, nearest centroid (both plans are origin-shifted by normalizePlan)
  const used = new Set()
  for (const tr of truth.rooms) {
    const cands = plan.rooms.filter(r => r.type === tr.type && !used.has(r.id))
    if (!cands.length) {
      check(false, `${tr.id}: no ${tr.type} left to match`)
      continue
    }
    const tc = centroid(tr.polygon)
    cands.sort((a, b) => dist(centroid(a.polygon), tc) - dist(centroid(b.polygon), tc))
    const r = cands[0]
    used.add(r.id)
    const e = pctErr(area(r.polygon), area(tr.polygon))
    check(e <= 0.2, `${tr.id} ≈ ${r.id}: area ${area(r.polygon).toFixed(1)} vs ${area(tr.polygon).toFixed(1)} (${pct(e)} off), centroid ${dist(centroid(r.polygon), tc).toFixed(2)} m away`)
  }
  for (const kind of ['door', 'opening', 'window']) {
    const want = truth.openings.filter(o => o.kind === kind)
    const got = plan.openings.filter(o => o.kind === kind || (kind === 'door' && o.kind === 'opening') || (kind === 'opening' && o.kind === 'door'))
    const hit = want.filter(w => got.some(g => dist(g.at, w.at) <= 0.6)).length
    check(hit / Math.max(1, want.length) >= 0.6, `${kind} recall ${hit}/${want.length} (found ${plan.openings.filter(o => o.kind === kind).length})`)
  }
  const t = tiling(plan)
  check(t.coverage >= 0.85 && t.coverage <= 1.05, `coverage ${pct(t.coverage)}`)
  check(t.overlaps === 0, `overlaps ${t.overlaps}${t.pairs.length ? ` (${t.pairs.join(', ')})` : ''}`)
  return result()
}

// ---------- stability: what has to come back the same every run ----------

const sumArea = p => p.rooms.reduce((s, r) => s + area(r.polygon), 0)

/**
 * How the living room meets the kitchen: 'open' when every wall between them is a full-width opening (no
 * wall pieces: what the drawing shows), 'walled' when any stretch of wall stands between them (an invented
 * wall, maybe with a cased hole in it), 'apart' when they share no wall. Measured from the opening widths so
 * it means the same thing on plans read before walls knew about `open`.
 */
function livingKitchen(plan) {
  const living = plan.rooms.find(r => r.type === 'living')
  const kitchen = plan.rooms.find(r => r.type === 'kitchen')
  if (!living || !kitchen) return 'missing'
  const between = walls(plan).filter(w => w.rooms.includes(living.id) && w.rooms.includes(kitchen.id))
  if (!between.length) return 'apart'
  return between.every(w => w.openings.some(o => o.kind !== 'window' && o.width >= 0.85 * w.length)) ? 'open' : 'walled'
}

/** Rooms you can walk to from the arrival through doors and openings. */
function reachable(plan) {
  const seen = new Set([entry(plan).room])
  const queue = [...seen]
  while (queue.length) {
    const id = queue.shift()
    const room = plan.rooms.find(r => r.id === id)
    for (const d of room ? doorsOf(plan, room) : []) {
      if (d.other === 'outside' || seen.has(d.other)) continue
      seen.add(d.other)
      queue.push(d.other)
    }
  }
  return seen
}

/** The owner's bar for desktop_2br, per run. */
function desktopTarget(plan) {
  const sized = DESKTOP_TRUTH.rooms.filter(t => t.type !== 'balcony').map((t) => {
    const r = plan.rooms.find(r => t.match.test(r.name) || t.match.test(r.id))
    return r ? pctErr(area(r.polygon), t.w * t.d) : 1
  })
  const seen = reachable(plan)
  const baths = plan.rooms.filter(r => r.type === 'bathroom')
  const lk = livingKitchen(plan)
  const out = {
    rooms: plan.rooms.length >= 8 && plan.rooms.length <= 11,
    areas: sized.every(e => e <= 0.15),
    open: lk === 'open',
    baths: baths.length >= 2 && baths.every(b => seen.has(b.id))
  }
  return { ...out, lk, worst: Math.max(...sized), met: Object.values(out).every(Boolean) }
}

// ---------- runner ----------

const files = readdirSync(samplesDir).filter(f => /\.(png|jpe?g)$/i.test(f) && (!only || f.includes(only))).sort()
const jobs = files.flatMap(f => hints.flatMap(h => Array.from({ length: repeat }, (_, i) => ({ file: f, hint: h, rep: i + 1 }))))

async function run(job) {
  const buf = readFileSync(resolve(samplesDir, job.file))
  const res = await extractPlan({ image: buf, hint: job.hint ? HINT : undefined, model, path: forcePath, reasoning, reads })
  const stem = `${basename(job.file, extname(job.file))}.${job.hint ? 'hint' : 'nohint'}${repeat > 1 ? `.r${job.rep}` : ''}`
  const truth = truthFor(job.file)
  let score = null
  if (res.ok && truth) score = truth.kind === 'sample' ? scoreSample(res.plan, truth.plan) : scoreDesktop(res.plan, truth.truth)
  const til = res.ok ? tiling(res.plan) : null
  writeFileSync(resolve(outDir, `${stem}.json`), JSON.stringify({ file: job.file, hint: job.hint ? HINT : null, ok: res.ok, path: res.path, reads: res.reads, chosen: res.chosen, scores: res.scores, ms: res.ms, costUsd: res.costUsd, model: res.ok ? res.model : undefined, reason: res.ok ? undefined : res.reason, score: score ? { pass: score.pass, total: score.total, lines: score.lines } : null, tiling: til ? { coverage: til.coverage, overlaps: til.overlaps, pairs: til.pairs } : null, loose: res.ok ? res.loose : undefined, plan: res.ok ? res.plan : undefined }, null, 2))
  return { job, res, score, til, stem }
}

async function pool(items, n, fn) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }))
  return out
}

console.log(`Instant Interiors extract bench · ${new Date().toISOString().slice(0, 16)} · ${files.length} images × ${hints.length} × ${repeat} · model ${model ?? 'sonnet'} · reads ${reads ?? 'default'}\n`)
const rows = await pool(jobs, conc, run)
const table = []
let spent = 0
for (const { job, res, score, til } of rows) {
  spent += res.costUsd ?? 0
  const tag = `${job.file} ${job.hint ? '(hint)' : '(no hint)'}${repeat > 1 ? ` #${job.rep}` : ''}`
  console.log(`\n=== ${tag} · ${res.ok ? `path ${res.path}${res.chosen ? ` · chose ${res.chosen}` : ''}` : 'FAILED'} · ${res.ms} ms · $${(res.costUsd ?? 0).toFixed(4)}`)
  if (!res.ok) {
    console.log(`  reason: ${res.reason}`)
    table.push([job.file, job.hint ? 'y' : 'n', job.rep, res.path ?? '-', res.ms, `$${(res.costUsd ?? 0).toFixed(3)}`, '-', `failed: ${res.reason.slice(0, 60)}`, '', '', '', '', ''])
    continue
  }
  const p = res.plan
  console.log(`  ${p.name} · ${p.rooms.length} rooms · confidence ${p.source?.confidence ?? '-'}`)
  for (const r of p.rooms) {
    const s = roomSize(r)
    console.log(`   - ${r.id.padEnd(14)} ${r.type.padEnd(9)} ${s.w.toFixed(2)}×${s.d.toFixed(2)} m (${s.a.toFixed(1)} m²)${r.polygon.length > 4 ? ` ${r.polygon.length}-gon` : ''}`)
  }
  const counts = { door: 0, opening: 0, window: 0 }
  for (const o of p.openings) counts[o.kind]++
  console.log(`  openings: ${counts.door} doors, ${counts.opening} openings, ${counts.window} windows · ${p.openings.map(o => `${o.kind[0]}:${o.rooms.join('-')}`).join(' ')}`)
  console.log(`  tiling: coverage ${pct(til.coverage)}, overlaps ${til.overlaps}${til.pairs.length ? ` (${til.pairs.join(', ')})` : ''}; bbox ${til.bb.size[0].toFixed(1)}×${til.bb.size[1].toFixed(1)} m`)
  if (res.scores) console.log(`  read scores: ${Object.entries(res.scores).map(([k, v]) => `${k} ${v ? `${v.total.toFixed(1)} (${v.why.join('; ')})` : 'failed'}`).join(' | ')}`)
  if (res.notes.length) console.log(`  notes: ${res.notes.join(' | ')}`)
  if (score) {
    console.log(`  score ${score.pass}/${score.total}`)
    for (const l of score.lines) console.log(`    ${l}`)
  }
  const target = truthFor(job.file)?.kind === 'desktop' ? desktopTarget(p) : null
  if (target) console.log(`  target: ${target.met ? 'MET' : 'missed'} · rooms ${target.rooms ? 'ok' : 'x'} · areas ${target.areas ? 'ok' : 'x'} (worst ${pct(target.worst)}) · living↔kitchen ${target.lk} · baths ${target.baths ? 'reachable' : 'NOT reachable'}`)
  table.push([job.file, job.hint ? 'y' : 'n', job.rep, `${res.path}${res.chosen ? `/${res.chosen}` : ''}`, res.ms, `$${res.costUsd.toFixed(3)}`, p.rooms.length, `${counts.door}/${counts.opening}/${counts.window}`, sumArea(p).toFixed(1), pct(til.coverage), til.overlaps, score ? `${score.pass}/${score.total}` : '-', target ? `${target.lk}${target.met ? ' · MET' : ''}` : '-'])
}

// The spread per (image, hint): the number that says whether reads have stopped varying.
const spread = []
for (const f of files) {
  for (const h of hints) {
    const runs = rows.filter(r => r.job.file === f && r.job.hint === h)
    const ok = runs.filter(r => r.res.ok)
    if (!ok.length) {
      spread.push([f, h ? 'y' : 'n', `0/${runs.length}`, '-', '-', '-', '-'])
      continue
    }
    const n = ok.map(r => r.res.plan.rooms.length)
    const a = ok.map(r => sumArea(r.res.plan))
    const desk = truthFor(f)?.kind === 'desktop'
    const t = desk ? ok.map(r => desktopTarget(r.res.plan)) : []
    spread.push([f, h ? 'y' : 'n', `${ok.length}/${runs.length}`, `${Math.min(...n)}–${Math.max(...n)}`, `${Math.min(...a).toFixed(1)}–${Math.max(...a).toFixed(1)}`,
      desk ? `${t.filter(x => x.open).length}/${ok.length} open (${t.map(x => x.lk).join(', ')})` : '-',
      desk ? `${t.filter(x => x.met).length}/${ok.length} (rooms ${t.filter(x => x.rooms).length}, areas ${t.filter(x => x.areas).length}, baths ${t.filter(x => x.baths).length})` : '-'])
  }
}
console.log(`\nspread:\n${mdTable(['image', 'hint', 'ok', 'rooms', 'total m²', 'living↔kitchen', 'target'], spread)}`)
console.log(`\ntotal spend $${spent.toFixed(4)}`)
const head = `## ${new Date().toISOString().slice(0, 16)}${label ? ` · ${label}` : ''}`
const section = `${head}\n\nmodel ${model ?? 'sonnet'} · reads ${reads ?? 'default (2)'} · repeat ${repeat} · hint: "${HINT}"\n\n${mdTable(['image', 'hint', 'run', 'path/chosen', 'ms', 'cost', 'rooms', 'doors/openings/windows', 'm²', 'coverage', 'overlaps', 'score', 'living↔kitchen'], table)}\n\n${repeat > 1 ? `Spread over ${repeat} runs:\n\n${mdTable(['image', 'hint', 'ok', 'rooms', 'total m²', 'living↔kitchen', 'target (8–11 rooms, areas ±15 %, open, baths reachable)'], spread)}\n\n` : ''}Total spend $${spent.toFixed(4)}. Per-run JSON (loose + normalized plan + score lines) sits next to this file.\n`
const readmePath = resolve(outDir, 'README.md')
let prev = ''
try {
  prev = readFileSync(readmePath, 'utf8')
} catch { /* first run */ }
// Append, newest last: earlier benches are the before-and-after record.
writeFileSync(readmePath, prev ? `${prev.trimEnd()}\n\n${section}` : `# Plan-reader bench\n\n${section}`)
console.log(`appended to ${readmePath}`)
