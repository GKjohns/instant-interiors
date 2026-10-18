// Headless tour of the home through the real models, with a screenshot after every sentence.
// Usage: node scripts/shoot.mjs [--url http://localhost:3092/] [--w 1440 --h 900] [--out dir] [--skip-extract]
// Reuses a dev server on :3092 when one is up (lsof), otherwise boots one and stops it at the end.
// Shots land in internal_docs/20261017_hearth_v0/shots/ as tour_NN_<slug>.png; the plan reader is run on
// public/samples/desktop_2br.png and that home is shot in plan and walk view. Ends with a table.
import { chromium } from 'playwright'
import { execSync, spawn } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const opt = (k, d) => {
  const i = args.indexOf(k)
  return i >= 0 ? args[i + 1] : d
}
const port = Number(opt('--port', 3092))
const url = opt('--url', `http://localhost:${port}/`)
const width = Number(opt('--w', 1440))
const height = Number(opt('--h', 900))
const outDir = resolve(opt('--out', resolve(root, 'internal_docs/20261017_hearth_v0/shots')))
const skipExtract = args.includes('--skip-extract')
mkdirSync(outDir, { recursive: true })

// ---------- the dev server ----------
let server = null
const portBusy = () => {
  try {
    return execSync(`lsof -i :${port} -sTCP:LISTEN -t`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().length > 0
  } catch {
    return false
  }
}
// Something else may own the port (another project's dev server): only reuse it if it serves Hearth.
// The page is client-rendered (no title in the HTML), so the plan reader's "image is required" is the fingerprint.
const up = async () => {
  try {
    const res = await fetch(new URL('/api/plan/extract', url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    return res.ok && /image is required/.test(await res.text())
  } catch {
    return false
  }
}
if (portBusy()) {
  if (!(await up())) throw new Error(`port ${port} is busy but is not serving Hearth; pass --port <free port>`)
} else {
  console.log(`booting the dev server on :${port}…`)
  server = spawn('npx', ['nuxt', 'dev', '--port', String(port)], { cwd: root, stdio: 'ignore', detached: true })
}
for (let i = 0; i < 120 && !(await up()); i++) await new Promise(r => setTimeout(r, 1000))
if (!(await up())) throw new Error(`no Hearth server at ${url}`)

// ---------- the browser ----------
const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl']
})
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 200))
  if (m.type() === 'error' || m.type() === 'warning') console.log('[browser]', m.type(), m.text().slice(0, 200))
})
page.on('pageerror', (e) => {
  errors.push(e.message)
  console.log('[pageerror]', e.message)
})

const ready = async () => {
  await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 90000 })
  await page.waitForSelector('canvas', { timeout: 30000 })
  await page.evaluate(() => document.querySelectorAll('#nuxt-devtools-container, nuxt-devtools-anchor, [id^="nuxt-devtools"]').forEach(e => e.remove()))
}
// A fresh first run every time: no saved home, no saved camera, whisper showing.
await page.goto(url, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await ready()
await page.waitForTimeout(2500) // the shell builds, fonts land

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
  const out = resolve(outDir, `tour_${String(shots.length + 1).padStart(2, '0')}_${slug}.png`)
  await page.screenshot({ path: out })
  shots.push(out)
  console.log('  shot', out.replace(root + '/', ''))
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
  const png = readFileSync(resolve(root, 'public/samples/desktop_2br.png'))
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
const cols = ['sentence', 'ops', 'firstOpMs', 'appliedMs', 'ms', 'wall', 'model', 'error']
const widths = cols.map(c => Math.min(60, Math.max(c.length, ...rows.map(r => String(r[c] ?? '').length))))
const cell = (v, w) => String(v ?? '').slice(0, w).padEnd(w)
console.log('\n' + cols.map((c, i) => cell(c, widths[i])).join(' │ '))
console.log(widths.map(w => '─'.repeat(w)).join('─┼─'))
for (const r of rows) console.log(cols.map((c, i) => cell(r[c], widths[i])).join(' │ '))
console.log(`\n${shots.length} shots in ${outDir.replace(root + '/', '')}`)
if (errors.length) console.log(`browser errors (${errors.length}):\n  ${[...new Set(errors)].slice(0, 12).join('\n  ')}`)

await browser.close()
if (server) {
  try {
    process.kill(-server.pid)
  } catch {
    // already gone
  }
}
