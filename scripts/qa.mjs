// Fresh-eyes QA of the real app, as a user would drive it: first load, walking (with a wall-clip check),
// twenty sentences through the real model, reload/restore, export → start over → import, the plan reader
// (API and the real upload UI), plan view, the light popover, a phone-width layout and frame timing.
// The renderer caps a frame's step at 50 ms, so under ~20 fps (software GL) you walk slower; the walks start
// a metre from the doorway so they cross it either way.
// Re-runnable; screenshots land in internal_docs/20261017_hearth_v0/shots/qa_NN_<slug>.png.
//   node scripts/qa.mjs --port 3096 [--only walk,sentences,restore,files,extract,planview,light,mobile,perf]
// Needs a Hearth dev server already running on --port (it never boots or kills one: 3092 may be another app).
import { chromium } from 'playwright'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { walls, doorsOf, entry, roomAt } from '../shared/plan/geometry.ts'
import { area, pointInPolygon } from '../shared/plan/poly.ts'
import { itemCorners } from '../shared/home/select.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d)
const port = Number(opt('--port', 3096))
const url = `http://localhost:${port}/`
const only = opt('--only', '') ? new Set(opt('--only', '').split(',')) : null
const want = s => !only || only.has(s)
const outDir = resolve(root, 'internal_docs/20261017_hearth_v0/shots')
mkdirSync(outDir, { recursive: true })
const report = { walks: [], sentences: [], checks: [], fps: [], freezes: [], extract: [] }
const check = (name, ok, detail = '') => {
  report.checks.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` · ${detail}` : ''}`)
}

const res = await fetch(new URL('/api/plan/extract', url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => null)
if (!res || !/image is required/.test(await res.text())) throw new Error(`no Hearth dev server on :${port}`)

// Metal by default (the Mac's GPU, so fps means something); --swiftshader for the software path CI would get.
const gl = args.includes('--swiftshader') ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=metal']
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', ...gl, '--ignore-gpu-blocklist', '--enable-webgl'] })
const W = 1280
const H = 800
const ctxB = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, acceptDownloads: true })
const page = await ctxB.newPage()
const errors = []
page.on('pageerror', e => errors.push(e.message))
page.on('console', m => m.type() === 'error' && errors.push(m.text().slice(0, 200)))

const wait = ms => page.waitForTimeout(ms)
let n = 0
/** Each section numbers its own shots from a fixed base, so a partial re-run overwrites the same files. */
const section = (base) => {
  n = base - 1
}
const shot = async (slug, p = page) => {
  await p.evaluate(() => document.activeElement?.blur())
  const file = resolve(outDir, `qa_${String(++n).padStart(2, '0')}_${slug}.png`)
  await p.screenshot({ path: file })
  console.log('  shot', file.replace(root + '/', ''))
  return file
}
const ready = async (p = page) => {
  await p.waitForFunction(() => window.__sceneReady === true, null, { timeout: 90000 })
  await p.evaluate(() => document.querySelectorAll('[id^="nuxt-devtools"], nuxt-devtools-anchor').forEach(e => e.remove()))
  await p.waitForTimeout(2000)
}
const H$ = (fn, arg) => page.evaluate(fn, arg)
const state = () => H$(() => {
  const s = window.__hearth.state()
  return { plan: s.plan, items: s.items, log: s.log.map(b => b.id), light: s.light }
})
const player = () => H$(() => window.__hearth.renderer().player())
const chip = () => H$(() => document.querySelector('[data-room]')?.textContent?.trim() ?? document.querySelector('[data-room-chip]')?.textContent?.trim() ?? '')
const stand = (pos, yaw, pitch = 0) => H$(([p, y, k]) => window.__hearth.look(y, k, p), [pos, yaw, pitch])

// Collision: a step that crosses a full-height solid wall piece clipped through the wall.
function clips(plan, a, b) {
  const hits = []
  for (const w of walls(plan)) {
    for (const piece of w.pieces) {
      if (piece.kind !== 'solid') continue
      if (segCross(a, b, piece.a, piece.b)) hits.push(w.id)
    }
  }
  return hits
}
function segCross(p, q, r, s) {
  const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  const d1 = d(r, s, p)
  const d2 = d(r, s, q)
  const d3 = d(p, q, r)
  const d4 = d(p, q, s)
  return d1 * d2 < -1e-9 && d3 * d4 < -1e-9
}

/** Hold W for `ms` from a pose, sampling the player; reports rooms seen, the chip at the end and any wall clip. */
async function walk(label, pos, yaw, ms = 1500) {
  await stand(pos, yaw)
  await wait(400)
  await page.mouse.move(W / 2, H / 2)
  const samples = []
  await page.keyboard.down('w')
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    samples.push(await player())
    await wait(60)
  }
  await page.keyboard.up('w')
  await wait(400)
  samples.push(await player())
  const s = await state()
  const clipsAt = []
  const mismatch = []
  for (let i = 1; i < samples.length; i++) {
    const c = clips(s.plan, samples[i - 1].pos, samples[i].pos)
    if (c.length) clipsAt.push(`${samples[i - 1].pos}→${samples[i].pos} through ${c.join(',')}`)
    const truth = roomAt(s.plan, samples[i].pos)?.id
    if (truth !== samples[i].room) mismatch.push(`${samples[i].pos}: renderer ${samples[i].room} vs plan ${truth}`)
  }
  const rooms = [...new Set(samples.map(x => x.room))]
  const c = await chip()
  const moved = Math.hypot(samples.at(-1).pos[0] - pos[0], samples.at(-1).pos[1] - pos[1])
  const out = { label, from: pos, to: samples.at(-1).pos, moved: +moved.toFixed(2), rooms, chip: c, clips: clipsAt, mismatch }
  report.walks.push(out)
  console.log('walk', JSON.stringify(out))
  return out
}

/** One sentence through the real model, the way the bar sends it; caption and notes read back from the HUD. */
async function ask(text, slug, view, settle = 1600) {
  const t0 = Date.now()
  const out = await H$(t => window.__hearth.ask(t), text)
  await page.waitForFunction(() => window.__hearth.phase() !== 'thinking', null, { timeout: 30000 }).catch(() => {})
  // Frame the result the way a person would check it: from a corner of the room looking in, or from above.
  // 'item:<kind>:<room>' stands in front of that thing (a mirror in an L-shaped hall hides from any corner).
  if (view === 'plan') await H$(() => window.__hearth.mode('plan'))
  else if (view?.startsWith('item:')) await aimAt(...view.split(':').slice(1), 2.2, -0.05)
  else if (view) await frame(view)
  await wait(settle)
  // Read after the settle: the caption swaps in on a transition, so reading at once got the previous line.
  const caption = await H$(() => document.querySelector('[data-caption]')?.textContent?.trim() ?? '')
  const file = await shot(slug)
  if (view === 'plan') await H$(() => window.__hearth.mode('walk'))
  const row = {
    sentence: text,
    ops: out.ops.map(o => o.op === 'place' ? `place ${o.kind}${o.count ? `×${o.count}` : ''}${o.arrange ? ` ${o.arrange}` : ''}` : o.op === 'say' ? 'say' : o.op === 'surface' ? `surface ${o.room ?? ''}.${o.part}` : o.op === 'remove' || o.op === 'move' || o.op === 'restyle' ? `${o.op} ${JSON.stringify(o.target)}` : o.op === 'goto' ? `goto ${o.room ?? JSON.stringify(o.target)}` : o.op === 'light' ? `light ${JSON.stringify({ time: o.time, lamps: o.lamps, warmth: o.warmth })}` : o.op === 'furnish' ? `furnish ${o.room} ${o.style ?? ''}` : o.op).join(' | '),
    raw: out.ops,
    dropped: out.dropped.map(d => d.reason),
    notes: out.notes,
    summary: out.summary,
    say: out.say,
    caption,
    firstOpMs: out.firstOpMs,
    appliedMs: out.firstAppliedMs,
    ms: out.ms,
    wall: Date.now() - t0,
    error: out.error,
    shot: file
  }
  report.sentences.push(row)
  console.log(`“${text}” → ${row.ops} · ${row.summary} · first op ${row.firstOpMs} ms · notes ${JSON.stringify(row.notes)} · caption “${caption}”`)
  return row
}

/** Stand 45 cm in from the room's south-east corner, looking at its middle with the eyes down a little. */
async function frame(id) {
  await H$((rid) => {
    const r = window.__hearth.state().plan.rooms.find(x => x.id === rid)
    if (!r) return
    const xs = r.polygon.map(p => p[0])
    const zs = r.polygon.map(p => p[1])
    const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)]
    const c = [(x0 + x1) / 2, (z0 + z1) / 2]
    // L-shaped rooms (a closet notch) have bbox corners outside the room: take the first corner that is inside.
    const inside = (p) => {
      let hit = false
      for (let i = 0, j = r.polygon.length - 1; i < r.polygon.length; j = i++) {
        const [xi, zi] = r.polygon[i]
        const [xj, zj] = r.polygon[j]
        if ((zi > p[1]) !== (zj > p[1]) && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) hit = !hit
      }
      return hit
    }
    const corners = [[x1 - 0.45, z1 - 0.45], [x0 + 0.45, z1 - 0.45], [x1 - 0.45, z0 + 0.45], [x0 + 0.45, z0 + 0.45]]
    // ...and the one farthest from a door, so an open door leaf doesn't fill the frame.
    const doors = window.__hearth.state().plan.openings.filter(o => o.kind !== 'window' && o.rooms.includes(rid)).map(o => o.at)
    const clear = p => Math.min(9, ...doors.map(d => Math.hypot(d[0] - p[0], d[1] - p[1])))
    const ok = corners.filter(p => [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]].every(([dx, dz]) => inside([p[0] + dx, p[1] + dz])))
    const pos = ok.sort((a, b) => clear(b) - clear(a))[0] ?? corners[0]
    window.__hearth.look(Math.atan2(-(c[0] - pos[0]), -(c[1] - pos[1])), -0.42, pos)
  }, id)
}

/** Aim at an item: stand 1.6 m in front of it, look at its middle, and report what the crosshair hits. */
async function aimAt(kind, room, gap = 1.6, pitch = -0.45) {
  return H$(([k, r, g, k2]) => {
    const s = window.__hearth.state()
    const it = s.items.findLast(i => i.kind === k && (!r || i.room === r)) // the newest: furnish may have hung one already
    if (!it) return null
    const f = [Math.sin(it.yaw), Math.cos(it.yaw)]
    const pos = [it.pos[0] + f[0] * g, it.pos[1] + f[1] * g]
    const yaw = Math.atan2(-(it.pos[0] - pos[0]), -(it.pos[1] - pos[1]))
    window.__hearth.look(yaw, k2, pos)
    return it.id
  }, [kind, room, gap, pitch])
}

/** requestAnimationFrame over `ms`: mean fps and the longest frame. */
const frames = (ms = 3000) => H$(dur => new Promise((done) => {
  const ts = []
  const t0 = performance.now()
  const loop = (t) => {
    ts.push(t)
    if (t - t0 < dur) requestAnimationFrame(loop)
    else {
      const gaps = ts.slice(1).map((x, i) => x - ts[i])
      done({ fps: +(gaps.length / ((ts.at(-1) - ts[0]) / 1000)).toFixed(1), worst: Math.round(Math.max(...gaps)) })
    }
  }
  requestAnimationFrame(loop)
}), ms)
/** The longest frame while `fn` runs in the page (kernel + renderer sync, no model). */
const freeze = (label, fn) => H$(async (src) => {
  const ts = []
  let on = true
  const loop = (t) => {
    ts.push(t)
    if (on) requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
  await new Promise(r => setTimeout(r, 200))
  // renderer.sync wrapped so its share of the op is visible (textures are drawn inside it).
  const rd = window.__hearth.renderer()
  const sync0 = rd.sync
  let syncMs = 0
  rd.sync = (...a) => {
    const s0 = performance.now()
    const out = sync0.apply(rd, a)
    syncMs += performance.now() - s0
    return out
  }
  const t0 = performance.now()
  new Function(src)()
  const call = performance.now() - t0
  // Op arrival → the first frame painted after the sync.
  const painted = await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(t => r(t - t0))))
  rd.sync = sync0
  await new Promise(r => setTimeout(r, 1200))
  on = false
  const gaps = ts.slice(1).map((x, i) => x - ts[i])
  return { call: Math.round(call), sync: Math.round(syncMs), toFrame: Math.round(painted), worst: Math.round(Math.max(...gaps)) }
}, `(${fn})()`).then((r) => {
  report.freezes.push({ label, ...r })
  console.log(`freeze ${label}: call ${r.call} ms (sync ${r.sync}), next frame at ${r.toFrame} ms, worst frame ${r.worst} ms`)
  return r
})

/** fps in walk and plan view from a fixed pose. */
const measure = async (label, pose = { pos: [4.5, 3.8], yaw: 0.8 }) => {
  await H$(() => window.__hearth.mode('walk'))
  await stand(pose.pos, pose.yaw, -0.05)
  await wait(800)
  const walkF = await frames()
  await H$(() => window.__hearth.mode('plan'))
  await wait(1200)
  const planF = await frames()
  await H$(() => window.__hearth.mode('walk'))
  report.fps.push({ label, walk: walkF, plan: planF })
  console.log(`fps ${label}: walk ${JSON.stringify(walkF)} · plan ${JSON.stringify(planF)}`)
}

// ---------- first load ----------
section(1)
await page.goto(url, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await ready()
await page.mouse.move(W / 2, H / 2 - 150)
const first = await state()
const spawn = await player()
check('first load: furnished sample', first.items.length > 30, `${first.items.length} items, spawn ${JSON.stringify(spawn)}`)
check('first load: whisper visible', await page.isVisible('[data-whisper]'))
check('first load: room chip shows the hall', /hall/i.test(await chip()), await chip())
await shot('first_load')

if (want('walk')) {
  section(2)
  const k = await walk('hall → kitchen (north through the opening)', [7, 3.9], 0)
  check('walk into the kitchen: chip changes', /kitchen/i.test(k.chip) && k.rooms.includes('kitchen'), `${k.rooms.join('→')} chip “${k.chip}”`)
  await shot('walk_kitchen')
  const p = await walk('hall → primary (west through its door)', [6.8, 6], Math.PI / 2)
  check('walk into the primary bedroom: chip changes', /primary/i.test(p.chip), `${p.rooms.join('→')} chip “${p.chip}”`)
  await shot('walk_primary')
  const wallHit = await walk('living → solid south wall (should stop)', [4, 3.6], Math.PI, 1500)
  for (const w of [k, p, wallHit]) check(`no wall clip: ${w.label}`, !w.clips.length && !w.mismatch.length, [...w.clips, ...w.mismatch].slice(0, 3).join('; '))
}

// ---------- twenty sentences ----------
if (want('sentences')) {
  section(10)
  const plan = (await state()).plan
  const centre = (id) => {
    const r = plan.rooms.find(x => x.id === id)
    const xs = r.polygon.map(p => p[0])
    const zs = r.polygon.map(p => p[1])
    return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2]
  }
  const goRoom = async (id, yaw = 0) => {
    await stand(centre(id), yaw, -0.15)
    await wait(500)
  }
  await goRoom('living', 0)
  await ask('paint the living room a warm terracotta', 's01_terracotta', 'living')
  await goRoom('primary', Math.PI)
  await ask('wallpaper the primary bedroom in a navy damask', 's02_damask', 'primary')
  await ask('make all the floors light oak herringbone', 's03_herringbone', 'plan')
  await goRoom('kitchen', 0)
  await ask('put a round table with four chairs in the kitchen', 's04_round_table', 'plan')
  await goRoom('living', Math.PI)
  await ask('swap the sofa for a green velvet sectional', 's05_sectional', 'living')
  await stand([7.2, 6.2], Math.PI / 2, -0.1)
  await wait(400)
  await ask('hang a big mirror over the console in the hall', 's06_mirror_console', 'item:mirror:hall')
  await ask('a bookshelf on the east wall of the office', 's07_office')
  await goRoom('primary', Math.PI)
  await ask('move the bed to the other wall', 's08_bed_other_wall', 'plan')
  const aimed = await aimAt('dresser', 'primary')
  await wait(600)
  const gz = await H$(() => window.__hearth.renderer().gaze())
  console.log('aimed at', aimed, 'gaze', JSON.stringify(gz))
  const dislike = await ask('I don\'t like this', 's09_dislike', 'primary')
  dislike.gaze = { aimed, hit: gz.itemId }
  await goRoom('primary', Math.PI)
  await ask('two nightstands with lamps', 's10_nightstands', 'primary')
  await H$(() => window.__hearth.run([{ op: 'light', time: 'evening', lamps: false }], 'qa: evening', undefined, { source: 'console' }))
  await ask('it\'s too dark in here', 's11_too_dark', 'primary', 2200)
  await ask('dawn', 's12_dawn', 'primary', 2200)
  await ask('take me to the balcony', 's13_balcony', undefined, 2000)
  await ask('remove everything in bedroom 2', 's14_clear_bed2', 'bedroom_2')
  await ask('furnish bedroom 2 mid-century', 's15_furnish_bed2', 'bedroom_2', 2200)
  await goRoom('living', Math.PI)
  await ask('make the rug bigger', 's16_rug_bigger', 'living')
  const before = (await state()).log.length
  await ask('undo', 's17_undo', 'living')
  await ask('undo', 's18_undo2', 'bedroom_2')
  const after = (await state()).log.length
  check('two undos pop two batches', before - after === 2, `${before} → ${after}`)
  await ask('start over', 's19_start_over', 'plan', 2400)
  const reset = await state()
  check('start over resets to the furnished sample', reset.log.length === 1 && reset.items.length === first.items.length, `${reset.items.length} items, log ${reset.log}`)
  await ask('purple monkey dishwasher', 's20_nonsense')
}

// ---------- reload / restore, export → start over → import ----------
if (want('restore')) {
  section(40)
  await H$(() => window.__hearth.run([{ op: 'surface', room: 'living', part: 'walls', set: { color: '#9caf88', pattern: 'plain' } }, { op: 'place', kind: 'plant', at: { room: 'living', where: 'corner' } }], 'qa: sage + plant', undefined, { source: 'console' }))
  await stand([3, 3], 0.7, -0.1)
  await wait(500)
  const b = await state()
  const pb = await player()
  const hb = await H$(() => window.__hearth.history().length)
  await page.reload({ waitUntil: 'networkidle' })
  await ready()
  const a = await state()
  const pa = await player()
  const ha = await H$(() => window.__hearth.history().length)
  check('reload restores the home', a.items.length === b.items.length && a.log.length === b.log.length && a.plan.rooms.find(r => r.id === 'living').walls.color === '#9caf88', `${b.items.length}/${a.items.length} items, log ${b.log.length}/${a.log.length}`)
  check('reload restores the camera', Math.hypot(pa.pos[0] - pb.pos[0], pa.pos[1] - pb.pos[1]) < 0.1 && Math.abs(pa.yaw - pb.yaw) < 0.05, `${JSON.stringify(pb)} → ${JSON.stringify(pa)}`)
  check('reload restores the history', ha >= b.log.length, `${hb} entries before, ${ha} after (labels only for replayed batches)`)
  await shot('reload_restored')
}
if (want('files')) {
  section(43)
  const count = (await state()).items.length
  await page.click('[data-menu-button]')
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByText('Export home JSON').click()])
  const path = resolve(outDir, '../qa_export.json')
  await dl.saveAs(path)
  await page.keyboard.press('Escape')
  await page.click('[data-menu-button]')
  await page.getByText('Start over').click()
  await wait(400)
  await shot('start_over_confirm')
  await page.click('[data-reset-go]')
  await wait(1200)
  const resetCount = (await state()).items.length
  await page.setInputFiles('[data-top-right] input[type=file], input[type=file][accept*=json]', path)
  await wait(1500)
  const back = (await state()).items.length
  check('export → start over → import keeps the item count', back === count, `${count} exported, ${resetCount} after reset, ${back} imported`)
  await shot('imported')
}

// ---------- the plan reader ----------
async function judgePlan(label, plan, items) {
  const e = entry(plan)
  const spawnRoom = plan.rooms.find(r => r.id === e.room)
  const adj = new Map(plan.rooms.map(r => [r.id, new Set()]))
  for (const r of plan.rooms) for (const d of doorsOf(plan, r)) if (d.other !== 'outside') adj.get(r.id).add(d.other)
  const seen = new Set([e.room])
  const q = [e.room]
  while (q.length) for (const nb of adj.get(q.shift()) ?? []) if (!seen.has(nb)) seen.add(nb) && q.push(nb)
  const unreachable = plan.rooms.filter(r => !seen.has(r.id)).map(r => r.id)
  const outside = items.filter(i => !itemCorners(i).every(c => pointInPolygon(c, plan.rooms.find(r => r.id === i.room).polygon, 0.05))).map(i => i.id)
  const slivers = walls(plan).filter(w => w.length < 0.25).map(w => `${w.id} ${w.rooms.join('|')} ${w.length.toFixed(2)}m`)
  const pairs = [...adj].flatMap(([a, s]) => [...s].filter(b => a < b).map(b => `${a}↔${b}`))
  const out = { label, rooms: plan.rooms.map(r => `${r.id}(${r.type},${area(r.polygon).toFixed(1)})`), spawn: `${e.room} (${spawnRoom?.type}, ${area(spawnRoom.polygon).toFixed(1)} m²) at ${e.pos}`, doors: pairs, unreachable, itemsOutside: outside, slivers, notes: plan.source?.notes ?? [] }
  report.extract.push(out)
  // Keep the read itself: reads vary run to run, and a bad one is the next regression fixture.
  const slug = label.split(' ')[0]
  writeFileSync(resolve(outDir, `../extract/qa_${slug}.plan.json`), JSON.stringify(plan, null, 1))
  out.planFile = `internal_docs/20261017_hearth_v0/extract/qa_${slug}.plan.json`
  console.log('plan', JSON.stringify(out, null, 1))
  return out
}
if (want('extract')) {
  section(50)
  // The real UI path: Plan → drop zone (file chooser) → hint → Read → the rooms table → Walk it.
  await page.click('[data-plan-button]')
  await wait(600)
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-drop-zone]')])
  await chooser.setFiles(resolve(root, 'public/samples/desktop_2br.png'))
  await wait(500)
  await page.fill('[data-plan-hint] input, input[data-plan-hint]', '2 bedroom apartment, dimensions in feet')
  const t0 = Date.now()
  await page.click('[data-plan-read]')
  await page.waitForSelector('[data-plan-result]', { timeout: 60000 })
  const readMs = Date.now() - t0
  await wait(800)
  await shot('extract_ui_panel')
  await page.click('[data-plan-walk]')
  await wait(1500)
  const s = await state()
  const j = await judgePlan('desktop_2br via the upload UI', s.plan, s.items)
  j.readMs = readMs
  await shot('extract_ui_spawn')
  check('extracted desktop_2br: spawn is not a closet', !/wd|w\/d|mech|closet|laundry/i.test(j.spawn), j.spawn)
  check('extracted desktop_2br: every room reachable', !j.unreachable.length, j.unreachable.join(','))
  check('extracted desktop_2br: furniture inside rooms', !j.itemsOutside.length, j.itemsOutside.join(','))
  check('extracted desktop_2br: no wall slivers', !j.slivers.length, j.slivers.join('; '))
  await H$(() => window.__hearth.mode('plan'))
  await wait(1500)
  await shot('extract_ui_plan')
  await H$(() => window.__hearth.mode('walk'))
  await wait(500)
  const byType = (t, nth = 0) => s.plan.rooms.filter(r => r.type === t).sort((a, b) => area(b.polygon) - area(a.polygon))[nth]?.id
  for (const [slug, id] of [['extract_ui_living', byType('living')], ['extract_ui_bedroom1', byType('bedroom')]]) {
    if (!id) continue
    await frame(id)
    await wait(900)
    await shot(slug)
  }
  // Walk from the spawn straight ahead for 1.5 s.
  const sp = await player()
  await walk('extracted desktop: forward from spawn', sp.pos, sp.yaw)
  await shot('extract_ui_walk')
  if (want('perf')) {
    await measure('extracted desktop_2br (from the spawn)', entry(s.plan))
    await freeze('extracted: wallpaper every room floral', () => window.__hearth.run([{ op: 'surface', room: 'all', part: 'walls', set: { color: '#dfe7d6', pattern: 'floral', accent: '#7a9a6a' } }], 'qa perf'))
    await freeze('extracted: furnish all mid-century', () => window.__hearth.run([{ op: 'furnish', room: 'all', style: 'mid-century' }], 'qa perf'))
  }

  const tyne = readFileSync(resolve(root, 'public/samples/wiki_2br_tyneside.png'))
  const t = await H$(([d, h]) => window.__hearth.extract(d, h), [`data:image/png;base64,${tyne.toString('base64')}`, ''])
  console.log('extract tyneside', t.ok, t.ms, t.reason ?? '')
  if (t.ok) {
    await wait(1500)
    const st = await state()
    const jt = await judgePlan('wiki_2br_tyneside via __hearth.extract (no hint)', st.plan, st.items)
    jt.readMs = t.ms
    await shot('tyneside_spawn')
    await H$(() => window.__hearth.mode('plan'))
    await wait(1500)
    await shot('tyneside_plan')
    await H$(() => window.__hearth.mode('walk'))
    const tl = st.plan.rooms.filter(r => r.type === 'living').sort((a, b) => area(b.polygon) - area(a.polygon))[0]?.id
    if (tl) {
      await frame(tl)
      await wait(900)
      await shot('tyneside_living')
    }
    const tp = await player()
    await walk('tyneside: forward from spawn', tp.pos, tp.yaw)
    await shot('tyneside_walk')
  }
  // Back to the sample for the remaining sections.
  await H$(() => window.__hearth.loadSample('two_bedroom_apartment'))
  await wait(1200)
}

// ---------- plan view ----------
if (want('planview')) {
  section(70)
  await H$(() => window.__hearth.run([
    { op: 'surface', room: 'primary', part: 'walls', set: { color: '#22355e', pattern: 'damask', accent: '#c9a24a' } },
    { op: 'surface', room: 'all', part: 'floor', set: { color: '#c9b088', pattern: 'herringbone' } }
  ], 'qa: finishes', undefined, { source: 'console' }))
  await H$(() => window.__hearth.mode('plan'))
  await wait(1600)
  await shot('plan_view_finishes')
  // Labels: every room's name should be on screen in plan view.
  const labels = await H$(() => [...document.querySelectorAll('[data-room-label], [data-plan-label]')].map(e => e.textContent?.trim()))
  console.log('plan labels', labels)
  await H$(() => window.__hearth.mode('walk'))
  await wait(600)
}

// ---------- the light popover ----------
if (want('light')) {
  section(72)
  await stand([4, 2.5], 0.3, -0.05)
  const log0 = (await state()).log.length
  await page.click('[data-light-button]')
  await wait(400)
  for (const t of ['night', 'noon']) {
    await page.click(`[data-time="${t}"]`)
    await wait(1400)
    await shot(`light_${t}`)
  }
  await page.click('[data-lamps]')
  await wait(800)
  const lampsOn = (await state()).light.lamps
  const slider = await page.$('[data-warmth] [role=slider]') ?? await page.$('[data-warmth]')
  await slider.focus()
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft')
  await wait(900)
  const l = (await state()).light
  await shot('light_warmth')
  await page.keyboard.press('Escape')
  const log1 = (await state()).log.length
  check('light: night, noon, lamps, warmth all logged', log1 - log0 === 4, `${log1 - log0} batches, lamps ${lampsOn}, warmth ${l.warmth}`)
  await page.click('[data-history-button]')
  await wait(700)
  await shot('light_history')
  await page.keyboard.press('Escape')
  for (let i = 0; i < 4; i++) await H$(() => window.__hearth.undo())
  const back = (await state()).light
  check('light: four undos restore the light', back.time === 'afternoon' && back.lamps === false && back.warmth === 0.5, JSON.stringify(back))
}

// ---------- phone width ----------
if (want('mobile')) {
  section(80)
  const m = await ctxB.newPage({ viewport: { width: 390, height: 844 } })
  await m.setViewportSize({ width: 390, height: 844 })
  await m.goto(url, { waitUntil: 'networkidle' })
  await ready(m)
  const box = sel => m.$eval(sel, (e) => {
    const r = e.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom }
  }).catch(() => null)
  const [bar, room, top] = [await box('[data-bar]'), await box('[data-room-chip]'), await box('[data-top-right]')]
  const hit = (a, b) => a && b && a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b
  console.log('mobile boxes', JSON.stringify({ bar, room, top }))
  check('mobile: chip, bar and top-right do not overlap', !hit(bar, room) && !hit(bar, top) && !hit(room, top), JSON.stringify({ room, top }))
  check('mobile: top-right fits the screen', top && top.x >= 0 && top.r <= 390, JSON.stringify(top))
  await shot('mobile_first', m)
  await m.click('[data-intent-input] input, input[data-intent-input]').catch(() => m.click('[data-intent-input]'))
  await m.keyboard.type('paint this room sage', { delay: 10 })
  await m.keyboard.press('Enter')
  await m.waitForFunction(() => window.__hearth.lastEntry()?.ms !== undefined && /sage/.test(window.__hearth.lastEntry()?.label ?? ''), null, { timeout: 30000 }).catch(() => {})
  await m.waitForTimeout(1500)
  const e = await m.evaluate(() => window.__hearth.lastEntry())
  check('mobile: the bar sends', !!e && /sage/.test(e.label) && e.surfaces > 0, `${e?.label} · surfaces ${e?.surfaces}`)
  await shot('mobile_sent', m)
  await m.close()
}

// ---------- frame timing ----------
if (want('perf')) {
  await H$(() => window.__hearth.loadSample('two_bedroom_apartment'))
  await wait(1500)
  await measure('furnished sample')
  await freeze('surface: wallpaper every room floral', () => window.__hearth.run([{ op: 'surface', room: 'all', part: 'walls', set: { color: '#dfe7d6', pattern: 'floral', accent: '#7a9a6a' } }], 'qa perf'))
  await freeze('surface: herringbone floors everywhere', () => window.__hearth.run([{ op: 'surface', room: 'all', part: 'floor', set: { color: '#c4a27a', pattern: 'herringbone' } }], 'qa perf'))
  await freeze('surface: terrazzo floors everywhere', () => window.__hearth.run([{ op: 'surface', room: 'all', part: 'floor', set: { color: '#d8d2c6', pattern: 'terrazzo', accent: '#8a7a6a' } }], 'qa perf'))
  await freeze('furnish all mid-century', () => window.__hearth.run([{ op: 'furnish', room: 'all', style: 'mid-century' }], 'qa perf'))
}

console.log('\n==== checks ====')
for (const c of report.checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` · ${c.detail}` : ''}`)
console.log(`${report.checks.filter(c => c.ok).length}/${report.checks.length} checks pass`)
if (errors.length) console.log(`browser errors (${errors.length}):\n  ${[...new Set(errors)].slice(0, 12).join('\n  ')}`)
// A partial run (--only) merges into the last report: checks by name, other sections replaced only if re-run.
const reportPath = resolve(outDir, '../qa_report.json')
let prev = {}
try {
  prev = JSON.parse(readFileSync(reportPath, 'utf8'))
} catch { /* first run */ }
const merged = { ...prev }
for (const [k, v] of Object.entries(report)) if (k !== 'checks' && v.length) merged[k] = v
merged.checks = [...(prev.checks ?? []).filter(c => !report.checks.some(x => x.name === c.name)), ...report.checks]
writeFileSync(reportPath, JSON.stringify(merged, null, 2))
await browser.close()
