/**
 * Small 2D polygon toolkit for the plan frame. Pure, no three.js.
 *
 * The plan frame: metres, `x` to the right on the drawing, `z` DOWN the drawing (so the top of the drawing is
 * -z). three.js uses the same x/z with y up, so a point [x, z] here is (x, 0, z) in the scene. "north" on a
 * plan is the top of the drawing unless the plan says otherwise.
 */
export type Vec2 = [number, number]

export type Compass = 'north' | 'south' | 'east' | 'west'

export const EPS = 1e-6

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

/** `p + d1·k1 + d2·k2`: a point stepped along one or two directions. */
export function add(p: Vec2, d1: Vec2, k1: number, d2: Vec2 = [0, 0], k2 = 0): Vec2 {
  return [p[0] + d1[0] * k1 + d2[0] * k2, p[1] + d1[1] * k1 + d2[1] * k2]
}

export function dot(a: Vec2, b: Vec2): number {
  return a[0] * b[0] + a[1] * b[1]
}

/** Signed area (positive = counter-clockwise in a y-up frame; our z points down, so positive = clockwise on the drawing). */
export function signedArea(poly: Vec2[]): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    s += a[0] * b[1] - b[0] * a[1]
  }
  return s / 2
}

export function area(poly: Vec2[]): number {
  return Math.abs(signedArea(poly))
}

export function centroid(poly: Vec2[]): Vec2 {
  const a = signedArea(poly)
  if (Math.abs(a) < EPS) {
    const n = poly.length || 1
    return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n]
  }
  let cx = 0
  let cz = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!
    const q = poly[(i + 1) % poly.length]!
    const f = p[0] * q[1] - q[0] * p[1]
    cx += (p[0] + q[0]) * f
    cz += (p[1] + q[1]) * f
  }
  return [cx / (6 * a), cz / (6 * a)]
}

export function bounds(poly: Vec2[]): { min: Vec2, max: Vec2, size: Vec2 } {
  let minX = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxZ = -Infinity
  for (const [x, z] of poly) {
    if (x < minX) minX = x
    if (z < minZ) minZ = z
    if (x > maxX) maxX = x
    if (z > maxZ) maxZ = z
  }
  return { min: [minX, minZ], max: [maxX, maxZ], size: [maxX - minX, maxZ - minZ] }
}

/** Even-odd point-in-polygon. Points on an edge count as inside (within `tol`). */
export function pointInPolygon(p: Vec2, poly: Vec2[], tol = 0.02): boolean {
  if (distToPolygonEdge(p, poly) <= tol) return true
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]!
    const [xj, zj] = poly[j]!
    const crosses = (zi > p[1]) !== (zj > p[1]) && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi + (zj === zi ? EPS : 0)) + xi
    if (crosses) inside = !inside
  }
  return inside
}

/** Closest point on segment ab to p, and the parameter t in [0, 1]. */
export function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): { point: Vec2, t: number, d: number } {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const len2 = dx * dx + dz * dz
  const t = len2 < EPS ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2))
  const point: Vec2 = [a[0] + dx * t, a[1] + dz * t]
  return { point, t, d: dist(p, point) }
}

export function distToPolygonEdge(p: Vec2, poly: Vec2[]): number {
  let best = Infinity
  for (let i = 0; i < poly.length; i++) {
    const d = closestOnSegment(p, poly[i]!, poly[(i + 1) % poly.length]!).d
    if (d < best) best = d
  }
  return best
}

/** The polygon edge nearest to p: its index, the closest point and the outward-facing normal (pointing out of the room). */
export function nearestEdge(p: Vec2, poly: Vec2[]): { index: number, point: Vec2, d: number, normal: Vec2, a: Vec2, b: Vec2 } {
  let best: { index: number, point: Vec2, d: number, normal: Vec2, a: Vec2, b: Vec2 } | null = null
  // Canonical winding is positive signed area (clockwise on the drawing, since z points down): then the
  // right-hand perpendicular already points out of the room. Negative winding flips it.
  const flip = signedArea(poly) < 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    const c = closestOnSegment(p, a, b)
    if (!best || c.d < best.d) {
      const len = dist(a, b) || 1
      // Perpendicular to the edge; flip by winding so it points away from the interior.
      let n: Vec2 = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len]
      if (flip) n = [-n[0], -n[1]]
      best = { index: i, point: c.point, d: c.d, normal: n, a, b }
    }
  }
  return best!
}

/** Drop a repeated closing vertex and consecutive duplicates; returns a fresh array. */
export function cleanPolygon(poly: Vec2[], tol = 0.01): Vec2[] {
  const out: Vec2[] = []
  for (const p of poly) {
    const last = out[out.length - 1]
    if (!last || dist(last, p) > tol) out.push([p[0], p[1]])
  }
  if (out.length > 1 && dist(out[0]!, out[out.length - 1]!) <= tol) out.pop()
  return out
}

/** Snap every vertex to a grid of `step` metres (shared walls from a vision model land on the same line). */
export function snapPolygon(poly: Vec2[], step = 0.05): Vec2[] {
  const r = (v: number) => Math.round(v / step) * step
  return poly.map(([x, z]) => [r(x), r(z)] as Vec2)
}

/** Compass direction of an outward normal in the plan frame: -z is north (top of the drawing). */
export function compassOf(normal: Vec2): Compass {
  const [x, z] = normal
  if (Math.abs(x) > Math.abs(z)) return x > 0 ? 'east' : 'west'
  return z > 0 ? 'south' : 'north'
}

/** Unit vector of a compass direction in the plan frame. */
export function dirOf(c: Compass): Vec2 {
  return c === 'north' ? [0, -1] : c === 'south' ? [0, 1] : c === 'east' ? [1, 0] : [-1, 0]
}

/** Yaw (radians, three.js convention: 0 faces -z, positive turns left toward -x) that faces along a direction. */
export function yawToward(from: Vec2, to: Vec2): number {
  return Math.atan2(-(to[0] - from[0]), -(to[1] - from[1]))
}
