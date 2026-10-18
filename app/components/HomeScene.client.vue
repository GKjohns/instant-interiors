<script setup lang="ts">
/**
 * Full-bleed home plus HUD. The renderer is created once on mount and handed to useHome, which owns
 * the HomeState; the HUD only talks to the composables.
 */
import { HomeRenderer } from '~/home/renderer'
import { TWO_BED_APARTMENT } from '#shared/plan/samples'

const hostEl = useTemplateRef<HTMLDivElement>('host')
const home = useHome()
const intent = useIntent()
const plan = usePlan()
let renderer: HomeRenderer | null = null

function typing(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
}

function onKey(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !typing(e)) {
    e.preventDefault()
    home.undo()
    return
  }
  if (e.key === 'Escape') {
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    return
  }
  if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return
  if (e.key === 'Tab') {
    // Tab would otherwise walk focus through the HUD buttons; here it flips walk ↔ plan.
    e.preventDefault()
    home.toggleMode()
  }
}

onMounted(async () => {
  // Nuxt's client-only wrapper renders a placeholder on the first pass, so the host div lands a tick later.
  await nextTick()
  if (!hostEl.value) return
  renderer = new HomeRenderer(hostEl.value)
  home.attach(renderer)
  if (!home.restore()) home.loadPlan(TWO_BED_APARTMENT, { furnish: true })
  // A handle for the shoot script (and for poking at the home from devtools).
  const w = window as unknown as Record<string, unknown>
  w.__hearth = {
    run: home.run,
    undo: home.undo,
    reset: home.reset,
    state: () => home.state.value,
    history: () => home.history.value,
    // Natural language through the real model, with the gaze snapshot taken now (as the text bar does).
    ask: (text: string) => intent.build(text, intent.capture(), 'text'),
    loadSample: (id: string) => plan.loadSample(id),
    extract: (dataUrl: string, hint = '') => plan.extract(dataUrl, hint),
    look: (yaw: number, pitch: number, pos?: [number, number]) => renderer?.look(yaw, pitch, pos),
    mode: (m?: 'walk' | 'plan') => (m ? home.setMode(m) : home.mode.value),
    lastEntry: () => home.history.value[home.history.value.length - 1],
    phase: () => intent.phase.value,
    renderer: () => renderer
  }
  w.__sceneReady = true
  window.addEventListener('keydown', onKey)
  window.addEventListener('pagehide', home.saveView)
})

onBeforeUnmount(() => {
  home.saveView()
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('pagehide', home.saveView)
  home.detach()
  renderer?.dispose()
  renderer = null
})
</script>

<template>
  <div class="fixed inset-0 overflow-hidden bg-[#0e0c0a] select-none">
    <div
      ref="host"
      class="absolute inset-0"
      data-home-host
    />
    <div
      v-if="home.mode.value === 'walk'"
      class="pointer-events-none absolute top-1/2 left-1/2 size-2 -translate-1/2 rounded-full border border-white/60 shadow-[0_0_6px_rgba(0,0,0,0.5)]"
      data-crosshair
    />
    <HudLayer />
  </div>
</template>
