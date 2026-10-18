/**
 * The building from the plan: a floor and ceiling per room, walls from `walls(plan)` as one box per cut
 * piece, baseboards, door frames and open leaves, window frames with glass and a sill, and a "sky card"
 * outside every exterior window so looking out reads as daylight. Static geometry is merged per material
 * (one draw call per room finish), so the whole shell is a few dozen meshes.
 *
 * Every finish mesh carries `userData.room` + `userData.part`; `updateSurfaces` swaps materials in place
 * when only finishes change. UVs are in metres everywhere (floors from the shape, walls rewritten per
 * piece and offset along the wall), so `surfaceMaterial(surface, part, [1, 1])` tiles continuously across
 * pieces and finish swaps never re-fit geometry.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { walls } from '../../shared/plan/geometry.ts'
import type { Wall, WallOpening } from '../../shared/plan/geometry.ts'
import type { Vec2 } from '../../shared/plan/poly.ts'
import type { FloorPlan, Surface, SurfacePart } from '../../shared/plan/schema.ts'
import { surfaceMaterial } from './surfaces.ts'

const DEFAULT_CEILING: Surface = { color: '#f4f1ea', pattern: 'plain' }
const FRAME = 0.04
const LEAF = 0.04
/** Each side's half-wall is a little over half thick, so the two overlap instead of sharing a coplanar face. */
const OVERLAP = 0.01
const SKY_OUT = 3

export interface ShellParts {
  floors: THREE.Mesh[]
  ceilings: THREE.Mesh[]
  /** Everything a gaze ray may stop on besides items: floors, walls, doors. */
  solid: THREE.Mesh[]
  /** Meshes whose material follows a room finish. */
  surfaced: THREE.Mesh[]
  skyCards: THREE.Mesh[]
  glass: THREE.MeshPhysicalMaterial
  sky: THREE.MeshBasicMaterial
}

export function shellParts(shell: THREE.Group): ShellParts {
  return shell.userData.parts as ShellParts
}

const trimMat = new THREE.MeshStandardMaterial({ color: '#f3efe7', roughness: 0.55 })
const leafMat = new THREE.MeshStandardMaterial({ color: '#e7e0d3', roughness: 0.5 })
const frontDoorMat = new THREE.MeshStandardMaterial({ color: '#4f4238', roughness: 0.6 })
const exteriorMat = new THREE.MeshStandardMaterial({ color: '#d8cfc2', roughness: 0.95 })
const handleMat = new THREE.MeshStandardMaterial({ color: '#b8b0a0', roughness: 0.3, metalness: 0.9 })

export function buildShell(plan: FloorPlan): THREE.Group {
  const shell = new THREE.Group()
  shell.name = 'shell'
  const parts: ShellParts = {
    floors: [], ceilings: [], solid: [], surfaced: [], skyCards: [],
    glass: new THREE.MeshPhysicalMaterial({ color: '#dbe9f5', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, emissive: '#dfeeff', emissiveIntensity: 0.4 }),
    sky: new THREE.MeshBasicMaterial({ map: skyGradient(), fog: false, toneMapped: false })
  }
  shell.userData.parts = parts

  for (const room of plan.rooms) {
    const floor = new THREE.Mesh(slab(room.polygon, false), surfaceMaterial(room.floor, 'floor', [1, 1]))
    floor.receiveShadow = true
    floor.userData = { room: room.id, part: 'floor' }
    const ceiling = new THREE.Mesh(slab(room.polygon, true), surfaceMaterial(room.ceiling ?? DEFAULT_CEILING, 'ceiling', [1, 1]))
    ceiling.position.y = plan.ceiling
    ceiling.userData = { room: room.id, part: 'ceiling' }
    shell.add(floor, ceiling)
    parts.floors.push(floor)
    parts.ceilings.push(ceiling)
    parts.solid.push(floor)
    parts.surfaced.push(floor, ceiling)
  }

  // Wall boxes bucketed by finish: `<room>` for a room-facing half, `outside` for the street side.
  const byFinish = new Map<string, THREE.BufferGeometry[]>()
  const trim: THREE.BufferGeometry[] = []
  const leaves: THREE.BufferGeometry[] = []
  const handles: THREE.BufferGeometry[] = []
  const panes: THREE.BufferGeometry[] = []
  const bucket = (key: string) => {
    let list = byFinish.get(key)
    if (!list) byFinish.set(key, list = [])
    return list
  }

  for (const w of walls(plan)) {
    const dir = unit(w.a, w.b)
    const half = w.thickness / 2
    for (const piece of w.pieces) {
      const len = piece.to - piece.from
      const h = piece.y1 - piece.y0
      const mid = lerp2(piece.a, piece.b, 0.5)
      for (const side of [0, 1] as const) {
        const sign = side === 0 ? -1 : 1
        const g = new THREE.BoxGeometry(len, h, half + OVERLAP)
        metreUvs(g, piece.from + len / 2, (piece.y0 + piece.y1) / 2)
        g.applyMatrix4(place(mid[0] + w.normal[0] * sign * (half - OVERLAP) / 2, (piece.y0 + piece.y1) / 2, mid[1] + w.normal[1] * sign * (half - OVERLAP) / 2, dir))
        bucket(w.rooms[side]).push(g)
      }
      // Baseboards hug floor-level pieces on each room side.
      if (piece.y0 === 0) {
        for (const side of [0, 1] as const) {
          if (w.rooms[side] === 'outside') continue
          const sign = side === 0 ? -1 : 1
          const g = new THREE.BoxGeometry(len, 0.08, 0.012)
          g.applyMatrix4(place(mid[0] + w.normal[0] * sign * (half + 0.006), 0.04, mid[1] + w.normal[1] * sign * (half + 0.006), dir))
          trim.push(g)
        }
      }
    }
    for (const o of w.openings) {
      if (o.kind === 'window') window_(w, o, dir, trim, panes)
      else door(w, o, dir, trim, leaves, handles)
      if (o.kind === 'window' && w.exterior) parts.skyCards.push(skyCard(w, o, plan.ceiling, parts.sky))
    }
  }

  for (const [key, list] of byFinish) {
    const room = plan.rooms.find(r => r.id === key)
    const mesh = merged(list, room ? surfaceMaterial(room.walls, 'walls', [1, 1]) : exteriorMat)
    mesh.userData = { room: key, part: 'walls' }
    shell.add(mesh)
    parts.solid.push(mesh)
    if (room) parts.surfaced.push(mesh)
  }
  if (trim.length) shell.add(merged(trim, trimMat))
  if (leaves.length) {
    const doors = merged(leaves, leafMat)
    shell.add(doors)
    parts.solid.push(doors)
  }
  if (handles.length) shell.add(merged(handles, handleMat))
  if (panes.length) {
    const glass = merged(panes, parts.glass)
    glass.castShadow = false
    glass.receiveShadow = false
    glass.renderOrder = 3
    shell.add(glass)
    // A gaze through a window stops at the pane, so "there" stays in the room rather than out on the lawn.
    parts.solid.push(glass)
  }
  for (const card of parts.skyCards) shell.add(card)
  frontDoors(plan, shell)
  return shell
}

/** Re-point every finish mesh at the plan's current surfaces; `surfaceMaterial` caches, so unchanged rooms cost nothing. */
export function updateSurfaces(shell: THREE.Group, plan: FloorPlan): void {
  const rooms = new Map(plan.rooms.map(r => [r.id, r]))
  for (const m of shellParts(shell).surfaced) {
    const room = rooms.get(m.userData.room as string)
    if (!room) continue
    const part = m.userData.part as SurfacePart
    const surface = part === 'ceiling' ? room.ceiling ?? DEFAULT_CEILING : room[part]
    const next = surfaceMaterial(surface, part, [1, 1])
    if (m.material !== next) m.material = next
  }
}

// ---------- pieces ----------

/** Door frame (jambs + head) on the wall centreline, and a leaf swung ~80° into rooms[0]; openings get the frame only. */
function door(w: Wall, o: WallOpening, dir: Vec2, trim: THREE.BufferGeometry[], leaves: THREE.BufferGeometry[], handles: THREE.BufferGeometry[]): void {
  const depth = w.thickness + 0.02
  const at = (along: number) => lerp2(w.a, w.b, along / w.length)
  for (const s of [-1, 1]) {
    const p = at(o.along + s * (o.width / 2 - FRAME / 2))
    const g = new THREE.BoxGeometry(FRAME, o.y1, depth)
    g.applyMatrix4(place(p[0], o.y1 / 2, p[1], dir))
    trim.push(g)
  }
  const headAt = at(o.along)
  const head = new THREE.BoxGeometry(o.width, FRAME, depth)
  head.applyMatrix4(place(headAt[0], o.y1 - FRAME / 2, headAt[1], dir))
  trim.push(head)
  if (o.kind !== 'door' || w.exterior) return
  const leafW = o.width - FRAME * 2 - 0.01
  const leafH = o.y1 - FRAME - 0.02
  const hinge = at(o.along - o.width / 2 + FRAME)
  const swing = 80 * Math.PI / 180
  // Open into rooms[0]: rotate the wall direction toward -normal.
  const ld: Vec2 = [dir[0] * Math.cos(swing) - w.normal[0] * Math.sin(swing), dir[1] * Math.cos(swing) - w.normal[1] * Math.sin(swing)]
  const centre: Vec2 = [hinge[0] + ld[0] * leafW / 2, hinge[1] + ld[1] * leafW / 2]
  const leaf = new THREE.BoxGeometry(leafW, leafH, LEAF)
  leaf.applyMatrix4(place(centre[0], leafH / 2 + 0.01, centre[1], ld))
  leaves.push(leaf)
  const side: Vec2 = [ld[1], -ld[0]]
  for (const s of [-1, 1]) {
    const hp: Vec2 = [hinge[0] + ld[0] * (leafW - 0.07) + side[0] * s * (LEAF / 2 + 0.02), hinge[1] + ld[1] * (leafW - 0.07) + side[1] * s * (LEAF / 2 + 0.02)]
    const h = new THREE.BoxGeometry(0.12, 0.02, 0.02)
    h.applyMatrix4(place(hp[0], 1.0, hp[1], ld))
    handles.push(h)
  }
}

/** Entry doors stay closed (a leaf flush in the opening) so the hall doesn't look out onto the void. */
function frontDoors(plan: FloorPlan, shell: THREE.Group): void {
  const parts = shellParts(shell)
  const list: THREE.BufferGeometry[] = []
  for (const w of walls(plan)) {
    if (!w.exterior) continue
    for (const o of w.openings) {
      if (o.kind !== 'door') continue
      const p = lerp2(w.a, w.b, o.along / w.length)
      const g = new THREE.BoxGeometry(o.width - FRAME * 2 - 0.01, o.y1 - FRAME - 0.02, 0.05)
      g.applyMatrix4(place(p[0], (o.y1 - FRAME - 0.02) / 2 + 0.01, p[1], unit(w.a, w.b)))
      list.push(g)
    }
  }
  if (!list.length) return
  const m = merged(list, frontDoorMat)
  shell.add(m)
  parts.solid.push(m)
}

function window_(w: Wall, o: WallOpening, dir: Vec2, trim: THREE.BufferGeometry[], panes: THREE.BufferGeometry[]): void {
  const depth = w.thickness + 0.02
  const h = o.y1 - o.y0
  const at = (along: number) => lerp2(w.a, w.b, along / w.length)
  const c = at(o.along)
  for (const s of [-1, 1]) {
    const p = at(o.along + s * (o.width / 2 - FRAME / 2))
    const g = new THREE.BoxGeometry(FRAME, h, depth)
    g.applyMatrix4(place(p[0], o.y0 + h / 2, p[1], dir))
    trim.push(g)
  }
  const head = new THREE.BoxGeometry(o.width, FRAME, depth)
  head.applyMatrix4(place(c[0], o.y1 - FRAME / 2, c[1], dir))
  trim.push(head)
  const sill = new THREE.BoxGeometry(o.width + 0.1, FRAME, w.thickness + 0.1)
  sill.applyMatrix4(place(c[0], o.y0 + FRAME / 2, c[1], dir))
  trim.push(sill)
  // A mullion splits anything wider than a metre, the way real sashes do; it also sells the glass as glass.
  if (o.width > 1) {
    const m = new THREE.BoxGeometry(FRAME, h, 0.05)
    m.applyMatrix4(place(c[0], o.y0 + h / 2, c[1], dir))
    trim.push(m)
  }
  const pane = new THREE.BoxGeometry(o.width - FRAME * 2, h - FRAME * 2, 0.008)
  pane.applyMatrix4(place(c[0], o.y0 + h / 2, c[1], dir))
  panes.push(pane)
}

function skyCard(w: Wall, o: WallOpening, ceiling: number, material: THREE.MeshBasicMaterial): THREE.Mesh {
  const c = lerp2(w.a, w.b, o.along / w.length)
  const n = w.normal
  const card = new THREE.Mesh(new THREE.PlaneGeometry(o.width + 8, ceiling + 6), material)
  card.position.set(c[0] + n[0] * SKY_OUT, ceiling / 2 + 1, c[1] + n[1] * SKY_OUT)
  // PlaneGeometry faces +z; turn it to face back at the window.
  card.rotation.y = Math.atan2(-n[0], -n[1])
  return card
}

// ---------- geometry helpers ----------

/** A room's floor (normal up) or ceiling (normal down) with UVs in plan metres. */
function slab(polygon: Vec2[], ceiling: boolean): THREE.ShapeGeometry {
  const shape = new THREE.Shape(polygon.map(([x, z]) => new THREE.Vector2(x, ceiling ? z : -z)))
  const g = new THREE.ShapeGeometry(shape)
  g.rotateX(ceiling ? Math.PI / 2 : -Math.PI / 2)
  if (!ceiling) {
    // ShapeGeometry's uv is the shape point, so v runs with -z; flip it back so planks read along +x consistently.
    const uv = g.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) uv.setY(i, -uv.getY(i))
  }
  return g
}

/** Rewrite a box's UVs to metres, offset so `u` continues along the wall (`uMid`) and `v` is the height above the floor. */
function metreUvs(g: THREE.BoxGeometry, uMid: number, vMid: number): void {
  const pos = g.attributes.position as THREE.BufferAttribute
  const nor = g.attributes.normal as THREE.BufferAttribute
  const uv = g.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    if (Math.abs(nor.getZ(i)) > 0.5) uv.setXY(i, x + uMid, y + vMid)
    else if (Math.abs(nor.getX(i)) > 0.5) uv.setXY(i, z + uMid, y + vMid)
    else uv.setXY(i, x + uMid, z + vMid)
  }
}

/** Transform for a box whose local x runs along `dir` in the plan frame, centred at (x, y, z). */
function place(x: number, y: number, z: number, dir: Vec2): THREE.Matrix4 {
  return new THREE.Matrix4().makeRotationY(Math.atan2(-dir[1], dir[0])).setPosition(x, y, z)
}

function merged(list: THREE.BufferGeometry[], material: THREE.Material): THREE.Mesh {
  const g = mergeGeometries(list, false) ?? list[0]!
  for (const part of list) if (part !== g) part.dispose()
  const m = new THREE.Mesh(g, material)
  m.castShadow = true
  m.receiveShadow = true
  return m
}

function unit(a: Vec2, b: Vec2): Vec2 {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
  return [(b[0] - a[0]) / len, (b[1] - a[1]) / len]
}

function lerp2(a: Vec2, b: Vec2, t: number): Vec2 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

/** Pale horizon fading up into sky: tinted per time of day through the card material's colour. */
function skyGradient(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = 4
  c.height = 128
  const g = c.getContext('2d')!
  const grad = g.createLinearGradient(0, 0, 0, 128)
  grad.addColorStop(0, '#ffffff')
  grad.addColorStop(0.55, '#f2f5f8')
  grad.addColorStop(1, '#d8d4c8')
  g.fillStyle = grad
  g.fillRect(0, 0, 4, 128)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
