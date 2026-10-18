// Odds and ends: garage and balcony things, and a fallback the registry uses for an unknown kind.
import * as THREE from 'three'
import { group, mesh, seeded } from './helpers.ts'
import type { Build } from './helpers.ts'
import { box, cushion, cyl, glass, gloss, mat, metal, wood } from './parts.ts'

export const exercise_bike: Build = ({ length, width, height }) => {
  const dark = metal('#2b2b2e')
  const wheel = cyl(0.25, 0.25, 0.06, gloss('#2b2b2e'), 'primary', 0, 0.3, width / 2 - 0.3, 24)
  wheel.rotation.z = Math.PI / 2
  const spine = cyl(0.03, 0.03, width * 0.7, dark, 'primary', 0, 0.45, 0, 10)
  spine.rotation.x = Math.PI / 2 - 0.35
  return group(
    box(length, 0.05, 0.08, dark, 'trim', 0, 0.025, width / 2 - 0.12),
    box(length, 0.05, 0.08, dark, 'trim', 0, 0.025, -width / 2 + 0.12),
    box(0.06, 0.04, width - 0.24, dark, 'trim', 0, 0.045, 0),
    wheel,
    spine,
    cyl(0.02, 0.02, height * 0.5, dark, 'primary', 0, 0.45 + height * 0.25, -width / 2 + 0.3, 8),
    cushion(0.2, 0.06, 0.28, mat('#1c1a18', { roughness: 0.6 }), 'trim', 0, height * 0.78, -width / 2 + 0.3, 0.03),
    cyl(0.02, 0.02, height * 0.5, dark, 'primary', 0, 0.5 + height * 0.25, width / 2 - 0.3, 8),
    cyl(0.018, 0.018, length - 0.1, dark, 'primary', 0, height - 0.02, width / 2 - 0.25, 8).rotateZ(Math.PI / 2),
    box(0.16, 0.1, 0.02, gloss('#1c1a18'), null, 0, height - 0.06, width / 2 - 0.2),
    box(0.1, 0.02, 0.05, dark, 'trim', 0.12, 0.32, 0.05),
    box(0.1, 0.02, 0.05, dark, 'trim', -0.12, 0.28, -0.05)
  )
}

export const box_: Build = ({ length, width, height }) => group(
  box(length, height, width, mat('#b08968', { roughness: 1 }), 'primary', 0, height / 2, 0),
  box(0.05, 0.004, width + 0.004, mat('#d9c8a9', { roughness: 0.6 }), null, 0, height, 0),
  box(length - 0.02, 0.004, 0.004, mat('#7a5a3a'), null, 0, height + 0.001, 0)
)

export const bicycle: Build = ({ length, height }) => {
  const r = height * 0.34
  const tyre = mat('#1c1a18', { roughness: 0.95 })
  const tube = metal('#2b4a6a')
  const bar = (a: THREE.Vector3, b: THREE.Vector3) => {
    const d = b.clone().sub(a)
    const m = cyl(0.012, 0.012, d.length(), tube, 'primary', 0, 0, 0, 8)
    m.position.copy(a).addScaledVector(d, 0.5)
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())
    return m
  }
  const ax = length / 2 - r
  const hub = (x: number) => new THREE.Vector3(x, r + 0.02, 0)
  const crank = new THREE.Vector3(-0.1, r * 0.9, 0)
  const seatTop = new THREE.Vector3(-0.35, height * 0.93, 0)
  const head = new THREE.Vector3(0.35, height * 0.8, 0)
  const g = group(
    mesh(new THREE.TorusGeometry(r, 0.02, 8, 28), tyre, null, -ax, r + 0.02, 0),
    mesh(new THREE.TorusGeometry(r, 0.02, 8, 28), tyre, null, ax, r + 0.02, 0),
    bar(hub(-ax), seatTop), bar(hub(-ax), crank), bar(crank, seatTop), bar(seatTop, head), bar(crank, head), bar(head, hub(ax)),
    cushion(0.24, 0.05, 0.12, mat('#3b3129', { roughness: 0.7 }), 'trim', -0.37, height * 0.95, 0, 0.02),
    cyl(0.012, 0.012, 0.44, tube, 'primary', 0.42, height - 0.02, 0, 8).rotateX(Math.PI / 2),
    cyl(0.1, 0.1, 0.02, metal('#8a8a8e'), null, -0.1, r * 0.9, 0.03, 16).rotateX(Math.PI / 2)
  )
  return g
}

export const car: Build = ({ length, width, height }) => {
  const paint = gloss('#8a2b2b')
  const g = group(
    cushion(length, height * 0.36, width, paint, 'primary', 0, 0.3 + height * 0.18, 0, 0.06),
    cushion(length * 0.86, height * 0.38, width * 0.5, paint, 'primary', 0, 0.3 + height * 0.36 + height * 0.19 - 0.02, -width * 0.05, 0.1),
    cushion(length * 0.87, height * 0.26, width * 0.49, glass('#2b3a4a'), null, 0, 0.3 + height * 0.36 + height * 0.16, -width * 0.05, 0.06)
  )
  for (const sx of [-1, 1]) {
    for (const z of [width * 0.32, -width * 0.32]) g.add(cyl(0.33, 0.33, 0.22, mat('#1c1a18', { roughness: 0.9 }), null, sx * (length / 2 - 0.1), 0.33, z, 20).rotateZ(Math.PI / 2))
    g.add(box(0.3, 0.1, 0.04, mat('#f4f1ea', { emissive: '#f4f1ea', emissiveIntensity: 0.3 }), null, sx * length * 0.33, 0.3 + height * 0.25, width / 2 + 0.01))
    g.add(box(0.26, 0.08, 0.04, mat('#8a1c1c', { emissive: '#8a1c1c', emissiveIntensity: 0.3 }), null, sx * length * 0.34, 0.3 + height * 0.25, -width / 2 - 0.01))
  }
  return g
}

export const planter: Build = ({ length, width, height }) => {
  const g = group(
    box(length, height * 0.6, width, wood('#9a6a4a'), 'primary', 0, height * 0.3, 0),
    box(length - 0.04, 0.02, width - 0.04, mat('#3b2a1e'), null, 0, height * 0.6, 0)
  )
  const rand = seeded('planter')
  for (let i = 0; i < 7; i++) {
    const s = 0.07 + rand() * 0.05
    g.add(mesh(new THREE.IcosahedronGeometry(s, 0), mat('#3f7a45', { flatShading: true, roughness: 0.9 }), 'trim', -length / 2 + 0.1 + i * (length - 0.2) / 6, height * 0.6 + s * 0.9 + rand() * (height * 0.4 - s * 1.6), (rand() - 0.5) * (width - s * 2)))
  }
  return g
}
