// Tables and desks. Tops are rounded slabs; legs are the trim slot so "walnut top, black legs" works.
import { group } from './helpers.ts'
import type { Build } from './helpers.ts'
import { box, cushion, cyl, drawers, legs, metal, wood } from './parts.ts'

export const coffee_table: Build = ({ length, width, height }) => group(
  cushion(length, 0.04, width, wood('#7a5a3a'), 'primary', 0, height - 0.02, 0, 0.012),
  // A lower shelf for the magazines; it also keeps the legs from reading as four sticks.
  box(length - 0.16, 0.02, width - 0.16, wood('#7a5a3a'), 'primary', 0, 0.14, 0),
  ...legs(length, width, height - 0.04, wood('#4a3626'), { inset: 0.06, r: 0.025 })
)

export const side_table: Build = ({ length, height }) => {
  const g = group(cyl(length / 2, length / 2, 0.03, wood('#7a5a3a'), 'primary', 0, height - 0.015, 0, 24))
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6
    const leg = cyl(0.014, 0.02, height - 0.03, wood('#4a3626'), 'trim', Math.cos(a) * length * 0.32, (height - 0.03) / 2, Math.sin(a) * length * 0.32, 8)
    leg.rotation.set(Math.sin(a) * 0.1, 0, -Math.cos(a) * 0.1)
    g.add(leg)
  }
  return g
}

export const console_table: Build = ({ length, width, height }) => group(
  cushion(length, 0.035, width, wood('#5a4030'), 'primary', 0, height - 0.0175, 0, 0.01),
  box(length - 0.06, 0.1, width - 0.04, wood('#5a4030'), 'primary', 0, height - 0.09, 0),
  ...drawers(length - 0.3, height - 0.13, height - 0.05, 1, 1, wood('#5a4030'), metal('#c9a24a'), width / 2 - 0.015),
  box(length - 0.12, 0.02, width - 0.1, wood('#5a4030'), 'primary', 0, 0.18, 0),
  ...legs(length, width, height - 0.035, wood('#3b2a1e'), { inset: 0.04, r: 0.018 })
)

export const dining_table: Build = ({ length, width, height }) => group(
  cushion(length, 0.05, width, wood('#8b6a48'), 'primary', 0, height - 0.025, 0, 0.012),
  box(length - 0.2, 0.08, width - 0.2, wood('#8b6a48'), 'primary', 0, height - 0.09, 0),
  ...legs(length, width, height - 0.05, wood('#5a4030'), { inset: 0.09, r: 0.035, square: true })
)

export const round_table: Build = ({ length, height }) => group(
  cyl(length / 2, length / 2 - 0.01, 0.045, wood('#8b6a48'), 'primary', 0, height - 0.0225, 0, 32),
  cyl(0.06, 0.09, height - 0.1, wood('#5a4030'), 'trim', 0, 0.05 + (height - 0.1) / 2, 0, 12),
  cyl(length * 0.3, length * 0.32, 0.05, wood('#5a4030'), 'trim', 0, 0.025, 0, 24)
)

export const desk: Build = ({ length, width, height }) => {
  const pedW = Math.min(0.42, length * 0.3)
  return group(
    cushion(length, 0.035, width, wood('#9a7a58'), 'primary', 0, height - 0.0175, 0, 0.01),
    // Drawer pedestal on the right, a panel leg on the left, a modesty panel between: a desk, not a table.
    box(pedW, height - 0.1, width - 0.06, wood('#9a7a58'), 'primary', length / 2 - pedW / 2, 0.065 + (height - 0.1) / 2, 0),
    ...drawers(pedW - 0.04, 0.1, height - 0.05, 3, 1, wood('#9a7a58'), metal('#3b3129'), width / 2 - 0.02).map((m) => {
      m.position.x += length / 2 - pedW / 2
      return m
    }),
    box(0.04, height - 0.1, width - 0.06, wood('#9a7a58'), 'primary', -length / 2 + 0.03, 0.065 + (height - 0.1) / 2, 0),
    box(length - pedW - 0.06, height * 0.45, 0.02, wood('#9a7a58'), 'primary', (-pedW) / 2 + 0.01, height - 0.04 - height * 0.225, -width / 2 + 0.06),
    ...legs(length, width, 0.065, wood('#3b3129'), { inset: 0.05, r: 0.02 })
  )
}

export const nightstand: Build = ({ length, width, height }) => group(
  box(length, height - 0.12, width, wood('#8a6a4a'), 'primary', 0, 0.1 + (height - 0.12) / 2, 0),
  cushion(length + 0.02, 0.025, width + 0.02, wood('#8a6a4a'), 'primary', 0, height - 0.0125, 0, 0.008),
  ...drawers(length - 0.04, 0.12, height - 0.04, 2, 1, wood('#8a6a4a'), metal('#c9a24a'), width / 2),
  ...legs(length, width, 0.1, wood('#5a4030'), { inset: 0.05, r: 0.018 })
)

export const vanity_table: Build = ({ length, width, height }) => {
  const g = group(cushion(length, 0.03, width, wood('#d9cfc2'), 'primary', 0, height - 0.015, 0, 0.01), ...legs(length, width, height - 0.03, wood('#c9b79a'), { inset: 0.04, r: 0.02 }))
  for (const sx of [-1, 1]) {
    g.add(box(0.3, 0.14, width - 0.04, wood('#d9cfc2'), 'primary', sx * (length / 2 - 0.17), height - 0.1, 0))
    g.add(...drawers(0.26, height - 0.165, height - 0.035, 1, 1, wood('#d9cfc2'), metal('#c9a24a'), width / 2 - 0.015).map((m) => {
      m.position.x += sx * (length / 2 - 0.17)
      return m
    }))
  }
  return g
}
