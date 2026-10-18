/**
 * The op brain on the client: a sentence plus the gaze snapshot taken when the player STARTED typing or
 * speaking (the deictic rule: "there" is where you were looking when you said it) → /api/intent → the
 * same `useHome().run` path the HUD controls use. `build(request, ctx, source)` is the one entry point;
 * the text bar and the browser mic both call it. Mirrors conjure's useIntent.
 */
import { shallowRef } from 'vue'
import { trimScene } from '#shared/home/context'
import { honestSay } from '#shared/home/state'
import type { DroppedOp, Op } from '#shared/home/ops'
import type { BatchResult, OpContext } from '#shared/home/types'

export type IntentPhase = 'idle' | 'listening' | 'thinking' | 'building'
export type IntentModel = 'haiku' | 'sonnet'

export interface IntentOutcome {
  ok: boolean
  /** One honest line: "placed 1 floor lamp · moved 1 · said “Done.”". */
  summary: string
  say?: string
  ops: Op[]
  dropped: DroppedOp[]
  /** Why ops did nothing ("move: nothing matches sofa in the kitchen"). */
  notes: string[]
  model?: string
  /** Server-side model time to the first op. */
  firstOpMs?: number
  /** Client time from the request to the first op applied in the home. */
  firstAppliedMs?: number
  ms: number
  error?: string
}

type IntentEvent
  = | { t: 'op', op: Op, ms: number, i: number }
    | { t: 'drop', dropped: DroppedOp }
    | { t: 'done', ms: number, model: string, count: number, firstOpMs?: number, error?: string }

const MODEL_KEY = 'hearth.model'
const phase = shallowRef<IntentPhase>('idle')
const inflight = shallowRef(0)
const interim = shallowRef('')
const error = shallowRef('')
const model = shallowRef<IntentModel>('haiku')
const micSupported = shallowRef(false)
const micOn = shallowRef(false)
/** The sentences in flight, so the HUD can show what's being built while the pill says thinking. */
const pendingText = shallowRef<string[]>([])
/** How many sentences this browser has sent, ever (the first-run whisper goes after the first). */
const sent = shallowRef(0)
let buildingTimer: ReturnType<typeof setTimeout> | undefined
let pending: OpContext | null = null
let recognition: SpeechRecognitionLike | null = null
let loaded = false

function loadPrefs() {
  if (loaded || typeof window === 'undefined') return
  loaded = true
  try {
    const m = localStorage.getItem(MODEL_KEY)
    if (m === 'haiku' || m === 'sonnet') model.value = m
    sent.value = Number(localStorage.getItem('hearth.sent') ?? 0) || 0
  } catch {
    // storage blocked: defaults
  }
}

function setModel(m: IntentModel) {
  model.value = m
  try {
    localStorage.setItem(MODEL_KEY, m)
  } catch {
    // not persisted; fine
  }
}

function setPhase(p: IntentPhase) {
  clearTimeout(buildingTimer)
  phase.value = p
  if (p === 'building') {
    // Arrivals stagger for about a second; then the pill settles back.
    buildingTimer = setTimeout(() => {
      phase.value = inflight.value ? 'thinking' : recognition ? 'listening' : 'idle'
    }, 1400)
  }
}

function restPhase(): IntentPhase {
  return inflight.value ? 'thinking' : recognition ? 'listening' : 'idle'
}

/** Freeze where the player is looking now and start the soft glow there while they type or talk. */
function capture(): OpContext {
  const home = useHome()
  const ctx = home.snapshot()
  home.renderer()?.anticipate(ctx.gaze.point)
  return ctx
}

/** Let the glow go, unless another sentence is being typed or is still in flight. */
function release() {
  if (pending || inflight.value) return
  useHome().renderer()?.anticipate(null)
}

/** The text bar calls this on the first keystroke of a sentence; `takeSnapshot` hands the snapshot to `build`. */
function beginTyping() {
  if (!pending) pending = capture()
}
function cancelTyping() {
  pending = null
  release()
}
function takeSnapshot(): OpContext {
  const ctx = pending ?? capture()
  pending = null
  return ctx
}

function summarize(placed: string[], moved: number, modified: number, removed: number, other: string[]): string {
  const kinds = new Map<string, number>()
  for (const id of placed) {
    const k = id.split('#')[0]!.replace(/_/g, ' ')
    kinds.set(k, (kinds.get(k) ?? 0) + 1)
  }
  const bits: string[] = []
  if (kinds.size) bits.push(`placed ${[...kinds].map(([k, n]) => `${n} ${k}`).join(', ')}`)
  if (moved) bits.push(`moved ${moved}`)
  if (modified) bits.push(`restyled ${modified}`)
  if (removed) bits.push(`removed ${removed}`)
  bits.push(...other)
  return bits.join(' · ') || 'nothing changed'
}

/** Read an NDJSON response line by line. Throws on a network failure mid-stream. */
async function readNdjson<T>(res: Response, onLine: (ev: T) => void) {
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let buf = ''
  const flush = (line: string) => {
    if (!line.trim()) return
    try {
      onLine(JSON.parse(line) as T)
    } catch (err) {
      console.warn('[intent] bad line', line.slice(0, 120), err)
    }
  }
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let nl = buf.indexOf('\n')
    while (nl >= 0) {
      flush(buf.slice(0, nl))
      buf = buf.slice(nl + 1)
      nl = buf.indexOf('\n')
    }
  }
  flush(buf)
}

/**
 * One request → ops → the home, streamed: each op is applied the moment the server sees its JSON object
 * close, so the first one lands before the model has finished. All of a sentence's ops share ONE batch
 * (the first home-changing op opens it with `run`, the rest join it with `extend`), so one "undo" still
 * takes back the whole sentence. `ctx` must be the snapshot from when the request STARTED (typing or
 * speech start). Never throws; resolves with an honest one-line outcome once the answer has ended.
 */
async function build(request: string, ctx: OpContext, source: 'text' | 'voice' = 'text'): Promise<IntentOutcome> {
  const text = request.trim()
  if (!text) return { ok: false, summary: 'empty request', ops: [], dropped: [], notes: [], ms: 0, error: 'empty request' }
  const home = useHome()
  error.value = ''
  inflight.value++
  pendingText.value = [...pendingText.value, text]
  sent.value++
  try {
    localStorage.setItem('hearth.sent', String(sent.value))
  } catch {
    // not persisted; fine
  }
  setPhase('thinking')
  let settled = false
  const done = () => {
    if (settled) return
    settled = true
    inflight.value--
    const i = pendingText.value.indexOf(text)
    pendingText.value = pendingText.value.filter((_, j) => j !== i)
  }
  const started = performance.now()
  // The glow holds (or starts, for a voice wish whose speech-start glow already let go) until something lands.
  home.renderer()?.anticipate(ctx.gaze.point)

  // What this sentence did, summed over every run/extend.
  const placed = new Set<string>()
  const moved = new Set<string>()
  const modified = new Set<string>()
  const removed = new Set<string>()
  const other: string[] = []
  const notes: string[] = []
  const says: string[] = []
  const applied: Op[] = []
  const dropped: DroppedOp[] = []
  /** The sentence's batch once a home-changing op opened it; the history entries this sentence wrote. */
  let target: { id: string, at: number } | null = null
  const entries: number[] = []
  /** `say` ops that arrive before anything opened a batch (says come last, so this is rare). */
  let held: Op[] = []
  let firstAppliedMs: number | undefined

  const absorb = (out: BatchResult) => {
    const fx = out.effects
    fx.placed.forEach(id => placed.add(id))
    fx.moved.forEach(id => moved.add(id))
    fx.modified.forEach(id => modified.add(id))
    fx.removed.forEach(id => removed.add(id))
    const rooms = [...new Set(fx.surfaces.map(s => s.split(':')[0]))]
    if (rooms.length) other.push(`finished ${rooms.join(', ')}`)
    if (fx.light && !other.some(o => o.startsWith('light'))) other.push(`light → ${out.state.light.time}${out.state.light.lamps ? ', lamps on' : ''}`)
    if (fx.goto) other.push(`walked to ${fx.goto.room ?? 'the spot'}`)
    if (out.ops.some(o => o.op === 'undo')) other.push('undid the last change')
    if (fx.reset) other.push('started over')
    notes.push(...fx.notes)
    // A say that joins a batch skipped the kernel's honesty pass (it ran before the say arrived): run it here
    // over everything this sentence did, so the caption never claims four chairs when one fit.
    says.push(...fx.say.map(t => honestSay(t, changedSoFar(), notes)))
    applied.push(...out.ops)
  }
  const changedSoFar = () => placed.size + moved.size + modified.size + removed.size > 0 || other.length > 0
  const open = (ops: Op[], label: string) => {
    const out = home.run(ops, label, ctx, { source })
    const entry = home.history.value[home.history.value.length - 1]
    if (entry) entries.push(entry.n)
    if (out.batch) target = { id: out.batch.id, at: out.batch.at }
    else if (out.effects.reset) target = null
    absorb(out)
  }
  const apply = (op: Op) => {
    if (op.op === 'say' && !target && !entries.length) {
      held.push(op)
      return
    }
    // Undo and reset never join a batch (extendLastBatch drops them): they always run on their own.
    const out = target && op.op !== 'undo' && op.op !== 'reset' ? home.extend(target.id, target.at, [op]) : null
    if (out) {
      if (out.batch) target = { id: out.batch.id, at: out.batch.at }
      const from = says.length
      absorb(out)
      if (out.effects.say.length) home.caption.value = { text: says.slice(from).join(' '), at: Date.now() }
    } else if (op.op === 'say') {
      // A say with no batch to join (the sentence changed nothing, or the batch is no longer last): caption
      // it, through the same honesty filter as a batch's lines.
      const line = honestSay(op.text, changedSoFar(), notes)
      says.push(line)
      applied.push(op)
      home.caption.value = { text: line, at: Date.now() }
    } else {
      open([...held, op], target || entries.length ? `${text} (cont.)` : text)
      held = []
    }
    if (changedSoFar()) {
      firstAppliedMs ??= Math.round(performance.now() - started)
      setPhase('building')
    }
  }

  let end: Extract<IntentEvent, { t: 'done' }> | undefined
  let netError: string | undefined
  try {
    const res = await fetch(`/api/intent${model.value === 'haiku' ? '' : `?model=${model.value}`}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, state: trimScene(home.state.value), ctx })
    })
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`)
    await readNdjson<IntentEvent>(res, (ev) => {
      if (ev.t === 'op') apply(ev.op)
      else if (ev.t === 'drop') dropped.push(ev.dropped)
      else end = ev
    })
  } catch (err) {
    netError = (err as Error).message
  }
  done()
  if (held.length) open(held, text)
  release()
  const ms = end?.ms ?? Math.round(performance.now() - started)
  const failure = netError ?? end?.error ?? (end ? undefined : 'the stream ended early')
  if (!entries.length) {
    // Nothing applied: still log the sentence so the drawer shows what went wrong.
    home.run({ ops: [] }, text, ctx, { source, model: end?.model, ms, dropped, error: failure })
    const msg = netError ? `Couldn't reach the genie: ${netError}` : failure ? `The genie stumbled: ${failure}` : 'nothing changed'
    if (failure) error.value = msg
    setPhase(restPhase())
    return { ok: false, summary: msg, ops: applied, dropped, notes, say: says.join(' ') || undefined, model: end?.model, ms, error: failure }
  }
  // Stamp the model, latency and server-side drops onto this sentence's log entries.
  home.history.value = home.history.value.map(h => !entries.includes(h.n)
    ? h
    : { ...h, model: end?.model, ms, error: failure, ...(h.n === entries[0] ? { dropped: [...dropped, ...h.dropped] } : {}) })

  const changed = changedSoFar()
  if (!changed && phase.value !== 'building') setPhase(restPhase())
  // A late batch (held says) can land after the last op: never leave the pill stuck on thinking.
  if (phase.value === 'thinking' && !inflight.value) setPhase(changed ? 'building' : restPhase())
  const why = [...notes.filter(n => !n.startsWith('undid')), ...dropped.map(d => `dropped an op: ${d.reason}`)]
  // An undo's diff is the reversal (the furniture it took back shows up as "removed"): the honest line is the note.
  const undid = applied.some(o => o.op === 'undo') && !applied.some(o => o.op !== 'undo' && o.op !== 'say')
  const summary = undid
    ? (notes.find(n => n.startsWith('undid')) ?? 'undid the last change')
    : summarize([...placed], [...moved].filter(id => !placed.has(id)).length, [...modified].filter(id => !placed.has(id)).length, removed.size, other)
  return {
    ok: changed,
    summary: summary + (why.length ? ` (${why.slice(0, 2).join('; ')})` : ''),
    say: says.join(' ') || undefined,
    ops: applied,
    dropped,
    notes,
    model: end?.model,
    firstOpMs: end?.firstOpMs,
    firstAppliedMs,
    ms,
    error: failure
  }
}

// ---------- the browser mic ----------

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onspeechstart: (() => void) | null
  onresult: ((e: { resultIndex: number, results: ArrayLike<{ isFinal: boolean, 0: { transcript: string } }> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}

function recognizer(): (new () => SpeechRecognitionLike) | undefined {
  const w = window as unknown as Record<string, unknown>
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => SpeechRecognitionLike) | undefined
}

function detectMic() {
  micSupported.value = typeof window !== 'undefined' && !!recognizer()
}

function startMic() {
  const Ctor = recognizer()
  if (!Ctor || recognition) return
  const rec = new Ctor()
  rec.lang = 'en-US'
  rec.continuous = true
  rec.interimResults = true
  let speechCtx: OpContext | null = null
  rec.onspeechstart = () => {
    // The deictic moment: freeze the gaze as soon as the voice starts, not when the sentence ends.
    speechCtx = capture()
  }
  rec.onresult = (e) => {
    let partial = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]!
      const said = r[0].transcript
      if (r.isFinal) {
        interim.value = ''
        const ctx = speechCtx ?? capture()
        speechCtx = null
        void build(said, ctx, 'voice')
      } else {
        // Chrome fires onspeechstart once per session; a new utterance's first partial re-arms the snapshot.
        if (!speechCtx) speechCtx = capture()
        partial += said
      }
    }
    if (partial) interim.value = partial
  }
  rec.onerror = (e) => {
    if (e.error !== 'no-speech' && e.error !== 'aborted') error.value = `Mic: ${e.error}`
  }
  rec.onend = () => {
    recognition = null
    micOn.value = false
    interim.value = ''
    if (phase.value === 'listening') setPhase('idle')
  }
  recognition = rec
  micOn.value = true
  error.value = ''
  setPhase('listening')
  rec.start()
}

function stopMic() {
  recognition?.stop()
  recognition = null
  micOn.value = false
  interim.value = ''
  if (phase.value === 'listening') setPhase('idle')
}

function toggleMic() {
  if (recognition) stopMic()
  else startMic()
}

export function useIntent() {
  loadPrefs()
  return {
    phase, inflight, interim, error, model, micSupported, micOn, pendingText, sent,
    build, beginTyping, cancelTyping, takeSnapshot, capture, release, setModel,
    detectMic, startMic, stopMic, toggleMic
  }
}
