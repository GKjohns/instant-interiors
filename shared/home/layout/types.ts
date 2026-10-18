import type { Vec2 } from '../../plan/poly.ts'
import type { FloorPlan, Room } from '../../plan/schema.ts'
import type { RoomCorner, RoomOpening, RoomWall } from '../../plan/geometry.ts'
import type { KindDescriptor } from '../kinds.ts'
import type { Arrangement, Props, Spot, Where } from '../ops.ts'
import type { Footprint } from '../select.ts'
import type { HomeState, Item, OpContext } from '../types.ts'

export interface Placed {
  pos: Vec2
  yaw: number
  room: string
  /** Bottom of the piece above the floor: omitted on the floor, the anchor's top when placed on it, the hang height for wall pieces, the ceiling for hung fixtures. */
  y?: number
}

export interface LayoutOpts {
  /** The op's index in its batch: part of the seed, so two sofas in one sentence don't share jitter. */
  index: number
  count: number
  arrange?: Arrangement
  seed: number
  existing: Item[]
  props?: Props
}

/** `note` says where a piece went when it could not go where it was asked ("put the stove on the east wall instead"). */
export type LayoutResult = (Placed[] & { note?: string, why?: string }) | { fail: string }

/** Which things can share floor space: rugs go under everything, hung pieces only clash with what reaches them. */
export type Layer = 'floor' | 'under' | 'mounted' | 'ceiling' | 'top'

export interface Blocker {
  id: string
  box: Vec2[]
  layer: Layer
  y: number
  top: number
}

export interface Cand extends Placed {
  /** Against a wall or in a row: swept along, never nudged off its line or pulled toward the centre. */
  pinned?: boolean
  /** The room's own middle: may land where the viewer stands (they step back), see centerCands. */
  middle?: boolean
}

/** Everything one placement is resolved against: the room, the piece, its anchors and what is already there. */
export interface Site {
  state: HomeState
  plan: FloorPlan
  ctx: OpContext
  room: Room
  poly: Vec2[]
  center: Vec2
  walls: RoomWall[]
  corners: RoomCorner[]
  windows: RoomOpening[]
  doors: RoomOpening[]
  kind: KindDescriptor
  fp: Footprint
  props: Props
  spot: Spot | undefined
  anchor?: Item
  anchors: Item[]
  blockers: Blocker[]
  rand: () => number
  ceiling: number
}

export type Place = Where | 'free'
