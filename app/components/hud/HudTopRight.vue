<script setup lang="ts">
/**
 * Top-right controls: Plan (the reader panel), Light (time-of-day chips, lamps, warmth: every change is a
 * `light` op through `run`, so it is undoable and logged like a sentence), the walk ↔ plan view toggle,
 * History (a drawer of batches with undo-to-here) and the ⋯ menu (export / import / model / start over).
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import type { TimeOfDay } from '#shared/home/ops'
import { TIMES } from '#shared/home/ops'

const home = useHome()
const intent = useIntent()
const plan = usePlan()
const historyOpen = ref(false)
const confirmReset = ref(false)
const fileInput = useTemplateRef<HTMLInputElement>('file')
const toast = useToast()

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

// ---------- history ----------
const entries = computed(() => [...home.history.value].reverse().slice(0, 80))
const liveIds = computed(() => new Set(home.state.value.log.map(b => b.id)))
const canUndo = computed(() => home.state.value.log.length > 0)
function opLine(op: unknown): string {
  return JSON.stringify(op, (_k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v))
}
function undoTo(batchId: string) {
  home.undoTo(batchId)
}

// ---------- the ⋯ menu ----------
const menu = computed<DropdownMenuItem[][]>(() => [
  [
    { label: 'Export home JSON', icon: 'i-lucide-download', onSelect: () => home.exportJson() },
    { label: 'Import home JSON', icon: 'i-lucide-upload', onSelect: () => fileInput.value?.click() }
  ],
  [
    {
      label: `Model: ${intent.model.value === 'haiku' ? 'Haiku (fast)' : 'Sonnet (careful)'}`,
      icon: 'i-lucide-cpu',
      onSelect: () => intent.setModel(intent.model.value === 'haiku' ? 'sonnet' : 'haiku')
    }
  ],
  [
    { label: 'Start over', icon: 'i-lucide-rotate-ccw', color: 'error', onSelect: () => (confirmReset.value = true) }
  ]
])

async function onFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  ;(e.target as HTMLInputElement).value = ''
  if (!f) return
  try {
    const ok = await home.importJson(f)
    if (!ok) toast.add({ title: 'Not a Hearth home', description: `${f.name} has no plan and op log in it.`, color: 'warning', icon: 'i-lucide-file-x' })
  } catch (err) {
    toast.add({ title: 'Could not import', description: (err as Error).message, color: 'error', icon: 'i-lucide-file-x' })
  }
}

function resetHome() {
  confirmReset.value = false
  home.reset()
}

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

    <UPopover :content="{ side: 'bottom', align: 'end', sideOffset: 8 }">
      <UButton
        icon="i-lucide-sun-medium"
        label="Light"
        color="neutral"
        variant="ghost"
        size="sm"
        :class="glass"
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

    <UTooltip
      text="What changed"
      :content="{ side: 'bottom' }"
    >
      <UButton
        icon="i-lucide-history"
        color="neutral"
        variant="ghost"
        size="sm"
        :class="glass"
        aria-label="History"
        data-history-button
        @click="historyOpen = true"
      />
    </UTooltip>

    <UDropdownMenu
      :items="menu"
      :content="{ side: 'bottom', align: 'end', sideOffset: 8 }"
    >
      <UButton
        icon="i-lucide-ellipsis"
        color="neutral"
        variant="ghost"
        size="sm"
        :class="glass"
        aria-label="More"
        data-menu-button
      />
    </UDropdownMenu>
    <input
      ref="file"
      type="file"
      accept="application/json,.json"
      class="hidden"
      @change="onFile"
    >
  </div>

  <USlideover
    v-model:open="historyOpen"
    title="History"
    :description="`${home.state.value.log.length} ${home.state.value.log.length === 1 ? 'change' : 'changes'} on this plan`"
    :ui="{ content: 'sm:max-w-md' }"
  >
    <template #body>
      <div
        class="flex flex-col gap-2"
        data-history-list
      >
        <UButton
          icon="i-lucide-undo-2"
          label="Undo last"
          color="neutral"
          variant="soft"
          :disabled="!canUndo"
          data-undo
          @click="home.undo()"
        />
        <p
          v-if="!entries.length"
          class="py-6 text-center text-xs text-muted"
        >
          Nothing yet. Say what you'd change.
        </p>
        <div
          v-for="h in entries"
          :key="h.n"
          class="rounded-lg bg-muted/50 px-2.5 py-2 ring ring-default/60"
          :class="h.undone ? 'opacity-50' : ''"
        >
          <div class="mb-1 flex items-center gap-1.5">
            <span
              class="truncate text-[13px] text-default"
              :class="h.undone ? 'line-through' : ''"
            >“{{ h.label }}”</span>
            <UBadge
              v-if="h.batchId"
              class="ml-auto shrink-0 font-mono"
              size="sm"
              :color="h.undone ? 'neutral' : 'primary'"
              variant="subtle"
              :label="h.undone ? `${h.batchId} undone` : h.batchId"
            />
          </div>
          <div class="mb-1 flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted">
            <span
              v-if="h.source && h.source !== 'console'"
              class="flex items-center gap-1 text-toned"
            ><UIcon
              :name="h.source === 'voice' ? 'i-lucide-mic' : 'i-lucide-keyboard'"
              class="size-3"
            />{{ h.model ?? '?' }}<template v-if="h.ms !== undefined"> · {{ h.ms }} ms</template></span>
            <span v-if="h.placed">+{{ h.placed }}</span>
            <span v-if="h.moved">↔{{ h.moved }}</span>
            <span v-if="h.modified">~{{ h.modified }}</span>
            <span v-if="h.removed">−{{ h.removed }}</span>
            <span v-if="h.surfaces">finish ×{{ h.surfaces }}</span>
            <span v-if="h.light">light</span>
            <UButton
              v-if="h.batchId && !h.undone && liveIds.has(h.batchId) && h.label !== 'furnished'"
              class="ml-auto"
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-undo-2"
              label="undo to here"
              @click="undoTo(h.batchId)"
            />
          </div>
          <pre
            v-for="(op, i) in h.ops.slice(0, 6)"
            :key="i"
            class="truncate font-mono text-[11px] leading-relaxed text-toned"
            :title="JSON.stringify(op, null, 2)"
          >{{ opLine(op) }}</pre>
          <p
            v-if="h.ops.length > 6"
            class="font-mono text-[11px] text-dimmed"
          >
            … {{ h.ops.length - 6 }} more
          </p>
          <p
            v-if="h.error"
            class="mt-0.5 font-mono text-[11px] leading-snug text-error"
          >
            {{ h.error }}
          </p>
          <p
            v-for="(d, i) in h.dropped"
            :key="`d${i}`"
            class="mt-0.5 font-mono text-[11px] leading-snug text-warning"
            :title="JSON.stringify(d.raw)"
          >
            dropped #{{ d.index }}: {{ d.reason }}
          </p>
          <p
            v-for="(note, i) in h.notes"
            :key="`n${i}`"
            class="mt-0.5 text-[11px] text-muted italic"
          >
            {{ note }}
          </p>
        </div>
      </div>
    </template>
  </USlideover>

  <UModal
    v-model:open="confirmReset"
    title="Start over?"
    description="Every change on this plan goes; the furniture and finishes come back as they were. Cmd-Z right after cannot bring them back."
  >
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          label="Keep it"
          @click="confirmReset = false"
        />
        <UButton
          color="error"
          icon="i-lucide-rotate-ccw"
          label="Start over"
          data-reset-go
          @click="resetHome"
        />
      </div>
    </template>
  </UModal>
</template>
