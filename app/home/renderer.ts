/**
 * The home on screen: the shell from the plan (shell.ts), one kit group per item, light by time of day
 * (lights.ts), and two ways to see it: walking at eye height with wall collision, or the plan view, an
 * orbiting dollhouse with the ceilings off. `sync` reconciles a HomeState against what is already built so
 * a sentence that moves one chair only moves one chair.
 *
 * Frames: the plan frame IS three.js x/z (y up, floors at 0). Yaw 0 faces -z, positive turns toward -x.
 */
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { entry, planBounds, roomAt, walls } from '../../shared/plan/geometry.ts'
import type { WallPiece } from '../../shared/plan/geometry.ts'
import { closestOnSegment } from '../../shared/plan/poly.ts'
import type { Vec2 } from '../../shared/plan/poly.ts'
import type { FloorPlan } from '../../shared/plan/schema.ts'
import { KIT } from '../../shared/home/kinds.ts'
import type { KindDescriptor } from '../../shared/home/kinds.ts'
import { footprintOf } from '../../shared/home/select.ts'
import type { Effects, HomeState, Item, OpContext } from '../../shared/home/types.ts'
import { applyLit, buildItem, recolor } from './kit/index.ts'
import { applyLight, assignLamps, createRig } from './lights.ts'
import type { LampSource, Rig } from './lights.ts'
import { LookInput } from './look.ts'
import { buildShell, shellParts, updateSurfaces } from './shell.ts'
import type { ShellParts } from './shell.ts'

export type Mode = 'walk' | 'plan'
/** What the crosshair is on: the same shape a sentence's `OpContext.gaze` freezes. */
export type Gaze = OpContext['gaze']

const EYE = 1.6
const RADIUS = 0.3
const SPEED = 2.2
const RUN = 2.2
const TURN = 0.004
/** A kind the catalog no longer knows still gets a box so the log replays without holes. */
const UNKNOWN: KindDescriptor = { kind: 'box', label: 'box', footprint: [0.5, 0.5], height: 0.5, place: 'free', face: 'none', tags: ['decor'], rooms: [], color: '#b08968' }

interface View {
  item: Item
  group: THREE.Group
  desc: KindDescriptor
  box: THREE.Box3
  boxDirty: boolean
  /** Props with the colour-only keys removed; a change here means a rebuild. */
  shapeKey: string
}

interface Solid {
  a: Vec2
  b: Vec2
  half: number
}

interface Tween {
  t0: number
  dur: number
  fn: (t: number) => void
  done?: () => void
}

export class HomeRenderer {
  camera: THREE.PerspectiveCamera
  yaw = 0
  pitch = 0
  mode: Mode = 'walk'
  /** Fires when the looked-at item or room changes; `gaze()` is the cheap polled form. */
  onGaze?: (g: Gaze) => void

  private host: HTMLElement
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private rig: Rig
  private pmrem: THREE.PMREMGenerator
  private input: LookInput
  private ro: ResizeObserver
  private raycaster = new THREE.Raycaster()

  private state: HomeState | null = null
  private shell: THREE.Group | null = null
  private parts: ShellParts | null = null
  private shellKey = ''
  private surfaceKey = ''
  private lightKey = ''
  private solids: Solid[] = []
  private bounds = { min: [0, 0] as Vec2, max: [10, 10] as Vec2, center: [5, 5] as Vec2, size: [10, 10] as Vec2 }
  private views = new Map<string, View>()
  private tweens: Tween[] = []

  /** Feet position in the plan frame. */
  private pos: Vec2 = [0, 0]
  private glide: { from: Vec2, to: Vec2, yaw0: number, yaw1: number, t0: number } | null = null
  private orbit = { yaw: 0, pitch: -75 * Math.PI / 180, dist: 14, target: [5, 5] as Vec2 }
  private pointerNdc: Vec2 | null = null
  private lampAnchor: Vec2 = [Infinity, Infinity]

  private gazeNow: Gaze = { point: [0, 0] }
  private gazeSig = ''
  private highlighted: View | null = null
  private ring: THREE.Mesh
  private halo: THREE.Mesh
  private haloTarget = 0
  private dome: THREE.Mesh
  private ground: THREE.Mesh
  private prev = 0

  constructor(host: HTMLElement) {
    this.host = host
    const w = host.clientWidth || window.innerWidth
    const h = host.clientHeight || window.innerHeight
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(w, h)
    this.renderer.shadowMap.enabled = true
    // three 0.186 dropped PCFSoft; PCF with a 2048 map is crisp enough for window-shaped sun patches.
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.domElement.classList.add('home-canvas')
    this.renderer.domElement.style.touchAction = 'none'
    host.appendChild(this.renderer.domElement)

    this.camera = new THREE.PerspectiveCamera(70, w / h, 0.05, 500)
    this.camera.rotation.order = 'YXZ'
    this.camera.position.set(0, EYE, 0)

    // A neutral studio environment gives the PBR materials their speculars; its strength follows the time of day.
    this.pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    this.scene.fog = new THREE.Fog('#dbe7f3', 40, 160)
    this.rig = createRig(this.scene)

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#8d9a80', roughness: 1 }))
    this.ground.position.y = -0.03
    this.ground.receiveShadow = true
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(240, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: this.rig.sky,
        vertexShader: 'varying float vY; void main() { vY = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying float vY; void main() { float t = smoothstep(-0.05, 0.45, vY); gl_FragColor = vec4(mix(horizon, top, t), 1.0); }'
      })
    )
    this.scene.add(this.ground, this.dome)

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthWrite: false, fog: false })
    )
    this.ring.visible = false
    this.ring.renderOrder = 2
    this.halo = new THREE.Mesh(
      new THREE.CircleGeometry(0.55, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#fff1d2', transparent: true, opacity: 0, depthWrite: false, fog: false, alphaMap: radial() })
    )
    this.halo.visible = false
    this.halo.renderOrder = 2
    this.scene.add(this.ring, this.halo)

    this.raycaster.far = 60
    this.input = new LookInput(this.renderer.domElement, {
      turn: (dx, dy) => this.turn(dx, dy),
      zoom: (d) => {
        if (this.mode === 'plan') this.orbit.dist = THREE.MathUtils.clamp(this.orbit.dist * (1 + d * 0.0012), 3, 60)
      },
      step: (m) => {
        if (this.mode === 'walk') this.walk(m, 0)
      },
      pointer: (ndc) => {
        this.pointerNdc = ndc
      }
    })
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(host)
    this.renderer.setAnimationLoop(now => this.frame(now))
  }

  // ---------- reconcile ----------

  sync(state: HomeState, effects?: Effects): void {
    const plan = state.plan
    const now = performance.now()
    const shellKey = `${plan.id}|${plan.ceiling}|${plan.north}|${JSON.stringify(plan.rooms.map(r => [r.id, r.polygon]))}|${JSON.stringify(plan.openings)}`
    const surfaceKey = JSON.stringify(plan.rooms.map(r => [r.id, r.floor, r.walls, r.ceiling]))
    const newPlan = !this.state || this.state.plan.id !== plan.id
    if (shellKey !== this.shellKey) {
      this.rebuildShell(plan)
      this.shellKey = shellKey
      this.surfaceKey = surfaceKey
    } else if (surfaceKey !== this.surfaceKey && this.shell) {
      updateSurfaces(this.shell, plan)
      this.surfaceKey = surfaceKey
    }
    if (effects?.reset) {
      for (const v of [...this.views.values()]) this.dropView(v, false)
    }

    const seen = new Set<string>()
    for (const item of state.items) {
      seen.add(item.id)
      const v = this.views.get(item.id)
      if (!v) {
        this.addView(item, state, now)
        continue
      }
      const shapeKey = shapeOf(item)
      if (v.item === item) continue
      if (item.kind !== v.item.kind || shapeKey !== v.shapeKey) {
        this.dropView(v, false)
        this.addView(item, state, now, false)
        continue
      }
      if (JSON.stringify([item.props.color, item.props.trim, item.props.lit]) !== JSON.stringify([v.item.props.color, v.item.props.trim, v.item.props.lit])) {
        recolor(v.group, item.props)
        if (v.desc.light) applyLit(v.group, this.effectiveLit(item, state))
      }
      if (item.pos[0] !== v.item.pos[0] || item.pos[1] !== v.item.pos[1] || item.yaw !== v.item.yaw || item.y !== v.item.y) this.moveView(v, item, plan, now)
      v.item = item
    }
    for (const v of [...this.views.values()]) if (!seen.has(v.item.id)) this.dropView(v, true)

    const lightKey = JSON.stringify(state.light)
    if (lightKey !== this.lightKey || shellKey !== this.shellKey || newPlan) {
      const lampsChanged = this.state?.light.lamps !== state.light.lamps
      this.lightKey = lightKey
      applyLight(this.rig, state.light, plan, this.renderer, this.scene, this.parts)
      if (lampsChanged) for (const v of this.views.values()) if (v.desc.light) applyLit(v.group, this.effectiveLit(v.item, state))
    }
    this.state = state
    this.lampAnchor = [Infinity, Infinity]
    if (newPlan) this.spawn(plan)
    if (effects?.goto) this.teleport(effects.goto.pos, effects.goto.yaw)
  }

  private rebuildShell(plan: FloorPlan): void {
    if (this.shell) {
      this.scene.remove(this.shell)
      disposeGeometry(this.shell)
    }
    this.shell = buildShell(plan)
    this.parts = shellParts(this.shell)
    this.scene.add(this.shell)
    this.bounds = planBounds(plan)
    this.solids = walls(plan).flatMap(w => w.pieces.filter(p => p.y0 < 1).map((p: WallPiece): Solid => ({ a: p.a, b: p.b, half: w.thickness / 2 })))
    this.orbit.target = this.bounds.center
    this.orbit.dist = this.fitDistance()
    this.applyMode()
  }

  private effectiveLit(item: Item, state: HomeState): number {
    return state.light.lamps ? item.props.lit ?? 1 : 0
  }

  private addView(item: Item, state: HomeState, now: number, pop = true): void {
    const desc = KIT[item.kind] ?? UNKNOWN
    const group = buildItem(item.kind, item.props, desc)
    group.userData.itemId = item.id
    group.userData.baseScale = group.scale.x
    if (desc.light) applyLit(group, this.effectiveLit(item, state))
    placeGroup(group, item, desc, state.plan)
    this.scene.add(group)
    const v: View = { item, group, desc, box: new THREE.Box3(), boxDirty: true, shapeKey: shapeOf(item) }
    this.views.set(item.id, v)
    if (pop) {
      const target = group.userData.baseScale as number
      group.scale.setScalar(target * 0.01)
      // Ease-out-back: a small overshoot reads as "set down", not "faded in".
      this.tween(now, 250, (t) => {
        const u = t - 1
        group.scale.setScalar(target * Math.max(0.01, 1 + 2.7 * u * u * u + 1.7 * u * u))
        v.boxDirty = true
      }, () => {
        group.scale.setScalar(target)
        v.boxDirty = true
      })
    }
  }

  private moveView(v: View, item: Item, plan: FloorPlan, now: number): void {
    const from = v.group.position.clone()
    const yaw0 = v.group.rotation.y
    const probe = new THREE.Group()
    placeGroup(probe, item, v.desc, plan)
    const to = probe.position.clone()
    let dYaw = item.yaw - yaw0
    dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw))
    this.tween(now, 300, (t) => {
      const e = t * t * (3 - 2 * t)
      v.group.position.lerpVectors(from, to, e)
      v.group.rotation.y = yaw0 + dYaw * e
      v.boxDirty = true
    }, () => {
      v.group.position.copy(to)
      v.group.rotation.y = item.yaw
      v.boxDirty = true
      this.lampAnchor = [Infinity, Infinity]
    })
  }

  private dropView(v: View, animate: boolean): void {
    this.views.delete(v.item.id)
    if (this.highlighted === v) this.highlight(null)
    const gone = () => {
      this.scene.remove(v.group)
      disposeGeometry(v.group, true)
    }
    if (!animate) return gone()
    const s0 = v.group.scale.x
    this.tween(performance.now(), 200, t => v.group.scale.setScalar(Math.max(0.001, s0 * (1 - t))), gone)
  }

  // ---------- modes and movement ----------

  setMode(mode: Mode): void {
    if (mode === this.mode) return
    this.mode = mode
    if (mode === 'plan') {
      this.orbit.target = this.bounds.center
      this.orbit.dist = this.fitDistance()
    }
    this.applyMode()
  }

  private applyMode(): void {
    if (!this.parts) return
    const plan = this.mode === 'plan'
    for (const c of this.parts.ceilings) c.visible = !plan
    for (const c of this.parts.skyCards) c.visible = !plan
  }

  private fitDistance(): number {
    const aspect = this.camera.aspect || 1.6
    const need = Math.max(this.bounds.size[0] / aspect, this.bounds.size[1]) / 2 + 1.5
    return THREE.MathUtils.clamp(need / Math.tan((this.camera.fov * Math.PI) / 360) * 1.1, 3, 60)
  }

  private turn(dx: number, dy: number): void {
    if (this.mode === 'plan') {
      this.orbit.yaw -= dx * TURN
      this.orbit.pitch = THREE.MathUtils.clamp(this.orbit.pitch - dy * TURN, -89 * Math.PI / 180, -25 * Math.PI / 180)
      return
    }
    this.glide = null
    this.yaw -= dx * TURN
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * TURN, -1.3, 1.2)
  }

  /** Move `forward` metres along the facing and `strafe` to the right, sliding along any wall in the way. */
  private walk(forward: number, strafe: number): void {
    if (!forward && !strafe) return
    this.glide = null
    const fx = -Math.sin(this.yaw)
    const fz = -Math.cos(this.yaw)
    const next: Vec2 = [this.pos[0] + fx * forward + Math.cos(this.yaw) * strafe, this.pos[1] + fz * forward - Math.sin(this.yaw) * strafe]
    this.pos = this.resolve(next)
  }

  /** Circle vs floor-level wall pieces: push out along the piece's normal; doorways are simply gaps. */
  private resolve(p: Vec2): Vec2 {
    const out: Vec2 = [p[0], p[1]]
    for (let iter = 0; iter < 3; iter++) {
      let moved = false
      for (const s of this.solids) {
        const c = closestOnSegment(out, s.a, s.b)
        const min = RADIUS + s.half
        if (c.d >= min) continue
        moved = true
        if (c.d < 1e-4) {
          // Standing on the centreline: shove sideways off the wall.
          const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) || 1
          out[0] += ((s.b[1] - s.a[1]) / len) * min
          out[1] += (-(s.b[0] - s.a[0]) / len) * min
        } else {
          out[0] += ((out[0] - c.point[0]) / c.d) * (min - c.d)
          out[1] += ((out[1] - c.point[1]) / c.d) * (min - c.d)
        }
      }
      if (!moved) break
    }
    out[0] = THREE.MathUtils.clamp(out[0], this.bounds.min[0] - 1, this.bounds.max[0] + 1)
    out[1] = THREE.MathUtils.clamp(out[1], this.bounds.min[1] - 1, this.bounds.max[1] + 1)
    return out
  }

  look(yaw: number, pitch: number, pos?: Vec2): void {
    this.glide = null
    this.yaw = yaw
    this.pitch = pitch
    if (pos) this.pos = [pos[0], pos[1]]
  }

  teleport(pos: Vec2, yaw?: number): void {
    const yaw1 = yaw ?? this.yaw
    this.glide = { from: [this.pos[0], this.pos[1]], to: [pos[0], pos[1]], yaw0: this.yaw, yaw1: this.yaw + Math.atan2(Math.sin(yaw1 - this.yaw), Math.cos(yaw1 - this.yaw)), t0: performance.now() }
  }

  spawn(plan: FloorPlan): void {
    const e = entry(plan)
    this.look(e.yaw, 0, e.pos)
  }

  player(): { pos: Vec2, yaw: number, room?: string } {
    const room = this.state ? roomAt(this.state.plan, this.pos)?.id : undefined
    return { pos: [r2(this.pos[0]), r2(this.pos[1])], yaw: r2(this.yaw), ...(room ? { room } : {}) }
  }

  // ---------- gaze, highlight, projection ----------

  gaze(): Gaze {
    return this.gazeNow
  }

  private computeGaze(): Gaze {
    const ndc: Vec2 = this.mode === 'plan' && this.pointerNdc ? this.pointerNdc : [0, 0]
    this.raycaster.setFromCamera(new THREE.Vector2(ndc[0], ndc[1]), this.camera)
    const ray = this.raycaster.ray
    let best: { d: number, point: THREE.Vector3, id?: string } | null = null
    for (const view of this.views.values()) {
      if (view.boxDirty) {
        view.box.setFromObject(view.group)
        view.boxDirty = false
      }
      if (!ray.intersectsBox(view.box)) continue
      const hit = this.raycaster.intersectObject(view.group, true)[0]
      if (hit && (!best || hit.distance < best.d)) best = { d: hit.distance, point: hit.point, id: view.item.id }
    }
    if (this.parts) {
      const hit = this.raycaster.intersectObjects(this.parts.solid, false)[0]
      if (hit && (!best || hit.distance < best.d)) best = { d: hit.distance, point: hit.point }
    }
    let point: Vec2
    if (best) point = [best.point.x, best.point.z]
    else {
      // Looking at the sky or out a window: "there" is a few metres ahead on the floor.
      const t = ray.direction.y < -1e-3 ? Math.min(8, (ray.origin.y) / -ray.direction.y) : 5
      point = [ray.origin.x + ray.direction.x * t, ray.origin.z + ray.direction.z * t]
    }
    const room = this.state ? roomAt(this.state.plan, point)?.id : undefined
    return { point: [r2(point[0]), r2(point[1])], ...(best?.id ? { itemId: best.id } : {}), ...(room ? { room } : {}) }
  }

  highlight(itemId: string | null): void {
    const next = itemId ? this.views.get(itemId) ?? null : null
    if (next === this.highlighted) return
    if (this.highlighted) glow(this.highlighted.group, false)
    this.highlighted = next
    if (!next) {
      this.ring.visible = false
      return
    }
    glow(next.group, true)
    const fp = footprintOf(next.desc, next.item.props)
    const r = Math.hypot(fp.length, fp.width) / 2 + 0.08
    this.ring.scale.setScalar(r)
    // Above a rug (2 cm) so the ring is not swallowed by it.
    this.ring.position.set(next.group.position.x, 0.035, next.group.position.z)
    this.ring.visible = true
  }

  anticipate(point: Vec2 | null): void {
    if (point) {
      this.halo.position.set(point[0], 0.035, point[1])
      this.halo.visible = true
    }
    this.haloTarget = point ? 0.75 : 0
  }

  toScreen(p: Vec2, y = 0): { x: number, y: number, visible: boolean } {
    const v = new THREE.Vector3(p[0], y, p[1]).project(this.camera)
    const el = this.renderer.domElement
    return { x: (v.x * 0.5 + 0.5) * el.clientWidth, y: (-v.y * 0.5 + 0.5) * el.clientHeight, visible: v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 }
  }

  // ---------- loop ----------

  private frame(now: number): void {
    const dt = Math.min(0.05, (now - this.prev) / 1000) || 0.016
    this.prev = now

    if (this.glide) {
      const t = Math.min(1, (now - this.glide.t0) / 600)
      const e = t * t * (3 - 2 * t)
      this.pos = [this.glide.from[0] + (this.glide.to[0] - this.glide.from[0]) * e, this.glide.from[1] + (this.glide.to[1] - this.glide.from[1]) * e]
      this.yaw = this.glide.yaw0 + (this.glide.yaw1 - this.glide.yaw0) * e
      if (t >= 1) this.glide = null
    } else if (this.mode === 'walk') {
      const m = this.input.move()
      const speed = SPEED * (m.run ? RUN : 1) * dt
      this.walk(m.forward * speed, m.strafe * speed)
    }

    if (this.mode === 'walk') {
      this.camera.position.set(this.pos[0], EYE, this.pos[1])
      this.camera.rotation.set(this.pitch, this.yaw, 0)
    } else {
      const o = this.orbit
      const e = -o.pitch
      this.camera.position.set(o.target[0] + Math.sin(o.yaw) * Math.cos(e) * o.dist, Math.sin(e) * o.dist, o.target[1] + Math.cos(o.yaw) * Math.cos(e) * o.dist)
      this.camera.lookAt(o.target[0], 0, o.target[1])
    }
    this.dome.position.set(this.camera.position.x, 0, this.camera.position.z)

    this.tweens = this.tweens.filter((tw) => {
      const t = Math.min(1, (now - tw.t0) / tw.dur)
      tw.fn(t)
      if (t < 1) return true
      tw.done?.()
      return false
    })

    const hm = this.halo.material as THREE.MeshBasicMaterial
    hm.opacity += (this.haloTarget - hm.opacity) * Math.min(1, dt * 8)
    if (hm.opacity < 0.01 && !this.haloTarget) this.halo.visible = false

    if (this.state && Math.hypot(this.pos[0] - this.lampAnchor[0], this.pos[1] - this.lampAnchor[1]) > 1) {
      this.lampAnchor = [this.pos[0], this.pos[1]]
      assignLamps(this.rig, this.lamps(), this.state.light, this.pos)
    }

    this.gazeNow = this.computeGaze()
    const sig = `${this.gazeNow.itemId ?? ''}|${this.gazeNow.room ?? ''}`
    if (sig !== this.gazeSig) {
      this.gazeSig = sig
      this.onGaze?.(this.gazeNow)
    }
    this.renderer.render(this.scene, this.camera)
  }

  private lamps(): LampSource[] {
    const out: LampSource[] = []
    for (const v of this.views.values()) {
      if (!v.group.userData.light) continue
      const at = v.group.userData.lightAt as [number, number, number] | undefined
      const world = new THREE.Vector3(...(at ?? [0, 0, 0]))
      v.group.updateMatrixWorld()
      world.applyMatrix4(v.group.matrixWorld)
      out.push({ group: v.group, world, lit: (v.group.userData.lit as number | undefined) ?? 1 })
    }
    return out
  }

  private tween(t0: number, dur: number, fn: (t: number) => void, done?: () => void): void {
    this.tweens.push({ t0, dur, fn, done })
  }

  private resize(): void {
    const w = this.host.clientWidth
    const h = this.host.clientHeight
    if (!w || !h) return
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null)
    this.ro.disconnect()
    this.input.dispose()
    for (const v of this.views.values()) disposeGeometry(v.group, true)
    this.views.clear()
    if (this.shell) disposeGeometry(this.shell)
    disposeGeometry(this.ground, true)
    disposeGeometry(this.dome, true)
    this.scene.environment?.dispose()
    this.pmrem.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}

// ---------- helpers ----------

/** Where a built group sits for an item: hung kinds are built centred on y = 0, ceiling kinds hang down from y = 0. */
function placeGroup(group: THREE.Object3D, item: Item, desc: KindDescriptor, plan: FloorPlan): void {
  const h = footprintOf(desc, item.props).height
  let y = item.y ?? 0
  if (desc.place === 'ceiling') y = item.y !== undefined ? item.y + h : plan.ceiling
  else if (desc.hang !== undefined || desc.place === 'wall_mounted') y = (item.y ?? Math.max(0.05, (item.props.hang ?? desc.hang ?? 1.5) - h / 2)) + h / 2
  // The kernel hangs a mirror or picture with its back on the room polygon, which is the wall's centreline;
  // out to the wall's face, or a 5 cm-deep picture sits inside the plaster and never shows.
  const out = desc.place === 'wall_mounted' ? wallFace(plan, item.pos) : 0
  group.position.set(item.pos[0] + Math.sin(item.yaw) * out, y, item.pos[1] + Math.cos(item.yaw) * out)
  group.rotation.y = item.yaw
}

/** Half the thickness of the wall a hung thing is on (0 when nothing is within 20 cm). */
function wallFace(plan: FloorPlan, p: Vec2): number {
  let best = { d: 0.2, half: 0 }
  for (const w of walls(plan)) {
    const d = closestOnSegment(p, w.a, w.b).d
    if (d < best.d) best = { d, half: w.thickness / 2 }
  }
  return best.half
}

function shapeOf(item: Item): string {
  const { color: _c, trim: _t, lit: _l, ...rest } = item.props
  return JSON.stringify(rest)
}

/** Hover emphasis: a faint lift on every non-glowing part, undone exactly. */
function glow(root: THREE.Object3D, on: boolean): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || m.userData.emissive) return
    const mat = m.material as THREE.MeshStandardMaterial
    if (!mat.emissive) return
    if (on) {
      m.userData.hlEmissive = mat.emissive.getHex()
      m.userData.hlIntensity = mat.emissiveIntensity
      mat.emissive.setHex(0xa09484)
      mat.emissiveIntensity = 0.25
    } else if (m.userData.hlEmissive !== undefined) {
      mat.emissive.setHex(m.userData.hlEmissive as number)
      mat.emissiveIntensity = m.userData.hlIntensity as number
      delete m.userData.hlEmissive
      delete m.userData.hlIntensity
    }
  })
}

/** Geometry always; materials only for things we built (kit groups), never the shared surface cache. */
function disposeGeometry(root: THREE.Object3D, materials = false): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.geometry) m.geometry.dispose()
    if (!materials || !m.material) return
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.dispose()
  })
}

function radial(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32)
  grad.addColorStop(0, '#ffffff')
  grad.addColorStop(0.6, '#999999')
  grad.addColorStop(1, '#000000')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(c)
}

function r2(n: number): number {
  return Math.round(n * 100) / 100
}
