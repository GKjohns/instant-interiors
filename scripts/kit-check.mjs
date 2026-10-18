// Builds every catalog kind headless and measures it against the catalog: footprint within 15 %, height
// within 20 %, and nothing floor-standing poking below the floor. Exits non-zero on any failure.
//   node scripts/kit-check.mjs            (Node 22 strips the kit's types natively)
import * as THREE from 'three'
import { buildItem } from '../app/home/kit/index.ts'
import { CATALOG } from '../shared/home/kinds.ts'

const FOOT = 0.15
const TALL = 0.2
const failures = []
const rows = []

for (const d of CATALOG) {
  let g
  try {
    g = buildItem(d.kind, {}, d)
  } catch (e) {
    failures.push(`${d.kind}: build threw ${e instanceof Error ? e.message : e}`)
    continue
  }
  const box = new THREE.Box3().setFromObject(g)
  const size = box.getSize(new THREE.Vector3())
  const [fl, fw] = d.footprint
  const problems = []
  // Relative, with a 2 cm floor: a 1 cm miss on a 5 cm-deep picture frame is not a bug.
  const off = (got, want) => Math.abs(got - want) > 0.02 ? Math.abs(got - want) / want : 0
  if (off(size.x, fl) > FOOT) problems.push(`length ${size.x.toFixed(2)} vs ${fl}`)
  if (off(size.z, fw) > FOOT) problems.push(`width ${size.z.toFixed(2)} vs ${fw}`)
  if (off(size.y, d.height) > TALL) problems.push(`height ${size.y.toFixed(2)} vs ${d.height}`)
  const floorStanding = d.place !== 'ceiling' && d.place !== 'wall_mounted'
  if (floorStanding && box.min.y < -0.02) problems.push(`min y ${box.min.y.toFixed(3)}`)
  if (d.place === 'ceiling' && box.max.y > 0.02) problems.push(`ceiling kind rises above its mount (max y ${box.max.y.toFixed(2)})`)
  if (d.hang && Math.abs((box.min.y + box.max.y) / 2) > 0.03) problems.push(`hung kind not centred on y = 0 (${((box.min.y + box.max.y) / 2).toFixed(2)})`)
  let primary = 0
  let meshes = 0
  g.traverse((o) => {
    if (o.isMesh) meshes++
    if (o.isMesh && o.userData.slot === 'primary') primary++
  })
  if (!primary) problems.push('no primary slot')
  rows.push([d.kind.padEnd(16), `${size.x.toFixed(2)}×${size.z.toFixed(2)}×${size.y.toFixed(2)}`.padEnd(18), `cat ${fl}×${fw}×${d.height}`.padEnd(22), `${meshes} meshes`.padEnd(11), problems.join('; ')].join(' '))
  if (problems.length) failures.push(`${d.kind}: ${problems.join('; ')}`)
}

console.log(rows.join('\n'))
console.log(`\n${CATALOG.length} kinds, ${failures.length} failing`)
if (failures.length) {
  console.log(failures.map(f => '  ' + f).join('\n'))
  process.exit(1)
}
