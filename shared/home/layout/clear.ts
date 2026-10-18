/**
 * Livable floor: the walking corridors of the room and the space each piece needs to be used (legroom in
 * front of a sofa, a side of the bed to get in, chairs' room round a table). A floor piece may not stand in
 * either; `circulationBlock` says why when it would, so a refusal can explain itself.
 */
import { area } from '../../plan/poly.ts'
import type { Vec2 } from '../../plan/poly.ts'
import { rectAlong, sharedArea } from '../../plan/geometry.ts'
import type { Corridor } from '../../plan/geometry.ts'
import { KIT } from '../kinds.ts'
import type { KindDescriptor } from '../kinds.ts'
import { itemFootprint, kindOfItem } from '../select.ts'
import type { Footprint } from '../select.ts'
import type { Item } from '../types.ts'
import { frontOf, sideOf } from './facing.ts'
import type { Blocker, Cand, Clearance, Site } from './types.ts'

/** A floor piece may cover at most this share of its own footprint of a corridor or someone's clearance. */
export const BLOCK_SHARE = 0.1
/** Clear strip along a bed's long side to get in and make it. */
const BED_SIDE = 0.7
/** Bed side strips start this far from the headboard: that end belongs to the nightstands (0.4 m deep). */
const BED_HEAD_SKIP = 0.45
/** Knees and feet in front of a sofa or chair; room to pull out a desk chair. */
const SEAT_FRONT = 0.6
const DESK_FRONT = 0.6
/** Room to pull a chair out and sit at a dining table, every side. */
const DINING_RING = 0.75
/**
 * Pieces smaller than this (m²: a plant, a lamp, a stool) never shut a lane for a bigger piece: a person
 * steps round them, and moving the bed shouldn't be refused over a plant. They still may not stand in a
 * lane themselves.
 */
const STEP_ROUND = 0.3
/** A clearance zone this much outside the room (or under other pieces) is no use. */
const ZONE_LOST = 0.15

const DINING = new Set(['dining_table', 'round_table'])
/** What belongs in front of a seat: the coffee table, a side table, a footstool. */
const SEAT_COMPANIONS = new Set(['coffee_table', 'side_table', 'ottoman'])
/** Where a one-door room's walk-in path leads: these pieces are the destination, not an obstacle. */
const DESTINATIONS = new Set(['dining_table', 'round_table', 'island', 'car'])

function isBed(k: KindDescriptor): boolean {
  return k.tags.includes('bed')
}

export function isDestination(k: KindDescriptor | undefined): boolean {
  return !!k && (isBed(k) || DESTINATIONS.has(k.kind))
}

/** The space a piece of `kind` at this pose needs kept clear, or null for pieces that need none. */
export function clearanceFor(kind: KindDescriptor, pos: Vec2, yaw: number, fp: Footprint): Clearance | null {
  const f = frontOf(yaw)
  const s = sideOf(yaw)
  const L = fp.length
  const W = fp.width
  const at = (side: number, fwd: number): Vec2 => [pos[0] + s[0] * side + f[0] * fwd, pos[1] + s[1] * side + f[1] * fwd]
  if (isBed(kind)) {
    const zones = [1, -1].map(sg => rectAlong(at(sg * (L / 2 + BED_SIDE / 2), -W / 2 + BED_HEAD_SKIP), at(sg * (L / 2 + BED_SIDE / 2), W / 2), BED_SIDE))
    return { label: `the open side of the ${kind.label.replace(/ \(.*\)/, '')}`, zones, need: 'any', exempt: () => false }
  }
  if (DINING.has(kind.kind)) {
    const zones = [
      rectAlong(at(0, W / 2), at(0, W / 2 + DINING_RING), L),
      rectAlong(at(0, -W / 2), at(0, -W / 2 - DINING_RING), L),
      rectAlong(at(L / 2, 0), at(L / 2 + DINING_RING, 0), W),
      rectAlong(at(-L / 2, 0), at(-L / 2 - DINING_RING, 0), W)
    ]
    return { label: `the chairs' room round the ${kind.label}`, zones, need: 'all', exempt: k => k.tags.includes('seating') }
  }
  if (kind.tags.includes('desk')) {
    return { label: `the space in front of the ${kind.label}`, zones: [rectAlong(at(0, W / 2), at(0, W / 2 + DESK_FRONT), L)], need: 'all', exempt: k => k.tags.includes('seating') }
  }
  if (kind.tags.includes('seating') && kind.face === 'room') {
    return { label: `the ${kind.label}'s legroom`, zones: [rectAlong(at(0, W / 2), at(0, W / 2 + SEAT_FRONT), L)], need: 'all', exempt: k => SEAT_COMPANIONS.has(k.kind) }
  }
  return null
}

export function clearanceAround(item: Item): Clearance | null {
  const kind = kindOfItem(item)
  return kind ? clearanceFor(kind, item.pos, item.yaw, itemFootprint(item)) : null
}

/** Pieces that take up floor and so can block a walk or a clearance (door swings and the viewer are handled elsewhere). */
function solid(b: Blocker): boolean {
  return b.layer === 'floor' && !!b.kind
}

/** A zone is lost when a slice of it is outside the room or under something already standing (the caller drops what is exempt). */
function zoneLost(site: Site, zone: Vec2[], others: Blocker[]): boolean {
  const a = area(zone)
  if (a - sharedArea(site.poly, zone) > ZONE_LOST * a) return true
  return others.some(b => b.layer === 'floor' && b.id !== 'player' && sharedArea(b.box, zone) > ZONE_LOST * a)
}

/** The zones of a placed piece's clearance that still need protecting: all of them, or a bed's sides that are open. */
function liveZones(site: Site, owner: Blocker, all: Blocker[]): Vec2[][] {
  const cl = owner.clear!
  if (cl.need === 'all') return cl.zones
  const others = all.filter(b => b !== owner && !(b.kind && cl.exempt(KIT[b.kind]!)))
  return cl.zones.filter(z => !zoneLost(site, z, others))
}

/** Is a route of a corridor blocked by this footprint? More than BLOCK_SHARE of the piece on any of its rectangles. */
function blocks(box: Vec2[], rects: Vec2[][]): boolean {
  const lim = BLOCK_SHARE * area(box)
  return rects.some(r => sharedArea(box, r) > lim)
}

function routeClear(site: Site, cor: Corridor, ri: number, extra: Blocker[]): boolean {
  const route = cor.routes[ri]!
  const counts = (b: Blocker) => solid(b) && !b.follows && area(b.box) >= STEP_ROUND && !(cor.kind === 'reach' && isDestination(KIT[b.kind!]))
  let cache = routeCache.get(site.corridors)
  if (!cache) routeCache.set(site.corridors, (cache = new Map()))
  const key = `${site.corridors.indexOf(cor)}:${ri}:${site.blockers.length}`
  let clear = cache.get(key)
  if (clear === undefined) {
    clear = !site.blockers.some(b => counts(b) && blocks(b.box, route.rects))
    cache.set(key, clear)
  }
  return clear && !extra.some(b => counts(b) && blocks(b.box, route.rects))
}

/** Corridors are rebuilt per site; their open/closed state against the site's standing pieces is worth keeping per call. */
const routeCache = new WeakMap<Corridor[], Map<string, boolean>>()

/**
 * Why a floor candidate may not stand here, or null when it may: it would close the last clear route of a
 * corridor, stand in another piece's clearance, or have no clearance of its own. Rugs, hung and ceiling
 * pieces and things on top of others never get here (see fits()).
 */
export function circulationBlock(site: Site, c: Cand, me: Blocker, extra: Blocker[]): string | null {
  const dest = isDestination(site.kind)
  for (const cor of site.corridors) {
    if (cor.kind === 'reach' && dest) continue
    const open = cor.routes.map((_, i) => i).filter(i => routeClear(site, cor, i, extra))
    // Already shut by what stands there: at least don't make the straight way worse.
    const keep = open.length ? open : [0]
    if (keep.every(i => blocks(me.box, cor.routes[i]!.rects))) return `block ${cor.why}`
  }
  const all = [...site.blockers, ...extra]
  const myArea = area(me.box)
  for (const b of all) {
    if (!b.clear || b.clear.exempt(site.kind)) continue
    for (const z of liveZones(site, b, all)) if (sharedArea(me.box, z) > BLOCK_SHARE * myArea) return `stand in ${b.clear.label}`
  }
  const own = clearanceFor(site.kind, c.pos, c.yaw, site.fp)
  // A dining table's ring only protects; a table asked for the middle of a small kitchen still goes there and seats what fits.
  if (own && (own.need === 'any' || own.zones.length === 1)) {
    const others = all.filter(b => b.id !== 'player' && !(b.kind && own.exempt(KIT[b.kind]!)))
    const open = own.zones.filter(z => !zoneLost(site, z, others))
    if (!open.length) return isBed(site.kind) ? 'leave neither side of the bed free to get in' : site.kind.tags.includes('desk') ? 'leave no room to pull out a chair' : 'leave no legroom in front of it'
  }
  return null
}

/** How many of a bed's sides stay open at this pose (for scoring: both beats one). */
export function openSides(site: Site, c: Cand, extra: Blocker[] = []): number {
  const own = clearanceFor(site.kind, c.pos, c.yaw, site.fp)
  if (!own) return 0
  const others = [...site.blockers, ...extra].filter(b => b.id !== 'player')
  return own.zones.filter(z => !zoneLost(site, z, others)).length
}

/** Record a refusal reason on the site (copies share the map), most common wins in the failure note. */
export function noteWhy(site: Site, why: string): void {
  site.why.set(why, (site.why.get(why) ?? 0) + 1)
}

export function topWhy(site: Site): string | undefined {
  let best: string | undefined
  let n = 0
  for (const [k, v] of site.why) {
    if (v > n) {
      best = k
      n = v
    }
  }
  return best
}
