/**
 * The placement resolver: a Spot ("against the north wall", "beside the sofa", "where I'm looking") plus a
 * kind and a count → positions and yaws in metres. The model never does this maths. Every choice is
 * deterministic for a seed, so replaying the log lands everything where it was.
 */
import { add, compassOf, dist, distToPolygonEdge, pointInPolygon, yawToward } from '../../plan/poly.ts'
import type { Vec2 } from '../../plan/poly.ts'
import type { FloorPlan, Room } from '../../plan/schema.ts'
import { DOOR_HEAD, cornersOf, corridors, doorsOf, roomAt, roomCenter, wallSegmentsOf, windowsOf } from '../../plan/geometry.ts'
import { hashSeed, rng, round3 } from '../../math.ts'
import type { KindDescriptor } from '../kinds.ts'
import type { Selector, Side, Spot } from '../ops.ts'
import { boxCorners, footprintOf, hereRoom, itemFootprint, kindOfItem, resolveRoom, roomPhrase, select } from '../select.ts'
import type { HomeState, Item, OpContext } from '../types.ts'
import { group } from './arrange.ts'
import { frontOf, yawFacing } from './facing.ts'
import { topWhy } from './clear.ts'
import { blockerOf, finish, fits, layerOf } from './fit.ts'
import { livability, pick, scored } from './score.ts'
import { candidates } from './spots.ts'
import type { Cand, LayoutOpts, LayoutResult, Place, Placed, Site } from './types.ts'

/**
 * Resolve a Spot for `count` pieces of `kind`. Returns every pose that fits (fewer than asked when the
 * room is tight; the caller notes the difference) or why none did. Deterministic for (seed, index, kind).
 */
export function resolveSpot(state: HomeState, spot: Spot | undefined, kind: KindDescriptor, ctx: OpContext, opts: LayoutOpts): LayoutResult {
  const rand = rng(hashSeed(opts.seed, opts.index, kind.kind))
  const anchors = spot?.of ? pickAnchors(state, spot, ctx) : []
  if (spot?.of && !anchors.length) return withoutAnchor(state, spot, spot.of, kind, ctx, opts)
  const room = roomFor(state, spot, ctx, anchors[0])
  if (!room) return { fail: spot?.room ? `I don't know a room called “${spot.room}”` : 'no room to put it in' }
  const dup = secondMainSeat(state, room, kind, opts)
  if (dup) return { fail: dup }
  const site = makeSite(state, room, kind, spot, ctx, opts, anchors, rand)
  const where = whereOf(spot, kind, site.anchor)
  const side = spot?.side ?? (where === 'near' ? 'beside' : undefined)
  const n = Math.max(1, Math.round(opts.count))
  // On top of a thing with several candidates ("a lamp on the nightstand"): the next one when the first is topped.
  const onAny = side === 'on' && site.anchors.length > 1
  const placed = n === 1 && !onAny ? single(site, where, side) : group(site, where, side, n, opts.arrange)
  if (placed.length) return toPlaced(placed)
  return elsewhereInRoom(site, spot, where, side, n) ?? { fail: failMessage(site, where, side) }
}

/** The pieces a living room is arranged round; two from one sentence is a duplicate, not a design. */
const MAIN_SEATS = new Set(['sofa', 'sectional', 'loveseat'])

/**
 * "A sofa facing the TV" sometimes arrives as two place ops: one sentence gets one main seat per room unless
 * it asked for a count ("two sofas" is count 2). Items this batch placed carry its group, g<nextGroup>.
 */
function secondMainSeat(state: HomeState, room: Room, kind: KindDescriptor, opts: LayoutOpts): string | null {
  if (!MAIN_SEATS.has(kind.kind) || opts.count > 1) return null
  const group = `g${state.nextGroup}`
  const twin = opts.existing.find(i => i.room === room.id && i.group === group && MAIN_SEATS.has(i.kind))
  return twin ? `the ${roomPhrase(room)} already got a ${kindOfItem(twin)?.label ?? twin.kind} from this sentence; one main seat per room unless you ask for more` : null
}

function single(site: Site, where: Place, side: Side | undefined): Cand[] {
  const score = scored(site, where) ? (f: Cand) => livability(site, f) : undefined
  const c = pick(site, candidates(site, where, side, site.fp.length), c => fits(site, finish(site, c), []), score)
  return c ? [c] : []
}

/**
 * "A mirror over the console in the hall" with no console: a wall piece still has an obvious home on that
 * room's wall, which beats nothing; the note owns up that the anchor wasn't there. Not for a missing bed: a
 * nightstand alone on a wall is furniture for nobody.
 */
function withoutAnchor(state: HomeState, spot: Spot, of: Selector, kind: KindDescriptor, ctx: OpContext, opts: LayoutOpts): LayoutResult {
  const ref = spot.room ?? of.room
  const r = ref ? resolveRoom(state.plan, ref, ctx) : hereRoom(state.plan, ctx)
  if (r && r !== 'all' && ['wall', 'wall_mounted', 'corner'].includes(kind.place) && !/bed/.test(of.kind ?? of.tag ?? '')) {
    const got = resolveSpot(state, { room: r.id }, kind, ctx, opts)
    const at = kind.place === 'corner' ? 'in a corner' : 'on the wall'
    if (!('fail' in got)) return Object.assign(got, { note: `no ${describeSel(of)} in the ${roomPhrase(r)}, so the ${kind.label} went ${at}` })
  }
  return { fail: `no ${describeSel(of)} to put the ${kind.label} near` }
}

/**
 * Beside a full counter (or on a named wall that is full), a floor-standing wall piece is still better on
 * another wall or in a corner of the same room than not at all: a kitchen with no stove reads as broken, one
 * on the far wall doesn't. Not beside a bed: a nightstand across the room from it is worse than none.
 */
function elsewhereInRoom(site: Site, spot: Spot | undefined, where: Place, side: Side | undefined, n: number): LayoutResult | null {
  const kind = site.kind
  const natural = kind.place === 'wall' || kind.place === 'corner'
  // A named wall or corner that is full or would block a door path: same room, best other spot, with a note.
  const asked = where === 'near' || ((where === 'wall' || where === 'corner') && !!spot?.wall)
  if (!asked || !natural || layerOf(kind) !== 'floor' || site.anchor?.tags.includes('bed')) return null
  const why = failMessage(site, where, side)
  const loose: Site = { ...site, spot: spot?.room ? { room: spot.room } : undefined, why: new Map() }
  for (const alt of kind.place === 'corner' ? ['corner', 'wall'] as const : ['wall', 'corner'] as const) {
    const got = n === 1 ? single(loose, alt, undefined) : group(loose, alt, undefined, n, undefined)
    if (!got.length) continue
    const f = frontOf(got[0]!.yaw)
    const at = alt === 'wall' ? `on the ${compassOf([-f[0], -f[1]])} wall` : where === 'corner' ? 'in another corner' : 'in a corner'
    return Object.assign(toPlaced(got), { note: `put the ${kind.label} ${at} instead (${why})`, why })
  }
  return null
}

function toPlaced(cands: Cand[]): Placed[] {
  return cands.map(p => ({ pos: [round3(p.pos[0]), round3(p.pos[1])] as Vec2, yaw: round3(p.yaw), room: p.room, ...(p.y !== undefined ? { y: round3(p.y) } : {}) }))
}

function makeSite(state: HomeState, room: Room, kind: KindDescriptor, spot: Spot | undefined, ctx: OpContext, opts: LayoutOpts, anchors: Item[], rand: () => number): Site {
  const props = opts.props ?? {}
  let fp = footprintOf(kind, props)
  // Curtains are cut to their window unless the sentence sized them.
  if (kind.kind === 'curtains' && !props.length) {
    const w = windowsOf(state.plan, room).find(x => x.side === spot?.wall) ?? windowsOf(state.plan, room)[0]
    if (w) fp = { ...fp, length: w.width + 0.4 }
  }
  const standing = new Set(opts.existing.map(i => i.id))
  const blockers = opts.existing.filter(i => i.room === room.id).map(i => (i.anchor && !standing.has(i.anchor.id) ? { ...blockerOf(i), follows: true } : blockerOf(i)))
  for (const d of doorsOf(state.plan, room)) {
    if (d.kind !== 'door') continue
    const c = add(d.at, d.inward, d.width / 2)
    blockers.push({ id: `swing:${d.id}`, box: boxCorners(c, yawFacing(d.inward), d.width, d.width), layer: 'floor', y: 0, top: DOOR_HEAD })
  }
  if (roomAt(state.plan, ctx.player.pos)?.id === room.id) {
    blockers.push({ id: 'player', box: boxCorners(ctx.player.pos, 0, 0.5, 0.5), layer: 'floor', y: 0, top: 1.8 })
  }
  return {
    state,
    plan: state.plan,
    ctx,
    room,
    poly: room.polygon,
    center: roomCenter(room),
    walls: wallSegmentsOf(state.plan, room),
    corners: cornersOf(room).filter(c => c.convex),
    windows: windowsOf(state.plan, room),
    doors: doorsOf(state.plan, room),
    kind,
    fp,
    props,
    spot,
    anchor: anchors[0],
    anchors,
    blockers,
    rand,
    ceiling: state.plan.ceiling,
    corridors: corridors(state.plan, room),
    why: new Map()
  }
}

function whereOf(spot: Spot | undefined, kind: KindDescriptor, anchor: Item | undefined): Place {
  if (spot?.where && spot.where !== 'near') return spot.where
  if (anchor) return 'near'
  if (spot?.where === 'near') return 'gaze'
  if (spot?.wall) return spot.side && spot.where !== 'wall' ? 'corner' : 'wall'
  switch (kind.place) {
    case 'wall':
    case 'wall_mounted': return 'wall'
    case 'corner': return 'corner'
    case 'window': return 'window'
    case 'free': return 'free'
    default: return 'center'
  }
}

/** Anchors in the spot's room when it names one; the one you look at first, then the nearest to your gaze. */
function pickAnchors(state: HomeState, spot: Spot, ctx: OpContext): Item[] {
  let pool = select(state, spot.of!, ctx)
  if (spot.room) {
    const r = resolveRoom(state.plan, spot.room, ctx)
    if (r && r !== 'all') pool = pool.filter(i => i.room === r.id)
  }
  return [...pool].sort((p, q) => Number(q.id === ctx.gaze.itemId) - Number(p.id === ctx.gaze.itemId) || dist(p.pos, ctx.gaze.point) - dist(q.pos, ctx.gaze.point))
}

function roomFor(state: HomeState, spot: Spot | undefined, ctx: OpContext, anchor: Item | undefined): Room | undefined {
  const plan = state.plan
  if (spot?.room) {
    const r = resolveRoom(plan, spot.room, ctx)
    if (!r) return undefined
    if (r !== 'all') return r
  }
  if (anchor) return plan.rooms.find(r => r.id === anchor.room) ?? hereRoom(plan, ctx)
  if (spot?.where === 'gaze') return plan.rooms.find(r => r.id === ctx.gaze.room) ?? roomAt(plan, ctx.gaze.point) ?? hereRoom(plan, ctx)
  return hereRoom(plan, ctx)
}

export function describeSel(sel: Selector): string {
  if (sel.kind) return sel.kind.replace(/_/g, ' ')
  if (sel.tag) return sel.tag
  return sel.ref === 'gaze' ? 'thing you are looking at' : sel.ref === 'last' ? 'last thing' : 'thing'
}

function failMessage(site: Site, where: Place, side: Side | undefined): string {
  const what = site.kind.label
  const room = roomPhrase(site.room)
  // Turned away for circulation rather than space: say what it would have blocked.
  const why = topWhy(site)
  if (why) {
    const there = where === 'corner' && site.spot?.wall ? 'in that corner' : where === 'wall' && site.spot?.wall ? `on the ${site.spot.wall} wall` : where === 'near' || where === 'gaze' || where === 'here' || where === 'door' || where === 'window' ? 'there' : ''
    return there ? `the ${what} ${there} would ${why}` : `no spot for the ${what} in the ${room}: everywhere it fits would ${why}`
  }
  switch (where) {
    case 'wall': return site.spot?.wall ? `no room for the ${what} on the ${site.spot.wall} wall of the ${room}` : `no free wall for the ${what} in the ${room}`
    case 'corner': return `no free corner for the ${what} in the ${room}`
    case 'window': return site.windows.length ? `no room by the window for the ${what}` : `the ${room} has no window`
    case 'door': return site.doors.length ? `no room by the door for the ${what}` : `the ${room} has no door`
    case 'near': {
      const rel = side === 'left' ? 'to the left of' : side === 'right' ? 'to the right of' : side === 'front' ? 'in front of' : side ?? 'beside'
      return `no room ${rel} the ${site.anchor ? kindOfItem(site.anchor)?.label ?? site.anchor.kind : 'anchor'} for the ${what}`
    }
    default: return `no room for the ${what} in the ${room}`
  }
}

/** Where to stand to look at a thing: `gap` metres in front of it, kept inside its room, facing it. */
export function poseBefore(plan: FloorPlan, item: Item, gap = 1.2): { pos: Vec2, yaw: number, room: string } {
  const fp = itemFootprint(item)
  const f = frontOf(item.yaw)
  const room = plan.rooms.find(r => r.id === item.room)
  let pos = add(item.pos, f, fp.width / 2 + gap)
  if (room) {
    const clear = (p: Vec2) => pointInPolygon(p, room.polygon) && distToPolygonEdge(p, room.polygon) >= 0.3
    for (let k = 0; k < 12 && !clear(pos); k++) pos = add(pos, f, -0.15)
  }
  return { pos: [round3(pos[0]), round3(pos[1])], yaw: round3(yawToward(pos, item.pos)), room: item.room }
}
