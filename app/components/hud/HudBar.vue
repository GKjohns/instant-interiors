<script setup lang="ts">
/**
 * The primary input: a floating glass bar at the bottom. Type (or press the mic) and the gaze is frozen
 * on the first keystroke, so "there" means where you were looking when you started the sentence. Enter
 * anywhere focuses it; Escape and a click on the home give the keys back to walking. Keys never bubble
 * past the field while it has focus, so typing "wasd" writes letters instead of walking.
 */
import type { IntentPhase } from '~/composables/useIntent'

const intent = useIntent()
const home = useHome()
const text = ref('')
const focused = ref(false)
const input = useTemplateRef<{ inputRef?: HTMLInputElement }>('input')

const EXAMPLES = [
  'move the sofa under the window',
  'wallpaper the bedroom in a soft green floral',
  'what would the kitchen look like at golden hour',
  'add a floor lamp beside the armchair',
  'take me to the primary bedroom',
  'paint these walls a warm terracotta',
  'it’s night, lamps on',
  'furnish bedroom 2 scandinavian'
]
const exampleIdx = ref(0)
let cycle: ReturnType<typeof setInterval> | undefined

type PillColor = 'neutral' | 'warning' | 'primary' | 'info'
const PILL: Record<IntentPhase, { label: string, icon: string, color: PillColor }> = {
  idle: { label: 'ready', icon: 'i-lucide-circle-dot', color: 'neutral' },
  listening: { label: 'listening', icon: 'i-lucide-ear', color: 'info' },
  thinking: { label: 'thinking', icon: 'i-lucide-loader-circle', color: 'warning' },
  building: { label: 'arranging', icon: 'i-lucide-sofa', color: 'primary' }
}
const pill = computed(() => PILL[intent.phase.value])
const placeholder = computed(() => intent.interim.value
  ? `“${intent.interim.value}…”`
  : intent.micOn.value ? 'Listening… say what you’d change' : `“${EXAMPLES[exampleIdx.value]}”`)

/** Up-arrow recall over what you've sent this session. */
const sentLines: string[] = []
let recall = -1

watch(text, (v, old) => {
  if (v.trim() && !old.trim()) intent.beginTyping()
  else if (!v.trim()) intent.cancelTyping()
})

async function send() {
  const request = text.value.trim()
  if (!request) return
  const ctx = intent.takeSnapshot()
  text.value = ''
  recall = -1
  if (sentLines[sentLines.length - 1] !== request) sentLines.push(request)
  // Blur so WASD walks again while the genie works; Enter brings the bar back.
  input.value?.inputRef?.blur()
  await intent.build(request, ctx, 'text')
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    text.value = ''
    ;(e.target as HTMLElement).blur()
  } else if (e.key === 'ArrowUp' && sentLines.length) {
    e.preventDefault()
    recall = recall < 0 ? sentLines.length - 1 : Math.max(0, recall - 1)
    text.value = sentLines[recall] ?? ''
  } else if (e.key === 'ArrowDown' && recall >= 0) {
    e.preventDefault()
    recall = recall + 1 >= sentLines.length ? -1 : recall + 1
    text.value = recall < 0 ? '' : sentLines[recall] ?? ''
  }
  // The renderer listens on window: a sentence's letters must never walk the player.
  e.stopPropagation()
}

// Enter anywhere (outside another field) focuses the bar, so you can look, then type.
function onWindowKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
    e.preventDefault()
    input.value?.inputRef?.focus()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onWindowKey)
  cycle = setInterval(() => {
    if (!text.value && !focused.value) exampleIdx.value = (exampleIdx.value + 1) % EXAMPLES.length
  }, 4200)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onWindowKey)
  clearInterval(cycle)
})
</script>

<template>
  <div class="pointer-events-none absolute bottom-5 left-1/2 flex w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 flex-col items-center gap-2">
    <form
      class="pointer-events-auto flex w-full items-center gap-1.5 rounded-full bg-black/40 py-1.5 pr-1.5 pl-2 ring-1 ring-white/12 backdrop-blur-md transition"
      :class="focused ? 'bg-black/55 ring-white/20' : ''"
      data-bar
      @submit.prevent="send"
    >
      <UBadge
        :color="pill.color"
        variant="subtle"
        size="md"
        class="w-[6.5rem] shrink-0 justify-center rounded-full"
        data-pill
        :data-phase="intent.phase.value"
      >
        <UIcon
          :name="pill.icon"
          class="size-3.5"
          :class="intent.phase.value === 'thinking' ? 'animate-spin' : intent.phase.value === 'listening' ? 'animate-pulse' : ''"
        />
        {{ pill.label }}
      </UBadge>
      <UInput
        ref="input"
        v-model="text"
        class="flex-1"
        size="xl"
        variant="none"
        :placeholder="placeholder"
        autocomplete="off"
        spellcheck="false"
        data-intent-input
        :ui="{ base: `font-display text-xl text-white placeholder:text-white/40 placeholder:italic ${intent.interim.value ? 'placeholder:text-white/80' : ''}` }"
        @focus="focused = true"
        @blur="focused = false"
        @keydown="onKey"
      />
      <UTooltip
        v-if="intent.micSupported.value"
        :text="intent.micOn.value ? 'Stop listening' : 'Speak instead'"
      >
        <UButton
          :icon="intent.micOn.value ? 'i-lucide-mic-off' : 'i-lucide-mic'"
          :color="intent.micOn.value ? 'error' : 'neutral'"
          :variant="intent.micOn.value ? 'solid' : 'ghost'"
          size="md"
          class="rounded-full"
          :class="intent.micOn.value ? '' : 'text-white/60 hover:text-white'"
          aria-label="Microphone"
          data-mic
          @click="intent.toggleMic()"
        />
      </UTooltip>
      <UButton
        type="submit"
        icon="i-lucide-arrow-up"
        size="md"
        class="rounded-full"
        :disabled="!text.trim()"
        aria-label="Say it"
        data-send
      />
    </form>
    <!-- A faint dark pill behind the key hints: glow alone vanished over pale floors and sunlit walls. -->
    <p class="hud-glow rounded-full bg-black/25 px-3 py-0.5 text-[11px] tracking-wide text-white/60 backdrop-blur-sm">
      <UKbd
        value="enter"
        size="sm"
        variant="subtle"
        class="bg-white/5 text-white/55 ring-white/10"
      /> to type · drag to look · <UKbd
        value="W A S D"
        size="sm"
        variant="subtle"
        class="bg-white/5 text-white/55 ring-white/10"
      /> to walk · <UKbd
        value="tab"
        size="sm"
        variant="subtle"
        class="bg-white/5 text-white/55 ring-white/10"
      /> {{ home.mode.value === 'walk' ? 'plan view' : 'walk' }}
    </p>
  </div>
</template>
