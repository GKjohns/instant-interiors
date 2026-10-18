<script setup lang="ts">
/** The first-run hint over the bar; it goes once the first sentence has been sent. */
const intent = useIntent()
const show = computed(() => intent.sent.value === 0 && !intent.pendingText.value.length)
</script>

<template>
  <Transition
    enter-from-class="opacity-0"
    leave-to-class="opacity-0"
    enter-active-class="transition-opacity duration-[1800ms] delay-500"
    leave-active-class="transition-opacity duration-700"
  >
    <div
      v-if="show"
      class="pointer-events-none absolute inset-x-4 bottom-36 flex flex-col items-center gap-1.5 text-center"
      data-whisper
    >
      <p class="hud-glow font-display text-3xl font-light tracking-wide text-white/90 italic sm:text-4xl">
        Walk with WASD, drag to look.
      </p>
      <p class="hud-glow font-display text-xl text-white/65">
        Press Enter and say what you’d change.
      </p>
    </div>
  </Transition>
</template>
