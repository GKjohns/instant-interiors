/** Several of a thing at once: a row along a wall, chairs around a table, a pair flanking an anchor, a loose cluster. */
import { add } from '../../plan/poly.ts'
import type { Vec2 } from '../../plan/poly.ts'
import type { Arrangement, Side } from '../ops.ts'
import { itemFootprint } from '../select.ts'
import { applyFacing, faceToward, frontOf, normYaw, sideOf, yawFacing } from './facing.ts'
import { finish, firstFit, fits, toBlocker } from './fit.ts'
import { livability, pick, scored } from './score.ts'
import { candidates, nearCands, nudged } from './spots.ts'
import type { Blocker, Cand, Place, Site } from './types.ts'

const TAU = Math.PI * 2
const ROW_GAP = 0.15

type Arr = Arrangement | 'each'

function defaultArrange(where: Place, side: Side | undefined): Arr {
  if (where === 'wall' || where === 'window' || where === 'door') return 'row'
  if (where === 'corner') return 'each'
  if (where === 'near') return side === 'on' || side === 'beside' || side === 'opposite' ? 'each' : 'row'
  return 'cluster'
}

function row(site: Site, where: Place, side: Side | undefined, n: number, gap = ROW_GAP): Cand[] {
  const L = site.fp.length
  const span = n * L + (n - 1) * gap
  const line = (c: Cand): Cand[] | null => {
    const base = finish(site, c)
    const axis = sideOf(base.yaw)
    const group: Cand[] = []
    const extra: Blocker[] = []
    for (let i = 0; i < n; i++) {
      const p: Cand = { ...base, pos: add(base.pos, axis, (i - (n - 1) / 2) * (L + gap)), pinned: true }
      const f = fits(site, p, extra)
      if (!f) return null
      group.push(f)
      extra.push(toBlocker(site, f))
    }
    return group
  }
  // A row is scored by its middle: the wall it is on and how far it keeps from the walking lanes.
  const score = scored(site, where) ? (g: Cand[]) => livability(site, g[Math.floor(g.length / 2)]!) : undefined
  return pick(site, candidates(site, where, side, span), line, score) ?? each(site, where, side, n)
}

/** One at a time, each avoiding the ones before: as many as the room takes. */
function each(site: Site, where: Place, side: Side | undefined, n: number): Cand[] {
  const out: Cand[] = []
  const extra: Blocker[] = []
  // An anchor that is already taken (the nightstand that has its lamp) is skipped, not the end of the line.
  for (let i = 0; out.length < n && i < n + site.anchors.length; i++) {
    const anchor = site.anchors[i % Math.max(1, site.anchors.length)]
    const forAnchor = anchor && anchor !== site.anchor ? { ...site, anchor } : site
    const score = scored(forAnchor, where) ? (c: Cand) => livability(forAnchor, c, extra) : undefined
    const f = pick(forAnchor, candidates(forAnchor, where, side, site.fp.length), c => fits(forAnchor, finish(forAnchor, c), extra), score)
    if (!f) {
      if (site.anchors.length > 1) continue
      break
    }
    out.push(f)
    extra.push(toBlocker(site, f))
  }
  return out
}

function cluster(site: Site, where: Place, side: Side | undefined, n: number): Cand[] {
  const base = firstFit(site, candidates(site, where, side, site.fp.length), [])
  if (!base) return []
  const out = [base]
  const extra = [toBlocker(site, base)]
  const R = 0.45 * Math.sqrt(n) * Math.max(site.fp.length, site.fp.width) + 0.25
  for (let i = 1; i < n; i++) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const a = site.rand() * TAU
      const r = R * Math.sqrt(site.rand())
      const pos: Vec2 = [base.pos[0] + Math.cos(a) * r, base.pos[1] + Math.sin(a) * r]
      const yaw = site.kind.face === 'room' ? faceToward(pos, base.pos) : normYaw(base.yaw + (site.rand() - 0.5) * 0.6)
      const f = firstFit(site, nudged([{ ...base, pos, yaw, pinned: false }]), extra)
      if (!f) continue
      out.push(f)
      extra.push(toBlocker(site, f))
      break
    }
  }
  return out
}

function pair(site: Site): Cand[] {
  const out: Cand[] = []
  const extra: Blocker[] = []
  for (const side of ['left', 'right'] as const) {
    const f = firstFit(site, nudged(nearCands(site, side, site.fp.length)), extra)
    if (!f) continue
    out.push(f)
    extra.push(toBlocker(site, f))
  }
  return out
}

/** Chairs round a table: long sides first, evenly spread, each facing straight in. Round tables get a ring. */
function around(site: Site, n: number): Cand[] {
  const A = site.anchor!
  const fa = itemFootprint(A)
  const gap = site.spot?.dist ?? 0.05
  const out: Cand[] = []
  const extra: Blocker[] = []
  // A round table's footprint is its bounding square: a chair on the diagonal is clear of the real top, so
  // the ring only checks the room and the other chairs, never the table it rings.
  const round = A.kind === 'round_table' || Math.abs(fa.length - fa.width) < 0.05
  const clear = round ? { ...site, blockers: site.blockers.filter(b => b.id !== A.id) } : site
  const take = (c: Cand) => {
    const f = fits(clear, applyFacing(site, c), extra)
    if (!f) return
    out.push(f)
    extra.push(toBlocker(site, f))
  }
  if (round) {
    const r = fa.length / 2 + gap + site.fp.width / 2
    // In a small kitchen one rotation of the ring puts every chair in an appliance and another clears them
    // all: try square to the room first, then eighth-turns, and keep the rotation that seats the most.
    let best: Cand[] = []
    for (const start of [0, Math.PI / 4, Math.PI / 8, (3 * Math.PI) / 8, site.rand() * TAU]) {
      out.length = 0
      extra.length = 0
      for (let i = 0; i < n; i++) {
        const a = start + (i * TAU) / n
        const pos: Vec2 = [A.pos[0] + Math.cos(a) * r, A.pos[1] + Math.sin(a) * r]
        take({ pos, yaw: faceToward(pos, A.pos), room: A.room, pinned: true })
      }
      if (out.length > best.length) best = [...out]
      if (best.length === n) break
    }
    return best
  }
  const f = frontOf(A.yaw)
  const lft = sideOf(A.yaw)
  const sides = [
    { dir: f, axis: lft, len: fa.length, depth: fa.width / 2 },
    { dir: [-f[0], -f[1]] as Vec2, axis: lft, len: fa.length, depth: fa.width / 2 },
    { dir: lft, axis: f, len: fa.width, depth: fa.length / 2 },
    { dir: [-lft[0], -lft[1]] as Vec2, axis: f, len: fa.width, depth: fa.length / 2 }
  ].map(s => ({ ...s, cap: Math.max(0, Math.floor((s.len + 0.1) / (site.fp.length + 0.1))), seats: 0 }))
  // Long sides fill first, split evenly; the ends take what is left.
  const long = Math.min(n, sides[0]!.cap + sides[1]!.cap)
  sides[0]!.seats = Math.min(sides[0]!.cap, Math.ceil(long / 2))
  sides[1]!.seats = Math.min(sides[1]!.cap, long - sides[0]!.seats)
  const ends = n - sides[0]!.seats - sides[1]!.seats
  sides[2]!.seats = Math.min(sides[2]!.cap, Math.ceil(ends / 2))
  sides[3]!.seats = Math.min(sides[3]!.cap, ends - sides[2]!.seats)
  for (const s of sides) {
    for (let j = 0; j < s.seats; j++) {
      const off = ((j + 0.5) / s.seats - 0.5) * s.len
      const pos = add(A.pos, s.dir, s.depth + gap + site.fp.width / 2, s.axis, off)
      take({ pos, yaw: yawFacing([-s.dir[0], -s.dir[1]]), room: A.room, pinned: true })
    }
  }
  return out
}

export function group(site: Site, where: Place, side: Side | undefined, n: number, arrange: Arrangement | undefined): Cand[] {
  // "Four dining chairs near the table" arrives without arrange: three or more of anything near a table ring it.
  const ring = !arrange && n >= 3 && where === 'near' && (!site.spot?.side || site.spot.side === 'beside') && !!site.anchor?.tags.includes('table')
  // "Two lamps on the nightstands" arrives as a pair: on top of things is always one per anchor, never a floor row.
  const arr: Arr = ring ? 'around' : where === 'near' && side === 'on' ? 'each' : arrange ?? defaultArrange(where, side)
  switch (arr) {
    case 'around': return site.anchor ? around(site, n) : cluster(site, where, side, n)
    case 'pair': return site.anchor && where === 'near' && n === 2 ? pair(site) : row(site, where, side, n, 0.4)
    case 'row': return row(site, where, side, n)
    case 'cluster': return cluster(site, where, side, n)
    case 'each': return each(site, where, side, n)
  }
}
