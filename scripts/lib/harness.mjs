// What every browser script needs: flags, a Hearth dev server (reused or booted), a WebGL-capable headless
// Chromium, the scene-ready wait and screenshots. The scripts drive the app through `window.__hearth`
// (app/components/HomeScene.client.vue) or `window.__hearthRenderer` (app/pages/dev/renderer.vue).
import { execSync, spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const SHOTS_DIR = resolve(ROOT, 'internal_docs/20261017_hearth_v0/shots')

/** `--key value` flags: `opt('--port', 3092)` and `has('--keep')`. */
export function flags(argv = process.argv.slice(2)) {
  return {
    argv,
    opt: (k, d) => {
      const i = argv.indexOf(k)
      return i >= 0 ? argv[i + 1] : d
    },
    has: k => argv.includes(k)
  }
}

const wait = ms => new Promise(r => setTimeout(r, ms))

/** A path relative to the repo, for log lines. */
export const rel = (file) => {
  const r = relative(ROOT, file)
  return r.startsWith('..') ? file : r
}

// ---------- the dev server ----------

/** Anything listening on the port: lsof sees non-HTTP listeners, a fetch sees servers bound only to ::1. */
async function portBusy(port) {
  try {
    if (execSync(`lsof -i :${port} -sTCP:LISTEN -t`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()) return true
  } catch { /* nothing listening, or no lsof */ }
  try {
    await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(3000) })
    return true
  } catch {
    return false
  }
}

/**
 * Another project's dev server may own the port, so only reuse one that serves Hearth. The page is
 * client-rendered (no title in the HTML), so the plan reader's "image is required" is the fingerprint.
 */
async function isHearth(port) {
  try {
    const res = await fetch(`http://localhost:${port}/api/plan/extract`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(5000) })
    return res.ok && /image is required/.test(await res.text())
  } catch {
    return false
  }
}

/**
 * A Hearth server on `port`: reused when it is already up, else booted with `nuxt dev` (and stopped by
 * `stop()`). `boot: false` only reuses. A port held by something else throws, or with `nextFree` moves on
 * to the next free port.
 */
export async function devServer({ port, boot = true, nextFree = false }) {
  const found = { port, url: `http://localhost:${port}/`, stop: () => {} }
  if (await isHearth(port)) {
    console.log(`reusing the Hearth dev server on :${port}`)
    return found
  }
  if (!boot) throw new Error(`no Hearth dev server on :${port}`)
  if (await portBusy(port)) {
    if (!nextFree) throw new Error(`port ${port} is busy but is not serving Hearth; pass --port <free port>`)
    while (await portBusy(port)) port++
  }
  console.log(`booting the dev server on :${port}…`)
  const child = spawn('npx', ['nuxt', 'dev', '--port', String(port)], { cwd: ROOT, stdio: 'ignore', detached: true })
  const stop = () => {
    try {
      process.kill(-child.pid)
    } catch { /* already gone */ }
  }
  for (let i = 0; i < 120 && !(await isHearth(port)); i++) await wait(1000)
  if (!(await isHearth(port))) {
    stop()
    throw new Error(`the dev server on :${port} did not come up`)
  }
  return { port, url: `http://localhost:${port}/`, stop }
}

// ---------- the browser ----------

const GL = {
  // Software GL: works anywhere, slow; what a CI box would get.
  swiftshader: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
  // The Mac's GPU, so frame rates mean something.
  metal: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-webgl']
}

export function launch(gl = 'metal') {
  return chromium.launch({ headless: true, args: GL[gl] })
}

/** Collect page errors and console errors; `echo` also prints errors and warnings as they happen. */
export function collectErrors(page, { echo = false } = {}) {
  const errors = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 200))
    if (echo && (m.type() === 'error' || m.type() === 'warning')) console.log('[browser]', m.type(), m.text().slice(0, 200))
  })
  page.on('pageerror', (e) => {
    errors.push(e.message)
    if (echo) console.log('[pageerror]', e.message)
  })
  return errors
}

/** The devtools pill would sit in every shot. */
export function hideDevtools(page) {
  return page.addStyleTag({ content: '[id^="nuxt-devtools"], nuxt-devtools-anchor, .nuxt-devtools-anchor { display: none !important }' })
}

/** The home page's scene is built and the canvas is up; then a beat for the shell and fonts. */
export async function sceneReady(page, settle = 2000) {
  await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 90000 })
  await page.waitForSelector('canvas', { timeout: 30000 })
  await hideDevtools(page)
  await page.waitForTimeout(settle)
}

/** A first run every time: no saved home, no saved camera, the whisper showing. */
export async function freshStart(page, url, settle) {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  await sceneReady(page, settle)
}

export async function screenshot(page, file) {
  mkdirSync(dirname(file), { recursive: true })
  await page.screenshot({ path: file })
  console.log('  shot', rel(file))
  return file
}

/** `tour_07_floor_lamp.png`: numbered shots sort in the order they were taken. */
export function shotFile(dir, prefix, n, slug) {
  return resolve(dir, `${prefix}_${String(n).padStart(2, '0')}_${slug}.png`)
}
