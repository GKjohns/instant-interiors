// Soft things and decor. Wall-mounted kinds (picture, mirror, clock, shelf) build with their back on
// local z = -width/2 and their centre at y = 0; the renderer lifts them to `hang`.
import * as THREE from 'three'
import { group, mesh, rugTexture, seeded } from './helpers.ts'
import type { Build, Dims } from './helpers.ts'
import { box, ceramic, cushion, cyl, fabric, frame, gloss, mat, metal, wood } from './parts.ts'

function woven({ length, width }: Dims, color: string, trim: string, border: number): THREE.Group {
  const field = box(length - border * 2, 0.022, width - border * 2, fabric(color), 'primary', 0, 0.011, 0)
  const tex = rugTexture(length / 0.6, width / 0.6)
  if (tex) (field.material as THREE.MeshPhysicalMaterial).map = tex
  const g = group(box(length, 0.02, width, fabric(trim), 'trim', 0, 0.01, 0), field)
  // Fringe at the short ends, a shade lighter than the border.
  for (const sx of [-1, 1]) g.add(box(0.05, 0.01, width - 0.1, fabric('#e8dcc4'), null, sx * (length / 2 + 0.025), 0.005, 0))
  g.traverse((o) => {
    o.castShadow = false
  })
  return g
}

export const rug: Build = d => woven(d, '#8c3b3b', '#d8c8a8', 0.12)
export const runner: Build = d => woven(d, '#5a6a7a', '#d8c8a8', 0.07)

/** Two gathered panels on a rod, parted in the middle so the window shows between them. */
export const curtains: Build = ({ length, width, height }) => {
  const rod = metal('#c9a24a')
  const g = group(cyl(0.012, 0.012, length + 0.1, rod, 'trim', 0, height - 0.03, 0, 10))
  g.children[0]!.rotation.z = Math.PI / 2
  for (const sx of [-1, 1]) g.add(mesh(new THREE.SphereGeometry(0.03, 10, 8), rod, 'trim', sx * (length / 2 + 0.06), height - 0.03, 0))
  const panel = length * 0.3
  const r = width * 0.3
  const folds = Math.max(3, Math.round(panel / (r * 1.6)))
  for (const sx of [-1, 1]) {
    for (let i = 0; i < folds; i++) {
      const x = sx * (length / 2 - r - i * (panel - r * 2) / (folds - 1))
      g.add(cyl(r, r, height - 0.08, fabric('#c9c0b2'), 'primary', x, (height - 0.08) / 2 + 0.02, (i % 2 ? 1 : -1) * r * 0.45, 10))
    }
  }
  return g
}

function foliage(g: THREE.Group, seed: string, color: string, from: number, to: number, spread: number, n: number, size: number): void {
  const rand = seeded(seed)
  for (let i = 0; i < n; i++) {
    const t = i / Math.max(1, n - 1)
    // Golden-angle spacing fills the crown evenly; the rng only jitters, so the silhouette stays round.
    const r = spread * (0.75 + rand() * 0.25) * (1 - 0.5 * Math.abs(2 * t - 1))
    const a = i * 2.39996 + rand() * 0.4
    const s = size * (0.75 + rand() * 0.5)
    g.add(mesh(new THREE.IcosahedronGeometry(s, 0), mat(color, { flatShading: true, roughness: 0.9 }), 'primary', Math.cos(a) * r, from + (to - from) * t, Math.sin(a) * r))
  }
}

export const plant: Build = ({ length, height }) => {
  const g = group(
    cyl(length * 0.34, length * 0.26, height * 0.23, ceramic('#9a6a4a'), 'trim', 0, height * 0.115, 0, 14),
    cyl(length * 0.31, length * 0.31, 0.02, mat('#3b2a1e'), null, 0, height * 0.23, 0, 14),
    cyl(0.015, 0.02, height * 0.45, mat('#4a3a20'), null, 0, height * 0.45, 0, 6)
  )
  foliage(g, 'plant', '#3f7a45', height * 0.55, height * 0.86, length * 0.37, 9, length * 0.26)
  return g
}

export const tree: Build = ({ length, height }) => {
  const g = group(
    cyl(length * 0.3, length * 0.24, 0.4, ceramic('#9a6a4a'), 'trim', 0, 0.2, 0, 14),
    cyl(0.03, 0.045, height * 0.6, mat('#4a3a20'), null, 0, 0.4 + height * 0.3, 0, 7)
  )
  foliage(g, 'tree', '#2f6a3a', height * 0.55, height * 0.88, length * 0.32, 11, length * 0.26)
  return g
}

export const picture: Build = ({ length, width, height }) => group(
  frame(length, height, 0.035, width * 0.7, wood('#2b2219'), 'trim', -width * 0.15),
  box(length - 0.05, height - 0.05, width * 0.3, mat('#4a6a8a', { roughness: 0.9 }), 'primary', 0, 0, -width * 0.3)
)

export const mirror: Build = ({ length, width, height }) => group(
  frame(length, height, 0.04, width * 0.8, gloss('#c9a24a'), 'trim', -width * 0.1),
  // Half-metallic: fully metallic glass goes black without an environment map.
  box(length - 0.06, height - 0.06, width * 0.3, mat('#b8c4cc', { metalness: 0.5, roughness: 0.06, clearcoat: 1 }), 'primary', 0, 0, -width * 0.3)
)

export const clock: Build = ({ length, width }) => {
  const r = length / 2 - 0.012
  const face = cyl(r, r, 0.015, mat('#f4f1ea', { roughness: 0.4 }), 'primary', 0, 0, -width / 2 + 0.015, 32)
  face.rotation.x = Math.PI / 2
  const rim = mesh(new THREE.TorusGeometry(r, 0.012, 8, 36), gloss('#2b2b2e'), 'trim', 0, 0, -width / 2 + 0.015)
  const hour = box(0.01, r * 0.55, 0.004, mat('#2b2b2e'), null, 0, r * 0.22, -width / 2 + 0.026)
  const minute = box(0.008, r * 0.85, 0.004, mat('#2b2b2e'), null, 0, 0, -width / 2 + 0.028)
  minute.rotation.z = -Math.PI * 0.55
  minute.position.x = r * 0.3
  return group(face, rim, hour, minute, cyl(0.012, 0.012, 0.01, mat('#2b2b2e'), null, 0, 0, -width / 2 + 0.03, 10).rotateX(Math.PI / 2))
}

export const shelf: Build = ({ length, width, height }) => group(cushion(length, height, width, wood('#8a6a4a'), 'primary', 0, 0, 0, 0.008))

export const vase: Build = ({ length, height }) => {
  const r = length / 2
  const profile = [[0.55, 0], [0.9, 0.08], [1, 0.3], [0.8, 0.55], [0.5, 0.72], [0.55, 0.78]].map(([x, y]) => new THREE.Vector2(x! * r, y! * height * 0.8))
  const body = mesh(new THREE.LatheGeometry(profile, 20), ceramic('#c9d3d7'), 'primary')
  const g = group(body)
  const rand = seeded('vase')
  for (let i = 0; i < 5; i++) {
    const a = rand() * Math.PI * 2
    const lean = 0.25 + rand() * 0.3
    const stem = cyl(0.004, 0.004, height * 0.5, mat('#4a7a3a'), null, Math.cos(a) * r * 0.3, height * 0.72, Math.sin(a) * r * 0.3, 5)
    stem.rotation.set(Math.sin(a) * lean, 0, -Math.cos(a) * lean)
    const tip = new THREE.Vector3(0, height * 0.25, 0).applyEuler(stem.rotation).add(stem.position)
    g.add(stem, mesh(new THREE.SphereGeometry(0.022, 8, 6), mat(['#e8b4c8', '#f1e2c2', '#c9742b'][i % 3]!, { roughness: 0.9 }), null, tip.x, Math.min(tip.y, height - 0.022), tip.z))
  }
  return g
}

export const books: Build = ({ length, width, height }) => {
  const g = group()
  const colours = ['#2e4a7a', '#d9c8a9', '#8c3b3b']
  let y = 0
  colours.forEach((c, i) => {
    const h = height / 3
    const b = box(length - i * 0.02, h - 0.004, width - i * 0.015, mat(c, { roughness: 0.85 }), i === 2 ? 'primary' : null, 0, y + h / 2, 0)
    b.rotation.y = (i - 1) * 0.12
    g.add(b, box(length - i * 0.02 - 0.02, h - 0.014, width - i * 0.015 - 0.015, mat('#f4efe4'), null, 0, y + h / 2, 0.004).rotateY((i - 1) * 0.12))
    y += h
  })
  return g
}

export const piano: Build = ({ length, width, height }) => {
  const body = gloss('#1c1a18')
  const g = group(
    box(length, height, width * 0.7, body, 'primary', 0, height / 2, -width * 0.15),
    box(length, 0.07, width * 0.45, body, 'primary', 0, 0.7, width * 0.22),
    box(length, 0.035, width * 0.35, body, 'primary', 0, 0.78, width * 0.1),
    box(length * 0.86, 0.018, width * 0.25, mat('#f4f1ea', { roughness: 0.3 }), null, 0, 0.745, width * 0.27),
    box(length * 0.6, 0.02, 0.08, metal('#c9a24a'), 'trim', 0, height * 0.72, width * 0.21)
  )
  for (let i = 0; i < 36; i++) if (i % 7 !== 2 && i % 7 !== 6) g.add(box(0.012, 0.012, width * 0.14, mat('#1c1a18'), null, -length * 0.42 + 0.02 + i * (length * 0.84) / 36, 0.76, width * 0.22))
  for (const sx of [-1, 1]) g.add(box(0.06, 0.7, 0.06, body, 'primary', sx * (length / 2 - 0.05), 0.35, width * 0.35))
  for (const x of [-0.08, 0, 0.08]) g.add(box(0.025, 0.012, 0.08, metal('#c9a24a'), 'trim', x, 0.03, width * 0.4))
  return g
}
