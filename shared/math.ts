/**
 * Number helpers the kernel, the renderer and the scripts share. Pure, no three.js.
 */

/** mulberry32: a tiny seeded generator, so a seeded placement or texture comes out the same on every replay. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a over the parts joined by '|': one 32-bit seed from a sentence seed, an op index and a kind. */
export function hashSeed(...parts: (string | number)[]): number {
  let h = 2166136261
  for (const ch of parts.join('|')) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** Millimetre rounding for stored positions and yaws; -0 becomes 0 so saved homes diff cleanly. */
export function round3(v: number): number {
  const r = Math.round(v * 1000) / 1000
  return Object.is(r, -0) ? 0 : r
}
