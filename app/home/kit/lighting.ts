// Lights. Shades are the trim slot and glow in their own colour when lit; the bulb is the glow slot and
// the anchor for a pooled point light. Ceiling kinds hang DOWN from y = 0 (the renderer lifts them).
import * as THREE from 'three'
import { glowMat, group, mesh } from './helpers.ts'
import type { Build } from './helpers.ts'
import { box, bulb, ceramic, cyl, mat, metal, shade } from './parts.ts'

export const floor_lamp: Build = ({ length, height }) => {
  const shadeH = 0.3
  return group(
    cyl(length / 2 * 0.85, length / 2, 0.025, metal('#2b2b2e'), 'primary', 0, 0.0125, 0, 20),
    cyl(0.014, 0.018, height - shadeH - 0.04, metal('#2b2b2e'), 'primary', 0, (height - shadeH - 0.04) / 2 + 0.025, 0, 10),
    shade(length / 2 * 0.8, length / 2, shadeH, '#f1e2c2', 0, height - shadeH / 2, 0),
    bulb(0.035, 0, height - shadeH - 0.02, 0)
  )
}

export const table_lamp: Build = ({ length, height }) => {
  const shadeH = height * 0.4
  return group(
    cyl(0.035, 0.06, height - shadeH - 0.06, ceramic('#8a6a4a'), 'primary', 0, (height - shadeH - 0.06) / 2 + 0.015, 0, 14),
    cyl(0.07, 0.075, 0.03, ceramic('#8a6a4a'), 'primary', 0, 0.015, 0, 16),
    shade(length / 2 * 0.65, length / 2, shadeH, '#f1e2c2', 0, height - shadeH / 2, 0),
    bulb(0.028, 0, height - shadeH - 0.01, 0)
  )
}

export const pendant: Build = ({ length, height }) => {
  const shadeH = height * 0.42
  return group(
    cyl(0.04, 0.04, 0.02, metal('#2b2b2e'), 'primary', 0, -0.01, 0, 12),
    cyl(0.005, 0.005, height - shadeH, metal('#2b2b2e'), 'primary', 0, -(height - shadeH) / 2, 0, 6),
    cyl(0.03, 0.035, 0.05, metal('#2b2b2e'), 'primary', 0, -(height - shadeH) - 0.01, 0, 12),
    shade(length * 0.15, length / 2, shadeH, '#ffe6b0', 0, -height + shadeH / 2, 0),
    bulb(0.03, 0, -height + shadeH * 0.55, 0)
  )
}

export const chandelier: Build = ({ length, height }) => {
  const hubY = -height * 0.6
  const g = group(
    cyl(0.005, 0.005, -hubY - 0.05, metal('#c9a24a'), 'primary', 0, hubY / 2, 0, 6),
    mesh(new THREE.SphereGeometry(0.07, 14, 10), metal('#c9a24a'), 'primary', 0, hubY, 0),
    cyl(0.02, 0.04, height + hubY, metal('#c9a24a'), 'primary', 0, hubY - (height + hubY) / 2, 0, 10)
  )
  const n = 8
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const r = length / 2 - 0.04
    const arm = cyl(0.008, 0.008, r, metal('#c9a24a'), 'primary', Math.cos(a) * r / 2, hubY - 0.03, Math.sin(a) * r / 2, 6)
    arm.rotation.set(0, -a, Math.PI / 2)
    g.add(arm, cyl(0.025, 0.02, 0.02, metal('#c9a24a'), 'primary', Math.cos(a) * r, hubY - 0.02, Math.sin(a) * r, 10))
    g.add(cyl(0.012, 0.012, 0.09, mat('#fff1cc'), 'trim', Math.cos(a) * r, hubY + 0.035, Math.sin(a) * r, 8))
    const b = bulb(0.02, Math.cos(a) * r, hubY + 0.1, Math.sin(a) * r, '#ffe6b0', 2.2)
    b.userData.bulb = i === 0
    g.add(b)
  }
  return g
}

export const ceiling_light: Build = ({ length, height }) => {
  const dome = mesh(new THREE.SphereGeometry(length / 2 - 0.02, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mat('#f4f1ea', { side: THREE.DoubleSide, roughness: 0.6, emissive: '#f4f1ea', emissiveIntensity: 0.5 }), 'primary', 0, -0.02, 0)
  dome.scale.y = (height - 0.02) / (length / 2 - 0.02)
  dome.userData.emissiveFollows = 0.5
  dome.userData.emissive = true
  dome.castShadow = false
  return group(cyl(length / 2, length / 2, 0.02, ceramic('#fff6dd'), 'trim', 0, -0.01, 0, 24), dome, bulb(0.03, 0, -height * 0.5, 0, '#ffe6b0', 1.8))
}

/** Wall sconce: a back plate on the wall (local -z), a short arm, and a half shade open at the top. */
export const sconce: Build = ({ length, width, height }) => {
  const half = mesh(new THREE.CylinderGeometry(length / 2, length / 2 * 0.7, height * 0.6, 16, 1, true, 0, Math.PI), mat('#ffe6b0', { side: THREE.DoubleSide, roughness: 0.7, emissive: '#ffe6b0', emissiveIntensity: 0.55 }), 'trim', 0, height * 0.05, -width / 2 + 0.03)
  half.rotation.y = -Math.PI / 2
  half.userData.emissiveFollows = 0.55
  half.userData.emissive = true
  return group(
    box(0.08, height * 0.95, 0.02, metal('#3b3129'), 'primary', 0, 0, -width / 2 + 0.01),
    box(0.015, 0.015, width * 0.5, metal('#3b3129'), 'primary', 0, -height * 0.2, -width / 2 + 0.02 + width * 0.25),
    half,
    bulb(0.022, 0, height * 0.05, -width / 2 + 0.05)
  )
}

export const candles: Build = ({ length, width }) => {
  const g = group(box(length, 0.012, width, metal('#8a6a4a'), 'trim', 0, 0.006, 0))
  const heights = [0.18, 0.12, 0.22]
  heights.forEach((h, i) => {
    const x = (i - 1) * length * 0.33
    g.add(cyl(0.025, 0.025, h, mat('#f1e2c2', { roughness: 0.6 }), 'primary', x, 0.012 + h / 2, 0, 12))
    const flame = mesh(new THREE.ConeGeometry(0.008, 0.03, 8), glowMat('#ffb347', 3), 'glow', x, 0.012 + h + 0.015, 0)
    flame.castShadow = false
    flame.userData.emissive = true
    flame.userData.bulb = i === 2
    g.add(flame)
  })
  return g
}
