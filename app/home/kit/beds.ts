// Beds. The headboard is on local -z (against the wall); the duvet takes `color`, the frame takes `trim`.
import type * as THREE from 'three'
import { group } from './helpers.ts'
import type { Build, Dims } from './helpers.ts'
import { box, cushion, fabric, legs, wood } from './parts.ts'

function bedOf({ length, width, height }: Dims, color: string, trim: string, pillows: number): THREE.Group {
  const frameTop = 0.28
  const mattressTop = Math.max(frameTop + 0.14, height - 0.08)
  const head = Math.max(height + 0.08, mattressTop + 0.16)
  const g = group(
    box(length + 0.04, frameTop - 0.1, width - 0.04, wood(trim), 'trim', 0, 0.1 + (frameTop - 0.1) / 2, 0),
    box(length + 0.04, head, 0.05, wood(trim), 'trim', 0, head / 2, -width / 2 + 0.025),
    ...legs(length + 0.04, width - 0.04, 0.1, wood(trim), { inset: 0.06, r: 0.03, square: true }),
    cushion(length, mattressTop - frameTop, width - 0.1, fabric('#f1ede6'), null, 0, frameTop + (mattressTop - frameTop) / 2, 0.02, 0.04),
    // The duvet covers the lower two thirds and droops a little over the sides.
    cushion(length + 0.06, 0.07, width * 0.62, fabric(color), 'primary', 0, mattressTop + 0.02, width * 0.17, 0.035)
  )
  const pw = Math.min(0.6, (length - 0.1) / pillows - 0.05)
  for (let i = 0; i < pillows; i++) {
    const x = pillows === 1 ? 0 : -length / 2 + 0.1 + pw / 2 + i * ((length - 0.2 - pw) / (pillows - 1))
    g.add(cushion(pw, 0.12, 0.42, fabric('#f7f4ee'), null, x, mattressTop + 0.06, -width / 2 + 0.32, 0.05))
  }
  return g
}

export const bed: Build = d => bedOf(d, '#d8d2c6', '#5a4030', 2)
export const king_bed: Build = d => bedOf(d, '#d8d2c6', '#5a4030', 2)
export const single_bed: Build = d => bedOf(d, '#cfd6dd', '#6a5040', 1)

export const bunk_bed: Build = ({ length, width, height }) => {
  const g = group()
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.06, height, 0.06, wood('#5a4030'), 'trim', sx * (length / 2 - 0.03), height / 2, sz * (width / 2 - 0.03)))
  for (const base of [0.25, height - 0.55]) {
    g.add(box(length, 0.1, width, wood('#5a4030'), 'trim', 0, base + 0.05, 0))
    g.add(cushion(length - 0.12, 0.14, width - 0.12, fabric('#f1ede6'), null, 0, base + 0.17, 0, 0.04))
    g.add(cushion(length - 0.08, 0.05, (width - 0.12) * 0.62, fabric('#c9b9a5'), 'primary', 0, base + 0.255, width * 0.16, 0.025))
    g.add(cushion(length - 0.3, 0.1, 0.36, fabric('#f7f4ee'), null, 0, base + 0.28, -width / 2 + 0.28, 0.04))
  }
  // Guard rail on the open side of the top bunk, and a ladder flush with the right side.
  g.add(box(length - 0.12, 0.04, 0.04, wood('#5a4030'), 'trim', 0, height - 0.12, width / 2 - 0.03))
  for (let i = 0; i < 4; i++) g.add(box(0.03, 0.03, 0.3, wood('#5a4030'), 'trim', length / 2 - 0.015, 0.4 + i * 0.3, width / 2 - 0.2))
  return g
}

export const crib: Build = ({ length, width, height }) => {
  const g = group(
    box(length - 0.06, 0.08, width - 0.06, wood('#8a6a4a'), 'trim', 0, 0.42, 0),
    cushion(length - 0.1, 0.1, width - 0.1, fabric('#efe6da'), 'primary', 0, 0.51, 0, 0.03)
  )
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.04, height, 0.04, wood('#8a6a4a'), 'trim', sx * (length / 2 - 0.02), height / 2, sz * (width / 2 - 0.02)))
  for (const side of [-1, 1]) {
    g.add(box(0.03, 0.03, width - 0.08, wood('#8a6a4a'), 'trim', side * (length / 2 - 0.02), height - 0.05, 0))
    for (let z = -width / 2 + 0.12; z < width / 2 - 0.08; z += 0.09) g.add(box(0.015, height - 0.5, 0.015, wood('#8a6a4a'), 'trim', side * (length / 2 - 0.02), 0.45 + (height - 0.5) / 2, z))
    g.add(box(length - 0.08, 0.03, 0.03, wood('#8a6a4a'), 'trim', 0, height - 0.05, side * (width / 2 - 0.02)))
    for (let x = -length / 2 + 0.12; x < length / 2 - 0.08; x += 0.09) g.add(box(0.015, height - 0.5, 0.015, wood('#8a6a4a'), 'trim', x, 0.45 + (height - 0.5) / 2, side * (width / 2 - 0.02)))
  }
  return g
}
