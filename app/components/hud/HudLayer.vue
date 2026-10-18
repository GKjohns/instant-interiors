<script setup lang="ts">
/**
 * Everything drawn over the home. The layer itself lets pointer events through to the canvas; each
 * control opts back in with `pointer-events-auto`. Errors from the genie and the plan reader surface as
 * toasts here, so no panel has to own them.
 */
const intent = useIntent()
const plan = usePlan()
const toast = useToast()

watch(intent.error, (e) => {
  if (e) toast.add({ title: e, color: 'error', icon: 'i-lucide-flame' })
})
watch(plan.error, (e) => {
  if (e) toast.add({ title: 'Could not read the plan', description: e, color: 'warning', icon: 'i-lucide-image-off' })
})
// A pasted screenshot anywhere on the page opens the Plan panel with it staged.
watch(plan.pasted, () => {
  plan.panelOpen.value = true
})

function onDragOver(e: DragEvent) {
  if ([...(e.dataTransfer?.types ?? [])].includes('Files')) e.preventDefault()
}
function onDrop(e: DragEvent) {
  plan.onDrop(e)
  if (plan.image.value) plan.panelOpen.value = true
}

onMounted(() => {
  intent.detectMic()
  plan.listen()
  window.addEventListener('dragover', onDragOver)
  window.addEventListener('drop', onDrop)
})
onBeforeUnmount(() => {
  intent.stopMic()
  plan.unlisten()
  window.removeEventListener('dragover', onDragOver)
  window.removeEventListener('drop', onDrop)
})
</script>

<template>
  <div class="pointer-events-none absolute inset-0">
    <HudPlanLabels />
    <HudRoomChip />
    <HudTopRight />
    <HudWhisper />
    <HudCaption />
    <HudBar />
    <HudPlanPanel />
  </div>
</template>
