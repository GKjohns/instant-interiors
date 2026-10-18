// Renders the sample apartment through app/pages/dev/renderer.vue and screenshots the views that matter:
// living room by morning, the kitchen through its opening, the primary bedroom at night with lamps, the
// plan (dollhouse) view, and the living room after a wallpaper change. Reports console errors (WebGL,
// three) and the frame rate. Reuses a Instant Interiors dev server on --port (default 3092) when one is there,
// otherwise boots one on the next free port.
//   node scripts/render-check.mjs [--port 3092] [--keep]
import { resolve } from 'node:path'
import { SHOTS_DIR, devServer, flags, hideDevtools, launch, screenshot } from './lib/harness.mjs'

const { opt, has } = flags()
const SIZE = { width: 1440, height: 900 }

async function main() {
  const server = await devServer({ port: Number(opt('--port', 3092)), nextFree: true })
  const browser = await launch('metal')
  const page = await browser.newPage({ viewport: SIZE, deviceScaleFactor: 1 })
  const problems = []
  page.on('console', (m) => {
    const text = m.text()
    if (m.type() === 'error' || /WebGL|THREE\./.test(text)) problems.push(`[${m.type()}] ${text.slice(0, 300)}`)
  })
  page.on('pageerror', e => problems.push(`[pageerror] ${e.message}`))
  await page.goto(new URL('/dev/renderer', server.url).href, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!window.__iiRenderer, null, { timeout: 60000 })
  await hideDevtools(page)
  // First frames compile shaders; give the pop-in tweens time to land before measuring anything.
  await page.waitForTimeout(2500)

  const shot = async (name, setup, settle = 900) => {
    await page.evaluate(setup)
    await page.waitForTimeout(settle)
    await screenshot(page, resolve(SHOTS_DIR, `renderer_${name}.png`))
    const g = await page.evaluate(() => ({ gaze: window.__iiRenderer.gaze(), player: window.__iiRenderer.player() }))
    console.log(`  ${name}: gaze=${JSON.stringify(g.gaze)} player=${JSON.stringify(g.player)}`)
  }

  // 1. Living room, morning: from the south-east corner looking across the seating toward the north window.
  await shot('living_morning', () => {
    const h = window.__iiRenderer
    h.setLight('morning', false)
    h.setMode('walk')
    h.look(0.68, -0.04, [4.8, 4.0])
  }, 1200)
  // 2. From the living room looking into the kitchen through the wide opening.
  await shot('kitchen', () => {
    const h = window.__iiRenderer
    h.look(-Math.PI / 2 + 0.25, -0.03, [3.2, 1.6])
  })
  // 3. Primary bedroom at night, lamps on: from the south-east corner toward the bed. The first night frame
  //    recompiles every shader for the point lights, so settle longer and read the steady frame rate.
  await shot('primary_night', () => {
    const h = window.__iiRenderer
    h.setLight('night', true, 0.7)
    h.look(0.9, -0.05, [5.5, 7.0])
  }, 2600)
  const nightFps = await page.evaluate(() => window.__iiRenderer.fps())
  console.log(`fps at night with lamps (steady): ${nightFps}`)
  // 4. The plan view (dollhouse), afternoon.
  await shot('plan', () => {
    const h = window.__iiRenderer
    h.setLight('afternoon', false)
    h.setMode('plan')
  }, 1200)
  // 5. Back on foot after wallpapering the living room in a soft green floral.
  await shot('living_floral', () => {
    const h = window.__iiRenderer
    h.setMode('walk')
    h.paint('living', 'walls', { color: '#9fb79a', pattern: 'floral', accent: '#5f7d5a' })
    h.look(-0.6, 0.0, [1.0, 4.0])
  }, 1200)
  // 6. Golden hour: the living room's west window with the low sun coming straight through it.
  await shot('golden_west', () => {
    const h = window.__iiRenderer
    h.setLight('golden', false)
    h.look(Math.PI / 2 + 0.15, 0.02, [4.6, 2.3])
  }, 1200)

  // 7. Hover emphasis on the sofa plus the anticipation glow where a sentence is pointing.
  await shot('highlight', () => {
    const h = window.__iiRenderer
    h.setLight('afternoon', false)
    const sofa = h.state.items.find(i => i.kind === 'sofa')
    h.highlight(sofa ? sofa.id : null)
    h.anticipate([2.75, 2.4])
    h.look(1.05, -0.25, [4.6, 4.0])
  }, 1200)
  await page.evaluate(() => {
    window.__iiRenderer.highlight(null)
    window.__iiRenderer.anticipate(null)
  })

  // Item diff paths, headless: move the armchair (tween), remove the plant, then move it back.
  await page.evaluate(() => {
    const h = window.__iiRenderer
    const chair = h.state.items.find(i => i.kind === 'armchair' && i.room === 'living')
    if (chair) h.move(chair.id, [chair.pos[0] - 0.4, chair.pos[1] + 0.3], chair.yaw + 0.5)
    const plant = h.state.items.find(i => i.kind === 'plant')
    if (plant) h.remove(plant.id)
  })
  await page.waitForTimeout(600)

  // Frame rate over two seconds of walking (W held) in the living room.
  await page.evaluate(() => window.__iiRenderer.look(Math.PI * 0.7, 0, [4.6, 3.9]))
  await page.keyboard.down('w')
  await page.waitForTimeout(2200)
  await page.keyboard.up('w')
  const fps = await page.evaluate(() => window.__iiRenderer.fps())
  const after = await page.evaluate(() => window.__iiRenderer.player())
  console.log(`fps while walking: ${fps}; walked to ${JSON.stringify(after)}`)

  // Collision: walk straight at the living room's west wall and make sure we stop short of it.
  await page.evaluate(() => window.__iiRenderer.look(Math.PI / 2, 0, [1.2, 2.5]))
  await page.keyboard.down('w')
  await page.waitForTimeout(1500)
  await page.keyboard.up('w')
  const atWall = await page.evaluate(() => window.__iiRenderer.player())
  console.log(`collision: x=${atWall.pos[0]} (wall at 0; expect ≈ 0.42) ${atWall.pos[0] > 0.3 && atWall.pos[0] < 0.6 ? 'ok' : 'FAIL'}`)
  // Doorway: walk from the hall through the primary bedroom door.
  await page.evaluate(() => window.__iiRenderer.look(Math.PI / 2, 0, [7.0, 6.0]))
  await page.keyboard.down('w')
  await page.waitForTimeout(1500)
  await page.keyboard.up('w')
  const through = await page.evaluate(() => window.__iiRenderer.player())
  console.log(`doorway: ${JSON.stringify(through)} ${through.room === 'primary' ? 'ok' : 'FAIL'}`)

  const errors = [...new Set(problems)]
  console.log(errors.length ? `console problems (${errors.length}):\n  ${errors.join('\n  ')}` : 'console: clean')
  if (!has('--keep')) {
    await browser.close()
    server.stop()
  }
  process.exit(errors.some(e => /WebGL|pageerror/.test(e)) ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
