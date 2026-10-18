/**
 * The home state: the plan, the furniture in it, the light, and the op log that rebuilt it. Plain data,
 * no three.js. The log is the truth: replaying it from the plan rebuilds the same home (positions are
 * seeded from each batch's stored context), which is how undo, save and load work.
 */
import type { FloorPlan } from '../plan/schema.ts'
import type { Vec2 } from '../plan/poly.ts'
import type { DroppedOp, Op, Props, TimeOfDay } from './ops.ts'

export interface Item {
  /** `${kind}#${n}`. */
  id: string
  kind: string
  /** The room whose floor it stands on. */
  room: string
  /** Centre of the footprint in the plan frame (metres). */
  pos: Vec2
  /** Radians, three.js convention: 0 faces -z (north / up the drawing), positive turns toward -x (west). */
  yaw: number
  /** Bottom of the piece above the floor; omitted = on the floor. The anchor's top for a lamp on a nightstand, the hang height for wall pieces, the ceiling for hung fixtures. */
  y?: number
  props: Props
  /** The batch group it was placed in (`g<n>`), for "last" and group selection. */
  group: string
  tags: string[]
}

export interface Light {
  time: TimeOfDay
  lamps: boolean
  /** 0 = cool, 1 = candle-warm. */
  warmth: number
}

export interface OpContext {
  /** Where the player was looking when the sentence started: a floor point, maybe an item, and its room. */
  gaze: { point: Vec2, itemId?: string, room?: string }
  player: { pos: Vec2, yaw: number, room?: string }
  /** Stable per-sentence seed so replay places things identically. */
  seed: number
}

export interface Batch {
  id: string
  label: string
  ops: Op[]
  ctx: OpContext
  at: number
}

export interface HomeState {
  /** The live plan: surface ops write copied rooms here. */
  plan: FloorPlan
  /** The plan as loaded; replay and undo rebuild from it. */
  base: FloorPlan
  items: Item[]
  light: Light
  log: Batch[]
  nextId: number
  nextGroup: number
  lastGroup: string | null
}

/** What a batch did, for the renderer to animate and the HUD / voice to report honestly. */
export interface Effects {
  placed: string[]
  moved: string[]
  modified: string[]
  removed: string[]
  /** `${roomId}:${part}` for every finish that changed. */
  surfaces: string[]
  light: boolean
  reset: boolean
  goto?: { pos: Vec2, yaw: number, room?: string }
  say: string[]
  /** Why ops did nothing ("move: nothing matches sofa in the kitchen"). */
  notes: string[]
}

export interface BatchResult {
  state: HomeState
  ops: Op[]
  dropped: DroppedOp[]
  effects: Effects
  batch?: Batch
}
