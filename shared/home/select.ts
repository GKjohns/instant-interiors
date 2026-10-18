/**
 * Selectors → items, and room references → rooms. The model never lists ids; it says "the sofa in the
 * living room" or "that" and this decides. Also the footprint maths every other module shares (size with
 * props applied, rotated corners). Pure over plain home data.
 */
import { area, dist, pointInPolygon } from '../plan/poly.ts'
import type { Vec2 } from '../plan/poly.ts'
import { ROOM_TYPES, normalizeId, roomTypeOf } from '../plan/schema.ts'
import type { FloorPlan, Room, RoomType } from '../plan/schema.ts'
import { largestRoom, roomAt } from '../plan/geometry.ts'
import { KIT, kindOf } from './kinds.ts'
import type { KindDescriptor } from './kinds.ts'
import { normalizeKind } from './ops.ts'
import type { Props, Selector } from './ops.ts'
import type { HomeState, Item, OpContext } from './types.ts'

/** Indoors, "near" means a couple of metres, not conjure's fifteen. */
export const DEFAULT_WITHIN = 2.5

export interface Footprint {
  length: number
  width: number
  height: number
}

export function kindOfItem(item: Item): KindDescriptor | undefined {
  return KIT[item.kind]
}

/** The kind's size with the item's props applied: explicit length/width only resize `sized` kinds; scale multiplies everything. */
export function footprintOf(kind: KindDescriptor, props: Props = {}): Footprint {
  const s = props.scale ?? 1
  const length = (kind.sized && props.length ? props.length : kind.footprint[0]) * s
  const width = (kind.sized && props.width ? props.width : kind.footprint[1]) * s
  return { length, width, height: (props.height ?? kind.height) * s }
}

export function itemFootprint(item: Item): Footprint {
  const kind = kindOfItem(item)
  return kind ? footprintOf(kind, item.props) : { length: 0.5, width: 0.5, height: 0.5 }
}

/** Half the footprint's diagonal: the circle that surely contains it. */
export function itemRadius(item: Item): number {
  const f = itemFootprint(item)
  return Math.hypot(f.length, f.width) / 2
}

/** Corners of a footprint centred on `pos`: length runs along local x, width along local z (the front). */
export function boxCorners(pos: Vec2, yaw: number, length: number, width: number): Vec2[] {
  const ax: Vec2 = [Math.cos(yaw) * length / 2, -Math.sin(yaw) * length / 2]
  const az: Vec2 = [Math.sin(yaw) * width / 2, Math.cos(yaw) * width / 2]
  return [
    [pos[0] + ax[0] + az[0], pos[1] + ax[1] + az[1]],
    [pos[0] - ax[0] + az[0], pos[1] - ax[1] + az[1]],
    [pos[0] - ax[0] - az[0], pos[1] - ax[1] - az[1]],
    [pos[0] + ax[0] - az[0], pos[1] + ax[1] - az[1]]
  ]
}

export function itemCorners(item: Item): Vec2[] {
  const f = itemFootprint(item)
  return boxCorners(item.pos, item.yaw, f.length, f.width)
}

// ---------- rooms ----------

const ALL_WORDS = new Set(['all', 'every', 'everywhere', 'all_rooms', 'every_room', 'whole', 'house', 'home', 'apartment'])
const HERE_WORDS = new Set(['here', 'this', 'this_room', 'current', 'in_here'])

/**
 * A room reference → the room. Order: 'here' / omitted (the player's room, then the gaze's, then the
 * largest), 'all', exact id, name, type (largest of that type, or the numbered / primary / guest one),
 * then a word the room's name shares ("the living" → Living room). Undefined when nothing fits.
 */
export function resolveRoom(plan: FloorPlan, ref: string | undefined, ctx: OpContext): Room | undefined | 'all' {
  const word = (ref ?? 'here').trim().toLowerCase()
  const id = normalizeId(word)
  if (!word || HERE_WORDS.has(id)) return hereRoom(plan, ctx)
  if (ALL_WORDS.has(id)) return 'all'
  const byId = plan.rooms.find(r => r.id === id)
  if (byId) return byId
  const byName = plan.rooms.find(r => r.name.toLowerCase() === word || normalizeId(r.name) === id)
  if (byName) return byName
  const type = (ROOM_TYPES as readonly string[]).includes(id) ? id as RoomType : roomTypeOf(word.replace(/_/g, ' '))
  if (type !== 'other' || id === 'other') {
    const ofType = plan.rooms.filter(r => r.type === type)
    if (ofType.length) return pickOfType(ofType, word)
  }
  const tokens = id.split('_').filter(t => t.length >= 3)
  return plan.rooms.find(r => tokens.some(t => normalizeId(r.name).split('_').includes(t) || r.id.split('_').includes(t)))
}

/** Among rooms of one type: a number picks by plan order, "primary / master" and "guest / spare" by size or name, else the largest. */
function pickOfType(rooms: Room[], word: string): Room {
  const bySize = [...rooms].sort((p, q) => area(q.polygon) - area(p.polygon))
  const n = /(\d+)/.exec(word)
  if (n) return rooms[Math.min(rooms.length, Math.max(1, Number(n[1]))) - 1]!
  if (/\b(master|primary|main|big|large|biggest|largest)\b/.test(word)) {
    return rooms.find(r => /primary|master|main/.test(`${r.id} ${r.name.toLowerCase()}`)) ?? bySize[0]!
  }
  if (/\b(guest|spare|small|smallest|kids?|child|children|second|other)\b/.test(word)) {
    return rooms.find(r => /guest|spare|kid|child/.test(`${r.id} ${r.name.toLowerCase()}`)) ?? bySize[bySize.length - 1]!
  }
  return bySize[0]!
}

/** "Here": where the player stands, then where they look, then the largest room. */
export function hereRoom(plan: FloorPlan, ctx: OpContext): Room {
  const byId = (id?: string) => (id ? plan.rooms.find(r => r.id === id) : undefined)
  return byId(ctx.player.room) ?? roomAt(plan, ctx.player.pos) ?? byId(ctx.gaze.room) ?? roomAt(plan, ctx.gaze.point) ?? largestRoom(plan)
}

// ---------- items ----------

/** What "that" means: the item the gaze ray hit, else the smallest item whose footprint holds the gaze point. */
export function gazeItem(state: HomeState, ctx: OpContext): Item | undefined {
  if (ctx.gaze.itemId) {
    const hit = state.items.find(i => i.id === ctx.gaze.itemId)
    if (hit) return hit
  }
  let best: Item | undefined
  let bestArea = Infinity
  for (const i of state.items) {
    if (kindOfItem(i)?.place === 'ceiling') continue
    if (!pointInPolygon(ctx.gaze.point, itemCorners(i), 0.25)) continue
    const f = itemFootprint(i)
    if (f.length * f.width < bestArea) {
      best = i
      bestArea = f.length * f.width
    }
  }
  return best
}

export function lastBatch(state: HomeState): Item[] {
  return state.lastGroup ? state.items.filter(i => i.group === state.lastGroup) : []
}

export function select(state: HomeState, sel: Selector, ctx: OpContext): Item[] {
  let pool: Item[]
  if (sel.ref === 'gaze') {
    const hit = gazeItem(state, ctx)
    pool = hit ? [hit] : lastBatch(state)
  } else if (sel.ref === 'last') pool = lastBatch(state)
  else pool = state.items

  if (sel.kind) pool = byKind(pool, sel.kind)
  if (sel.tag) pool = byTag(pool, sel.tag)
  // "That lamp" while the ray hit the sofa: the nearest lamp to where you look is what you meant.
  if (sel.ref === 'gaze' && !pool.length && (sel.kind || sel.tag)) {
    pool = state.items.filter(i => dist(i.pos, ctx.gaze.point) <= DEFAULT_WITHIN + itemRadius(i))
    if (sel.kind) pool = byKind(pool, sel.kind)
    if (sel.tag) pool = byTag(pool, sel.tag)
    pool = [...pool].sort((p, q) => dist(p.pos, ctx.gaze.point) - dist(q.pos, ctx.gaze.point)).slice(0, 1)
  }

  if (sel.room) {
    const room = resolveRoom(state.plan, sel.room, ctx)
    if (room === undefined) return []
    if (room !== 'all') pool = pool.filter(i => i.room === room.id)
  }

  const origin = sel.near === 'player' ? ctx.player.pos : ctx.gaze.point
  if (sel.near) {
    const within = sel.within ?? DEFAULT_WITHIN
    pool = pool.filter(i => dist(i.pos, origin) <= within + itemRadius(i))
  }
  if (sel.near || sel.limit !== undefined) pool = [...pool].sort((p, q) => dist(p.pos, origin) - dist(q.pos, origin))
  if (sel.limit !== undefined) pool = pool.slice(0, sel.limit)
  return pool
}

/** A kind word through the aliases ("couch" → sofa); a miss falls back to a label match ("lamp" → every lamp) and then a tag. */
function byKind(pool: Item[], word: string): Item[] {
  const desc = kindOf(word)
  if (desc) {
    const exact = pool.filter(i => i.kind === desc.kind)
    if (exact.length) return exact
  }
  const k = singular(normalizeKind(word))
  if (!k) return []
  const loose = pool.filter(i => i.kind.includes(k) || (KIT[i.kind]?.label ?? '').includes(k.replace(/_/g, ' ')))
  return loose.length ? loose : byTag(pool, k)
}

function byTag(pool: Item[], tag: string): Item[] {
  const t = singular(tag.trim().toLowerCase())
  return pool.filter(i => i.tags.some(x => x === t || singular(x) === t))
}

function singular(w: string): string {
  if (w.endsWith('ies')) return `${w.slice(0, -3)}y`
  if (w.endsWith('shes') || w.endsWith('ches') || w.endsWith('xes') || w.endsWith('sses')) return w.slice(0, -2)
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1)
  return w
}
