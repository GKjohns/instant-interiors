/**
 * Whether a candidate pose is allowed: inside the room, clear of the door swings, the viewer and every piece
 * it would really clash with. Rugs go under things and hung pieces only clash with what reaches them, so
 * "overlap" is per layer.
 */
import { EPS, add, area, dist, pointInPolygon, signedArea } from '../../plan/poly.ts'
import type { Vec2 } from '../../plan/poly.ts'
import type { KindDescriptor } from '../kinds.ts'
import { boxCorners, itemCorners, itemFootprint, kindOfItem } from '../select.ts'
import type { Item } from '../types.ts'
import { applyFacing } from './facing.ts'
import { hangOf } from './site.ts'
import type { Blocker, Cand, Layer, Site } from './types.ts'

/** Touching footprints are fine; this much shared area (m², a 3 cm square) is a real overlap. */
const OVERLAP_TOL = 0.001
/** Candidate streams are lazy and some are long; past this many the room is simply full. */
export const MAX_TRIES = 900

/** Area shared by two convex polygons (Sutherland–Hodgman clip of `a` by `b`). */
export function overlapArea(a: Vec2[], b: Vec2[]): number {
  const s = signedArea(b) >= 0 ? 1 : -1
  let out = a
  for (let i = 0; i < b.length && out.length; i++) {
    const p = b[i]!
    const q = b[(i + 1) % b.length]!
    const inside = (v: Vec2) => ((q[0] - p[0]) * (v[1] - p[1]) - (q[1] - p[1]) * (v[0] - p[0])) * s >= -EPS
    const input = out
    out = []
    for (let j = 0; j < input.length; j++) {
      const cur = input[j]!
      const prev = input[(j + input.length - 1) % input.length]!
      const ci = inside(cur)
      if (ci !== inside(prev)) out.push(intersect(prev, cur, p, q))
      if (ci) out.push(cur)
    }
  }
  return out.length < 3 ? 0 : area(out)
}

function intersect(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): Vec2 {
  const d = (a1[0] - a2[0]) * (b1[1] - b2[1]) - (a1[1] - a2[1]) * (b1[0] - b2[0])
  if (Math.abs(d) < EPS) return a2
  const t = ((a1[0] - b1[0]) * (b1[1] - b2[1]) - (a1[1] - b1[1]) * (b1[0] - b2[0])) / d
  return [a1[0] + t * (a2[0] - a1[0]), a1[1] + t * (a2[1] - a1[1])]
}

export function layerOf(kind: KindDescriptor, y?: number): Layer {
  if (kind.place === 'ceiling') return 'ceiling'
  if (kind.place === 'wall_mounted') return 'mounted'
  if (kind.tags.includes('textile')) return 'under'
  if (y !== undefined && y > 0.05) return 'top'
  return 'floor'
}

export function itemLayer(item: Item): Layer {
  const kind = kindOfItem(item)
  return kind ? layerOf(kind, item.y) : 'floor'
}

export function blockerOf(item: Item): Blocker {
  const y = item.y ?? 0
  return { id: item.id, box: itemCorners(item), layer: itemLayer(item), y, top: y + itemFootprint(item).height }
}

/** Do two things fight for the same space? Rugs never do; hung and ceiling pieces only with what reaches their height. */
function conflicts(c: Blocker, b: Blocker): boolean {
  if (c.layer === 'under' || b.layer === 'under') return false
  if (c.layer === 'ceiling' || b.layer === 'ceiling') return c.layer === b.layer && overlaps(c.box, b.box)
  if (c.layer === 'top' || b.layer === 'top') return c.layer === b.layer && Math.abs(c.y - b.y) < 0.1 && overlaps(c.box, b.box)
  if (c.layer === 'mounted' || b.layer === 'mounted') return Math.min(c.top, b.top) - Math.max(c.y, b.y) > 0.02 && overlaps(c.box, b.box)
  return overlaps(c.box, b.box)
}

function overlaps(a: Vec2[], b: Vec2[]): boolean {
  return overlapArea(a, b) > OVERLAP_TOL
}

export function fits(site: Site, cand: Cand, extra: Blocker[]): Cand | null {
  const layer = layerOf(site.kind, cand.y)
  let c: Cand | null = cand
  if (layer !== 'top') c = keepInside(site, cand)
  if (!c) return null
  const y = c.y ?? 0
  const me: Blocker = { id: '', box: boxCorners(c.pos, c.yaw, site.fp.length, site.fp.width), layer, y, top: y + site.fp.height }
  for (const b of site.blockers) {
    // You can stand where a wall piece goes (step aside); only free placements keep off the viewer.
    if (b.id === 'player' && (c.pinned || c.middle || layer !== 'floor')) continue
    if (conflicts(me, b)) return null
  }
  for (const b of extra) if (conflicts(me, b)) return null
  return c
}

/** Shrink toward the room's centre until the whole footprint is inside; pinned candidates must already be. */
function keepInside(site: Site, c: Cand): Cand | null {
  const inside = (p: Vec2) => boxCorners(p, c.yaw, site.fp.length, site.fp.width).every(k => pointInPolygon(k, site.poly, 0.03))
  if (inside(c.pos)) return c
  if (c.pinned) return null
  const d = dist(c.pos, site.center)
  if (d < EPS) return null
  const dir: Vec2 = [(site.center[0] - c.pos[0]) / d, (site.center[1] - c.pos[1]) / d]
  for (let k = 1; k <= 40; k++) {
    const p = add(c.pos, dir, k * 0.05)
    if (inside(p)) return { ...c, pos: p }
  }
  return null
}

/** Hung and ceiling pieces get their height, then the spot's `facing` turns the piece. */
export function finish(site: Site, c: Cand): Cand {
  let out = c
  if (site.kind.place === 'ceiling') out = { ...out, y: site.ceiling - site.fp.height }
  else if (site.kind.place === 'wall_mounted' && out.y === undefined) out = { ...out, y: Math.max(0.05, hangOf(site) - site.fp.height / 2) }
  return applyFacing(site, out)
}

export function firstFit(site: Site, cands: Iterable<Cand>, extra: Blocker[]): Cand | null {
  let tries = 0
  for (const c of cands) {
    if (++tries > MAX_TRIES) break
    const f = fits(site, finish(site, c), extra)
    if (f) return f
  }
  return null
}

export function toBlocker(site: Site, c: Cand): Blocker {
  const y = c.y ?? 0
  return { id: '', box: boxCorners(c.pos, c.yaw, site.fp.length, site.fp.width), layer: layerOf(site.kind, c.y), y, top: y + site.fp.height }
}
