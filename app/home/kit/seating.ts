// Seating. Fronts face +z; the back of a sofa sits on local z = -width/2; the floor is y = 0.
import * as THREE from 'three'
import { clamp } from '../../../shared/math.ts'
import { group, mesh } from './helpers.ts'
import type { Build, Dims } from './helpers.ts'
import { box, cushion, cyl, fabric, legs, metal, wood } from './parts.ts'

/** The upholstered body every sofa-like kind shares: base, `n` seat and back cushions, two arms, short legs. */
function couch({ length, width, height }: Dims, color: string, trim: string, arm: number, n: number): THREE.Group {
  const legH = 0.1
  const seatTop = height * 0.5
  const inner = length - arm * 2
  const g = group(
    cushion(inner, seatTop - legH, width - 0.04, fabric(color), 'primary', 0, legH + (seatTop - legH) / 2, 0, 0.06),
    ...legs(length, width, legH, wood(trim), { inset: 0.1 })
  )
  for (const sx of [-1, 1]) g.add(cushion(arm, seatTop + 0.22 - legH, width, fabric(color), 'primary', sx * (length / 2 - arm / 2), legH + (seatTop + 0.22 - legH) / 2, 0, 0.05))
  const bh = height - seatTop + 0.05
  for (let i = 0; i < n; i++) {
    const w = inner / n - 0.012
    const x = -inner / 2 + inner / n * (i + 0.5)
    g.add(cushion(w, 0.13, width - 0.3, fabric(color), 'primary', x, seatTop + 0.065, 0.13, 0.05))
    const back = cushion(w, bh, 0.22, fabric(color), 'primary', x, seatTop - 0.05 + bh / 2, -width / 2 + 0.12, 0.06)
    back.rotation.x = -0.06
    g.add(back)
  }
  return g
}

export const sofa: Build = d => couch(d, '#6b7b8c', '#3b3129', 0.18, clamp(Math.round(d.length / 0.75), 1, 5))
export const loveseat: Build = d => couch(d, '#8a7f74', '#3b3129', 0.18, 2)
export const armchair: Build = d => couch(d, '#a0623d', '#3b3129', 0.17, 1)

/** An L: the sofa run along the back edge, plus a chaise returning along the right side. */
export const sectional: Build = ({ length, width, height }) => {
  const run = couch({ length, width: 0.9, height }, '#7a8a7a', '#3b3129', 0.18, Math.max(2, Math.round(length / 0.75)))
  run.position.z = -(width - 0.9) / 2
  const depth = width - 0.9
  const x = length / 2 - 0.45
  const z = width / 2 - depth / 2
  const seatTop = height * 0.5
  return group(
    run,
    cushion(0.9, seatTop - 0.1, depth, fabric('#7a8a7a'), 'primary', x, 0.1 + (seatTop - 0.1) / 2, z, 0.06),
    cushion(0.68, 0.13, depth - 0.04, fabric('#7a8a7a'), 'primary', x - 0.09, seatTop + 0.065, z, 0.05),
    cushion(0.18, seatTop + 0.12, depth, fabric('#7a8a7a'), 'primary', length / 2 - 0.09, 0.1 + (seatTop + 0.12) / 2, z, 0.05),
    ...legs(0.9, depth, 0.1, wood('#3b3129'), { inset: 0.1 }).map((l) => {
      l.position.x += x
      l.position.z += z
      return l
    })
  )
}

export const ottoman: Build = ({ length, width, height }) => {
  const g = group(cushion(length, height - 0.12, width, fabric('#9c8b7a'), 'primary', 0, 0.12 + (height - 0.12) / 2, 0, 0.08), ...legs(length, width, 0.12, wood('#5a4030'), { inset: 0.08 }))
  // Four tufting buttons: the one detail that says "ottoman" rather than "crate".
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(new THREE.SphereGeometry(0.012, 8, 6), wood('#5a4030'), null, sx * length * 0.22, height, sz * width * 0.22))
  return g
}

export const bench: Build = ({ length, width, height }) => group(
  cushion(length, 0.06, width, wood('#9a7b5b'), 'primary', 0, height - 0.03, 0, 0.015),
  ...legs(length, width, height - 0.06, wood('#5a4030'), { inset: 0.08, r: 0.025, square: true }),
  box(length - 0.2, 0.03, 0.03, wood('#5a4030'), 'trim', 0, 0.14, 0)
)

export const dining_chair: Build = ({ length, width, height }) => {
  const seatH = 0.46
  const g = group(
    cushion(length - 0.04, 0.05, width - 0.06, wood('#8a6a4a'), 'primary', 0, seatH - 0.025, 0.02, 0.015),
    ...legs(length - 0.04, width - 0.06, seatH - 0.05, wood('#8a6a4a'), { inset: 0.03, r: 0.018, slot: 'primary', square: true })
  )
  const bz = -width / 2 + 0.02
  for (const sx of [-1, 1]) g.add(box(0.036, height - seatH, 0.036, wood('#8a6a4a'), 'primary', sx * (length / 2 - 0.038), seatH + (height - seatH) / 2, bz))
  for (const y of [height - 0.06, height - 0.2]) g.add(box(length - 0.1, 0.07, 0.025, fabric('#5a4030'), 'trim', 0, y, bz))
  return g
}

export const bar_stool: Build = ({ length, width, height }) => {
  const g = group(cushion(length, 0.07, width, fabric('#3b3129'), 'primary', 0, height - 0.035, 0, 0.1))
  const legH = height - 0.07
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = cyl(0.016, 0.016, legH + 0.01, wood('#b08968'), 'trim', sx * (length / 2 - 0.06), legH / 2, sz * (width / 2 - 0.06), 8)
      leg.rotation.set(sz * 0.07, 0, -sx * 0.07)
      g.add(leg)
    }
  }
  g.add(mesh(new THREE.TorusGeometry(length * 0.4, 0.01, 6, 20).rotateX(Math.PI / 2), wood('#b08968'), 'trim', 0, legH * 0.35, 0))
  return g
}

export const office_chair: Build = ({ length, width, height }) => {
  const g = group(cyl(0.03, 0.03, 0.3, metal('#5a5a5e'), 'trim', 0, 0.2, 0, 8), cushion(length - 0.08, 0.08, width - 0.1, fabric('#2b2b2e'), 'primary', 0, 0.45, 0.03, 0.03))
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    const spoke = box(0.3, 0.025, 0.04, metal('#5a5a5e'), 'trim', Math.cos(a) * 0.14, 0.04, Math.sin(a) * 0.14)
    spoke.rotation.y = -a
    g.add(spoke, cyl(0.025, 0.025, 0.03, metal('#2b2b2e'), null, Math.cos(a) * 0.27, 0.025, Math.sin(a) * 0.27, 8))
  }
  const back = cushion(length - 0.14, height - 0.52, 0.06, fabric('#2b2b2e'), 'primary', 0, 0.5 + (height - 0.52) / 2, -width / 2 + 0.08, 0.03)
  back.rotation.x = -0.08
  g.add(back)
  for (const sx of [-1, 1]) g.add(box(0.03, 0.2, 0.25, metal('#5a5a5e'), 'trim', sx * (length / 2 - 0.02), 0.6, 0), box(0.05, 0.02, 0.25, fabric('#2b2b2e'), 'primary', sx * (length / 2 - 0.025), 0.7, 0))
  return g
}

export const stool: Build = ({ length, height }) => {
  const g = group(cyl(length / 2, length / 2 - 0.02, 0.04, wood('#b08968'), 'primary', 0, height - 0.02, 0, 18))
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2
    const leg = cyl(0.015, 0.02, height - 0.03, wood('#b08968'), 'primary', Math.cos(a) * length * 0.3, (height - 0.03) / 2, Math.sin(a) * length * 0.3, 8)
    leg.rotation.set(Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12)
    g.add(leg)
  }
  return g
}

/** Slatted outdoor chair: a dark frame with slats, nothing soft to get rained on. */
export const outdoor_chair: Build = ({ length, width, height }) => {
  const g = group(...legs(length, width, 0.42, metal('#3b3129'), { inset: 0.03, r: 0.015, slot: 'trim', square: true }))
  for (let i = 0; i < 5; i++) g.add(box(length - 0.04, 0.02, 0.07, wood('#3b3129'), 'primary', 0, 0.43, -width / 2 + 0.07 + i * (width - 0.1) / 4))
  const bz = -width / 2 + 0.03
  for (const sx of [-1, 1]) g.add(box(0.03, height - 0.42, 0.03, metal('#3b3129'), 'trim', sx * (length / 2 - 0.02), 0.42 + (height - 0.42) / 2, bz))
  for (let i = 0; i < 4; i++) g.add(box(length - 0.06, 0.06, 0.02, wood('#3b3129'), 'primary', 0, 0.52 + i * (height - 0.58) / 3, bz))
  for (const sx of [-1, 1]) g.add(box(0.03, 0.02, width - 0.12, metal('#3b3129'), 'trim', sx * (length / 2 - 0.02), 0.66, -0.02), box(0.03, 0.24, 0.03, metal('#3b3129'), 'trim', sx * (length / 2 - 0.02), 0.54, width / 2 - 0.1))
  return g
}
