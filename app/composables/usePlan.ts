/**
 * The plan reader on the client: a floor-plan image (file picker, drop or a pasted screenshot) →
 * downscaled on a canvas → POST /api/plan/extract → `useHome().loadPlan`. Keeps the last upload in
 * memory so the Plan panel can show the original beside the rooms the reader found.
 */
import { shallowRef } from 'vue'
import type { FloorPlan } from '#shared/plan/schema'
import { SAMPLES } from '#shared/plan/samples'
import { area } from '#shared/plan/poly'

export type PlanPhase = 'idle' | 'reading' | 'done' | 'error'

export interface ExtractOk {
  ok: true
  plan: FloorPlan
  notes: string[]
  ms: number
  costUsd?: number
}
export interface ExtractFail {
  ok: false
  reason: string
  ms?: number
}
export type ExtractResponse = ExtractOk | ExtractFail

/** Long side the upload is scaled to: plenty for a vision model, a fifth of the bytes of a retina screenshot. */
const MAX_SIDE = 1600
const JPEG_Q = 0.85
/** A PNG this small (and this few pixels) is likely line art: keep it lossless. */
const KEEP_PNG_BYTES = 1_500_000

const phase = shallowRef<PlanPhase>('idle')
const image = shallowRef<string | null>(null)
const imageName = shallowRef('')
const hint = shallowRef('')
const result = shallowRef<ExtractOk | null>(null)
const error = shallowRef('')
/** Wall-clock ms since the read started, ticking while `phase === 'reading'`. */
const elapsed = shallowRef(0)
/** Bumps on every pasted image so the HUD can open the Plan panel. */
const pasted = shallowRef(0)
/** The Plan slideover, shared so a paste or a drop anywhere can open it. */
const panelOpen = shallowRef(false)
let ticker: ReturnType<typeof setInterval> | undefined
let pasteBound = false

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('could not decode the image'))
    img.src = src
  })
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('could not read the file'))
    r.readAsDataURL(blob)
  })
}

/** ≤ 1600 px on the long side, JPEG q0.85, unless it is a small PNG (line art stays crisp and lossless). */
async function downscale(blob: Blob): Promise<string> {
  const original = await readAsDataUrl(blob)
  const img = await loadImage(original)
  const long = Math.max(img.naturalWidth, img.naturalHeight)
  if (blob.type === 'image/png' && blob.size <= KEEP_PNG_BYTES && long <= MAX_SIDE) return original
  const k = Math.min(1, MAX_SIDE / long)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(img.naturalWidth * k))
  canvas.height = Math.max(1, Math.round(img.naturalHeight * k))
  const g = canvas.getContext('2d')
  if (!g) return original
  // Plans are mostly white paper; a white backing keeps transparent PNGs from turning black in the JPEG.
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, canvas.width, canvas.height)
  g.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', JPEG_Q)
}

function startTicker() {
  const t0 = performance.now()
  elapsed.value = 0
  clearInterval(ticker)
  ticker = setInterval(() => {
    elapsed.value = Math.round(performance.now() - t0)
  }, 100)
}
function stopTicker() {
  clearInterval(ticker)
  ticker = undefined
}

/** Send a data URL to the reader; on success the home becomes that plan. Never throws. */
async function extract(dataUrl: string, hintText = hint.value): Promise<ExtractResponse> {
  image.value = dataUrl
  phase.value = 'reading'
  error.value = ''
  startTicker()
  let res: ExtractResponse
  try {
    res = await $fetch<ExtractResponse>('/api/plan/extract', {
      method: 'POST',
      body: { image: dataUrl, hint: hintText.trim() || undefined },
      timeout: 70_000
    })
  } catch (err) {
    res = { ok: false, reason: (err as Error).message || 'network error' }
  }
  stopTicker()
  if (res.ok) {
    result.value = res
    phase.value = 'done'
    useHome().loadPlan(res.plan, { furnish: true })
  } else {
    error.value = res.reason
    phase.value = 'error'
  }
  return res
}

async function fromBlob(blob: Blob, name = ''): Promise<ExtractResponse> {
  if (!blob.type.startsWith('image/')) {
    error.value = 'that is not an image'
    phase.value = 'error'
    return { ok: false, reason: error.value }
  }
  imageName.value = name
  let dataUrl: string
  try {
    dataUrl = await downscale(blob)
  } catch (err) {
    error.value = (err as Error).message
    phase.value = 'error'
    return { ok: false, reason: error.value }
  }
  return extract(dataUrl)
}

/** Stage an image without reading it yet (the panel shows it; Read sends it). */
async function stage(blob: Blob, name = ''): Promise<boolean> {
  if (!blob.type.startsWith('image/')) return false
  try {
    image.value = await downscale(blob)
    imageName.value = name
    result.value = null
    error.value = ''
    phase.value = 'idle'
    return true
  } catch (err) {
    error.value = (err as Error).message
    phase.value = 'error'
    return false
  }
}

/** The staged image through the reader. */
function readStaged(): Promise<ExtractResponse> | null {
  return image.value ? extract(image.value) : null
}

/** A native file picker; resolves once a file is staged (or null if the picker was dismissed). */
function pickImage(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = async () => {
      const f = input.files?.[0] ?? null
      if (f) await stage(f, f.name)
      resolve(f)
    }
    // Safari fires no event on cancel; a focus-back check settles the promise either way.
    window.addEventListener('focus', () => setTimeout(() => resolve(input.files?.[0] ?? null), 400), { once: true })
    input.click()
  })
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  const f = [...(e.dataTransfer?.files ?? [])].find(x => x.type.startsWith('image/'))
  if (f) void stage(f, f.name)
}

/** Cmd-V of a screenshot anywhere on the page stages it (text pastes into the bar still work). */
function onPaste(e: ClipboardEvent) {
  const item = [...(e.clipboardData?.items ?? [])].find(i => i.type.startsWith('image/'))
  const f = item?.getAsFile()
  if (!f) return
  e.preventDefault()
  void stage(f, 'pasted image')
  pasted.value++
}

function listen() {
  if (pasteBound || typeof window === 'undefined') return
  pasteBound = true
  window.addEventListener('paste', onPaste)
}
function unlisten() {
  if (!pasteBound) return
  pasteBound = false
  window.removeEventListener('paste', onPaste)
}

function loadSample(id: string): FloorPlan | null {
  const plan = SAMPLES.find(p => p.id === id)
  if (!plan) return null
  useHome().loadPlan(plan, { furnish: true })
  return plan
}

/** Rooms with their areas, for the panel's table. */
function roomsOf(plan: FloorPlan) {
  return plan.rooms.map(r => ({ id: r.id, name: r.name, type: r.type, m2: Math.round(area(r.polygon) * 10) / 10 }))
}

export function usePlan() {
  return {
    phase, image, imageName, hint, result, error, elapsed, pasted, panelOpen, samples: SAMPLES,
    pickImage, stage, readStaged, extract, fromBlob, onDrop, listen, unlisten, loadSample, roomsOf
  }
}
