/**
 * Small parts the builders share: a leg set, a cushion, a slab, a frame, drawer fronts, a shade, a bulb.
 * Each returns tagged meshes so a builder stays a short list of parts rather than geometry arithmetic.
 */
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { emissiveFollows, glowMat, group, mat, mesh } from './helpers.ts'
import type { Slot } from './helpers.ts'

export { mat }

export const wood = (c: string) => mat(c, { roughness: 0.65 })
export const fabric = (c: string) => mat(c, { roughness: 0.95, sheen: 0.4, sheenRoughness: 0.8 })
export const metal = (c: string) => mat(c, { metalness: 0.8, roughness: 0.3 })
export const gloss = (c: string) => mat(c, { roughness: 0.25, clearcoat: 0.4 })
export const ceramic = (c: string) => mat(c, { roughness: 0.2, clearcoat: 0.6 })
export const glass = (c: string) => mat(c, { roughness: 0.05, transparent: true, opacity: 0.35 })

export function box(w: number, h: number, d: number, material: THREE.Material, slot: Slot | null, x = 0, y = 0, z = 0): THREE.Mesh {
  return mesh(new THREE.BoxGeometry(w, h, d), material, slot, x, y, z)
}

export function cyl(rTop: number, rBot: number, h: number, material: THREE.Material, slot: Slot | null, x = 0, y = 0, z = 0, seg = 14): THREE.Mesh {
  return mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), material, slot, x, y, z)
}

/** A rounded box: cushions, mattresses, padded seats. Radius clamps so thin parts don't invert. */
export function cushion(w: number, h: number, d: number, material: THREE.Material, slot: Slot | null, x = 0, y = 0, z = 0, radius = 0.05): THREE.Mesh {
  const r = Math.min(radius, w / 2.2, h / 2.2, d / 2.2)
  return mesh(new RoundedBoxGeometry(w, h, d, 2, r), material, slot, x, y, z)
}

/** A horizontal slab (table top, shelf) with its top face at `top`. */
export function slab(length: number, width: number, thick: number, material: THREE.Material, slot: Slot | null, top: number, x = 0, z = 0): THREE.Mesh {
  return box(length, thick, width, material, slot, x, top - thick / 2, z)
}

/** Four tapered legs at the corners, inset from the footprint, standing on the floor. */
export function legs(length: number, width: number, h: number, material: THREE.Material, opts: { inset?: number, r?: number, slot?: Slot | null, y?: number, square?: boolean } = {}): THREE.Mesh[] {
  const { inset = 0.07, r = 0.03, slot = 'trim', y = 0, square = false } = opts
  const out: THREE.Mesh[] = []
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * (length / 2 - inset)
      const z = sz * (width / 2 - inset)
      out.push(square ? box(r * 2, h, r * 2, material, slot, x, y + h / 2, z) : cyl(r, r * 0.7, h, material, slot, x, y + h / 2, z, 8))
    }
  }
  return out
}

/** A plinth instead of legs: a recessed base under a cabinet so it sits on a shadow line, not the floor. */
export function plinth(length: number, width: number, h: number, material: THREE.Material, slot: Slot | null = 'trim'): THREE.Mesh {
  return box(length - 0.08, h, width - 0.06, material, slot, 0, h / 2, -0.02)
}

/** A rectangular frame in the XY plane (picture, mirror, window of a cabinet door), centred at the origin. */
export function frame(w: number, h: number, bar: number, depth: number, material: THREE.Material, slot: Slot | null, z = 0): THREE.Group {
  return group(
    box(w, bar, depth, material, slot, 0, h / 2 - bar / 2, z),
    box(w, bar, depth, material, slot, 0, -h / 2 + bar / 2, z),
    box(bar, h - bar * 2, depth, material, slot, -w / 2 + bar / 2, 0, z),
    box(bar, h - bar * 2, depth, material, slot, w / 2 - bar / 2, 0, z)
  )
}

/** `rows` × `cols` drawer fronts over a face, each with a handle, proud of the carcass at `z`. */
export function drawers(length: number, bottom: number, top: number, rows: number, cols: number, material: THREE.Material, handleMat: THREE.Material, z: number): THREE.Object3D[] {
  const out: THREE.Object3D[] = []
  const gap = 0.015
  const w = (length - gap * (cols + 1)) / cols
  const h = (top - bottom - gap * (rows + 1)) / rows
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = -length / 2 + gap + w / 2 + c * (w + gap)
      const y = bottom + gap + h / 2 + r * (h + gap)
      out.push(box(w, h, 0.02, material, 'primary', x, y, z))
      out.push(box(Math.min(0.14, w * 0.4), 0.015, 0.02, handleMat, 'trim', x, y, z + 0.02))
    }
  }
  return out
}

/** Cupboard doors across a face, each with a small knob near its opening edge. */
export function doors(length: number, bottom: number, top: number, n: number, material: THREE.Material, knobMat: THREE.Material, z: number): THREE.Object3D[] {
  const out: THREE.Object3D[] = []
  const gap = 0.012
  const w = (length - gap * (n + 1)) / n
  const h = top - bottom - gap * 2
  for (let i = 0; i < n; i++) {
    const x = -length / 2 + gap + w / 2 + i * (w + gap)
    out.push(box(w, h, 0.02, material, 'primary', x, bottom + gap + h / 2, z))
    const knobX = n === 1 ? x + w / 2 - 0.05 : i % 2 === 0 ? x + w / 2 - 0.04 : x - w / 2 + 0.04
    out.push(mesh(new THREE.SphereGeometry(0.012, 8, 6), knobMat, 'trim', knobX, bottom + h / 2, z + 0.02))
  }
  return out
}

/** An open-bottomed lamp shade in the trim slot that glows in its own colour when the lamp is lit. */
export function shade(rTop: number, rBot: number, h: number, color: string, x: number, y: number, z: number): THREE.Mesh {
  const m = mesh(new THREE.CylinderGeometry(rTop, rBot, h, 18, 1, true), mat(color, { side: THREE.DoubleSide, roughness: 0.7, emissive: color, emissiveIntensity: 0.55 }), 'trim', x, y, z)
  return emissiveFollows(m, 0.55)
}

/** A small warm bulb: the glow slot, and the anchor the renderer parks a pooled point light on. */
export function bulb(r: number, x: number, y: number, z: number, color = '#ffe2b0', intensity = 2.4): THREE.Mesh {
  const b = mesh(new THREE.SphereGeometry(r, 12, 8), glowMat(color, intensity), 'glow', x, y, z)
  b.castShadow = false
  b.userData.emissive = true
  b.userData.bulb = true
  return b
}
