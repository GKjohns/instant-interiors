/**
 * Input for the home: drag (mouse or one finger) to look, WASD / arrows to walk (shift runs), double-click
 * to lock the pointer for mouse-look, wheel to zoom the plan view, two fingers to pinch-zoom or walk on
 * touch. Owns no camera state: it reports gestures to the renderer, which decides what a drag means in
 * walk vs plan mode. Keys the HUD already claimed (defaultPrevented) or typed into a field are ignored.
 */
import type { Vec2 } from '../../shared/plan/poly.ts'

interface LookHandlers {
  /** Pixels dragged (or pointer-lock movement). */
  turn(dx: number, dy: number): void
  /** Wheel deltaY, or a pinch expressed in the same units. */
  zoom(delta: number): void
  /** Two-finger vertical drag: metres to step forward (negative = back). */
  step(metres: number): void
  /** Where the pointer hovers, in NDC; null when it leaves the canvas. */
  pointer(ndc: Vec2 | null): void
}

const KEYS: Record<string, 'forward' | 'back' | 'left' | 'right'> = {
  w: 'forward', arrowup: 'forward', s: 'back', arrowdown: 'back', a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right'
}

export class LookInput {
  private held = new Set<string>()
  private run = false
  private cleanup: (() => void)[] = []
  private pointers = new Map<number, [number, number]>()
  private pinch = 0

  constructor(private el: HTMLElement, private h: LookHandlers) {
    const on = <K extends keyof WindowEventMap>(target: Window | HTMLElement, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn as EventListener, opts)
      this.cleanup.push(() => target.removeEventListener(type, fn as EventListener, opts))
    }
    on(el, 'pointerdown', (e) => {
      this.pointers.set(e.pointerId, [e.clientX, e.clientY])
      el.setPointerCapture?.(e.pointerId)
      if (this.pointers.size === 2) this.pinch = this.spread()
      // A click on the canvas takes focus back from the text bar so WASD walks again.
      ;(document.activeElement as HTMLElement | null)?.blur?.()
    })
    const lift = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId)
      if (this.pointers.size < 2) this.pinch = 0
    }
    on(window, 'pointerup', lift)
    on(window, 'pointercancel', lift)
    on(window, 'pointermove', (e) => {
      const rect = el.getBoundingClientRect()
      if (rect.width && rect.height) this.h.pointer([((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1])
      if (document.pointerLockElement === el) {
        this.h.turn(e.movementX, e.movementY)
        return
      }
      const prev = this.pointers.get(e.pointerId)
      if (!prev) return
      const dx = e.clientX - prev[0]
      const dy = e.clientY - prev[1]
      this.pointers.set(e.pointerId, [e.clientX, e.clientY])
      if (this.pointers.size === 1) this.h.turn(dx, dy)
      else if (this.pointers.size === 2) {
        const spread = this.spread()
        if (this.pinch) this.h.zoom((this.pinch - spread) * 2)
        this.pinch = spread
        // Both fingers dragging the same way walks; a pinch barely moves the centroid, so the two don't fight.
        this.h.step(-dy / 400)
      }
    })
    on(el, 'pointerleave', () => this.h.pointer(null))
    on(el, 'dblclick', () => {
      if (document.pointerLockElement !== el) el.requestPointerLock?.()
    })
    on(el, 'wheel', (e) => {
      e.preventDefault()
      this.h.zoom(e.deltaY)
    }, { passive: false })
    on(window, 'keydown', (e) => {
      if (e.key === 'Shift') this.run = true
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return
      const key = e.key.toLowerCase()
      if (KEYS[key]) {
        this.held.add(KEYS[key])
        if (key.startsWith('arrow')) e.preventDefault()
      }
    })
    on(window, 'keyup', (e) => {
      if (e.key === 'Shift') this.run = false
      const move = KEYS[e.key.toLowerCase()]
      if (move) this.held.delete(move)
    })
    on(window, 'blur', () => {
      this.held.clear()
      this.run = false
    })
  }

  /** Walk intent from the keys held: forward/back and strafe in [-1, 1], and whether shift is down. */
  move(): { forward: number, strafe: number, run: boolean } {
    const has = (k: string) => (this.held.has(k) ? 1 : 0)
    return { forward: has('forward') - has('back'), strafe: has('right') - has('left'), run: this.run }
  }

  /** Drop every held key (the HUD took a W/A/S/D tap as the first letter of a sentence). */
  release(): void {
    this.held.clear()
  }

  private spread(): number {
    const [p, q] = [...this.pointers.values()]
    return p && q ? Math.hypot(p[0] - q[0], p[1] - q[1]) : 0
  }

  dispose(): void {
    for (const fn of this.cleanup) fn()
    this.cleanup = []
    if (document.pointerLockElement === this.el) document.exitPointerLock?.()
  }
}

function typing(e: Event): boolean {
  const t = e.target as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
}
