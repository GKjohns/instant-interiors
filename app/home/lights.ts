/**
 * Light that follows `state.light`: a sun whose bearing, height, colour and strength come from the time
 * of day (rotated by `plan.north`), a sky/ground hemisphere and a touch of ambient so interiors read with
 * the ceilings on, window glass and sky cards tinted to match, and tone-mapping exposure per time so
 * night stays dim but legible. Lamps: a pool of point lights handed to the nearest lit fixtures (the rest
 * keep their emissive glow only), colour pulled toward amber by `warmth`.
 */
import * as THREE from 'three'
import { planBounds } from '../../shared/plan/geometry.ts'
import type { Vec2 } from '../../shared/plan/poly.ts'
import type { FloorPlan } from '../../shared/plan/schema.ts'
import type { TimeOfDay } from '../../shared/home/ops.ts'
import type { Light } from '../../shared/home/types.ts'
import type { ShellParts } from './shell.ts'

const POOL = 12

export interface Rig {
  sun: THREE.DirectionalLight
  hemi: THREE.HemisphereLight
  ambient: THREE.AmbientLight
  pool: THREE.PointLight[]
  /** Sky dome gradient uniforms (top, horizon) the renderer's dome shader reads. */
  sky: { top: { value: THREE.Color }, horizon: { value: THREE.Color } }
}

interface Look {
  /** Compass bearing the sun shines FROM (0 = north, 90 = east) and its elevation; elevation ≤ 0 = below the horizon. */
  bearing: number
  elevation: number
  sunColor: string
  sun: number
  skyTop: string
  horizon: string
  hemiSky: string
  hemiGround: string
  hemi: number
  ambient: number
  exposure: number
  glass: string
  glow: number
  env: number
  card: string
}

const LOOKS: Record<TimeOfDay, Look> = {
  dawn: { bearing: 95, elevation: 7, sunColor: '#ffb27a', sun: 1.6, skyTop: '#6f86b8', horizon: '#f6cfa6', hemiSky: '#cdbfcf', hemiGround: '#5a4e44', hemi: 0.9, ambient: 0.22, exposure: 0.95, glass: '#f4c9a0', glow: 0.5, env: 0.22, card: '#f6d2b0' },
  morning: { bearing: 125, elevation: 32, sunColor: '#fff1dc', sun: 2.8, skyTop: '#5f93d8', horizon: '#dbe7f3', hemiSky: '#c4d8f2', hemiGround: '#cbc2b4', hemi: 1.25, ambient: 0.32, exposure: 1.0, glass: '#dfeeff', glow: 0.6, env: 0.32, card: '#eef5fb' },
  noon: { bearing: 180, elevation: 64, sunColor: '#ffffff', sun: 3.2, skyTop: '#4c8be0', horizon: '#d9e6f2', hemiSky: '#cfe0f5', hemiGround: '#cfc6b8', hemi: 1.35, ambient: 0.36, exposure: 1.0, glass: '#e6f1ff', glow: 0.7, env: 0.36, card: '#f4f8fc' },
  afternoon: { bearing: 235, elevation: 38, sunColor: '#fff4e3', sun: 2.9, skyTop: '#5d94d6', horizon: '#e6e4dc', hemiSky: '#c9daf0', hemiGround: '#cbc2b3', hemi: 1.25, ambient: 0.32, exposure: 1.0, glass: '#e2efff', glow: 0.6, env: 0.32, card: '#eff3f6' },
  golden: { bearing: 272, elevation: 9, sunColor: '#ffb060', sun: 2.4, skyTop: '#7f8fb7', horizon: '#f7b97a', hemiSky: '#e8c3a2', hemiGround: '#5f4f40', hemi: 0.9, ambient: 0.22, exposure: 0.95, glass: '#ffc98a', glow: 0.5, env: 0.22, card: '#f9c994' },
  evening: { bearing: 290, elevation: -3, sunColor: '#ffa070', sun: 0, skyTop: '#1c2a4d', horizon: '#5d5f88', hemiSky: '#4a5680', hemiGround: '#2a2622', hemi: 0.45, ambient: 0.1, exposure: 0.85, glass: '#4b5a86', glow: 0.25, env: 0.1, card: '#565c85' },
  night: { bearing: 0, elevation: -20, sunColor: '#ffffff', sun: 0, skyTop: '#070b17', horizon: '#1a2238', hemiSky: '#273150', hemiGround: '#15120f', hemi: 0.22, ambient: 0.06, exposure: 0.8, glass: '#1f2a46', glow: 0.15, env: 0.06, card: '#1c2439' }
}

/** Candela per kind at lit = 1; anything unlisted is a lamp. */
const LAMP_CD: Record<string, number> = { floor_lamp: 9, table_lamp: 6, pendant: 11, chandelier: 16, ceiling_light: 14, sconce: 5, candles: 1.2, tv: 2.5 }
const AMBER = new THREE.Color('#ffb15c')

export function createRig(scene: THREE.Scene): Rig {
  const sun = new THREE.DirectionalLight('#ffffff', 2.5)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.03
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 80
  const hemi = new THREE.HemisphereLight('#c4d8f2', '#8a7b68', 1)
  const ambient = new THREE.AmbientLight('#ffffff', 0.3)
  const pool: THREE.PointLight[] = []
  for (let i = 0; i < POOL; i++) {
    const p = new THREE.PointLight('#ffd9a8', 0, 0, 2)
    p.visible = false
    pool.push(p)
  }
  scene.add(sun, sun.target, hemi, ambient, ...pool)
  return { sun, hemi, ambient, pool, sky: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() } } }
}

export function applyLight(rig: Rig, light: Light, plan: FloorPlan, renderer: THREE.WebGLRenderer, scene: THREE.Scene, shell: ShellParts | null): void {
  const look = LOOKS[light.time] ?? LOOKS.afternoon
  const b = planBounds(plan)
  const up = light.time === 'night' || look.elevation <= 0
  // Bearing → plan frame: the top of the drawing (-z) points at compass `plan.north`, so a bearing turns
  // clockwise from -z toward +x by (bearing - north).
  const phi = ((look.bearing - plan.north) * Math.PI) / 180
  const el = (Math.max(look.elevation, 2) * Math.PI) / 180
  const dir = new THREE.Vector3(Math.sin(phi) * Math.cos(el), Math.sin(el), -Math.cos(phi) * Math.cos(el))
  rig.sun.position.set(b.center[0], 0, b.center[1]).addScaledVector(dir, 30)
  rig.sun.target.position.set(b.center[0], 0, b.center[1])
  rig.sun.target.updateMatrixWorld()
  rig.sun.color.set(look.sunColor)
  rig.sun.intensity = up ? 0 : look.sun
  rig.sun.visible = !up
  // Fit the shadow frustum to the plan whatever the sun's angle: the half-diagonal plus a margin covers it.
  const half = Math.hypot(b.size[0], b.size[1]) / 2 + 2
  const cam = rig.sun.shadow.camera
  cam.left = -half
  cam.right = half
  cam.top = half
  cam.bottom = -half
  cam.updateProjectionMatrix()

  rig.hemi.color.set(look.hemiSky)
  rig.hemi.groundColor.set(look.hemiGround)
  rig.hemi.intensity = look.hemi
  rig.ambient.intensity = look.ambient
  rig.sky.top.value.set(look.skyTop)
  rig.sky.horizon.value.set(look.horizon)
  scene.environmentIntensity = look.env
  if (scene.fog instanceof THREE.Fog) scene.fog.color.set(look.horizon)
  renderer.toneMappingExposure = look.exposure
  if (shell) {
    shell.glass.emissive.set(look.glass)
    shell.glass.emissiveIntensity = look.glow
    shell.sky.color.set(look.card)
  }
}

export interface LampSource {
  group: THREE.Group
  world: THREE.Vector3
  lit: number
}

/** Hand the pool to the nearest lit fixtures; everything else keeps its emissive glow only. */
export function assignLamps(rig: Rig, lamps: LampSource[], light: Light, player: Vec2): void {
  const on = light.lamps ? lamps.filter(l => l.lit > 0) : []
  on.sort((p, q) => Math.hypot(p.world.x - player[0], p.world.z - player[1]) - Math.hypot(q.world.x - player[0], q.world.z - player[1]))
  rig.pool.forEach((p, i) => {
    const src = on[i]
    if (!src) {
      p.visible = false
      p.intensity = 0
      return
    }
    const kind = src.group.userData.kind as string
    const base = LAMP_CD[kind] ?? 7
    p.position.copy(src.world)
    p.color.set((src.group.userData.lightColor as string | undefined) ?? '#ffd9a8').lerp(AMBER, light.warmth * 0.6)
    p.intensity = base * (src.lit <= 1 ? src.lit : 1 + (src.lit - 1) * 0.8)
    p.visible = true
  })
}
