<script setup lang="ts">
// DEV PAGE, not part of the product and linked from nowhere. The renderer alone (no HUD, no intent, no
// save) for scripts/render-check.mjs, which drives it through `window.__hearthRenderer`. Visit
// /dev/renderer to walk the sample apartment by hand.
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { TWO_BED_APARTMENT } from '../../../shared/plan/samples.ts'
import { createHome } from '../../../shared/home/state.ts'
import type { HomeState } from '../../../shared/home/types.ts'
import type { TimeOfDay } from '../../../shared/home/ops.ts'
import type { Surface, SurfacePart } from '../../../shared/plan/schema.ts'
import type { Vec2 } from '../../../shared/plan/poly.ts'
import { HomeRenderer } from '../../home/renderer.ts'
import type { Gaze, Mode } from '../../home/renderer.ts'

definePageMeta({ layout: false })

const host = ref<HTMLElement | null>(null)
const gaze = ref<Gaze>({ point: [0, 0] })
const fps = ref(0)
let renderer: HomeRenderer | null = null
let state: HomeState = createHome(TWO_BED_APARTMENT, { furnish: true })
let frames = 0
let raf = 0
let lastTick = 0

function apply(next: HomeState) {
  state = next
  renderer?.sync(state)
}

onMounted(() => {
  renderer = new HomeRenderer(host.value!)
  renderer.onGaze = g => (gaze.value = g)
  renderer.sync(state)
  const tick = (now: number) => {
    frames++
    if (now - lastTick > 1000) {
      fps.value = Math.round((frames * 1000) / (now - lastTick))
      frames = 0
      lastTick = now
    }
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  const api = {
    renderer,
    get state() {
      return state
    },
    setLight(time: TimeOfDay, lamps?: boolean, warmth?: number) {
      apply({ ...state, light: { time, lamps: lamps ?? (time === 'night' || time === 'evening'), warmth: warmth ?? state.light.warmth } })
    },
    setMode: (m: Mode) => renderer!.setMode(m),
    look: (yaw: number, pitch: number, pos?: Vec2) => renderer!.look(yaw, pitch, pos),
    teleport: (pos: Vec2, yaw?: number) => renderer!.teleport(pos, yaw),
    paint(room: string, part: SurfacePart, surface: Surface) {
      apply({ ...state, plan: { ...state.plan, rooms: state.plan.rooms.map(r => (r.id === room ? { ...r, [part]: surface } : r)) } })
    },
    /** Move an item by id (tests the tween path). */
    move(id: string, pos: Vec2, yaw?: number) {
      apply({ ...state, items: state.items.map(i => (i.id === id ? { ...i, pos, yaw: yaw ?? i.yaw } : i)) })
    },
    remove(id: string) {
      apply({ ...state, items: state.items.filter(i => i.id !== id) })
    },
    gaze: () => renderer!.gaze(),
    player: () => renderer!.player(),
    highlight: (id: string | null) => renderer!.highlight(id),
    anticipate: (p: Vec2 | null) => renderer!.anticipate(p),
    fps: () => fps.value
  }
  ;(window as unknown as { __hearthRenderer: typeof api }).__hearthRenderer = api
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  renderer?.dispose()
  renderer = null
})
</script>

<template>
  <div class="fixed inset-0 bg-black">
    <div
      ref="host"
      class="absolute inset-0"
    />
    <div class="pointer-events-none absolute top-3 left-3 rounded bg-black/50 px-2 py-1 font-mono text-xs text-white">
      {{ fps }} fps · {{ gaze.room ?? '—' }}<span v-if="gaze.itemId"> · {{ gaze.itemId }}</span>
    </div>
    <div class="pointer-events-none absolute top-1/2 left-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/70" />
  </div>
</template>
