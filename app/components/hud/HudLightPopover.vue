<script setup lang="ts">
/** Time-of-day chips, lamps and warmth. Every change is a `light` op through `run`, so it is logged and undoable like a sentence. */
import type { TimeOfDay } from '#shared/home/ops'
import { TIMES } from '#shared/home/ops'

defineProps<{ buttonClass: string }>()

const home = useHome()

const TIME_LABEL: Record<TimeOfDay, string> = {
  dawn: 'dawn', morning: 'morning', noon: 'noon', afternoon: 'afternoon', golden: 'golden hour', evening: 'evening', night: 'night'
}
const light = computed(() => home.state.value.light)
const warmth = ref(light.value.warmth)
watch(() => light.value.warmth, (w) => {
  warmth.value = w
})
let warmthTimer: ReturnType<typeof setTimeout> | undefined

function setTime(time: TimeOfDay) {
  if (time === light.value.time) return
  home.run([{ op: 'light', time }], `light: ${TIME_LABEL[time]}`, undefined, { source: 'console' })
}
function setLamps(on: boolean) {
  home.run([{ op: 'light', lamps: on }], on ? 'lamps on' : 'lamps off', undefined, { source: 'console' })
}
function onWarmth(v: number | undefined) {
  if (typeof v !== 'number') return
  warmth.value = v
  // One logged batch per slide, not one per pixel.
  clearTimeout(warmthTimer)
  warmthTimer = setTimeout(() => {
    if (Math.abs(v - light.value.warmth) > 0.001) home.run([{ op: 'light', warmth: v }], `warmth ${Math.round(v * 100)}%`, undefined, { source: 'console' })
  }, 350)
}
</script>

<template>
  <UPopover :content="{ side: 'bottom', align: 'end', sideOffset: 8 }">
    <UButton
      icon="i-lucide-sun-medium"
      label="Light"
      color="neutral"
      variant="ghost"
      size="sm"
      :class="buttonClass"
      data-light-button
    />
    <template #content>
      <div
        class="flex w-72 flex-col gap-3 p-3"
        data-light-panel
      >
        <div class="flex flex-wrap gap-1">
          <UButton
            v-for="t in TIMES"
            :key="t"
            size="xs"
            :color="t === light.time ? 'primary' : 'neutral'"
            :variant="t === light.time ? 'solid' : 'soft'"
            :label="TIME_LABEL[t]"
            :data-time="t"
            @click="setTime(t)"
          />
        </div>
        <USwitch
          :model-value="light.lamps"
          label="Lamps"
          :description="light.lamps ? 'Every lamp and fixture is on' : 'Lamps off (night turns them on)'"
          data-lamps
          @update:model-value="setLamps"
        />
        <div class="flex flex-col gap-1.5">
          <div class="flex items-center justify-between text-xs">
            <span class="text-muted">Warmth</span>
            <span class="text-toned">{{ warmth < 0.34 ? 'cool white' : warmth < 0.67 ? 'neutral' : 'candle-warm' }}</span>
          </div>
          <USlider
            :model-value="warmth"
            :min="0"
            :max="1"
            :step="0.05"
            size="sm"
            data-warmth
            @update:model-value="onWarmth"
          />
        </div>
      </div>
    </template>
  </UPopover>
</template>
