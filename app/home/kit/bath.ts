// Bathroom fixtures: porcelain takes `color`, chrome and the vanity top take `trim`.
import * as THREE from 'three'
import { group, mesh } from './helpers.ts'
import type { Build } from './helpers.ts'
import { box, ceramic, cushion, cyl, doors, frame, glass, mat, metal } from './parts.ts'

export const toilet: Build = ({ length, width, height }) => {
  const porcelain = ceramic('#f4f4f2')
  const bowl = cyl(0.19, 0.13, 0.16, porcelain, 'primary', 0, 0.3, 0.06, 20)
  bowl.scale.z = 1.25
  const seat = cyl(0.2, 0.2, 0.03, ceramic('#fbfbf9'), null, 0, 0.395, 0.06, 20)
  seat.scale.z = 1.25
  return group(
    box(length, height * 0.45, 0.17, porcelain, 'primary', 0, height - height * 0.225, -width / 2 + 0.085),
    box(0.26, 0.26, 0.4, porcelain, 'primary', 0, 0.13, -0.02),
    bowl,
    seat,
    cyl(0.012, 0.012, 0.05, metal('#b8bcc0'), 'trim', -length / 2 + 0.06, height - 0.02, -width / 2 + 0.085, 8)
  )
}

export const bathtub: Build = ({ length, width, height }) => {
  const porcelain = ceramic('#f4f4f2')
  const t = 0.07
  const g = group(
    box(length, 0.1, width, porcelain, 'primary', 0, 0.05, 0),
    box(length, height - 0.1, t, porcelain, 'primary', 0, 0.05 + height / 2, -width / 2 + t / 2),
    box(length, height - 0.1, t, porcelain, 'primary', 0, 0.05 + height / 2, width / 2 - t / 2),
    box(t, height - 0.1, width, porcelain, 'primary', -length / 2 + t / 2, 0.05 + height / 2, 0),
    box(t, height - 0.1, width, porcelain, 'primary', length / 2 - t / 2, 0.05 + height / 2, 0),
    cushion(length - 2 * t, 0.03, width - 2 * t, mat('#dfe7ea', { roughness: 0.3 }), null, 0, 0.115, 0, 0.01)
  )
  const rim = frame(length, width, t + 0.02, 0.03, porcelain, 'primary')
  rim.rotation.x = -Math.PI / 2
  rim.position.y = height - 0.015
  const spout = cyl(0.012, 0.012, 0.12, metal('#b8bcc0'), 'trim', -length / 2 + 0.14, height + 0.02, -width / 2 + 0.03, 8)
  spout.rotation.x = Math.PI / 2
  g.add(rim, spout)
  for (const dx of [-0.07, 0.07]) g.add(mesh(new THREE.SphereGeometry(0.025, 10, 8), metal('#b8bcc0'), 'trim', -length / 2 + 0.14 + dx, height + 0.02, -width / 2 + 0.03))
  return g
}

/** Corner shower: the room's walls are its back and left; glass on the front (+z) and right (+x). */
export const shower: Build = ({ length, width, height }) => {
  const rail = metal('#b8bcc0')
  const gh = height - 0.16
  const g = group(
    cushion(length, 0.08, width, ceramic('#dfe7ea'), 'primary', 0, 0.04, 0, 0.015),
    cyl(0.035, 0.035, 0.01, mat('#8a8e92', { metalness: 0.7, roughness: 0.4 }), null, 0, 0.085, 0, 12),
    box(length - 0.04, gh, 0.012, glass('#dfe7ea'), null, 0, 0.08 + gh / 2, width / 2 - 0.02),
    box(0.012, gh, width - 0.04, glass('#dfe7ea'), null, length / 2 - 0.02, 0.08 + gh / 2, 0),
    box(length, 0.03, 0.03, rail, 'trim', 0, 0.08 + gh, width / 2 - 0.02),
    box(0.03, 0.03, width, rail, 'trim', length / 2 - 0.02, 0.08 + gh, 0),
    box(0.03, gh, 0.03, rail, 'trim', length / 2 - 0.02, 0.08 + gh / 2, width / 2 - 0.02),
    box(0.02, 0.25, 0.02, rail, 'trim', -0.1, 1.1, width / 2 - 0.04),
    cyl(0.012, 0.012, height - 0.1, rail, 'trim', -length / 2 + 0.06, 0.08 + (height - 0.1) / 2, -width / 2 + 0.06, 8),
    cyl(0.01, 0.01, 0.3, rail, 'trim', -length / 2 + 0.2, height - 0.06, -width / 2 + 0.2, 8).rotateZ(Math.PI / 2).rotateX(Math.PI / 4),
    cyl(0.08, 0.08, 0.015, rail, 'trim', -length / 2 + 0.3, height - 0.16, -width / 2 + 0.3, 16)
  )
  return g
}

export const vanity: Build = ({ length, width, height }) => {
  const g = group(
    box(length, height - 0.14, width - 0.02, ceramic('#eae6dd'), 'primary', 0, 0.1 + (height - 0.14) / 2, -0.01),
    box(length - 0.08, 0.1, width - 0.08, mat('#3b3129'), null, 0, 0.05, -0.02),
    cushion(length + 0.02, 0.04, width + 0.02, ceramic('#f4f4f2'), 'trim', 0, height - 0.02, 0.01, 0.008),
    ...doors(length - 0.02, 0.1, height - 0.05, length > 1.1 ? 3 : 2, ceramic('#eae6dd'), metal('#b8bcc0'), width / 2 - 0.01),
    cyl(0.012, 0.016, 0.1, metal('#b8bcc0'), 'trim', 0, height + 0.05, -width / 2 + 0.1, 8),
    cyl(0.008, 0.008, 0.1, metal('#b8bcc0'), 'trim', 0, height + 0.1, -width / 2 + 0.15, 8).rotateX(Math.PI / 2)
  )
  const basin = cyl(Math.min(0.2, length * 0.22), Math.min(0.15, length * 0.17), 0.03, mat('#dfe7ea', { roughness: 0.25 }), null, 0, height - 0.012, 0.03, 20)
  basin.scale.z = 0.75
  g.add(basin)
  return g
}

export const towel_rack: Build = ({ length, width, height }) => group(
  cyl(0.012, 0.012, length, metal('#b8bcc0'), 'primary', 0, 0, 0, 10).rotateZ(Math.PI / 2),
  box(0.03, 0.03, width - 0.02, metal('#b8bcc0'), 'primary', -length / 2 + 0.03, 0, -0.01),
  box(0.03, 0.03, width - 0.02, metal('#b8bcc0'), 'primary', length / 2 - 0.03, 0, -0.01),
  // A folded hand towel over the bar: a 10 cm-tall kind can't carry a full drape.
  cushion(length * 0.45, height * 0.9, 0.05, mat('#dfe7ea', { roughness: 1 }), 'trim', 0, -height * 0.05, 0.01, 0.012)
)
