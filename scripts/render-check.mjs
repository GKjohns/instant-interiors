// Renders the sample apartment through app/pages/dev/renderer.vue and screenshots the views that matter:
// living room by morning, the kitchen through its opening, the primary bedroom at night with lamps, the
// plan (dollhouse) view, and the living room after a wallpaper change. Reports console errors (WebGL,
// three) and the frame rate. Reuses a hearth dev server on --port (default 3092) when one is there,
// otherwise boots `npm run dev` on the next free port.
//   node scripts/render-check.mjs [--port 3092] [--keep]
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const argOf = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d)
const WANT = Number(argOf('--port', 3092))
const OUT = path.resolve('internal_docs/20261017_hearth_v0/shots')
const SIZE = { width: 1440, height: 900 }

/** Something answers HTTP on the port (a socket probe misses servers bound only to ::1). */
async function busy(port) {
  try {
    await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(3000) })
    return true
  } catch {
    return false
  }
}

async function waitFor(url, ms) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url)
      if (r.ok) return true
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 500))
  }
  return false
}

/** True when the server on `port` is this app: the harness page registers `__hearthRenderer`. */
async function isHearth(browser, port) {
  const page = await browser.newPage({ viewport: SIZE })
  try {
    await page.goto(`http://localhost:${port}/dev/renderer`, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await page.waitForFunction(() => !!window.__hearthRenderer, null, { timeout: 20000 })
    return true
  } catch {
    return false
  } finally {
    await page.close()
  }
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'] })
  let port = WANT
  let child = null
  if (!(await busy(port)) || !(await isHearth(browser, port))) {
    while (await busy(port)) port++
    console.log(`starting nuxt dev on :${port}`)
    child = spawn('npx', ['nuxt', 'dev', '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env })
    child.stderr.on('data', d => process.stderr.write(d))
    if (!(await waitFor(`http://localhost:${port}/dev/renderer`, 120000))) throw new Error('dev server did not come up')
  } else console.log(`reusing hearth dev server on :${port}`)

  const page = await browser.newPage({ viewport: SIZE, deviceScaleFactor: 1 })
  const problems = []
  page.on('console', (m) => {
    const text = m.text()
    if (m.type() === 'error' || /WebGL|THREE\./.test(text)) problems.push(`[${m.type()}] ${text.slice(0, 300)}`)
  })
  page.on('pageerror', e => problems.push(`[pageerror] ${e.message}`))
  await page.goto(`http://localhost:${port}/dev/renderer`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!window.__hearthRenderer, null, { timeout: 60000 })
  // The devtools pill would sit in every shot.
  await page.addStyleTag({ content: '#nuxt-devtools-container, .nuxt-devtools-anchor { display: none !important }' })
  // First frames compile shaders; give the pop-in tweens time to land before measuring anything.
  await page.waitForTimeout(2500)

  const shot = async (name, setup, settle = 900) => {
    await page.evaluate(setup)
    await page.waitForTimeout(settle)
    const file = path.join(OUT, `renderer_${name}.png`)
    await page.screenshot({ path: file })
    const g = await page.evaluate(() => ({ gaze: window.__hearthRenderer.gaze(), player: window.__hearthRenderer.player() }))
    console.log(`${name}: ${file}  gaze=${JSON.stringify(g.gaze)} player=${JSON.stringify(g.player)}`)
  }

  // 1. Living room, morning: from the south-east corner looking across the seating toward the north window.
  await shot('living_morning', () => {
    const h = window.__hearthRenderer
    h.setLight('morning', false)
    h.setMode('walk')
    h.look(0.68, -0.04, [4.8, 4.0])
  }, 1200)
  // 2. From the living room looking into the kitchen through the wide opening.
  await shot('kitchen', () => {
    const h = window.__hearthRenderer
    h.look(-Math.PI / 2 + 0.25, -0.03, [3.2, 1.6])
  })
  // 3. Primary bedroom at night, lamps on: from the south-east corner toward the bed. The first night frame
  //    recompiles every shader for the point lights, so settle longer and read the steady frame rate.
  await shot('primary_night', () => {
    const h = window.__hearthRenderer
    h.setLight('night', true, 0.7)
    h.look(0.9, -0.05, [5.5, 7.0])
  }, 2600)
  const nightFps = await page.evaluate(() => window.__hearthRenderer.fps())
  console.log(`fps at night with lamps (steady): ${nightFps}`)
  // 4. The plan view (dollhouse), afternoon.
  await shot('plan', () => {
    const h = window.__hearthRenderer
    h.setLight('afternoon', false)
    h.setMode('plan')
  }, 1200)
  // 5. Back on foot after wallpapering the living room in a soft green floral.
  await shot('living_floral', () => {
    const h = window.__hearthRenderer
    h.setMode('walk')
    h.paint('living', 'walls', { color: '#9fb79a', pattern: 'floral', accent: '#5f7d5a' })
    h.look(-0.6, 0.0, [1.0, 4.0])
  }, 1200)
  // 6. Golden hour: the living room's west window with the low sun coming straight through it.
  await shot('golden_west', () => {
    const h = window.__hearthRenderer
    h.setLight('golden', false)
    h.look(Math.PI / 2 + 0.15, 0.02, [4.6, 2.3])
  }, 1200)

  // 7. Hover emphasis on the sofa plus the anticipation glow where a sentence is pointing.
  await shot('highlight', () => {
    const h = window.__hearthRenderer
    h.setLight('afternoon', false)
    const sofa = h.state.items.find(i => i.kind === 'sofa')
    h.highlight(sofa ? sofa.id : null)
    h.anticipate([2.75, 2.4])
    h.look(1.05, -0.25, [4.6, 4.0])
  }, 1200)
  await page.evaluate(() => {
    window.__hearthRenderer.highlight(null)
    window.__hearthRenderer.anticipate(null)
  })

  // Item diff paths, headless: move the armchair (tween), remove the plant, then move it back.
  await page.evaluate(() => {
    const h = window.__hearthRenderer
    const chair = h.state.items.find(i => i.kind === 'armchair' && i.room === 'living')
    if (chair) h.move(chair.id, [chair.pos[0] - 0.4, chair.pos[1] + 0.3], chair.yaw + 0.5)
    const plant = h.state.items.find(i => i.kind === 'plant')
    if (plant) h.remove(plant.id)
  })
  await page.waitForTimeout(600)

  // Frame rate over two seconds of walking (W held) in the living room.
  await page.evaluate(() => window.__hearthRenderer.look(Math.PI * 0.7, 0, [4.6, 3.9]))
  await page.keyboard.down('w')
  await page.waitForTimeout(2200)
  await page.keyboard.up('w')
  const fps = await page.evaluate(() => window.__hearthRenderer.fps())
  const after = await page.evaluate(() => window.__hearthRenderer.player())
  console.log(`fps while walking: ${fps}; walked to ${JSON.stringify(after)}`)

  // Collision: walk straight at the living room's west wall and make sure we stop short of it.
  await page.evaluate(() => window.__hearthRenderer.look(Math.PI / 2, 0, [1.2, 2.5]))
  await page.keyboard.down('w')
  await page.waitForTimeout(1500)
  await page.keyboard.up('w')
  const atWall = await page.evaluate(() => window.__hearthRenderer.player())
  console.log(`collision: x=${atWall.pos[0]} (wall at 0; expect ≈ 0.42) ${atWall.pos[0] > 0.3 && atWall.pos[0] < 0.6 ? 'ok' : 'FAIL'}`)
  // Doorway: walk from the hall through the primary bedroom door.
  await page.evaluate(() => window.__hearthRenderer.look(Math.PI / 2, 0, [7.0, 6.0]))
  await page.keyboard.down('w')
  await page.waitForTimeout(1500)
  await page.keyboard.up('w')
  const through = await page.evaluate(() => window.__hearthRenderer.player())
  console.log(`doorway: ${JSON.stringify(through)} ${through.room === 'primary' ? 'ok' : 'FAIL'}`)

  const errors = [...new Set(problems)]
  console.log(errors.length ? `console problems (${errors.length}):\n  ${errors.join('\n  ')}` : 'console: clean')
  if (!args.includes('--keep')) {
    await browser.close()
    child?.kill()
  }
  process.exit(errors.some(e => /WebGL|pageerror/.test(e)) ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
