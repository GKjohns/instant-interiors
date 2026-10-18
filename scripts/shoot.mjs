// Headless tour of the home through the real models, with a screenshot after every sentence.
// Usage: node scripts/shoot.mjs [--port 3092 | --url http://localhost:3092/] [--w 1440 --h 900] [--out dir] [--skip-extract]
// Reuses a Hearth dev server on --port when one is up, otherwise boots one and stops it at the end.
// Shots land in internal_docs/20261017_hearth_v0/shots/ as tour_NN_<slug>.png; the plan reader is run on
// public/samples/desktop_2br.png and that home is shot in plan and walk view. Ends with a table.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ROOT, SHOTS_DIR, collectErrors, devServer, flags, freshStart, launch, rel, screenshot, shotFile } from './lib/harness.mjs'
import { textTable } from './lib/table.mjs'

const { opt, has } = flags()
const width = Number(opt('--w', 1440))
const height = Number(opt('--h', 900))
const outDir = resolve(opt('--out', SHOTS_DIR))
const skipExtract = has('--skip-extract')
const server = opt('--url') ? { url: opt('--url'), stop: () => {} } : await devServer({ port: Number(opt('--port', 3092)) })
const url = server.url

const browser = await launch('swiftshader')
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
const errors = collectErrors(page, { echo: true })
await freshStart(page, url, 2500)

const wait = ms => page.waitForTimeout(ms)
/** Drop focus (a closed panel hands it back to its button, and a focused button shows its tooltip). */
const blurAll = () => page.evaluate(() => document.activeElement?.blur())
const shots = []
const shot = async (slug) => {
  await page.mouse.move(width / 2, height / 2 - 160, { steps: 6 })
  await wait(300)
  // A button under the pointer when a panel's overlay closes pops its tooltip on the NEXT pointer event and
  // never sees a leave; one more hover-and-leave on that trigger closes it.
  const open = await page.$('[data-top-right] [data-state="instant-open"], [data-top-right] [data-state="delayed-open"]')
  if (open) {
    await open.hover()
    await page.mouse.move(width / 2, height / 2 - 160, { steps: 6 })
    await wait(400)
  }
  shots.push(await screenshot(page, shotFile(outDir, 'tour', shots.length + 1, slug)))
}
const summary = () => page.evaluate(() => {
  const s = window.__hearth.state()
  const by = {}
  for (const i of s.items) by[i.kind] = (by[i.kind] || 0) + 1
  return { items: s.items.length, by, log: s.log.map(b => b.id), light: s.light }
})

const rows = []
/** One sentence through the real model (gaze snapshot taken now, as the bar does); settle; screenshot. */
const ask = async (text, slug, settle = 1800) => {
  const t0 = Date.now()
  const out = await page.evaluate(t => window.__hearth.ask(t), text)
  const wall = Date.now() - t0
  await page.waitForFunction(() => window.__hearth.phase() !== 'thinking', null, { timeout: 30000 }).catch(() => {})
  await wait(settle)
  const entry = await page.evaluate(() => window.__hearth.lastEntry())
  const ops = out.ops.map(o => o.op === 'place' ? `place ${o.kind}${o.count ? `×${o.count}` : ''}` : o.op === 'say' ? 'say' : o.op)
  rows.push({ sentence: text, ops: ops.join(', ') || '—', firstOpMs: out.firstOpMs ?? '—', appliedMs: out.firstAppliedMs ?? '—', ms: out.ms, wall, model: out.model ?? '—', error: out.error ?? (out.dropped.length ? `${out.dropped.length} dropped` : ''), say: out.say ?? '' })
  console.log(`“${text}” → ${out.summary} · ${out.model} first op ${out.firstOpMs ?? '-'} ms · done ${out.ms} ms${out.error ? ` · ERROR ${out.error}` : ''}${entry?.notes?.length ? ` · notes: ${entry.notes.join('; ')}` : ''}${out.say ? ` · “${out.say}”` : ''}`)
  const phase = await page.evaluate(() => window.__hearth.phase())
  if (phase === 'thinking') console.log('  !! phase pill stuck on thinking')
  await shot(slug)
  return out
}

console.log('start', JSON.stringify(await summary()))
await shot('first_run')

await ask('take me to the living room', 'living_room')
await ask('move the sofa under the window', 'sofa_window')
await ask('add a floor lamp beside it', 'floor_lamp')
await ask('wallpaper this room in a soft green floral', 'wallpaper')
await ask('make it golden hour', 'golden_hour', 2200)
await ask('take me to the primary bedroom', 'primary_bedroom')
await ask('it’s night, lamps on', 'night_lamps', 2200)
await ask('furnish bedroom 2 scandinavian', 'furnish_bed2', 2400)
await ask('undo', 'undo')
console.log('after tour', JSON.stringify(await summary()))

// HUD panels, for the QA pass.
await page.click('[data-light-button]')
await wait(500)
await shot('hud_light')
await page.keyboard.press('Escape')
await blurAll()
await wait(300)
await page.click('[data-history-button]')
await wait(700)
await shot('hud_history')
await page.keyboard.press('Escape')
await blurAll() // focus lands back on the button, whose tooltip would otherwise sit in the next shot
await wait(500)
await page.evaluate(() => window.__hearth.mode('plan'))
await wait(1500)
await shot('plan_view')
await page.evaluate(() => window.__hearth.mode('walk'))
await wait(800)

// The typed path: Enter focuses the bar, the sentence is typed (snapshot on the first key), Enter sends.
await page.keyboard.press('Enter')
await page.keyboard.type('put a plant in the corner', { delay: 20 })
await wait(300)
await shot('typing')
const typed0 = Date.now()
await page.keyboard.press('Enter')
await page.waitForFunction(() => window.__hearth.phase() === 'thinking', null, { timeout: 5000 }).catch(() => {})
await page.waitForFunction(() => window.__hearth.phase() !== 'thinking', null, { timeout: 30000 })
// The model and latency are stamped on the entry once the stream ends, a beat after the first op lands.
await page.waitForFunction(() => window.__hearth.lastEntry()?.ms !== undefined, null, { timeout: 30000 }).catch(() => {})
const typedEntry = await page.evaluate(() => window.__hearth.lastEntry())
rows.push({ sentence: 'put a plant in the corner (typed)', ops: (typedEntry?.ops || []).map(o => o.op === 'place' ? `place ${o.kind}` : o.op).join(', ') || '—', firstOpMs: '—', appliedMs: '—', ms: typedEntry?.ms ?? '—', wall: Date.now() - typed0, model: typedEntry?.model ?? '—', error: typedEntry?.error ?? '', say: (typedEntry?.say || []).join(' ') })
await wait(1800)
await shot('typed_plant')
const focusAfter = await page.evaluate(() => document.activeElement?.tagName)
console.log('focus after send:', focusAfter, '(INPUT would steal WASD)')

// ---------- the plan reader ----------
if (!skipExtract) {
  const png = readFileSync(resolve(ROOT, 'public/samples/desktop_2br.png'))
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`
  console.log(`extract: desktop_2br.png (${Math.round(png.length / 1024)} KB)…`)
  const t0 = Date.now()
  const res = await page.evaluate(d => window.__hearth.extract(d, '2 bedroom apartment, dimensions in feet'), dataUrl)
  const wall = Date.now() - t0
  if (res.ok) {
    console.log(`  ok: ${res.plan.name} · ${res.plan.rooms.length} rooms (${res.plan.rooms.map(r => r.name).join(', ')}) · ${res.plan.openings.length} openings · ${res.ms} ms server / ${wall} ms wall · $${(res.costUsd ?? 0).toFixed(4)} · notes: ${res.notes.join('; ') || '-'}`)
  } else {
    console.log(`  FAILED: ${res.reason} (${wall} ms)`)
    errors.push(`extract: ${res.reason}`)
  }
  rows.push({ sentence: '[extract desktop_2br.png]', ops: res.ok ? `${res.plan.rooms.length} rooms, ${res.plan.openings.length} openings` : '—', firstOpMs: '—', appliedMs: '—', ms: res.ms ?? '—', wall, model: 'sonnet-vision', error: res.ok ? '' : res.reason, say: '' })
  await wait(2500)
  await page.click('[data-plan-button]')
  await wait(900)
  await shot('extract_panel')
  await page.keyboard.press('Escape')
  await blurAll()
  await wait(400)
  await page.evaluate(() => window.__hearth.mode('plan'))
  await wait(1500)
  await shot('extract_plan')
  await page.evaluate(() => window.__hearth.mode('walk'))
  await wait(800)
  await shot('extract_walk')
  await ask('take me to the living room', 'extract_living')
  console.log('extracted home', JSON.stringify(await summary()))
}

// ---------- the table ----------
console.log(`\n${textTable(['sentence', 'ops', 'firstOpMs', 'appliedMs', 'ms', 'wall', 'model', 'error'], rows)}`)
console.log(`\n${shots.length} shots in ${rel(outDir)}`)
if (errors.length) console.log(`browser errors (${errors.length}):\n  ${[...new Set(errors)].slice(0, 12).join('\n  ')}`)

await browser.close()
server.stop()
