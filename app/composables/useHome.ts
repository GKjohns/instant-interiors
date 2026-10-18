/**
 * The app's one home: the pure HomeState, the renderer it drives, and the HUD's history of batches.
 * Everything that changes the home goes through `run`, so the light chips, the history drawer and the
 * model brain (useIntent) share one path: snapshot the gaze → applyBatch → renderer.sync → save.
 * Mirrors conjure's useWorld.
 */
import { shallowRef } from 'vue'
import { applyBatch, createHome, defaultContext, diffStates, exportHome, extendLastBatch, importHome } from '#shared/home/state'
import type { DroppedOp, Op } from '#shared/home/ops'
import type { Batch, BatchResult, Effects, HomeState, OpContext, Vec2 } from '#shared/home/types'
import { KIT } from '#shared/home/kinds'
import type { FloorPlan } from '#shared/plan/schema'
import { TWO_BED_APARTMENT } from '#shared/plan/samples'

const STORAGE_KEY = 'hearth:home:v1'
/** The saved camera (saved on pagehide); a new plan or a reset forgets it so you start at the door. */
export const VIEW_KEY = 'hearth.view'

export type ViewMode = 'walk' | 'plan'

/** The renderer surface the composables code against (app/home/renderer.ts, sprint D1). */
export interface HomeRendererApi {
  camera: { position: { x: number, y: number, z: number } }
  yaw: number
  pitch: number
  mode: ViewMode
  sync(state: HomeState, effects?: Effects): void
  setMode(mode: ViewMode): void
  gaze(): { point: Vec2, itemId?: string, room?: string }
  player(): { pos: Vec2, yaw: number, room?: string }
  look(yaw: number, pitch: number, pos?: Vec2): void
  teleport(pos: Vec2, yaw?: number): void
  spawn(plan: FloorPlan): void
  highlight(itemId: string | null): void
  toScreen(p: Vec2, y?: number): { x: number, y: number, visible: boolean }
  anticipate(point: Vec2 | null): void
  dispose(): void
}

export interface HistoryEntry {
  n: number
  label: string
  ops: Op[]
  dropped: DroppedOp[]
  notes: string[]
  say: string[]
  batchId?: string
  placed: number
  moved: number
  modified: number
  removed: number
  surfaces: number
  light: boolean
  undone: boolean
  /** Who wrote the ops: a HUD control, typed text or the mic. Model runs also carry the model and its latency. */
  source?: RunMeta['source']
  model?: string
  ms?: number
  error?: string
}

export interface RunMeta {
  source?: 'console' | 'text' | 'voice'
  model?: string
  ms?: number
  /** Ops the server already dropped (the client re-parse only sees the survivors). */
  dropped?: DroppedOp[]
  error?: string
}

const state = shallowRef<HomeState>(createHome(TWO_BED_APARTMENT))
const history = shallowRef<HistoryEntry[]>([])
const caption = shallowRef<{ text: string, at: number } | null>(null)
const currentRoom = shallowRef<{ id: string, name: string } | null>(null)
/** The catalog label of the item under the crosshair ("floor lamp"), for the hover tag. */
const gazeLabel = shallowRef('')
const mode = shallowRef<ViewMode>('walk')
let renderer: HomeRendererApi | null = null
let counter = 0
let poll: ReturnType<typeof setInterval> | undefined

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(exportHome(state.value)))
  } catch {
    // Storage full or blocked: the home still works, it just won't survive a reload.
  }
}

function snapshot(): OpContext {
  const fallback = defaultContext(state.value.plan)
  const g = renderer?.gaze()
  const p = renderer?.player()
  return {
    gaze: g ? { point: g.point, itemId: g.itemId, room: g.room } : fallback.gaze,
    player: p ? { pos: p.pos, yaw: p.yaw, room: p.room } : fallback.player,
    seed: Math.floor(Math.random() * 2 ** 31)
  }
}

function commit(next: HomeState, effects: Effects) {
  state.value = next
  renderer?.sync(next, effects)
  if (effects.goto) renderer?.teleport(effects.goto.pos, effects.goto.yaw)
  if (effects.say.length) caption.value = { text: effects.say.join(' '), at: Date.now() }
  save()
}

function entriesOf(log: Batch[], label?: string): HistoryEntry[] {
  return log.map(b => ({
    n: ++counter, label: label ?? b.label, ops: b.ops, dropped: [], notes: [], say: [], batchId: b.id,
    placed: 0, moved: 0, modified: 0, removed: 0, surfaces: 0, light: false, undone: false
  }))
}

/** Apply one batch (one sentence's worth of ops). Accepts `{ ops }`, an array or a single op. */
function run(raw: unknown, label = 'ops', ctx: OpContext = snapshot(), meta: RunMeta = {}): BatchResult {
  const before = state.value
  const res = applyBatch(before, raw, label, ctx)
  let list = history.value
  if (res.effects.reset) {
    // The old log is gone: its history entries go too, so the drawer reads from the fresh furnishing.
    list = entriesOf(res.state.log)
    forgetView()
    renderer?.spawn(res.state.plan)
  }
  const undos = res.ops.filter(o => o.op === 'undo').length
  // Mark undone entries so the drawer reads honestly; batch ids are reused after an undo, so match newest first.
  for (let i = 0; i < undos; i++) {
    const popped = before.log[before.log.length - 1 - i]
    const idx = popped ? findLastIndex(list, h => h.batchId === popped.id && !h.undone) : -1
    if (idx >= 0) list = list.map((h, j) => j === idx ? { ...h, undone: true } : h)
  }
  const entry: HistoryEntry = {
    n: ++counter,
    label,
    ops: res.ops,
    dropped: [...(meta.dropped ?? []), ...res.dropped],
    notes: res.effects.notes,
    say: res.effects.say,
    batchId: res.batch?.id,
    placed: res.effects.placed.length,
    moved: res.effects.moved.length,
    modified: res.effects.modified.length,
    removed: res.effects.removed.length,
    surfaces: res.effects.surfaces.length,
    light: res.effects.light,
    undone: false,
    source: meta.source,
    model: meta.model,
    ms: meta.ms,
    error: meta.error
  }
  history.value = [...list, entry]
  commit(res.state, res.effects)
  return res
}

/**
 * Stream ops into the last batch (a sentence's later ops joining the one its first op opened). Only if
 * that batch is still the last one; returns null otherwise so the caller can open a new batch instead.
 */
function extend(batchId: string, at: number, ops: Op[]): BatchResult | null {
  const s = state.value
  const last = s.log[s.log.length - 1]
  if (!last || last.id !== batchId || last.at !== at) return null
  const res = extendLastBatch(s, batchId, at, ops)
  if (!res) return null
  const idx = findLastIndex(history.value, h => h.batchId === batchId && !h.undone)
  if (idx >= 0) {
    history.value = history.value.map((h, j) => j !== idx
      ? h
      : {
          ...h,
          ops: [...h.ops, ...res.ops],
          notes: [...h.notes, ...res.effects.notes],
          say: [...h.say, ...res.effects.say],
          placed: h.placed + res.effects.placed.length,
          moved: h.moved + res.effects.moved.length,
          modified: h.modified + res.effects.modified.length,
          removed: h.removed + res.effects.removed.length,
          surfaces: h.surfaces + res.effects.surfaces.length,
          light: h.light || res.effects.light
        })
  }
  commit(res.state, res.effects)
  return res
}

function undo() {
  return run([{ op: 'undo' }], 'undo', snapshot(), { source: 'console' })
}

/** Undo every batch after (and including) `batchId`: one run with N undos, so the drawer marks them all. */
function undoTo(batchId: string) {
  const log = state.value.log
  const idx = log.findIndex(b => b.id === batchId)
  if (idx < 0) return null
  const n = log.length - idx
  return run(Array.from({ length: n }, () => ({ op: 'undo' })), n === 1 ? 'undo' : `undo ×${n}`, snapshot(), { source: 'console' })
}

/** "Start over" without a word: the plan's furniture and finishes back to their defaults. Same path as the op. */
function reset() {
  return run([{ op: 'reset' }, { op: 'say', text: 'Back to how it was.' }], 'start over', snapshot(), { source: 'console' })
}

/** A new home from a plan: furnished, walked into from the front door, saved. */
function loadPlan(plan: FloorPlan, opts: { furnish?: boolean } = { furnish: true }) {
  const next = createHome(plan, opts)
  history.value = entriesOf(next.log)
  state.value = next
  renderer?.sync(next, diffStates(createHome(plan), next))
  renderer?.spawn(plan)
  forgetView()
  save()
  return next
}

function load(saved: unknown, label?: string): boolean {
  const next = importHome(saved)
  if (!next) return false
  history.value = entriesOf(next.log, label)
  state.value = next
  renderer?.sync(next, diffStates(createHome(next.base), next))
  renderer?.spawn(next.plan)
  save()
  return true
}

/** The saved home from localStorage, then the saved camera. False when there is nothing saved (a first run). */
function restore(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw || !load(JSON.parse(raw), undefined)) return false
    restoreView()
    return true
  } catch (err) {
    console.warn('[hearth] could not restore the saved home', err)
    return false
  }
}

// ---------- the camera ----------

function saveView() {
  if (!renderer) return
  const p = renderer.camera.position
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ yaw: renderer.yaw, pitch: renderer.pitch, x: p.x, z: p.z, mode: mode.value }))
  } catch {
    // Storage blocked: you just start at the door.
  }
}

function restoreView() {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null') as { yaw: number, pitch: number, x: number, z: number, mode?: ViewMode } | null
    if (v && [v.yaw, v.pitch, v.x, v.z].every(Number.isFinite)) renderer?.look(v.yaw, v.pitch, [v.x, v.z])
  } catch {
    // Nothing saved, or unreadable: keep the spawn view.
  }
}

function forgetView() {
  try {
    localStorage.removeItem(VIEW_KEY)
  } catch {
    // storage blocked: nothing to forget
  }
}

function setMode(m: ViewMode) {
  mode.value = m
  renderer?.setMode(m)
}

function toggleMode() {
  setMode(mode.value === 'walk' ? 'plan' : 'walk')
}

// ---------- files ----------

function exportJson() {
  const blob = new Blob([JSON.stringify(exportHome(state.value), null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
  a.href = URL.createObjectURL(blob)
  a.download = `hearth-${state.value.plan.id}-${stamp}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

async function importJson(file: File): Promise<boolean> {
  const ok = load(JSON.parse(await file.text()), file.name)
  if (ok) forgetView()
  return ok
}

// ---------- the renderer ----------

/** A few times a second: the room you stand in (for the chip) and the item under the crosshair (for the hover tag). */
function tick() {
  if (!renderer) return
  const p = renderer.player()
  const room = p.room ? state.value.plan.rooms.find(r => r.id === p.room) : undefined
  const next = room ? { id: room.id, name: room.name } : null
  if (next?.id !== currentRoom.value?.id) currentRoom.value = next
  const g = renderer.gaze()
  const item = g.itemId ? state.value.items.find(i => i.id === g.itemId) : undefined
  const label = item ? (KIT[item.kind]?.label ?? item.kind.replace(/_/g, ' ')) : ''
  if (label !== gazeLabel.value) {
    gazeLabel.value = label
    renderer.highlight(item ? item.id : null)
  }
}

function attach(r: HomeRendererApi) {
  renderer = r
  r.sync(state.value, diffStates(createHome(state.value.base), state.value))
  r.setMode(mode.value)
  clearInterval(poll)
  poll = setInterval(tick, 150)
}

function detach() {
  clearInterval(poll)
  poll = undefined
  renderer = null
}

function findLastIndex<T>(list: T[], fn: (x: T) => boolean): number {
  for (let i = list.length - 1; i >= 0; i--) if (fn(list[i]!)) return i
  return -1
}

export function useHome() {
  return {
    state, history, caption, currentRoom, gazeLabel, mode,
    run, extend, undo, undoTo, reset, loadPlan, load, restore, save, saveView, snapshot,
    setMode, toggleMode, exportJson, importJson, attach, detach,
    renderer: () => renderer
  }
}
