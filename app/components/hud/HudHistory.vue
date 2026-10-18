<script setup lang="ts">
/** The History button and its drawer: every batch with its ops, notes and drops, and undo-to-here. */
defineProps<{ buttonClass: string }>()

const home = useHome()
const open = ref(false)

const entries = computed(() => [...home.history.value].reverse().slice(0, 80))
const liveIds = computed(() => new Set(home.state.value.log.map(b => b.id)))
const canUndo = computed(() => home.state.value.log.length > 0)

/** One op on one line, numbers to the centimetre. */
function opLine(op: unknown): string {
  return JSON.stringify(op, (_k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v))
}
</script>

<template>
  <UTooltip
    text="What changed"
    :content="{ side: 'bottom' }"
  >
    <UButton
      icon="i-lucide-history"
      color="neutral"
      variant="ghost"
      size="sm"
      :class="buttonClass"
      aria-label="History"
      data-history-button
      @click="open = true"
    />
  </UTooltip>

  <USlideover
    v-model:open="open"
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
              @click="home.undoTo(h.batchId)"
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
</template>
