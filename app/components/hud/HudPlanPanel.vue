<script setup lang="ts">
/**
 * The plan reader: drop, paste or choose a floor-plan image, add a one-line hint, Read. While the model
 * reads, the clock ticks; after, the upload sits beside the rooms it found (names, types, m²), the
 * reader's notes and its confidence. The home already became that plan; "Walk it" re-spawns you at the
 * door. Below: the built-in samples.
 */
import { area } from '#shared/plan/poly'

const plan = usePlan()
const home = useHome()
const dragging = ref(false)

const rooms = computed(() => (plan.result.value ? plan.roomsOf(plan.result.value.plan) : []))
const totalM2 = computed(() => Math.round(rooms.value.reduce((a, r) => a + r.m2, 0)))
const confidence = computed(() => plan.result.value?.plan.source?.confidence)
const seconds = computed(() => (plan.elapsed.value / 1000).toFixed(1))
const current = computed(() => home.state.value.plan.id)

function sampleM2(p: { rooms: { polygon: [number, number][] }[] }) {
  return Math.round(p.rooms.reduce((a, r) => a + area(r.polygon), 0))
}

function onDrop(e: DragEvent) {
  dragging.value = false
  plan.onDrop(e)
}
function read() {
  void plan.readStaged()
}
function walkIt() {
  if (plan.result.value) home.loadPlan(plan.result.value.plan, { furnish: true })
  plan.panelOpen.value = false
}
function loadSample(id: string) {
  plan.loadSample(id)
  plan.panelOpen.value = false
}
</script>

<template>
  <USlideover
    v-model:open="plan.panelOpen.value"
    title="Floor plan"
    description="Paste a screenshot, drop an image or choose a file. The reader turns it into rooms you can walk."
    :ui="{ content: 'sm:max-w-lg' }"
  >
    <template #body>
      <div
        class="flex flex-col gap-4"
        data-plan-panel
      >
        <!-- the drop zone -->
        <div
          class="flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-center transition"
          :class="dragging ? 'border-primary bg-primary/10' : 'border-default bg-elevated/40 hover:bg-elevated/70'"
          data-drop-zone
          @click="plan.pickImage()"
          @dragover.prevent="dragging = true"
          @dragleave="dragging = false"
          @drop.prevent="onDrop"
        >
          <img
            v-if="plan.image.value"
            :src="plan.image.value"
            alt="The floor plan you uploaded"
            class="max-h-56 rounded-md bg-white object-contain shadow"
            data-plan-thumb
          >
          <template v-else>
            <UIcon
              name="i-lucide-image-plus"
              class="size-7 text-muted"
            />
            <p class="text-sm text-highlighted">
              Drop a floor plan here
            </p>
            <p class="text-xs text-muted">
              or <UKbd value="meta" /><UKbd value="v" /> to paste a screenshot · click to choose a file
            </p>
          </template>
          <p
            v-if="plan.imageName.value"
            class="truncate text-[11px] text-muted"
          >
            {{ plan.imageName.value }}
          </p>
        </div>

        <UInput
          v-model="plan.hint.value"
          icon="i-lucide-lightbulb"
          placeholder="A hint helps: “2 bedroom apartment, dimensions in feet”"
          data-plan-hint
          @keydown.stop
          @keydown.enter.prevent="read"
        />

        <div class="flex items-center gap-2">
          <UButton
            icon="i-lucide-scan-eye"
            :label="plan.phase.value === 'reading' ? `Reading… ${seconds} s` : plan.result.value ? 'Read again' : 'Read the plan'"
            :loading="plan.phase.value === 'reading'"
            :disabled="!plan.image.value || plan.phase.value === 'reading'"
            data-plan-read
            @click="read"
          />
          <UButton
            v-if="plan.image.value && plan.phase.value !== 'reading'"
            icon="i-lucide-folder-open"
            label="Choose another"
            color="neutral"
            variant="ghost"
            @click="plan.pickImage()"
          />
          <span
            v-if="plan.phase.value === 'reading'"
            class="text-xs text-muted"
          >usually 6–9 s</span>
        </div>

        <UAlert
          v-if="plan.phase.value === 'error' && plan.error.value"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="Could not read that plan"
          :description="plan.error.value"
        />

        <!-- the result -->
        <div
          v-if="plan.result.value"
          class="flex flex-col gap-3 rounded-xl bg-elevated/50 p-3 ring ring-default"
          data-plan-result
        >
          <div class="flex items-center gap-2">
            <UIcon
              name="i-lucide-house"
              class="size-4 text-primary"
            />
            <span class="text-sm font-medium text-highlighted">{{ plan.result.value.plan.name }}</span>
            <span class="text-xs text-muted">{{ rooms.length }} rooms · {{ totalM2 }} m²</span>
            <UBadge
              v-if="confidence !== undefined"
              class="ml-auto"
              size="sm"
              variant="subtle"
              :color="confidence >= 0.7 ? 'success' : confidence >= 0.4 ? 'warning' : 'error'"
              :label="`${Math.round(confidence * 100)}% sure`"
            />
          </div>
          <table class="w-full text-left text-xs">
            <thead class="text-muted">
              <tr>
                <th class="py-1 font-normal">
                  Room
                </th>
                <th class="py-1 font-normal">
                  Type
                </th>
                <th class="py-1 text-right font-normal">
                  m²
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="r in rooms"
                :key="r.id"
                class="border-t border-default/60"
              >
                <td class="py-1 text-default">
                  {{ r.name }}
                </td>
                <td class="py-1 text-muted">
                  {{ r.type }}
                </td>
                <td class="py-1 text-right font-mono text-toned">
                  {{ r.m2 }}
                </td>
              </tr>
            </tbody>
          </table>
          <ul
            v-if="plan.result.value.notes.length"
            class="flex flex-col gap-0.5 text-[11px] text-muted italic"
          >
            <li
              v-for="(n, i) in plan.result.value.notes"
              :key="i"
            >
              {{ n }}
            </li>
          </ul>
          <div class="flex items-center gap-2 text-[11px] text-dimmed">
            <span>read in {{ (plan.result.value.ms / 1000).toFixed(1) }} s</span>
            <span v-if="plan.result.value.costUsd !== undefined">· ${{ plan.result.value.costUsd.toFixed(3) }}</span>
            <UButton
              class="ml-auto"
              size="xs"
              icon="i-lucide-footprints"
              label="Walk it"
              data-plan-walk
              @click="walkIt"
            />
          </div>
        </div>

        <!-- samples -->
        <div class="flex flex-col gap-1.5">
          <p class="text-xs font-medium text-muted uppercase">
            Samples
          </p>
          <div
            v-for="s in plan.samples"
            :key="s.id"
            class="flex items-center gap-2 rounded-lg px-2.5 py-2 ring ring-default/60"
            :class="s.id === current ? 'bg-primary/10' : 'bg-muted/40'"
          >
            <UIcon
              name="i-lucide-layout-template"
              class="size-4 text-muted"
            />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm text-highlighted">
                {{ s.name }}
              </p>
              <p class="text-[11px] text-muted">
                {{ s.rooms.length }} rooms · {{ sampleM2(s) }} m²
              </p>
            </div>
            <UButton
              size="xs"
              :label="s.id === current ? 'Reload' : 'Walk it'"
              :color="s.id === current ? 'neutral' : 'primary'"
              :variant="s.id === current ? 'soft' : 'solid'"
              :data-sample="s.id"
              @click="loadSample(s.id)"
            />
          </div>
        </div>
      </div>
    </template>
  </USlideover>
</template>
