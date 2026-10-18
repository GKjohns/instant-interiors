import * as THREE from 'three'

/**
 * A colour from whatever the model or a saved home wrote ('#a0623d', 'a0623d', 'sage', 'navy'), else
 * `fallback`. three warns and leaves the colour untouched on a bad string, so it starts from an impossible
 * sentinel to tell a parse from a miss.
 */
export function safeColor(hex: string | undefined, fallback: string): THREE.Color {
  const c = new THREE.Color()
  if (hex) {
    c.setRGB(-1, -1, -1)
    const spec = /^[0-9a-f]{6}$/i.test(hex) ? `#${hex}` : hex
    try {
      c.set(spec)
    } catch {
      c.setRGB(-1, -1, -1)
    }
    if (c.r >= 0) return c
  }
  return c.set(fallback)
}
