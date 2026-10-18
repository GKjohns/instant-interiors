/**
 * Built-in plans, so the app has a home to walk the moment it loads and the plan reader has ground truth
 * to be benchmarked against (scripts/draw-plan.mjs draws these to PNG; scripts/bench-extract.mjs reads
 * the PNGs back through the model and scores the result against the numbers here).
 *
 * Plan frame: metres, x right, z down the drawing; polygons wind clockwise on the drawing (positive
 * signed area). Every sample goes through `normalizePlan`, the same path an upload takes.
 */
import { normalizePlan } from './schema.ts'
import type { FloorPlan, LoosePlan } from './schema.ts'

function sample(loose: LoosePlan): FloorPlan {
  const r = normalizePlan(loose, { kind: 'sample', notes: [] })
  if (!r.ok) throw new Error(`bad sample plan "${loose.name}": ${r.reason}`)
  return r.plan
}

/** A 2-bedroom apartment, ~80 m²: living + open kitchen across the top, primary suite and hall below, balcony off the hall. */
export const TWO_BED_APARTMENT: FloorPlan = sample({
  name: 'Two-bedroom apartment',
  units: 'm',
  ceiling: 2.7,
  north: 0,
  rooms: [
    { id: 'living', name: 'Living room', type: 'living', polygon: [[0, 0], [5.5, 0], [5.5, 4.5], [0, 4.5]] },
    { id: 'kitchen', name: 'Kitchen', type: 'kitchen', polygon: [[5.5, 0], [8.5, 0], [8.5, 3], [5.5, 3]] },
    { id: 'bedroom_2', name: 'Bedroom 2', type: 'bedroom', polygon: [[8.5, 0], [11, 0], [11, 4.2], [8.5, 4.2]] },
    { id: 'hall', name: 'Hall', type: 'hall', polygon: [[5.5, 3], [8.5, 3], [8.5, 7.5], [6, 7.5], [6, 4.5], [5.5, 4.5]] },
    { id: 'bathroom', name: 'Bathroom', type: 'bathroom', polygon: [[0, 4.5], [2, 4.5], [2, 7.5], [0, 7.5]] },
    { id: 'primary', name: 'Primary bedroom', type: 'bedroom', polygon: [[2, 4.5], [6, 4.5], [6, 7.5], [2, 7.5]] },
    { id: 'closet', name: 'Closet', type: 'closet', polygon: [[8.5, 4.2], [11, 4.2], [11, 5.5], [8.5, 5.5]] },
    { id: 'balcony', name: 'Balcony', type: 'balcony', polygon: [[8.5, 5.5], [11, 5.5], [11, 7.5], [8.5, 7.5]] }
  ],
  openings: [
    { kind: 'door', at: [7.25, 7.5], width: 0.95, rooms: ['hall', 'outside'] },
    { kind: 'opening', at: [5.5, 3.75], width: 1.2, rooms: ['living', 'hall'] },
    { kind: 'opening', at: [5.5, 1.5], width: 1.8, rooms: ['living', 'kitchen'] },
    { kind: 'opening', at: [7, 3], width: 1.0, rooms: ['kitchen', 'hall'] },
    { kind: 'door', at: [8.5, 3.6], width: 0.85, rooms: ['hall', 'bedroom_2'] },
    { kind: 'door', at: [6, 6], width: 0.85, rooms: ['hall', 'primary'] },
    { kind: 'door', at: [2, 6], width: 0.75, rooms: ['primary', 'bathroom'] },
    { kind: 'door', at: [8.5, 4.85], width: 0.8, rooms: ['hall', 'closet'] },
    { kind: 'door', at: [8.5, 6.5], width: 1.0, rooms: ['hall', 'balcony'] },
    { kind: 'window', at: [2.75, 0], width: 2.4, rooms: ['living', 'outside'] },
    { kind: 'window', at: [0, 2.25], width: 1.6, rooms: ['living', 'outside'] },
    { kind: 'window', at: [7, 0], width: 1.2, rooms: ['kitchen', 'outside'] },
    { kind: 'window', at: [9.75, 0], width: 1.6, rooms: ['bedroom_2', 'outside'] },
    { kind: 'window', at: [11, 2.1], width: 1.4, rooms: ['bedroom_2', 'outside'] },
    { kind: 'window', at: [4, 7.5], width: 2.0, rooms: ['primary', 'outside'] },
    { kind: 'window', at: [1, 7.5], width: 0.8, rooms: ['bathroom', 'outside'] }
  ]
})

export const SAMPLES: FloorPlan[] = [TWO_BED_APARTMENT]

export function sampleById(id: string): FloorPlan | undefined {
  return SAMPLES.find(p => p.id === id)
}
