/**
 * The kit registry (kind → builder) and `buildItem`, the one way the renderer turns an Item into a group:
 * build at the catalog dims (or the props' dims for sized kinds), scale, recolour the slots, apply the
 * material preset, and set `lit` on emissive parts.
 *
 * Group userData the renderer reads: `kind`; for light kinds `light: true`, `lit` (0..2 as applied),
 * `lightAt` [x, y, z] (local position of the `bulb` part, where a pooled point light goes) and
 * `lightColor` (hex). Mesh userData is documented in helpers.ts.
 */
import * as THREE from 'three'
import type { KindDescriptor } from '../../../shared/home/kinds.ts'
import type { Material, Props } from '../../../shared/home/ops.ts'
import { safeColor } from '../color.ts'
import { bathtub, shower, toilet, towel_rack, vanity } from './bath.ts'
import { bed, bunk_bed, crib, king_bed, single_bed } from './beds.ts'
import { books, clock, curtains, mirror, piano, picture, plant, rug, runner, shelf, tree, vase } from './decor.ts'
import type { Build, Dims } from './helpers.ts'
import { counter, dishwasher, dryer, fridge, island, sink, stove, tv, upper_cabinets, washer } from './kitchen.ts'
import { candles, ceiling_light, chandelier, floor_lamp, pendant, sconce, table_lamp } from './lighting.ts'
import { bicycle, box_, car, exercise_bike, planter } from './misc.ts'
import { armchair, bar_stool, bench, dining_chair, loveseat, office_chair, ottoman, outdoor_chair, sectional, sofa, stool } from './seating.ts'
import { bookshelf, cabinet, coat_rack, dresser, shoe_rack, tv_stand, wardrobe } from './storage.ts'
import { coffee_table, console_table, desk, dining_table, nightstand, round_table, side_table, vanity_table } from './tables.ts'

export const BUILDERS: Record<string, Build> = {
  sofa, loveseat, sectional, armchair, ottoman, bench, dining_chair, bar_stool, office_chair, stool,
  coffee_table, side_table, console_table, dining_table, round_table, desk, nightstand, vanity_table,
  bed, king_bed, single_bed, bunk_bed, crib,
  bookshelf, wardrobe, dresser, cabinet, tv_stand, shoe_rack, coat_rack,
  floor_lamp, table_lamp, pendant, chandelier, ceiling_light, sconce, candles,
  rug, runner, curtains, plant, tree, picture, mirror, clock, shelf, vase, books, piano,
  tv, fridge, stove, counter, island, upper_cabinets, sink, dishwasher, washer, dryer,
  toilet, bathtub, shower, vanity, towel_rack,
  exercise_bike, box: box_, bicycle, car, planter, outdoor_chair
}

/** Surface presets by material word. Applied to the primary slot; `BASE` first so glass doesn't linger. */
const BASE: THREE.MeshPhysicalMaterialParameters = { metalness: 0, transparent: false, opacity: 1, sheen: 0, clearcoat: 0 }
const PRESETS: Record<Material, THREE.MeshPhysicalMaterialParameters> = {
  fabric: { roughness: 0.95, sheen: 0.45, sheenRoughness: 0.8 },
  leather: { roughness: 0.42, clearcoat: 0.1, clearcoatRoughness: 0.6 },
  velvet: { roughness: 1, sheen: 1, sheenRoughness: 0.45 },
  wood: { roughness: 0.65 },
  metal: { roughness: 0.3, metalness: 0.85 },
  glass: { roughness: 0.05, metalness: 0.05, transparent: true, opacity: 0.4 },
  marble: { roughness: 0.18, clearcoat: 0.5, clearcoatRoughness: 0.2 },
  stone: { roughness: 1 },
  rattan: { roughness: 0.9, sheen: 0.2, sheenRoughness: 1 },
  plastic: { roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.3 }
}

export function buildItem(kind: string, props: Props, d: KindDescriptor): THREE.Group {
  const build = BUILDERS[kind] ?? box_
  const dims: Dims = { length: d.footprint[0], width: d.footprint[1], height: d.height }
  if (d.sized) {
    if (props.length) dims.length = props.length
    if (props.width) dims.width = props.width
    if (props.height) dims.height = props.height
  }
  const g = build(dims)
  g.name = kind
  g.userData.kind = kind
  if (props.scale && props.scale !== 1) g.scale.setScalar(props.scale)
  recolor(g, props)
  if (props.material) applyMaterial(g, props.material)
  if (d.light) {
    g.userData.light = true
    applyLit(g, props.lit ?? 1)
  }
  return g
}

/** Slot colours from props, falling back to the builder's own; shades re-derive their emissive from it. */
export function recolor(root: THREE.Object3D, props: Props): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || !m.userData.baseColor) return
    const slot = m.userData.slot as string | undefined
    const want = slot === 'primary' ? props.color : slot === 'trim' ? props.trim : undefined
    const material = m.material as THREE.MeshPhysicalMaterial
    material.color.copy(safeColor(want, m.userData.baseColor as string))
    const follows = m.userData.emissiveFollows as number | undefined
    if (follows !== undefined && material.emissive) material.emissive.copy(material.color).multiplyScalar(follows)
  })
}

function applyMaterial(root: THREE.Object3D, material: Material): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || m.userData.slot !== 'primary') return
    const mat = m.material as THREE.MeshPhysicalMaterial
    mat.setValues({ ...BASE, ...PRESETS[material] })
    if (material === 'velvet' || material === 'fabric') mat.sheenColor.copy(mat.color).offsetHSL(0, 0, 0.25)
    mat.needsUpdate = true
  })
}

/**
 * lit: 0 off, 1 normal, 2 bright. Emissive parts scale from their builder intensity; the group records the
 * bulb's local position and colour so the renderer can place (and pool) a point light without searching.
 */
export function applyLit(root: THREE.Object3D, lit: number): void {
  const k = lit <= 1 ? lit : 1 + (lit - 1) * 0.9
  root.userData.lit = lit
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || !m.userData.emissive) return
    const material = m.material as THREE.MeshPhysicalMaterial
    const follows = m.userData.emissiveFollows as number | undefined
    if (follows !== undefined) material.emissive.copy(material.color).multiplyScalar(follows * k)
    else material.emissiveIntensity = (m.userData.baseGlow ?? 1) * k
    if (m.userData.bulb && !root.userData.lightAt) {
      root.userData.lightAt = localTo(root, m).toArray()
      root.userData.lightColor = `#${material.emissive.getHexString()}`
    }
  })
}

/** A nested part's position in the root's frame (bulbs may sit inside a sub-group). */
function localTo(root: THREE.Object3D, o: THREE.Object3D): THREE.Vector3 {
  const p = new THREE.Vector3()
  for (let n: THREE.Object3D | null = o; n && n !== root; n = n.parent) {
    n.updateMatrix()
    p.applyMatrix4(n.matrix)
  }
  return p
}
