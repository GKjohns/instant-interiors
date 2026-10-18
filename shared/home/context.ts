/**
 * The model's view of the home for one sentence: the trimmed scene the client posts to /api/intent and
 * the compact text block the intent digest is followed by. Pure data, no three.js. Room facts come
 * straight from the plan polygons, so the server can build the block from a posted scene alone.
 *
 * Haiku pays for every token here, so the block is terse: one line per room, one line per room's items
 * (grouped by kind), the gaze, the light. Items are never listed by id: the selector language has no id
 * field, so the model targets by kind + room (or `ref: gaze`), and ids only appear on the gaze line
 * so "that" is unambiguous to a human reading the log.
 */
import { walls } from '../plan/geometry/walls.ts'
import { bounds, centroid, compassOf, dist, nearestEdge } from '../plan/poly.ts'
import type { Vec2 } from '../plan/poly.ts'
import type { FloorPlan, Opening, Room, RoomType } from '../plan/schema.ts'
import type { Props, WallSide } from './ops.ts'
import type { HomeState, Light, OpContext } from './types.ts'

// ---------- the trimmed scene (what the client sends) ----------

export interface SceneRoom {
  id: string
  name: string
  type: RoomType
  /** Bounding-box size [width along x, depth along z] in metres. */
  size: Vec2
  /** Area centroid, metres. */
  center: Vec2
  /** Compass walls that carry a window. */
  windows: WallSide[]
  /**
   * Doors and cased openings: which wall they sit on and where they lead (`outside` for the entry). `open`
   * marks an open-plan boundary (no wall at all), so the model treats the two rooms as one continuous space.
   */
  doors: { to: string, wall: WallSide, kind: 'door' | 'opening', open?: boolean }[]
}

export interface SceneItem {
  id: string
  kind: string
  room: string
  /** Rounded to 0.1 m. */
  pos: Vec2
  /** Degrees, 0 = faces north (-z), positive turns west. */
  yaw: number
  /** Only the props that are set. */
  props: Props
  tags: string[]
  group: string
}

export interface Scene {
  plan: { id: string, name: string, north: number }
  rooms: SceneRoom[]
  items: SceneItem[]
  light: Light
  lastGroup: string | null
  /** The sentence that made the last batch, so "those" / "undo" read naturally. */
  lastLabel?: string
}

const WALL_ORDER: WallSide[] = ['north', 'east', 'south', 'west']

/** Which compass wall of `room` an opening sits on: the room's nearest edge, outward normal → compass. */
export function wallOf(room: Pick<Room, 'polygon'>, at: Vec2): WallSide {
  return compassOf(nearestEdge(at, room.polygon).normal)
}

function trimRoom(room: Room, openings: Opening[], open: Set<string>): SceneRoom {
  const windows = new Set<WallSide>()
  const doors: SceneRoom['doors'] = []
  for (const o of openings) {
    if (!o.rooms.includes(room.id)) continue
    const wall = wallOf(room, o.at)
    if (o.kind === 'window') windows.add(wall)
    else doors.push({ to: o.rooms[0] === room.id ? o.rooms[1] : o.rooms[0], wall, kind: o.kind, ...(open.has(o.id) ? { open: true } : {}) })
  }
  const b = bounds(room.polygon)
  const c = centroid(room.polygon)
  return {
    id: room.id,
    name: room.name,
    type: room.type,
    size: [round1(b.size[0]), round1(b.size[1])],
    center: [round1(c[0]), round1(c[1])],
    windows: WALL_ORDER.filter(w => windows.has(w)),
    doors
  }
}

function trimPlan(plan: FloorPlan): Pick<Scene, 'plan' | 'rooms'> {
  const open = new Set(walls(plan).flatMap(w => w.openings.filter(o => o.open).map(o => o.id)))
  return {
    plan: { id: plan.id, name: plan.name, north: plan.north },
    rooms: plan.rooms.map(r => trimRoom(r, plan.openings, open))
  }
}

export function trimScene(state: HomeState): Scene {
  const last = state.log[state.log.length - 1]
  return {
    ...trimPlan(state.plan),
    items: state.items.map(it => ({
      id: it.id,
      kind: it.kind,
      room: it.room,
      pos: [round1(it.pos[0]), round1(it.pos[1])],
      yaw: Math.round((it.yaw * 180) / Math.PI),
      props: setProps(it.props),
      tags: it.tags,
      group: it.group
    })),
    light: state.light,
    lastGroup: state.lastGroup,
    lastLabel: last && last.id === state.lastGroup ? last.label : undefined
  }
}

/** A posted scene may be partial or hand-made; fill what's missing so the block never throws. */
export function sceneOf(scene: Partial<Scene> | undefined): Scene {
  return {
    plan: scene?.plan ?? { id: 'plan', name: 'Floor plan', north: 0 },
    rooms: (scene?.rooms ?? []).filter(r => r && typeof r.id === 'string'),
    items: (scene?.items ?? []).filter(i => i && typeof i.kind === 'string' && Array.isArray(i.pos)),
    light: scene?.light ?? { time: 'afternoon', lamps: false, warmth: 0.5 },
    lastGroup: scene?.lastGroup ?? null,
    lastLabel: scene?.lastLabel
  }
}

// ---------- words for directions ----------

const COMPASS = ['N', 'NW', 'W', 'SW', 'S', 'SE', 'E', 'NE'] // yaw 0 = north, positive turns left (west)

export function compass(yaw: number): string {
  const i = Math.round(yaw / (Math.PI / 4))
  return COMPASS[((i % 8) + 8) % 8]!
}

/** "ahead", "ahead-left", "behind-right"… relative to where the player faces (yaw 0 = -z, positive = toward -x). */
export function relativeDir(ctx: OpContext, p: Vec2): string {
  const dx = p[0] - ctx.player.pos[0]
  const dz = p[1] - ctx.player.pos[1]
  if (Math.hypot(dx, dz) < 0.3) return 'here'
  const f: Vec2 = [-Math.sin(ctx.player.yaw), -Math.cos(ctx.player.yaw)]
  const r: Vec2 = [Math.cos(ctx.player.yaw), -Math.sin(ctx.player.yaw)]
  const ahead = dx * f[0] + dz * f[1]
  const side = dx * r[0] + dz * r[1]
  const a = Math.atan2(side, ahead) // 0 ahead, +π/2 right
  const words = ['ahead', 'ahead-right', 'right', 'behind-right', 'behind', 'behind-left', 'left', 'ahead-left']
  const i = Math.round(a / (Math.PI / 4))
  return words[((i % 8) + 8) % 8]!
}

/** The room whose bounding box holds the point (a fallback when the client didn't say). */
export function roomAtPoint(scene: Scene, p: Vec2): SceneRoom | undefined {
  return scene.rooms.find(r => Math.abs(p[0] - r.center[0]) <= r.size[0] / 2 + 0.05 && Math.abs(p[1] - r.center[1]) <= r.size[1] / 2 + 0.05)
}

// ---------- the block ----------

/** Props worth a word in the block: colour and material read as the thing's identity; lit 0 says a lamp is off. */
function propText(props: Props): string {
  const bits: string[] = []
  if (props.color) bits.push(props.color)
  if (props.material) bits.push(props.material)
  if (props.lit === 0) bits.push('off')
  else if (props.lit !== undefined && props.lit > 1) bits.push('bright')
  if (props.scale !== undefined && props.scale !== 1) bits.push(`×${round1(props.scale)}`)
  return bits.join(', ')
}

const ITEMS_PER_ROOM = 12
const FACES = new Set(['sofa', 'sectional', 'loveseat', 'desk', 'dresser', 'tv_stand', 'piano'])

/** The compass wall at the thing's back when it stands within a bed's depth of it (else it floats). */
function backWall(it: SceneItem, room: SceneRoom): string | null {
  const back = compass((it.yaw * Math.PI) / 180)
  const [hx, hz] = [room.size[0] / 2, room.size[1] / 2]
  const gap: Record<string, number> = { N: it.pos[1] - (room.center[1] - hz), S: room.center[1] + hz - it.pos[1], W: it.pos[0] - (room.center[0] - hx), E: room.center[0] + hx - it.pos[0] }
  return gap[back] !== undefined && gap[back] < 1.3 ? back : null
}

/** Items of one room grouped by kind (+ distinguishing props): "sofa (navy) · armchair ×2 · floor_lamp". */
function roomItemsText(items: SceneItem[], room?: SceneRoom): string {
  const groups = new Map<string, { kind: string, props: string, n: number }>()
  for (const it of items) {
    // The big wall pieces say where they stand, so "the other wall" has an answer. "against N wall" rather
    // than "faces S": Haiku read "faces S" as "is on the south wall" and moved the bed onto its own wall.
    const big = it.tags.includes('bed') || FACES.has(it.kind)
    const back = big && room ? backWall(it, room) : null
    const facing = back ? `against ${back} wall` : big ? `faces ${compass(((it.yaw + 180) * Math.PI) / 180)}` : ''
    const props = [propText(it.props), facing].filter(Boolean).join(', ')
    const key = `${it.kind}|${props}`
    const g = groups.get(key)
    if (g) g.n++
    else groups.set(key, { kind: it.kind, props, n: 1 })
  }
  const all = [...groups.values()]
  const shown = all.slice(0, ITEMS_PER_ROOM).map(g => `${g.kind}${g.n > 1 ? ` ×${g.n}` : ''}${g.props ? ` (${g.props})` : ''}`)
  const rest = all.slice(ITEMS_PER_ROOM).reduce((s, g) => s + g.n, 0)
  return shown.join(' · ') + (rest ? ` · …and ${rest} more` : '')
}

function roomLine(r: SceneRoom): string {
  const bits = [`${r.name} ${r.size[0]}×${r.size[1]} m`]
  if (r.windows.length) bits.push(`windows ${r.windows.join('+')}`)
  // "open to kitchen" says there is no wall between them: one continuous space, so "the dining area" or
  // "across from the island" can mean the room next door. Everything else is a doorway.
  const open = [...new Set((r.doors ?? []).filter(d => d.open).map(d => d.to))]
  const to = [...new Set((r.doors ?? []).map(d => d.to))].filter(t => !open.includes(t))
  if (open.length) bits.push(`open to ${open.join(', ')}`)
  if (to.length) bits.push(`doors → ${to.join(', ')}`)
  return `- ${r.id}: ${bits.join(', ')}`
}

/**
 * The per-sentence context. Example:
 *   player: in living (Living room), facing N
 *   gaze: sofa#1 (sofa, navy) in living, 2.3 m ahead
 *   last: g3 "a lamp by the sofa" → floor_lamp ×1
 *   rooms (id: name size, windows, open to, doors →):
 *   - living: Living room 5.5×4.5 m, windows north+west, open to kitchen, doors → hall
 *   items by room:
 *   - living: sofa (navy) · rug · coffee_table · floor_lamp
 *   - kitchen: empty
 *   light: afternoon · lamps off · warmth 0.5
 */
export function buildContext(sceneIn: Partial<Scene> | undefined, ctx: OpContext): string {
  const scene = sceneOf(sceneIn)
  const lines: string[] = []
  const byId = new Map(scene.rooms.map(r => [r.id, r]))
  const pp = ctx.player.pos

  const playerRoom = (ctx.player.room && byId.get(ctx.player.room)) || roomAtPoint(scene, pp)
  lines.push(`player: ${playerRoom ? `in ${playerRoom.id} (${playerRoom.name})` : 'outside any room'}, facing ${compass(ctx.player.yaw)}`)

  const gp = ctx.gaze.point
  const hit = ctx.gaze.itemId ? scene.items.find(i => i.id === ctx.gaze.itemId) : undefined
  const gazeRoom = (ctx.gaze.room && byId.get(ctx.gaze.room)) || (hit && byId.get(hit.room)) || roomAtPoint(scene, gp)
  const gd = round1(dist(hit ? hit.pos : gp, pp))
  if (hit) {
    const props = propText(hit.props)
    lines.push(`gaze: ${hit.id} (${hit.kind}${props ? `, ${props}` : ''}) in ${hit.room}, ${gd} m ${relativeDir(ctx, hit.pos)}`)
  } else {
    lines.push(`gaze: floor${gazeRoom ? ` of ${gazeRoom.id}` : ', outside any room'}, ${gd} m ${relativeDir(ctx, gp)}`)
  }

  if (scene.lastGroup) {
    const last = scene.items.filter(i => i.group === scene.lastGroup)
    const made = last.length ? ` → ${roomItemsText(last)}` : ''
    lines.push(`last: ${scene.lastGroup}${scene.lastLabel ? ` "${scene.lastLabel.slice(0, 80)}"` : ''}${made}`)
  }

  if (scene.rooms.length) {
    lines.push('rooms (id: name size, windows, open to, doors →):')
    for (const r of scene.rooms) lines.push(roomLine(r))
  } else {
    lines.push('rooms: none')
  }

  if (scene.items.length) {
    lines.push(`items by room (${scene.items.length} total):`)
    const grouped = new Map<string, SceneItem[]>()
    for (const it of scene.items) grouped.set(it.room, [...(grouped.get(it.room) ?? []), it])
    // Plan order first so the model reads rooms and items in the same order; stray rooms after.
    const order = [...scene.rooms.map(r => r.id), ...[...grouped.keys()].filter(id => !byId.has(id))]
    for (const id of order) {
      const items = grouped.get(id)
      lines.push(`- ${id}: ${items?.length ? roomItemsText(items, byId.get(id)) : 'empty'}`)
    }
  } else {
    lines.push('items: none (the home is bare)')
  }

  const l = scene.light
  lines.push(`light: ${l.time} · lamps ${l.lamps ? 'on' : 'off'} · warmth ${round1(l.warmth)}`)
  return lines.join('\n')
}

function setProps(props: Props): Props {
  return Object.fromEntries(Object.entries(props).filter(([, v]) => v !== undefined)) as Props
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}
