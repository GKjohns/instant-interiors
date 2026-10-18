/**
 * Two reads, one answer: the plan reader runs twice on the same image (the model varies run to run, and
 * Sonnet ignores temperature and seed, so the two reads differ on their own) and keeps the better read by
 * a deterministic score. Every term is something a wrong read gets wrong and a right read can't fake:
 *
 *   coverage       union of room areas over the bounding box (holes = a missed room or a short wall line)
 *   overlap        floor claimed by two rooms (a room drawn past its wall line)
 *   interventions  doors `connectRooms` had to invent (the reader missed them)
 *   sealed         non-hall rooms the reader gave no way in at all
 *   walled         living/kitchen/dining pairs sharing a long wall with no opening between them (the usual
 *                  way a read fails an open plan: the kitchen comes back walled off)
 *   labels         each room's bounds against its printed dimension label ("11'5\" x 17'1\"")
 *   room count     agreement with the other read; when they differ by one tiny room (a W/D, a mech
 *                  closet), the read that found it
 *
 * Pure, no network: tests feed it saved reads.
 */
import { normalizeId } from './schema.ts'
import type { FloorPlan, LoosePlan } from './schema.ts'
import { area, bounds, pointInPolygon } from './poly.ts'
import { walls } from './geometry/walls.ts'

const FT = 0.3048
/** Grid step for the coverage raster: 10 cm is finer than the 5 cm-snapped walls matter at, and ~10k samples. */
const STEP = 0.1
/** A room below this is a closet-sized extra (W/D, mech, linen): finding it is a plus, missing it is minor. */
const TINY = 3.5

export const WEIGHTS = { coverage: 40, overlapPerM2: 10, overlapCap: 30, intervention: 4, sealed: 2, walled: 4, label: 40, count: 5 } as const
const OPEN_PLAN = new Set(['living', 'kitchen', 'dining'])
/** Shorter shared walls between two open-plan rooms can be a real partition (a galley's end wall). */
const WALLED_MIN = 1.5

export interface Label { room: string, width: number, depth: number }

export interface ReadInput {
  /** The normalized plan before `connectRooms`: what the reader drew. */
  plan: FloorPlan
  loose: LoosePlan
  /** How many openings `connectRooms` added to make it walkable. */
  interventions: number
}

export interface ReadScore {
  total: number
  rooms: number
  coverage: number
  overlapM2: number
  interventions: number
  sealed: number
  walled: number
  /** Mean relative error of labelled rooms' bounds (0 = exact); null when no labels were read. */
  labelErr: number | null
  countBonus: number
  /** One short phrase per term that moved the score, for logs and the bench. */
  why: string[]
}

/** Union coverage and doubly-claimed floor, by sampling cell centres over the bounding box. */
export function tiling(plan: FloorPlan): { coverage: number, overlapM2: number } {
  const b = bounds(plan.rooms.flatMap(r => r.polygon))
  let cells = 0
  let covered = 0
  let doubled = 0
  // Samples sit 2.5 cm off the 5 cm grid walls snap to, and the edge tolerance is off (-1), so a point on a
  // shared wall is never counted in both rooms.
  for (let i = 0; b.min[0] + STEP / 4 + i * STEP < b.max[0]; i++) {
    for (let j = 0; b.min[1] + STEP / 4 + j * STEP < b.max[1]; j++) {
      const p: [number, number] = [b.min[0] + STEP / 4 + i * STEP, b.min[1] + STEP / 4 + j * STEP]
      cells++
      let n = 0
      for (const r of plan.rooms) if (pointInPolygon(p, r.polygon, -1)) n++
      if (n) covered++
      if (n > 1) doubled++
    }
  }
  return { coverage: cells ? covered / cells : 0, overlapM2: doubled * STEP * STEP }
}

/** The printed labels in metres; a read with none borrows the other read's (the drawing's labels are the same). */
export function labelsOf(loose: LoosePlan): Label[] {
  const k = loose.units === 'ft' ? FT : 1
  return (loose.labels ?? []).filter(l => l.width > 0 && l.depth > 0).map(l => ({ room: l.room, width: l.width * k, depth: l.depth * k }))
}

/** Mean error of each labelled room's bounding box against its label, either orientation; a missing room counts 1. */
export function labelError(plan: FloorPlan, labels: Label[]): number | null {
  if (!labels.length) return null
  const errs = labels.map((l) => {
    const key = normalizeId(l.room)
    const room = plan.rooms.find(r => r.id === key || normalizeId(r.name) === key)
    if (!room) return 1
    const s = bounds(room.polygon).size
    const e = (w: number, d: number) => (Math.abs(w - l.width) / l.width + Math.abs(d - l.depth) / l.depth) / 2
    return Math.min(1, e(s[0], s[1]), e(s[1], s[0]))
  })
  return errs.reduce((a, b) => a + b, 0) / errs.length
}

/** Rooms other than halls with no door or opening (a balcony's glass counts: it is how you see out to it). */
export function sealedRooms(plan: FloorPlan): string[] {
  return plan.rooms.filter(r => r.type !== 'hall' && !plan.openings.some(o => o.rooms.includes(r.id) && (o.kind !== 'window' || r.type === 'balcony'))).map(r => r.id)
}

/** Living/kitchen/dining pairs that share a long wall the reader left with no door or opening: "a|b" ids. */
export function walledOpenPlan(plan: FloorPlan): string[] {
  const type = new Map(plan.rooms.map(r => [r.id, r.type]))
  const pairs = new Map<string, { long: boolean, linked: boolean }>()
  for (const w of walls(plan)) {
    if (w.exterior || !OPEN_PLAN.has(type.get(w.rooms[0]) ?? '') || !OPEN_PLAN.has(type.get(w.rooms[1]) ?? '')) continue
    const key = [...w.rooms].sort().join('|')
    const p = pairs.get(key) ?? { long: false, linked: false }
    p.long ||= w.length >= WALLED_MIN
    p.linked ||= w.openings.some(o => o.kind !== 'window')
    pairs.set(key, p)
  }
  return [...pairs].filter(([, p]) => p.long && !p.linked).map(([k]) => k)
}

function baseScore(read: ReadInput, labels: Label[]): ReadScore {
  const t = tiling(read.plan)
  const sealed = sealedRooms(read.plan).length
  const walled = walledOpenPlan(read.plan).length
  const labelErr = labelError(read.plan, labels)
  const why: string[] = [`coverage ${(100 * t.coverage).toFixed(0)}%`]
  let total = WEIGHTS.coverage * t.coverage
  if (t.overlapM2 > 0.05) {
    total -= Math.min(WEIGHTS.overlapCap, WEIGHTS.overlapPerM2 * t.overlapM2)
    why.push(`overlap ${t.overlapM2.toFixed(1)} m²`)
  }
  if (read.interventions) {
    total -= WEIGHTS.intervention * read.interventions
    why.push(`${read.interventions} invented`)
  }
  if (sealed) {
    total -= WEIGHTS.sealed * sealed
    why.push(`${sealed} sealed`)
  }
  if (walled) {
    total -= WEIGHTS.walled * walled
    why.push(`${walled} open plan walled off`)
  }
  if (labelErr !== null) {
    total -= WEIGHTS.label * labelErr
    why.push(`labels off ${(100 * labelErr).toFixed(0)}%`)
  }
  return { total, rooms: read.plan.rooms.length, coverage: t.coverage, overlapM2: t.overlapM2, interventions: read.interventions, sealed, walled, labelErr, countBonus: 0, why }
}

/** The smallest room in `big` whose id `small` lacks: the one extra room when two reads differ by one. */
function extraRoom(big: FloorPlan, small: FloorPlan) {
  const ids = new Set(small.rooms.map(r => r.id))
  return big.rooms.filter(r => !ids.has(r.id)).sort((a, b) => area(a.polygon) - area(b.polygon))[0]
}

/**
 * Score every read (null = that read failed) and pick the best: highest total, ties to the earlier read.
 * Room-count agreement is relative, so it is added here: each read gets the bonus for every other read with
 * the same room count; when exactly two reads differ by one and the larger one's extra room is tiny, the
 * larger read gets it instead (a W/D closet is real; a read that skipped it is the sloppier one).
 */
export function chooseRead(reads: (ReadInput | null)[]): { chosen: number, scores: (ReadScore | null)[] } {
  const own = reads.map(r => (r ? labelsOf(r.loose) : []))
  const shared = own.find(l => l.length) ?? []
  const scores = reads.map((r, i) => (r ? baseScore(r, own[i]!.length ? own[i]! : shared) : null))
  const ok = scores.map((s, i) => ({ s, r: reads[i] })).filter((x): x is { s: ReadScore, r: ReadInput } => !!x.s && !!x.r)
  for (const x of ok) {
    const same = ok.filter(y => y !== x && y.s.rooms === x.s.rooms).length
    if (same) {
      x.s.countBonus = WEIGHTS.count * same
      x.s.why.push('room count agrees')
    }
  }
  if (ok.length === 2 && Math.abs(ok[0]!.s.rooms - ok[1]!.s.rooms) === 1) {
    const [small, big] = ok[0]!.s.rooms < ok[1]!.s.rooms ? [ok[0]!, ok[1]!] : [ok[1]!, ok[0]!]
    const extra = extraRoom(big.r.plan, small.r.plan)
    if (extra && area(extra.polygon) < TINY) {
      big.s.countBonus = WEIGHTS.count
      big.s.why.push(`found the extra ${extra.id}`)
    }
  }
  for (const x of ok) x.s.total = +(x.s.total + x.s.countBonus).toFixed(2)
  let chosen = -1
  scores.forEach((s, i) => {
    if (s && (chosen < 0 || s.total > scores[chosen]!.total)) chosen = i
  })
  return { chosen, scores }
}
