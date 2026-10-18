<script setup lang="ts">
/** The ⋯ menu: export / import the home as JSON, the sentence model, and start over (behind a confirm). */
import type { DropdownMenuItem } from '@nuxt/ui'

defineProps<{ buttonClass: string }>()

const home = useHome()
const intent = useIntent()
const toast = useToast()
const confirmReset = ref(false)
const fileInput = useTemplateRef<HTMLInputElement>('file')

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
    if (!ok) toast.add({ title: 'Not a Instant Interiors home', description: `${f.name} has no plan and op log in it.`, color: 'warning', icon: 'i-lucide-file-x' })
  } catch (err) {
    toast.add({ title: 'Could not import', description: (err as Error).message, color: 'error', icon: 'i-lucide-file-x' })
  }
}

function resetHome() {
  confirmReset.value = false
  home.reset()
}
</script>

<template>
  <UDropdownMenu
    :items="menu"
    :content="{ side: 'bottom', align: 'end', sideOffset: 8 }"
  >
    <UButton
      icon="i-lucide-ellipsis"
      color="neutral"
      variant="ghost"
      size="sm"
      :class="buttonClass"
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
