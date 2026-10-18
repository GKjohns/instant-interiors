/**
 * Shared bits for the kit builders (lifted from Conjure, minus its palette snapping: a home keeps the
 * colours you ask for). Every mesh is tagged with a material slot so index.ts can recolour any kind the
 * same way: 'primary' takes `color`, 'trim' takes `trim`, 'glow' is the warm light itself.
 *
 * userData the renderer reads:
 *   mesh.userData.slot            'primary' | 'trim' | 'glow'
 *   mesh.userData.baseColor       the builder's colour, the fallback after a recolour is undone
 *   mesh.userData.baseGlow        the builder's emissiveIntensity; `lit` scales it
 *   mesh.userData.emissive        true when the part's emissive follows `lit` (bulbs, shades, the TV screen)
 *   mesh.userData.emissiveFollows k: emissive colour = the part's own colour × k (a shade lit from inside)
 *   mesh.userData.bulb            true on the one part a pooled point light should sit at
 */
import * as THREE from 'three'

export type Slot = 'primary' | 'trim' | 'glow'

/** What a builder receives: the catalog footprint/height, or the props' overrides for sized kinds. */
export interface Dims {
  length: number
  width: number
  height: number
}
export type Build = (dims: Dims) => THREE.Group

/** Physical rather than Standard so the material presets can use sheen (velvet, fabric) and clearcoat. */
export function mat(color: THREE.ColorRepresentation, opts: THREE.MeshPhysicalMaterialParameters = {}): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.8, ...opts })
}

export function glowMat(color: THREE.ColorRepresentation, intensity = 1.6): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.5 })
}

/** A shadow-casting mesh in a slot. Slot-less meshes keep their own colour forever (book spines, a screen). */
export function mesh(geo: THREE.BufferGeometry, material: THREE.Material, slot: Slot | null, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, material)
  m.position.set(x, y, z)
  m.castShadow = true
  m.receiveShadow = true
  if (slot) m.userData.slot = slot
  const std = material as THREE.MeshStandardMaterial
  if (std.color) m.userData.baseColor = '#' + std.color.getHexString()
  if (std.emissiveIntensity !== undefined) m.userData.baseGlow = std.emissiveIntensity
  return m
}

export function group(...children: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group()
  if (children.length) g.add(...children)
  return g
}

/** Mark a mesh whose emissive should follow its slot colour (lamp shades), scaled down by `k`, and `lit`. */
export function emissiveFollows(m: THREE.Mesh, k = 1): THREE.Mesh {
  m.userData.emissiveFollows = k
  m.userData.emissive = true
  m.castShadow = false
  return m
}

/** Deterministic little rng for builders (book colours, leaf placement), so a rebuild looks the same. */
export function seeded(seed: string | number): () => number {
  let h = 2166136261
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  let a = h >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A canvas, or null headless (kit-check and tests build without a DOM; textures are decoration). */
export function canvas(size: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = c.height = size
  return c
}

function wrap(c: HTMLCanvasElement, repeatX: number, repeatY: number): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeatX, repeatY)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

let planks: HTMLCanvasElement | null = null
/** A light plank pattern (the material colour tints it), repeated per metre by the caller. */
export function plankTexture(repeatX: number, repeatY: number): THREE.CanvasTexture | null {
  if (!planks) {
    planks = canvas(256)
    if (!planks) return null
    const g = planks.getContext('2d')!
    const rand = seeded('planks')
    for (let row = 0; row < 8; row++) {
      let x = -rand() * 120
      while (x < 256) {
        const w = 90 + rand() * 110
        const v = 200 + Math.floor(rand() * 45)
        g.fillStyle = `rgb(${v},${v - 6},${v - 14})`
        g.fillRect(x, row * 32, w, 32)
        g.fillStyle = 'rgba(40,25,10,0.55)'
        g.fillRect(x, row * 32, 2, 32)
        x += w
      }
      g.fillStyle = 'rgba(40,25,10,0.6)'
      g.fillRect(0, row * 32 + 31, 256, 1)
    }
  }
  return wrap(planks, repeatX, repeatY)
}

let rugCanvas: HTMLCanvasElement | null = null
/** A pale diamond lattice over a light field: tinted by the rug colour it reads as a woven pattern, not a slab. */
export function rugTexture(repeatX: number, repeatY: number): THREE.CanvasTexture | null {
  if (!rugCanvas) {
    rugCanvas = canvas(256)
    if (!rugCanvas) return null
    const g = rugCanvas.getContext('2d')!
    g.fillStyle = '#e4e4e4'
    g.fillRect(0, 0, 256, 256)
    const rand = seeded('rug')
    for (let i = 0; i < 2600; i++) {
      const v = 200 + Math.floor(rand() * 55)
      g.fillStyle = `rgba(${v},${v},${v},0.5)`
      g.fillRect(rand() * 256, rand() * 256, 2, 2)
    }
    g.strokeStyle = 'rgba(255,255,255,0.55)'
    g.lineWidth = 3
    for (let i = -4; i < 5; i++) {
      g.beginPath()
      g.moveTo(i * 64, 0)
      g.lineTo(i * 64 + 256, 256)
      g.moveTo(i * 64 + 256, 0)
      g.lineTo(i * 64, 256)
      g.stroke()
    }
    g.fillStyle = 'rgba(60,40,30,0.35)'
    for (let x = 32; x < 256; x += 64) for (let y = 32; y < 256; y += 64) g.fillRect(x - 5, y - 5, 10, 10)
  }
  return wrap(rugCanvas, repeatX, repeatY)
}

/** Text on a transparent canvas (the clock face, a spine label). */
export function textTexture(text: string, color = '#2b2b2e'): THREE.CanvasTexture | null {
  const c = canvas(256)
  if (!c) return null
  const g = c.getContext('2d')!
  g.font = '600 48px Geist, system-ui, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = color
  g.fillText(text, 128, 128)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
