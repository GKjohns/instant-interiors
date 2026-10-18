// Screens and appliances. Counters take `color` on the carcass and `trim` on the worktop.
import * as THREE from 'three'
import { group, mesh } from './helpers.ts'
import type { Build, Dims } from './helpers.ts'
import { box, cushion, cyl, doors, drawers, frame, glass, gloss, mat, metal, plinth, wood } from './parts.ts'

/** Flat screen on a wall bracket. The screen is slot-less dark glass that glows a cool blue-grey when lit. */
export const tv: Build = ({ length, width, height }) => {
  const screen = box(length - 0.03, height - 0.03, 0.006, mat('#0b0c10', { roughness: 0.12, metalness: 0.3, emissive: '#6a7f9a', emissiveIntensity: 0.4 }), null, 0, 0, -width / 2 + 0.06)
  screen.userData.emissive = true
  screen.userData.bulb = true
  screen.castShadow = false
  return group(
    box(length * 0.4, height * 0.4, 0.02, metal('#2b2b2e'), null, 0, 0, -width / 2 + 0.01),
    box(length, height, 0.035, gloss('#111214'), 'primary', 0, 0, -width / 2 + 0.0375),
    frame(length, height, 0.012, 0.012, gloss('#2b2b2e'), 'trim', -width / 2 + 0.065),
    screen
  )
}

export const fridge: Build = ({ length, width, height }) => group(
  cushion(length, height - 0.06, width, gloss('#d9d9d6'), 'primary', 0, 0.06 + (height - 0.06) / 2, 0, 0.02),
  plinth(length, width, 0.06, mat('#2b2b2e'), null),
  // The freezer line and the two door handles are what make a white box a fridge.
  box(length - 0.02, 0.012, 0.01, mat('#8a8a86'), null, 0, height * 0.68, width / 2 + 0.002),
  box(0.02, height * 0.22, 0.03, metal('#b8bcc0'), 'trim', length / 2 - 0.06, height * 0.8, width / 2 + 0.02),
  box(0.02, height * 0.42, 0.03, metal('#b8bcc0'), 'trim', length / 2 - 0.06, height * 0.42, width / 2 + 0.02)
)

export const stove: Build = ({ length, width, height }) => {
  const g = group(
    box(length, height - 0.1, width, gloss('#d9d9d6'), 'primary', 0, 0.08 + (height - 0.1) / 2, 0),
    plinth(length, width, 0.08, mat('#2b2b2e'), null),
    box(length, 0.02, width, gloss('#2b2b2e'), 'trim', 0, height - 0.01, 0),
    box(length, height * 0.12, 0.05, gloss('#d9d9d6'), 'primary', 0, height + height * 0.06, -width / 2 + 0.025),
    box(length - 0.1, height * 0.42, 0.015, glass('#2b2b2e'), null, 0, height * 0.42, width / 2 + 0.005),
    box(length - 0.08, 0.022, 0.03, metal('#b8bcc0'), 'trim', 0, height * 0.68, width / 2 + 0.02)
  )
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(new THREE.TorusGeometry(0.07, 0.008, 6, 20).rotateX(Math.PI / 2), mat('#1c1a18'), null, sx * length * 0.25, height + 0.004, sz * width * 0.22))
  for (let i = 0; i < 4; i++) g.add(cyl(0.016, 0.016, 0.02, metal('#b8bcc0'), 'trim', -length * 0.3 + i * length * 0.2, height + height * 0.06, -width / 2 + 0.06, 10).rotateX(Math.PI / 2))
  return g
}

/** A run of base cabinets: alternate drawer stacks and door bays, under a worktop in the trim colour. */
function baseRun({ length, width, height }: Dims, color: string, top: string, topDepth = width): THREE.Group {
  const g = group(
    box(length, height - 0.14, width - 0.02, wood(color), 'primary', 0, 0.1 + (height - 0.14) / 2, -0.01),
    plinth(length, width, 0.1, mat('#3b3129'), null),
    // A worktop deeper than the carcass overhangs BEHIND it; island turns the run round so that becomes the stool side.
    cushion(length + 0.02, 0.04, topDepth, wood(top), 'trim', 0, height - 0.02, -(topDepth - width) / 2 + 0.01, 0.008)
  )
  const bays = Math.max(1, Math.round(length / 0.6))
  const bw = length / bays
  for (let i = 0; i < bays; i++) {
    const x = -length / 2 + bw * (i + 0.5)
    const parts = i % 2 === 0 ? doors(bw - 0.02, 0.1, height - 0.05, bw > 0.7 ? 2 : 1, wood(color), metal('#8a8a8e'), width / 2 - 0.01) : drawers(bw - 0.02, 0.1, height - 0.05, 3, 1, wood(color), metal('#8a8a8e'), width / 2 - 0.01)
    for (const p of parts) p.position.x += x
    g.add(...parts)
  }
  return g
}

export const counter: Build = d => baseRun(d, '#eae6dd', '#8a6a4a')

/** Island: the cabinets face the kitchen (-z); the worktop overhangs the room side (+z) for stools. */
export const island: Build = (d) => {
  const run = baseRun({ ...d, width: d.width - 0.3 }, '#eae6dd', '#5a4030', d.width)
  run.rotation.y = Math.PI
  run.position.z = -0.15
  return group(run)
}

export const upper_cabinets: Build = ({ length, width, height }) => group(
  box(length, height, width, wood('#eae6dd'), 'primary', 0, 0, 0),
  ...doors(length - 0.02, -height / 2 + 0.01, height / 2 - 0.01, Math.max(1, Math.round(length / 0.45)), wood('#eae6dd'), metal('#8a8a8e'), width / 2),
  box(length, 0.02, width, wood('#d9d4c8'), 'primary', 0, -height / 2 + 0.01, 0)
)

export const sink: Build = ({ length, width, height }) => {
  const g = baseRun({ length, width, height }, '#eae6dd', '#b8bcc0')
  const steel = metal('#b8bcc0')
  g.add(
    box(length - 0.16, 0.03, width - 0.2, mat('#8a8e92', { metalness: 0.7, roughness: 0.35 }), null, 0, height + 0.003, 0.03),
    cyl(0.016, 0.02, 0.16, steel, 'trim', 0, height + 0.08, -width / 2 + 0.08, 10),
    cyl(0.01, 0.01, 0.2, steel, 'trim', 0, height + 0.16, -width / 2 + 0.17, 8).rotateX(Math.PI / 2)
  )
  return g
}

/** A front-loading box: dishwasher, washer, dryer. `port` draws the round door. */
function frontLoader({ length, width, height }: Dims, color: string, port: boolean): THREE.Group {
  const g = group(
    cushion(length, height - 0.04, width, gloss(color), 'primary', 0, 0.04 + (height - 0.04) / 2, 0, 0.015),
    plinth(length, width, 0.04, mat('#2b2b2e'), null),
    box(length - 0.06, 0.05, 0.01, mat('#2b2b2e'), 'trim', 0, height - 0.08, width / 2 + 0.002),
    cyl(0.02, 0.02, 0.02, metal('#b8bcc0'), 'trim', length / 2 - 0.09, height - 0.08, width / 2 + 0.01, 12).rotateX(Math.PI / 2)
  )
  if (port) {
    g.add(mesh(new THREE.TorusGeometry(0.17, 0.02, 8, 28), metal('#b8bcc0'), 'trim', 0, height * 0.48, width / 2 + 0.005))
    g.add(cyl(0.16, 0.16, 0.02, glass('#2b3a4a'), null, 0, height * 0.48, width / 2 + 0.01, 24).rotateX(Math.PI / 2))
  } else {
    g.add(box(length - 0.1, 0.02, 0.03, metal('#b8bcc0'), 'trim', 0, height - 0.16, width / 2 + 0.015))
  }
  return g
}

export const dishwasher: Build = d => frontLoader(d, '#d9d9d6', false)
export const washer: Build = d => frontLoader(d, '#eceae6', true)
export const dryer: Build = d => frontLoader(d, '#eceae6', true)
