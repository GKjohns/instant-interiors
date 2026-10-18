<script setup lang="ts">
/**
 * Plan view's labels: each room's name at its middle, and the hover tag by the pointer (walk view keeps its
 * tag under the crosshair in HudRoomChip). Positions are written straight to the elements every frame
 * rather than through Vue state, since the camera can orbit continuously and ten re-renders a frame would
 * cost more than the projection does.
 */
import { roomCenter } from '#shared/plan/geometry'

/** Labels this close to the bottom would sit under the HUD bar: fade them out instead. */
const BAR_CLEAR = 90

const home = useHome()
const plan = computed(() => home.state.value.plan)
const rooms = computed(() => plan.value.rooms.map(r => ({
  id: r.id,
  name: r.name,
  // "Primary bedroom" already says bedroom; a room called "Den" typed office should say so.
  type: r.name.toLowerCase().includes(r.type.replace(/_/g, ' ')) || r.type === 'other' ? '' : r.type.replace(/_/g, ' '),
  center: roomCenter(r)
})))
const visible = computed(() => home.mode.value === 'plan')

// Keyed by room id: a v-for ref array does not promise source order.
const labels = new Map<string, HTMLElement>()
function setLabel(id: string, el: unknown) {
  if (el instanceof HTMLElement) labels.set(id, el)
  else labels.delete(id)
}
const box = ref<HTMLElement | null>(null)
const hover = ref<HTMLElement | null>(null)
let raf = 0

function place() {
  raf = requestAnimationFrame(place)
  const r = home.renderer()
  if (!r) return
  // toScreen is in the canvas's pixels and this layer covers the canvas exactly.
  const h = box.value?.clientHeight ?? window.innerHeight
  const at = r.pointerScreen()
  const tag = !!(at && home.gazeLabel.value)
  rooms.value.forEach((room) => {
    const el = labels.get(room.id)
    if (!el) return
    const p = r.toScreen(room.center, 0)
    // The hover tag wins over a room name it would sit on (a bed is usually at its room's middle).
    const under = tag && Math.abs(p.x - at!.x) < 90 && p.y - at!.y > -10 && p.y - at!.y < 50
    const fade = p.visible && p.y < h - BAR_CLEAR ? (under ? 0.2 : 1) : 0
    el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%)`
    el.style.opacity = String(fade)
  })
  if (hover.value) {
    hover.value.style.opacity = tag ? '1' : '0'
    if (at) hover.value.style.transform = `translate(${at.x.toFixed(1)}px, ${(at.y + 18).toFixed(1)}px) translate(-50%, 0)`
  }
}

// Only spin the loop while the plan view is up; walking never pays for it.
watch(visible, (on) => {
  cancelAnimationFrame(raf)
  if (on) raf = requestAnimationFrame(place)
}, { immediate: true })
onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>

<template>
  <div
    v-if="visible"
    ref="box"
    class="pointer-events-none absolute inset-0 overflow-hidden"
    data-plan-labels
  >
    <div
      v-for="room in rooms"
      :key="room.id"
      :ref="el => setLabel(room.id, el)"
      class="absolute top-0 left-0 flex flex-col items-center rounded-full bg-black/35 px-2.5 py-0.5 whitespace-nowrap opacity-0 ring-1 ring-white/10 backdrop-blur-sm transition-opacity duration-200"
      :data-plan-label="room.id"
    >
      <!-- On a pill: white floors and walls in plan view would swallow bare text. -->
      <span class="font-display text-xs leading-tight text-white sm:text-sm">{{ room.name }}</span>
      <span
        v-if="room.type"
        class="text-[9px] tracking-wide text-white/65 uppercase"
      >{{ room.type }}</span>
    </div>
    <div
      ref="hover"
      class="absolute top-0 left-0 rounded-full bg-black/45 px-2.5 py-0.5 text-xs text-white/85 opacity-0 ring-1 ring-white/12 backdrop-blur-sm"
      data-plan-hover
    >
      {{ home.gazeLabel.value }}
    </div>
  </div>
</template>
