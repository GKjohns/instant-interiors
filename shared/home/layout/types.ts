import type { Vec2 } from '../../plan/poly.ts'
import type { FloorPlan, Room } from '../../plan/schema.ts'
import type { Corridor, RoomCorner, RoomOpening, RoomWall } from '../../plan/geometry.ts'
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
  /** The catalog kind behind it (absent for door swings and the viewer): circulation rules differ per kind. */
  kind?: string
  /** The space this piece needs kept clear (a sofa's legroom, a bed's open side), see clear.ts. */
  clear?: Clearance | null
  /** Anchored to a piece that is not standing (being moved or swapped): it follows that piece, so it never shuts a walking lane. */
  follows?: boolean
}

/** Space a piece needs around it to be usable; other pieces keep out of it unless `exempt` lets them in. */
export interface Clearance {
  /** What it is, for notes: "the sofa's legroom". */
  label: string
  zones: Vec2[][]
  /** 'all': every zone must stay clear; 'any': at least one (a bed needs one long side open, prefers both). */
  need: 'all' | 'any'
  /** Kinds that belong in the zone: the coffee table in front of the sofa, chairs round the table. */
  exempt: (kind: KindDescriptor) => boolean
}

export interface Cand extends Placed {
  /** Against a wall or in a row: swept along, never nudged off its line or pulled toward the centre. */
  pinned?: boolean
  /** The room's own middle: may land where the viewer stands (they step back), see centerCands. */
  middle?: boolean
  /** Which room wall / corner the candidate stands against, for livability scoring (score.ts). */
  wall?: number
  corner?: number
  /** Candidates sharing a slot (one wall stretch, one corner) are alternatives; scoring takes the first fit per slot. */
  slot?: string
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
  /** Where people walk (shared/plan/geometry/circulation.ts): floor pieces keep out. */
  corridors: Corridor[]
  /** Why candidates were turned away for circulation, counted, so a failure can say "would block the way…". Shared by copies of the site. */
  why: Map<string, number>
}

export type Place = Where | 'free'
