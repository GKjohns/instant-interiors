<script setup lang="ts">
/**
 * Captions above the bar: what you asked (italic, while the genie works) and the genie's reply in the
 * display face. Each fades a few seconds after it last changed; a new sentence replaces the last reply
 * at once, so the caption never answers the wrong sentence.
 */
const home = useHome()
const intent = useIntent()
const userLine = ref('')
const genieLine = ref('')
const tone = ref<'genie' | 'error'>('genie')
let userTimer: ReturnType<typeof setTimeout> | undefined
let genieTimer: ReturnType<typeof setTimeout> | undefined

function showUser(t: string, ms = 6000) {
  clearTimeout(userTimer)
  userLine.value = t
  if (t) {
    userTimer = setTimeout(() => {
      userLine.value = ''
    }, ms)
  }
}
function showGenie(t: string, kind: 'genie' | 'error' = 'genie', ms = 6000) {
  clearTimeout(genieTimer)
  genieLine.value = t
  tone.value = kind
  if (t) {
    genieTimer = setTimeout(() => {
      genieLine.value = ''
    }, ms)
  }
}

watch(() => intent.pendingText.value, (list, old) => {
  const latest = list[list.length - 1]
  if (latest && list.length >= (old?.length ?? 0)) {
    showUser(latest, 60_000)
    showGenie('')
  } else if (!list.length) {
    showUser(userLine.value, 3000)
  }
})
watch(home.caption, (c) => {
  if (c) showGenie(c.text)
})
watch(intent.error, (e) => {
  if (e) showGenie(e, 'error', 7000)
})
onBeforeUnmount(() => {
  clearTimeout(userTimer)
  clearTimeout(genieTimer)
})
</script>

<template>
  <!-- bottom-30: clear of the bar AND the key hints under it; at bottom-24 a two-line caption ran into the bar. -->
  <div class="pointer-events-none absolute inset-x-4 bottom-30 flex flex-col items-center gap-1 text-center">
    <Transition
      enter-from-class="opacity-0 translate-y-2 blur-sm"
      leave-to-class="opacity-0 -translate-y-1 blur-sm"
      enter-active-class="transition duration-500"
      leave-active-class="transition duration-1000"
      mode="out-in"
    >
      <p
        v-if="userLine"
        :key="userLine"
        class="hud-glow line-clamp-2 max-w-[40rem] font-display text-lg text-white/80 italic"
        data-caption-user
      >
        “{{ userLine }}”
      </p>
    </Transition>
    <Transition
      enter-from-class="opacity-0 translate-y-2 blur-sm"
      leave-to-class="opacity-0 -translate-y-1 blur-sm"
      enter-active-class="transition duration-700"
      leave-active-class="transition duration-[1500ms]"
      mode="out-in"
    >
      <p
        v-if="genieLine"
        :key="genieLine"
        class="hud-glow line-clamp-3 max-w-[44rem] font-display text-2xl leading-snug sm:text-[1.75rem]"
        :class="tone === 'error' ? 'text-rose-200/85' : 'text-amber-50'"
        data-caption
      >
        {{ genieLine }}
      </p>
    </Transition>
  </div>
</template>
