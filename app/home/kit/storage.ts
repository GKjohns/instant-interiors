// Storage: carcasses with drawer or door fronts, plinths or short legs, and a cornice where it suits.
import * as THREE from 'three'
import { group, seeded } from './helpers.ts'
import type { Build } from './helpers.ts'
import { box, cyl, doors, drawers, legs, mat, metal, plinth, wood } from './parts.ts'

const SPINES = ['#7a2e2e', '#2e4a7a', '#3a6a3a', '#c9a34a', '#5a3a6a', '#d9c8a9', '#2a2a2a', '#8a4a2a', '#4a7a8a', '#b05a3a']

export const bookshelf: Build = ({ length, width, height }) => {
  const g = group(
    box(length, height, 0.02, wood('#6a4a30'), 'primary', 0, height / 2, -width / 2 + 0.01),
    box(0.025, height, width, wood('#6a4a30'), 'primary', -length / 2 + 0.0125, height / 2, 0),
    box(0.025, height, width, wood('#6a4a30'), 'primary', length / 2 - 0.0125, height / 2, 0),
    box(length, 0.03, width, wood('#6a4a30'), 'primary', 0, height - 0.015, 0)
  )
  const rand = seeded(`books${length}${height}`)
  const n = Math.max(2, Math.round(height / 0.38))
  const pitch = (height - 0.08) / n
  for (let s = 0; s < n; s++) {
    const y = 0.05 + s * pitch
    g.add(box(length - 0.05, 0.025, width - 0.02, wood('#6a4a30'), 'primary', 0, y, 0))
    let x = -length / 2 + 0.04
    const stop = length / 2 - 0.05 - rand() * length * 0.25
    while (x < stop) {
      const bw = 0.025 + rand() * 0.035
      const bh = Math.min(pitch - 0.05, 0.18 + rand() * 0.12)
      g.add(box(bw, bh, width * 0.6, mat(SPINES[Math.floor(rand() * SPINES.length)]!), null, x + bw / 2, y + 0.0125 + bh / 2, 0.02))
      x += bw + 0.004
    }
  }
  return g
}

export const wardrobe: Build = ({ length, width, height }) => group(
  box(length, height - 0.1, width, wood('#a88a68'), 'primary', 0, 0.08 + (height - 0.1) / 2, 0),
  plinth(length, width, 0.08, wood('#5a4030')),
  box(length + 0.04, 0.04, width + 0.02, wood('#5a4030'), 'trim', 0, height - 0.02, 0.01),
  ...doors(length - 0.04, 0.1, height - 0.06, Math.max(2, Math.round(length / 0.5)), wood('#a88a68'), metal('#3b3129'), width / 2)
)

export const dresser: Build = ({ length, width, height }) => group(
  box(length, height - 0.14, width, wood('#9a7a58'), 'primary', 0, 0.12 + (height - 0.14) / 2, 0),
  box(length + 0.03, 0.025, width + 0.02, wood('#9a7a58'), 'primary', 0, height - 0.0125, 0.01),
  ...drawers(length - 0.04, 0.14, height - 0.04, 3, length > 1 ? 2 : 1, wood('#9a7a58'), metal('#3b3129'), width / 2),
  ...legs(length, width, 0.12, wood('#5a4030'), { inset: 0.06, r: 0.022 })
)

export const cabinet: Build = ({ length, width, height }) => group(
  box(length, height - 0.08, width, wood('#5a4a40'), 'primary', 0, 0.06 + (height - 0.08) / 2, 0),
  plinth(length, width, 0.06, wood('#3b3129')),
  box(length + 0.03, 0.025, width + 0.02, wood('#5a4a40'), 'primary', 0, height - 0.0125, 0.01),
  ...doors(length - 0.04, 0.08, height - 0.04, 2, wood('#5a4a40'), metal('#c9a24a'), width / 2)
)

export const tv_stand: Build = ({ length, width, height }) => {
  const mid = Math.min(0.8, length * 0.5)
  return group(
    box(length, height - 0.1, width, wood('#3b3129'), 'primary', 0, 0.1 + (height - 0.1) / 2, 0),
    box(length + 0.02, 0.02, width + 0.02, wood('#3b3129'), 'primary', 0, height - 0.01, 0.01),
    ...doors(mid, 0.12, height - 0.04, 2, wood('#3b3129'), metal('#8a8a8e'), width / 2),
    // Open bays either side: dark recesses with one shelf, so the stand reads as media storage.
    ...[-1, 1].flatMap(sx => [
      box((length - mid) / 2 - 0.06, height - 0.18, width - 0.04, mat('#1c1a18'), null, sx * (length / 4 + mid / 4), 0.12 + (height - 0.18) / 2, 0.02),
      box((length - mid) / 2 - 0.06, 0.02, width - 0.06, wood('#3b3129'), 'primary', sx * (length / 4 + mid / 4), height / 2, 0.03)
    ]),
    ...legs(length, width, 0.1, metal('#2b2b2e'), { inset: 0.05, r: 0.015 })
  )
}

export const shoe_rack: Build = ({ length, width, height }) => {
  const g = group(box(0.025, height, width, wood('#8a6a4a'), 'primary', -length / 2 + 0.0125, height / 2, 0), box(0.025, height, width, wood('#8a6a4a'), 'primary', length / 2 - 0.0125, height / 2, 0))
  const shoes = seeded('shoes')
  for (let s = 0; s < 3; s++) {
    const y = 0.06 + s * (height - 0.08) / 2
    for (const z of [-width / 3, 0, width / 3]) g.add(box(length - 0.05, 0.02, 0.05, wood('#8a6a4a'), 'primary', 0, y, z))
    for (let x = -length / 2 + 0.1; x < length / 2 - 0.1; x += 0.14) if (shoes() > 0.3) g.add(box(0.09, 0.07, width * 0.75, mat(SPINES[Math.floor(shoes() * SPINES.length)]!), null, x, y + 0.045, 0))
  }
  return g
}

export const coat_rack: Build = ({ length, height }) => {
  const g = group(
    cyl(length / 2, length / 2, 0.03, wood('#3b3129'), 'trim', 0, 0.015, 0, 20),
    cyl(0.02, 0.025, height - 0.03, wood('#3b3129'), 'primary', 0, 0.03 + (height - 0.03) / 2, 0, 10),
    new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), wood('#3b3129'))
  )
  g.children[2]!.position.y = height - 0.02
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4
    const peg = cyl(0.012, 0.012, length * 0.45, wood('#3b3129'), 'primary', Math.cos(a) * length * 0.2, height - 0.12, Math.sin(a) * length * 0.2, 6)
    peg.rotation.set(0, -a, 0.35 - Math.PI / 2)
    g.add(peg)
  }
  return g
}
