<script setup lang="ts">
/**
 * Top-right controls: Plan (the reader panel), Light, the walk ↔ plan view toggle, History and the ⋯ menu.
 * One glass pill; each control owns its own popover, drawer or dialog.
 */
const home = useHome()
const plan = usePlan()

const glass = 'rounded-full text-white/75 hover:bg-white/10 hover:text-white'
</script>

<template>
  <div
    class="pointer-events-auto absolute top-4 right-4 flex items-center gap-0.5 rounded-full bg-black/40 p-1 ring-1 ring-white/12 backdrop-blur-md"
    data-top-right
  >
    <UTooltip
      text="Read a floor plan"
      :content="{ side: 'bottom' }"
    >
      <UButton
        icon="i-lucide-scan"
        label="Plan"
        color="neutral"
        variant="ghost"
        size="sm"
        :class="glass"
        data-plan-button
        @click="plan.panelOpen.value = true"
      />
    </UTooltip>

    <HudLightPopover :button-class="glass" />

    <UTooltip
      :text="home.mode.value === 'walk' ? 'Plan view (dollhouse)' : 'Walk inside'"
      :content="{ side: 'bottom' }"
      :kbds="['tab']"
    >
      <UButton
        :icon="home.mode.value === 'walk' ? 'i-lucide-layout-grid' : 'i-lucide-footprints'"
        :label="home.mode.value === 'walk' ? 'Plan view' : 'Walk'"
        color="neutral"
        variant="ghost"
        size="sm"
        :class="glass"
        data-view-toggle
        @click="home.toggleMode()"
      />
    </UTooltip>

    <HudHistory :button-class="glass" />
    <HudMenu :button-class="glass" />
  </div>
</template>
