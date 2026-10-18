/**
 * The home kernel: a plain HomeState and a pure `applyOp`. The op log is the home; replaying it over the
 * plan rebuilds the same furniture and finishes (positions are seeded from each batch's stored context),
 * which is how undo, save and load all work. No three.js here, so tests and the server can use it.
 */
import { hashSeed, round3 } from '../math.ts'
import { yawToward } from '../plan/poly.ts'
import { FloorPlanSchema, defaultSurfaces } from '../plan/schema.ts'
import type { FloorPlan, Room, Surface } from '../plan/schema.ts'
import { doorsOf, entry, longestEdge, planBounds, roomCenter, windowsOf } from '../plan/geometry.ts'
import { FURNISH, kindOf, styleOf } from './kinds.ts'
import type { KindDescriptor } from './kinds.ts'
import { describeSel, poseBefore, resolveSpot } from './layout.ts'
import type { Placed } from './layout.ts'
import { parseOps } from './ops.ts'
import type { DroppedOp, Op, Props } from './ops.ts'
import { footprintOf, kindOfItem, resolveRoom, select } from './select.ts'
import type { Batch, BatchResult, Effects, HomeState, Item, OpContext } from './types.ts'

const HOME_VERSION = 1

export interface SavedHome {
  v: number
  plan: FloorPlan
  log: Batch[]
}

export function createHome(plan: FloorPlan, opts: { furnish?: boolean } = {}): HomeState {
  const s: HomeState = { plan, base: plan, items: [], light: { time: 'afternoon', lamps: false, warmth: 0.5 }, log: [], nextId: 1, nextGroup: 1, lastGroup: null }
  if (!opts.furnish) return s
  return applyBatch(s, [{ op: 'furnish', room: 'all' }], 'furnished', defaultContext(plan)).state
}

/** The context a home is furnished with before anyone stands in it: at the front door, looking at the middle. */
export function defaultContext(plan: FloorPlan): OpContext {
  const e = entry(plan)
  return { gaze: { point: planBounds(plan).center }, player: { pos: e.pos, yaw: e.yaw, room: e.room }, seed: hashSeed(plan.id, 'furnish') }
}

function emptyEffects(): Effects {
  return { placed: [], moved: [], modified: [], removed: [], surfaces: [], light: false, reset: false, say: [], notes: [] }
}

interface StepResult {
  state: HomeState
  notes: string[]
  say?: string
  goto?: Effects['goto']
  surfaces?: string[]
}

/** Apply one strict op. Pure: a new state plus what the renderer should animate. Placements join the in-progress batch `g<nextGroup>`. */
export function applyOp(state: HomeState, op: Op, ctx: OpContext): { state: HomeState, effects: Effects } {
  const res = step(state, op, ctx, 0)
  const effects = diffStates(state, res.state)
  if (res.say) effects.say.push(res.say)
  effects.notes.push(...res.notes)
  if (res.goto) effects.goto = res.goto
  if (op.op === 'reset') effects.reset = true
  return { state: res.state, effects }
}

function step(state: HomeState, op: Op, ctx: OpContext, index: number): StepResult {
  const group = `g${state.nextGroup}`
  switch (op.op) {
    case 'place': {
      const desc = kindOf(op.kind)
      if (!desc) return { state, notes: [`I don't have a ${op.kind.replace(/_/g, ' ')} yet`] }
      const count = op.count ?? 1
      const res = resolveSpot(state, op.at, desc, ctx, { index, count, arrange: op.arrange, seed: ctx.seed, existing: state.items, props: op.set })
      if ('fail' in res) {
        // "A big mirror" at 1.5× fits no wall of a door-riddled hall; at its own size it does. Say so, don't refuse.
        if ((op.set?.scale ?? 1) > 1) {
          const set = Object.fromEntries(Object.entries(op.set!).filter(([k]) => k !== 'scale')) as Props
          const again = resolveSpot(state, op.at, desc, ctx, { index, count, arrange: op.arrange, seed: ctx.seed, existing: state.items, props: set })
          if (!('fail' in again)) return { state: addItems(state, desc, again, set, group), notes: [`place: no room for a bigger ${desc.label}, so it's the usual size${again.note ? `; ${again.note}` : ''}`] }
        }
        return { state, notes: [`place: ${res.fail}`] }
      }
      const notes = res.length < count ? [`only room for ${res.length} of ${count} ${desc.label}s`] : []
      if (res.note) notes.unshift(`place: ${res.note}`)
      return { state: addItems(state, desc, res, op.set, group), notes }
    }

    case 'move': {
      const targets = select(state, op.target, ctx)
      if (!targets.length) return { state, notes: [`move: nothing matches ${describeSel(op.target)}`] }
      const ids = new Set(targets.map(t => t.id))
      let existing = state.items.filter(i => !ids.has(i.id))
      const moved = new Map<string, Item>()
      const notes: string[] = []
      let why: string | undefined
      // Same kinds move together so a row stays a row; the spot is resolved without the movers in the way.
      for (const list of groupByKind(targets).values()) {
        const desc = kindOfItem(list[0]!)
        if (!desc) continue
        // "Move the bed to the south wall" from the hall means the bed's room's south wall, not the hall's.
        const at = op.at.room || op.at.of || op.at.where === 'gaze' || op.at.where === 'here' ? op.at : { ...op.at, room: list[0]!.room }
        const res = resolveSpot({ ...state, items: existing }, at, desc, ctx, { index, count: list.length, seed: ctx.seed, existing, props: list[0]!.props })
        if ('fail' in res) {
          notes.push(`move: ${res.fail}`)
          continue
        }
        if (res.note) notes.push(`move: ${res.note}`)
        why ??= res.why
        list.forEach((t, i) => {
          const p = res[i]
          if (!p) return
          const next = withPose(t, p)
          moved.set(t.id, next)
          existing = [...existing, next]
        })
        if (res.length < list.length) notes.push(`only room to move ${res.length} of ${list.length} ${desc.label}s`)
      }
      // A move that lands where the thing already stands is a no-op the player should hear about.
      const still = [...moved.values()].filter((m) => {
        const t = targets.find(x => x.id === m.id)!
        return Math.hypot(t.pos[0] - m.pos[0], t.pos[1] - m.pos[1]) < 0.05 && Math.abs(t.yaw - m.yaw) < 0.05
      })
      // A fallback that lands it back where it stood is the original refusal, not "put it on the north wall instead".
      if (still.length && still.length === moved.size) {
        if (why) notes.splice(0, notes.length, `move: ${why}`)
        else notes.push(`move: the ${kindOfItem(still[0]!)?.label ?? still[0]!.kind} is already there`)
      }
      return { state: { ...state, items: state.items.map(i => moved.get(i.id) ?? i) }, notes }
    }

    case 'remove': {
      const targets = select(state, op.target, ctx)
      if (!targets.length) return { state, notes: [`remove: nothing matches ${describeSel(op.target)}`] }
      const ids = new Set(targets.map(t => t.id))
      return { state: { ...state, items: state.items.filter(i => !ids.has(i.id)) }, notes: [] }
    }

    case 'restyle': {
      const targets = select(state, op.target, ctx)
      if (!targets.length) return { state, notes: [`restyle: nothing matches ${describeSel(op.target)}`] }
      const ids = new Set(targets.map(t => t.id))
      const items = state.items.map(i => (ids.has(i.id) ? { ...i, props: mergeProps(i, op.set, op.relative ?? false) } : i))
      return { state: { ...state, items }, notes: [] }
    }

    case 'surface': {
      const r = resolveRoom(state.plan, op.room, ctx)
      if (!r) return { state, notes: [`surface: I don't know a room called “${op.room}”`] }
      const rooms = r === 'all' ? state.plan.rooms : [r]
      const ids = new Set(rooms.map(x => x.id))
      const next = state.plan.rooms.map((room) => {
        if (!ids.has(room.id)) return room
        const current: Surface = room[op.part] ?? defaultSurfaces(room.type).ceiling
        return { ...room, [op.part]: { ...current, ...op.set } }
      })
      return { state: { ...state, plan: { ...state.plan, rooms: next } }, notes: [], surfaces: rooms.map(x => `${x.id}:${op.part}`) }
    }

    case 'light': {
      const l = state.light
      // Night without a word about lamps means lamps on: nobody asks for a dark house.
      const lamps = op.lamps ?? (op.time === 'night' ? true : l.lamps)
      return { state: { ...state, light: { time: op.time ?? l.time, lamps, warmth: op.warmth ?? l.warmth } }, notes: [] }
    }

    case 'furnish': {
      const r = resolveRoom(state.plan, op.room, ctx)
      if (!r) return { state, notes: [`furnish: I don't know a room called “${op.room}”`] }
      const rooms = r === 'all' ? state.plan.rooms : [r]
      const style = styleOf(op.style)
      if (op.style && !style) return furnishRooms(state, rooms, null, ctx, index, group, [`no "${op.style}" palette; used the defaults`])
      return furnishRooms(state, rooms, style, ctx, index, group, [])
    }

    case 'goto': {
      if (op.target) {
        const t = select(state, { ...op.target, limit: op.target.limit ?? 1 }, ctx)[0]
        if (!t) return { state, notes: [`goto: nothing matches ${describeSel(op.target)}`] }
        return { state, notes: [], goto: poseBefore(state.plan, t) }
      }
      const r = resolveRoom(state.plan, op.room, ctx)
      if (!r || r === 'all') return { state, notes: [`goto: I don't know a room called “${op.room}”`] }
      return { state, notes: [], goto: roomPose(state.plan, r, ctx) }
    }

    case 'undo': {
      if (!state.log.length) return { state, notes: ['nothing to undo'] }
      const undone = state.log[state.log.length - 1]!
      return { state: replayLog(state.base, state.log.slice(0, -1)), notes: [`undid ${undone.id}${undone.label ? ` (“${undone.label}”)` : ''}`] }
    }

    case 'reset':
      return { state: createHome(state.base, { furnish: true }), notes: [] }

    case 'say':
      return { state, say: op.text, notes: [] }
  }
}

// ---------- items ----------

function addItems(state: HomeState, desc: KindDescriptor, placed: Placed[], set: Props | undefined, group: string): HomeState {
  const taken = new Set(state.items.filter(i => i.kind === desc.kind).map(i => i.id))
  const items = placed.map((p) => {
    let n = 1
    while (taken.has(`${desc.kind}#${n}`)) n++
    const id = `${desc.kind}#${n}`
    taken.add(id)
    const item: Item = { id, kind: desc.kind, room: p.room, pos: p.pos, yaw: p.yaw, props: cleanProps(set ?? {}), group, tags: [...desc.tags] }
    if (p.y !== undefined) item.y = p.y
    return item
  })
  return { ...state, items: [...state.items, ...items], nextId: state.nextId + items.length, lastGroup: group }
}

function withPose(item: Item, p: Placed): Item {
  const next: Item = { ...item, pos: p.pos, yaw: p.yaw, room: p.room }
  if (p.y !== undefined) next.y = p.y
  else delete next.y
  return next
}

function groupByKind(items: Item[]): Map<string, Item[]> {
  const m = new Map<string, Item[]>()
  for (const i of items) m.set(i.kind, [...(m.get(i.kind) ?? []), i])
  return m
}

/** Relative sizes multiply what the piece has now (or its natural size); everything else replaces. */
function mergeProps(item: Item, set: Props, relative: boolean): Props {
  const desc = kindOfItem(item)
  const out: Record<string, unknown> = { ...item.props }
  const natural = desc ? footprintOf(desc, {}) : { length: 1, width: 1, height: 1 }
  for (const [k, v] of Object.entries(set)) {
    if (v === undefined) continue
    if (relative && typeof v === 'number' && (k === 'scale' || k === 'length' || k === 'width' || k === 'height')) {
      const cur = (item.props[k as 'scale'] as number | undefined) ?? (k === 'scale' ? 1 : natural[k as 'length' | 'width' | 'height'])
      out[k] = round3(cur * v)
    } else out[k] = v
  }
  return cleanProps(out as Props)
}

function cleanProps(p: Props): Props {
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) as Props
}

// ---------- furnish ----------

type Style = NonNullable<ReturnType<typeof styleOf>>

/** A room's starter layout from FURNISH, in order, skipping what doesn't fit. Replaces whatever stood there. */
function furnishRooms(state: HomeState, rooms: Room[], style: Style | null, ctx: OpContext, index: number, group: string, notes: string[]): StepResult {
  let s = state
  const surfaces: string[] = []
  for (const room of rooms) {
    s = { ...s, items: s.items.filter(i => i.room !== room.id) }
    const longest = longestEdge(room)
    const roomCtx: OpContext = { ...ctx, gaze: { point: roomCenter(room), room: room.id } }
    let palette = 0
    FURNISH[room.type].forEach((e, k) => {
      if (e.minLength && longest < e.minLength) return
      const desc = kindOf(e.kind)
      if (!desc) return
      const props = style ? styleProps(desc, style, palette) : undefined
      if (props?.trim) palette++
      const res = resolveSpot(s, { ...e.at, room: room.id }, desc, roomCtx, { index: index * 100 + k, count: e.count ?? 1, arrange: e.arrange, seed: ctx.seed, existing: s.items, props })
      if ('fail' in res) {
        notes.push(`${room.name}: ${res.fail}`)
        return
      }
      if (res.note) notes.push(`${room.name}: ${res.note}`)
      s = addItems(s, desc, res, props, group)
    })
    if (style) {
      const rs = s.plan.rooms.map(x => (x.id === room.id ? { ...x, walls: { ...x.walls, color: style.walls, pattern: 'plain' as const }, floor: { ...x.floor, color: style.floor.color, pattern: style.floor.pattern as Surface['pattern'] } } : x))
      s = { ...s, plan: { ...s.plan, rooms: rs } }
      surfaces.push(`${room.id}:walls`, `${room.id}:floor`)
    }
  }
  return { state: s, notes, surfaces }
}

/** Soft things take the palette in turn with the style's trim; wooden things take the trim; appliances and fixtures stay as they are. */
function styleProps(desc: KindDescriptor, style: Style, i: number): Props | undefined {
  if (desc.tags.some(t => t === 'seating' || t === 'bed' || t === 'textile' || t === 'art')) return { color: style.primary[i % style.primary.length]!, trim: style.trim }
  if (desc.tags.some(t => t === 'table' || t === 'storage' || t === 'desk') && !desc.tags.includes('appliance')) return { color: style.trim }
  return undefined
}

// ---------- goto ----------

/** The middle of a room, looking at its biggest window, or the way you'd be looking having walked in through the nearest door. */
function roomPose(plan: FloorPlan, room: Room, ctx: OpContext): Effects['goto'] {
  const pos = roomCenter(room)
  const win = windowsOf(plan, room)[0]
  if (win) return { pos, yaw: round3(yawToward(pos, win.at)), room: room.id }
  const door = [...doorsOf(plan, room)].sort((p, q) => dist2(p.at, ctx.player.pos) - dist2(q.at, ctx.player.pos))[0]
  return { pos, yaw: door ? round3(yawToward(door.at, pos)) : 0, room: room.id }
}

function dist2(a: [number, number], b: [number, number]): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2
}

// ---------- batches ----------

/**
 * One sentence = one batch. Parses strictly (dropping bad ops), applies undos first, then the rest, and
 * logs the batch (with its context, so replay is identical) if it changed the home. A reset wipes what
 * came before it and is never logged, so the fresh home's log starts with its own furnishing.
 */
export function applyBatch(state: HomeState, raw: unknown, label: string, ctx: OpContext, at = Date.now()): BatchResult {
  const { ops, dropped } = parseOps(raw)
  return commitOps(state, ops, dropped, ctx, label, at)
}

function commitOps(state: HomeState, ops0: Op[], dropped: DroppedOp[], ctx: OpContext, label: string, at: number): BatchResult {
  const extras = emptyEffects()
  const run = (s: HomeState, list: Op[]) => {
    list.forEach((op, i) => {
      const res = step(s, op, ctx, i)
      s = res.state
      if (res.say) extras.say.push(res.say)
      extras.notes.push(...res.notes)
      if (res.goto) extras.goto = res.goto
    })
    return s
  }
  const cut = ops0.findLastIndex(o => o.op === 'reset')
  const reset = cut >= 0
  const ops = reset ? [...ops0.slice(cut + 1), ...ops0.slice(0, cut).filter(o => o.op === 'say')] : ops0
  const start = reset ? createHome(state.base, { furnish: true }) : state
  const afterUndo = run(start, ops.filter(o => o.op === 'undo'))
  const logged = ops.filter(o => o.op !== 'undo' && o.op !== 'say')
  let s = run(afterUndo, logged)
  for (const o of ops) if (o.op === 'say') extras.say.push(o.text)

  const own = diffStates(afterUndo, s)
  const changed = own.placed.length > 0 || own.moved.length > 0 || own.modified.length > 0 || own.removed.length > 0 || own.surfaces.length > 0 || own.light
  let batch: Batch | undefined
  if (logged.length && changed) {
    batch = { id: `g${s.nextGroup}`, label, ops: logged, ctx, at }
    s = { ...s, log: [...s.log, batch], nextGroup: s.nextGroup + 1 }
  }
  const effects: Effects = { ...diffStates(state, s), notes: extras.notes, say: extras.say.map(t => honestSay(t, changed || reset || !!extras.goto, extras.notes)) }
  if (extras.goto) effects.goto = extras.goto
  if (reset) effects.reset = true
  return { state: s, effects, ops: reset ? [{ op: 'reset' }, ...ops] : ops, dropped, batch }
}

/**
 * A later op from the same sentence (streamed in after the batch was committed) joins that batch: it runs
 * with the batch's own context and group, exactly as `replayLog` will run it. Null when `batchId` is no
 * longer the last batch (something else happened in between). Undo, reset and say never join.
 */
export function extendLastBatch(state: HomeState, batchId: string, at: number, ops: Op[]): BatchResult | null {
  const b = state.log[state.log.length - 1]
  if (!b || b.id !== batchId) return null
  const keep = ops.filter(o => o.op !== 'undo' && o.op !== 'reset' && o.op !== 'say')
  const extras = emptyEffects()
  let s: HomeState = { ...state, nextGroup: state.nextGroup - 1 }
  keep.forEach((op, i) => {
    const res = step(s, op, b.ctx, b.ops.length + i)
    s = res.state
    extras.notes.push(...res.notes)
    if (res.goto) extras.goto = res.goto
  })
  const batch: Batch = { ...b, ops: [...b.ops, ...keep], at }
  s = { ...s, nextGroup: state.nextGroup, log: [...state.log.slice(0, -1), batch] }
  const effects: Effects = { ...diffStates(state, s), notes: extras.notes, say: ops.filter(o => o.op === 'say').map(o => (o as { text: string }).text) }
  if (extras.goto) effects.goto = extras.goto
  return { state: s, effects, ops: keep, dropped: [], batch }
}

/**
 * The genie only claims what happened: a line over a batch that did nothing becomes the reason it didn't,
 * and a line over a batch that only half worked ("Two nightstands, each with a lamp." when one fit) carries
 * the op's note. Furnish's per-room skips ("Kitchen: no room for…") are routine and stay in the drawer.
 */
export function honestSay(text: string, changed: boolean, notes: string[]): string {
  const hedged = /\b(can't|cannot|couldn't|won't|no|not|nothing|already|yet|only)\b/i.test(text)
  if (changed) {
    const partial = notes.find(n => /^(place|move|restyle|remove|surface|goto): |^only room/.test(n))
    return partial && !hedged ? `${text} (${partial.replace(/^[a-z]+: /, '').replace(/ \(.*\)$/, '')})` : text
  }
  if (hedged) return text
  const why = notes.find(n => !/^undid/.test(n))
  return why ? `I couldn't: ${why.replace(/^[a-z]+: /, '')}.` : 'Nothing changed.'
}

/** Rebuild a home from its log over the plan as loaded. Logged ops are already strict, so they run as-is. */
export function replayLog(plan: FloorPlan, log: Batch[]): HomeState {
  let s = createHome(plan)
  for (const b of log) {
    b.ops.forEach((op, i) => {
      s = step(s, op, b.ctx, i).state
    })
    s = { ...s, log: [...s.log, { ...b, id: `g${s.nextGroup}` }], nextGroup: s.nextGroup + 1 }
  }
  return s
}

export function undo(state: HomeState): { state: HomeState, effects: Effects } {
  return applyOp(state, { op: 'undo' }, state.log[state.log.length - 1]?.ctx ?? defaultContext(state.base))
}

// ---------- diffs ----------

/** What changed between two item lists, by id. A reused id in a new batch is a removal plus a placement. */
export function diffItems(a: Item[], b: Item[]): Pick<Effects, 'placed' | 'moved' | 'modified' | 'removed'> {
  const out = { placed: [] as string[], moved: [] as string[], modified: [] as string[], removed: [] as string[] }
  const before = new Map(a.map(i => [i.id, i]))
  const after = new Set<string>()
  for (const i of b) {
    after.add(i.id)
    const old = before.get(i.id)
    if (!old) out.placed.push(i.id)
    else if (old.kind !== i.kind || old.group !== i.group) {
      out.removed.push(i.id)
      out.placed.push(i.id)
    } else if (old !== i) {
      if (old.pos[0] !== i.pos[0] || old.pos[1] !== i.pos[1] || old.yaw !== i.yaw || old.y !== i.y || old.room !== i.room) out.moved.push(i.id)
      else if (JSON.stringify([old.props, old.tags]) !== JSON.stringify([i.props, i.tags])) out.modified.push(i.id)
    }
  }
  for (const i of a) if (!after.has(i.id)) out.removed.push(i.id)
  return out
}

export function diffStates(a: HomeState, b: HomeState): Effects {
  const fx: Effects = { ...emptyEffects(), ...diffItems(a.items, b.items) }
  if (a.plan !== b.plan) {
    const before = new Map(a.plan.rooms.map(r => [r.id, r]))
    for (const r of b.plan.rooms) {
      const old = before.get(r.id)
      for (const part of ['walls', 'floor', 'ceiling'] as const) {
        if (!old || JSON.stringify(old[part]) !== JSON.stringify(r[part])) fx.surfaces.push(`${r.id}:${part}`)
      }
    }
  }
  fx.light = a.light.time !== b.light.time || a.light.lamps !== b.light.lamps || a.light.warmth !== b.light.warmth
  return fx
}

// ---------- save / load ----------

export function exportHome(state: HomeState): SavedHome {
  return { v: HOME_VERSION, plan: state.base, log: state.log }
}

/** Load a saved home by replaying its log over its plan. Ops are re-validated, since files can be hand-edited. Null when it isn't a home. */
export function importHome(saved: unknown): HomeState | null {
  const o = saved as Partial<SavedHome> | null
  if (!o || typeof o !== 'object' || !Array.isArray(o.log)) return null
  const plan = FloorPlanSchema.safeParse(o.plan)
  if (!plan.success) return null
  const log: Batch[] = []
  for (const b of o.log as Partial<Batch>[]) {
    if (!b?.ctx?.gaze?.point || !b.ctx.player?.pos || typeof b.ctx.seed !== 'number') continue
    const { ops } = parseOps(b.ops ?? [])
    if (!ops.length) continue
    log.push({ id: b.id ?? '', label: b.label ?? '', ops, ctx: b.ctx, at: b.at ?? 0 })
  }
  return replayLog(plan.data, log)
}
