// The kit covers the catalog, and every build is a recolourable group. Runs headless: no DOM, no WebGL.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { BUILDERS, buildItem, recolor } from '../app/home/kit/index.ts'
import { CATALOG } from '../shared/home/kinds.ts'

function slotMeshes(root: THREE.Object3D, slot: string): THREE.Mesh[] {
  const out: THREE.Mesh[] = []
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.userData.slot === slot) out.push(o as THREE.Mesh)
  })
  return out
}

test('BUILDERS has an entry for every catalog kind', () => {
  const missing = CATALOG.filter(k => typeof BUILDERS[k.kind] !== 'function').map(k => k.kind)
  assert.deepEqual(missing, [])
})

test('every kind builds a Group with at least one primary slot mesh and a kind tag', () => {
  for (const d of CATALOG) {
    const g = buildItem(d.kind, {}, d)
    assert.ok(g instanceof THREE.Group, `${d.kind} is a Group`)
    assert.equal(g.userData.kind, d.kind)
    assert.ok(slotMeshes(g, 'primary').length > 0, `${d.kind} has a primary slot`)
  }
})

test('light kinds expose a bulb anchor and respond to lit', () => {
  for (const d of CATALOG.filter(k => k.light)) {
    const on = buildItem(d.kind, { lit: 1 }, d)
    assert.ok(Array.isArray(on.userData.lightAt), `${d.kind} has lightAt`)
    assert.ok(on.userData.light && on.userData.lit === 1)
    const off = buildItem(d.kind, { lit: 0 }, d)
    const glowing = (root: THREE.Object3D) => {
      let sum = 0
      root.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.isMesh && m.userData.emissive) {
          const mat = m.material as THREE.MeshStandardMaterial
          sum += mat.emissiveIntensity * (mat.emissive.r + mat.emissive.g + mat.emissive.b)
        }
      })
      return sum
    }
    assert.ok(glowing(on) > 0 && glowing(off) === 0, `${d.kind} goes dark at lit 0`)
  }
})

test('color and trim recolour slots and sized kinds stretch', () => {
  const d = CATALOG.find(k => k.kind === 'sofa')!
  const g = buildItem('sofa', { color: '#ff0000', trim: '#00ff00', length: 3 }, d)
  for (const m of slotMeshes(g, 'primary')) assert.equal((m.material as THREE.MeshStandardMaterial).color.getHexString(), 'ff0000')
  for (const m of slotMeshes(g, 'trim')) assert.equal((m.material as THREE.MeshStandardMaterial).color.getHexString(), '00ff00')
  const size = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3())
  assert.ok(Math.abs(size.x - 3) < 0.1, `sofa stretched to 3 m (${size.x.toFixed(2)})`)
  recolor(g, {})
  for (const m of slotMeshes(g, 'primary')) assert.equal((m.material as THREE.MeshStandardMaterial).color.getHexString(), (m.userData.baseColor as string).slice(1))
})

test('a bad colour string falls back to the builder colour', () => {
  const d = CATALOG.find(k => k.kind === 'ottoman')!
  const g = buildItem('ottoman', { color: 'not a colour' }, d)
  for (const m of slotMeshes(g, 'primary')) assert.equal((m.material as THREE.MeshStandardMaterial).color.getHexString(), (m.userData.baseColor as string).slice(1))
})
