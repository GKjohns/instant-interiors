<script setup lang="ts">
/**
 * Top-left: where you are (the room, the plan) and, under the crosshair, what you're looking at. The
 * hover tag sits by the crosshair rather than in the chip so your eye never has to leave the thing.
 */
const home = useHome()
const roomName = computed(() => home.currentRoom.value?.name ?? (home.mode.value === 'plan' ? 'Plan view' : 'Outside'))
const planName = computed(() => home.state.value.plan.name)
const time = computed(() => home.state.value.light.time.replace('golden', 'golden hour'))
</script>

<template>
  <div class="pointer-events-none absolute top-4 left-4 flex max-w-[calc(100vw-22rem)] flex-col gap-1.5">
    <div
      class="flex items-center gap-2.5 rounded-full bg-black/40 py-1.5 pr-4 pl-3 ring-1 ring-white/12 backdrop-blur-md"
      data-room-chip
    >
      <UIcon
        name="i-lucide-flame"
        class="size-4 text-primary"
      />
      <span
        class="font-display text-lg leading-none text-white"
        data-room
      >{{ roomName }}</span>
      <span class="h-3.5 w-px bg-white/15" />
      <span class="truncate text-xs text-white/55">{{ planName }} · {{ time }}</span>
    </div>
  </div>
  <Transition
    enter-from-class="opacity-0"
    leave-to-class="opacity-0"
    enter-active-class="transition duration-200"
    leave-active-class="transition duration-300"
  >
    <div
      v-if="home.gazeLabel.value && home.mode.value === 'walk'"
      class="pointer-events-none absolute top-1/2 left-1/2 mt-3 -translate-x-1/2 rounded-full bg-black/45 px-2.5 py-0.5 text-xs text-white/85 ring-1 ring-white/12 backdrop-blur-sm"
      data-gaze-label
    >
      {{ home.gazeLabel.value }}
    </div>
  </Transition>
</template>
