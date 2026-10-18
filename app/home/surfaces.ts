/**
 * Procedural finishes: every PATTERN drawn on a canvas in the surface colour (+ accent), wrapped into a
 * repeating texture. One canvas tile covers TILE metres of wall or floor (`repeatFor`), and every pattern
 * is drawn in metres with periods that divide the tile, so the wrap is seamless. Drawings and materials are
 * cached so a re-sync of an unchanged room costs nothing.
 */
import * as THREE from 'three'
import type { Pattern, Surface, SurfacePart } from '../../shared/plan/schema.ts'

const TILE: Record<SurfacePart, number> = { walls: 2, floor: 1, ceiling: 2 }
const ROUGH: Record<Pattern, number> = { plain: 0.85, stripes: 0.85, floral: 0.9, damask: 0.8, tile: 0.35, checker: 0.4, plank: 0.6, herringbone: 0.55, carpet: 1, concrete: 0.9, brick: 0.95, subway: 0.25, terrazzo: 0.3 }
const NOISY: Pattern[] = ['plain', 'carpet', 'concrete']

/** How many times the tile repeats across a surface of `size` metres. */
export function repeatFor(part: SurfacePart, size: [number, number]): [number, number] {
  const t = TILE[part]
  return [Math.max(0.05, size[0] / t), Math.max(0.05, size[1] / t)]
}

const canvases = new Map<string, HTMLCanvasElement>()
const materials = new Map<string, THREE.MeshStandardMaterial>()

export function surfaceTexture(surface: Surface, part: SurfacePart, repeat: [number, number]): THREE.CanvasTexture {
  const key = `${part}|${surface.pattern}|${surface.color}|${surface.accent ?? ''}`
  let c = canvases.get(key)
  if (!c) {
    c = draw(surface, part)
    canvases.set(key, c)
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeat[0], repeat[1])
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

export function surfaceMaterial(surface: Surface, part: SurfacePart, size: [number, number]): THREE.MeshStandardMaterial {
  const rounded: [number, number] = [Math.round(size[0] * 4) / 4, Math.round(size[1] * 4) / 4]
  const key = JSON.stringify([surface.color, surface.pattern, surface.accent ?? null, part, rounded])
  let m = materials.get(key)
  if (m) return m
  const roughness = ROUGH[surface.pattern] * (part === 'floor' && surface.pattern === 'plain' ? 0.8 : 1)
  m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness, metalness: 0 })
  // Headless (tests, kit-check) there is no canvas; the flat colour stands in.
  if (typeof document === 'undefined') m.color.set(surface.color)
  else m.map = surfaceTexture(surface, part, repeatFor(part, rounded))
  materials.set(key, m)
  return m
}

// ---------- colour helpers ----------

function rgb(hex: string): [number, number, number] {
  const c = new THREE.Color()
  c.setRGB(-1, -1, -1)
  try {
    c.set(hex)
  } catch {
    c.setRGB(-1, -1, -1)
  }
  if (c.r < 0) c.set('#cccccc')
  return [c.r * 255, c.g * 255, c.b * 255]
}

/** Lighten (amt > 0) or darken (amt < 0) in HSL, as a CSS string. */
function shade(hex: string, amt: number, alpha = 1): string {
  const c = new THREE.Color(...rgb(hex).map(v => v / 255) as [number, number, number])
  const hsl = { h: 0, s: 0, l: 0 }
  c.getHSL(hsl)
  c.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l + amt)))
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${alpha})`
}

/** Stable per-cell value in [0, 1): a plank or a tile keeps its tone across redraws and wraps. */
function hash(i: number, j: number, k = 0): number {
  let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263) ^ Math.imul(k | 0, 2147483647 >>> 3)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------- the drawings ----------

interface Pen {
  g: CanvasRenderingContext2D
  /** Tile size in metres; the context is scaled so drawing coordinates are metres. */
  m: number
  color: string
  accent: string
  /** The nine wrap offsets, for motifs that cross the tile edge. */
  wrap: (fn: () => void) => void
}

function draw(surface: Surface, part: SurfacePart): HTMLCanvasElement {
  const size = NOISY.includes(surface.pattern) ? 512 : 1024
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const m = TILE[part]
  g.fillStyle = surface.color
  g.fillRect(0, 0, size, size)
  g.save()
  g.scale(size / m, size / m)
  const accent = surface.accent ?? DEFAULT_ACCENT[surface.pattern](surface.color)
  const pen: Pen = {
    g, m, color: surface.color, accent,
    wrap: (fn) => {
      for (const dx of [-m, 0, m]) {
        for (const dy of [-m, 0, m]) {
          g.save()
          g.translate(dx, dy)
          fn()
          g.restore()
        }
      }
    }
  }
  PAINTERS[surface.pattern](pen, part)
  g.restore()
  if (NOISY.includes(surface.pattern) || surface.pattern === 'plank' || surface.pattern === 'brick') noise(g, size, surface.pattern === 'carpet' ? 14 : surface.pattern === 'concrete' ? 10 : 5)
  return c
}

/** Per-pixel grain: ±amp on every channel. Cheap at these sizes and it kills the flat-vector look. */
function noise(g: CanvasRenderingContext2D, size: number, amp: number): void {
  const img = g.getImageData(0, 0, size, size)
  const d = img.data
  const r = rng(size + amp)
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * 2 * amp
    d[i] = d[i]! + n
    d[i + 1] = d[i + 1]! + n
    d[i + 2] = d[i + 2]! + n
  }
  g.putImageData(img, 0, 0)
}

/** When the plan gives no accent: grout darker, stripes a touch lighter, motifs clearly darker. */
const DEFAULT_ACCENT: Record<Pattern, (c: string) => string> = {
  plain: c => shade(c, -0.05),
  stripes: c => shade(c, 0.06),
  floral: c => shade(c, -0.22),
  damask: c => shade(c, -0.1),
  tile: c => shade(c, -0.14),
  checker: c => shade(c, -0.3),
  plank: c => shade(c, -0.2),
  herringbone: c => shade(c, -0.2),
  carpet: c => shade(c, -0.05),
  concrete: c => shade(c, -0.08),
  brick: c => shade(c, 0.18),
  subway: c => shade(c, -0.12),
  terrazzo: c => shade(c, -0.3)
}

function rect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string): void {
  g.fillStyle = fill
  g.fillRect(x, y, w, h)
}

/** Tiles in a grid with grout: the shared body of tile, subway, brick and checker. */
function grid(p: Pen, tw: number, th: number, grout: number, offsetOddRows: boolean, tone: (i: number, j: number) => string): void {
  const { g, m } = p
  rect(g, 0, 0, m, m, p.accent)
  const cols = Math.round(m / tw)
  const rows = Math.round(m / th)
  for (let j = 0; j < rows; j++) {
    const off = offsetOddRows && j % 2 ? tw / 2 : 0
    for (let i = -1; i <= cols; i++) {
      const ii = ((i % cols) + cols) % cols
      rect(g, i * tw + off + grout / 2, j * th + grout / 2, tw - grout, th - grout, tone(ii, j))
    }
  }
}

const PAINTERS: Record<Pattern, (p: Pen, part: SurfacePart) => void> = {
  plain: () => undefined,

  stripes: ({ g, m, accent }) => {
    const period = 0.2
    for (let x = 0; x < m; x += period) rect(g, x, 0, period / 2, m, accent)
  },

  floral: (p) => {
    const { g, m, accent } = p
    const cell = 0.5
    const n = Math.round(m / cell)
    g.strokeStyle = accent
    g.fillStyle = accent
    g.lineWidth = 0.006
    g.lineCap = 'round'
    p.wrap(() => {
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const cx = i * cell + cell / 2 + (j % 2 ? cell / 2 : 0)
          const cy = j * cell + cell / 2
          g.beginPath()
          g.moveTo(cx, cy + 0.2)
          g.bezierCurveTo(cx - 0.08, cy + 0.08, cx + 0.06, cy - 0.02, cx, cy - 0.12)
          g.stroke()
          for (const s of [-1, 1]) {
            g.beginPath()
            g.ellipse(cx + s * 0.05, cy + 0.08, 0.05, 0.02, s * 0.6, 0, Math.PI * 2)
            g.fill()
          }
          for (let k = 0; k < 5; k++) {
            const a = (k / 5) * Math.PI * 2
            g.beginPath()
            g.ellipse(cx + Math.cos(a) * 0.045, cy - 0.12 + Math.sin(a) * 0.045, 0.035, 0.02, a, 0, Math.PI * 2)
            g.fill()
          }
          g.fillStyle = shade(p.color, 0.1)
          g.beginPath()
          g.arc(cx, cy - 0.12, 0.018, 0, Math.PI * 2)
          g.fill()
          g.fillStyle = accent
        }
      }
    })
  },

  damask: (p) => {
    const { g, m, accent } = p
    const cell = 0.5
    const n = Math.round(m / cell)
    g.lineWidth = 0.005
    p.wrap(() => {
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const cx = i * cell + cell / 2 + (j % 2 ? cell / 2 : 0)
          const cy = j * cell + cell / 2
          // A mirrored lozenge: one half-outline drawn twice, flipped, so it is exactly symmetric.
          g.fillStyle = shade(accent, 0, 0.28)
          g.strokeStyle = accent
          g.beginPath()
          for (const s of [1, -1]) {
            g.moveTo(cx, cy - 0.2)
            g.bezierCurveTo(cx + s * 0.16, cy - 0.14, cx + s * 0.04, cy - 0.02, cx + s * 0.11, cy)
            g.bezierCurveTo(cx + s * 0.04, cy + 0.02, cx + s * 0.16, cy + 0.14, cx, cy + 0.2)
          }
          g.fill()
          g.stroke()
          g.beginPath()
          g.ellipse(cx, cy, 0.035, 0.07, 0, 0, Math.PI * 2)
          g.stroke()
          g.fillStyle = accent
          g.beginPath()
          g.arc(cx + cell / 2, cy, 0.012, 0, Math.PI * 2)
          g.arc(cx, cy + cell / 2, 0.012, 0, Math.PI * 2)
          g.fill()
        }
      }
    })
  },

  tile: (p) => {
    const tw = p.m / Math.round(p.m / 0.333)
    grid(p, tw, tw, 0.004, false, (i, j) => shade(p.color, (hash(i, j) - 0.5) * 0.08))
  },

  checker: (p) => {
    grid(p, 0.5, 0.5, 0.002, false, (i, j) => ((i + j) % 2 ? shade(p.accent, (hash(i, j) - 0.5) * 0.04) : shade(p.color, (hash(i, j) - 0.5) * 0.04)))
  },

  subway: (p) => {
    const tw = p.m / Math.round(p.m / 0.25)
    const th = tw / 3
    grid(p, tw, th, 0.004, true, (i, j) => shade(p.color, (hash(i, j) - 0.5) * 0.05))
    // A pale bevel along the top edge of each tile reads as glaze.
    const cols = Math.round(p.m / tw)
    const rows = Math.round(p.m / th)
    for (let j = 0; j < rows; j++) for (let i = -1; i <= cols; i++) rect(p.g, i * tw + (j % 2 ? tw / 2 : 0) + 0.004, j * th + 0.004, tw - 0.008, 0.006, shade(p.color, 0.12, 0.7))
  },

  brick: (p) => {
    const tw = p.m / Math.round(p.m / 0.25)
    const th = tw / 3
    grid(p, tw, th, 0.01, true, (i, j) => shade(p.color, (hash(i, j) - 0.5) * 0.16))
  },

  plank: (p) => {
    const { g, m } = p
    const rows = Math.round(m / 0.14)
    const bh = m / rows
    for (let j = 0; j < rows; j++) {
      // One or two joints per row at a staggered offset; every board segment keeps its own tone across the wrap.
      const joints = hash(j, 1) < 0.5 ? [hash(j, 2) * m] : [hash(j, 2) * m, (hash(j, 2) * m + m * (0.4 + hash(j, 3) * 0.2)) % m].sort((a, b) => a - b)
      const edges = [0, ...joints, m]
      const segs = edges.length - 1
      for (let s = 0; s < segs; s++) {
        // The first and last segments are one board that crosses the wrap, so they share a tone.
        const id = s === 0 && joints.length ? segs - 1 : s
        rect(g, edges[s]!, j * bh, edges[s + 1]! - edges[s]!, bh, shade(p.color, (hash(j, 7, id) - 0.5) * 0.14))
      }
      g.strokeStyle = shade(p.color, -0.08, 0.35)
      g.lineWidth = 0.0015
      for (let k = 1; k < 5; k++) {
        const y = j * bh + bh * (k / 5) + (hash(j, k) - 0.5) * 0.01
        g.beginPath()
        g.moveTo(0, y)
        g.bezierCurveTo(m * 0.3, y + (hash(j, k, 1) - 0.5) * 0.02, m * 0.7, y - (hash(j, k, 2) - 0.5) * 0.02, m, y)
        g.stroke()
      }
      rect(g, 0, j * bh, m, 0.003, p.accent)
      for (const x of joints) rect(g, x, j * bh, 0.003, bh, p.accent)
    }
  },

  herringbone: (p) => {
    const { g, m } = p
    // Plank width w = 1/(10·√2) m so the 45° pattern's rectangular period (5w√2 × w√2 = 0.5 × 0.1) divides the tile.
    const w = 1 / (10 * Math.SQRT2)
    const k = 5
    const reach = Math.ceil((m * Math.SQRT2) / w) + 2 * k
    // Plank tones must repeat with the tile too: one canvas step is 10·m cells along each diagonal.
    const P = 20 * m
    const tone = (i: number, j: number) => hash((((i + j) % P) + P) % P, (((i - j) % P) + P) % P)
    g.save()
    g.translate(m / 2, m / 2)
    g.rotate(Math.PI / 4)
    g.lineWidth = 0.003
    g.strokeStyle = p.accent
    for (let j = -reach; j <= reach; j++) {
      for (let i = -reach; i <= reach; i++) {
        const d = (((i - j) % (2 * k)) + 2 * k) % (2 * k)
        if (d !== 0 && d !== 2 * k - 1) continue
        const [bw, bh] = d === 0 ? [k * w, w] : [w, k * w]
        g.fillStyle = shade(p.color, (tone(i, j) - 0.5) * 0.16)
        g.fillRect(i * w, j * w, bw, bh)
        g.strokeRect(i * w, j * w, bw, bh)
      }
    }
    g.restore()
  },

  carpet: ({ g, m, color }) => {
    const r = rng(7)
    for (let i = 0; i < 400; i++) rect(g, r() * m, r() * m, 0.02 + r() * 0.06, 0.004, shade(color, (r() - 0.5) * 0.08, 0.5))
  },

  concrete: (p) => {
    const { g, m } = p
    const r = rng(11)
    // Blotches are rolled once and drawn at every wrap offset, so the ones crossing an edge continue on the other side.
    const blots = Array.from({ length: 14 }, () => ({ x: r() * m, y: r() * m, rad: 0.1 + r() * 0.25 * m, tone: (r() - 0.5) * 0.12 }))
    p.wrap(() => {
      for (const b of blots) {
        const grad = g.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.rad)
        grad.addColorStop(0, shade(p.color, b.tone, 0.5))
        grad.addColorStop(1, shade(p.color, 0, 0))
        g.fillStyle = grad
        g.fillRect(b.x - b.rad, b.y - b.rad, b.rad * 2, b.rad * 2)
      }
    })
    g.strokeStyle = shade(p.color, -0.18, 0.5)
    g.lineWidth = 0.002
    g.beginPath()
    g.moveTo(m * 0.2, m * 0.1)
    g.lineTo(m * 0.32, m * 0.38)
    g.lineTo(m * 0.3, m * 0.55)
    g.stroke()
  },

  terrazzo: (p) => {
    const { g, m, accent } = p
    const tones = [accent, shade(accent, -0.18), shade(p.color, 0.3), shade(accent, 0.25)]
    const r = rng(23)
    const chips = Array.from({ length: Math.round(160 * m * m) }, () => {
      const x = r() * m
      const y = r() * m
      const s = 0.008 + r() * 0.02
      const sides = 4 + Math.floor(r() * 3)
      const pts: [number, number][] = []
      for (let v = 0; v < sides; v++) {
        const a = (v / sides) * Math.PI * 2 + r() * 0.5
        const rr = s * (0.6 + r() * 0.6)
        pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr])
      }
      return { pts, fill: tones[Math.floor(r() * tones.length)]! }
    })
    p.wrap(() => {
      for (const c of chips) {
        g.fillStyle = c.fill
        g.beginPath()
        c.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)))
        g.closePath()
        g.fill()
      }
    })
  }
}
