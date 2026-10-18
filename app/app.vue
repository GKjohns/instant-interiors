<script setup lang="ts">
useHead({
  meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
  htmlAttrs: { lang: 'en', class: 'dark' }
})
useSeoMeta({ title: 'Hearth', description: 'Walk through a floor plan and change it by talking.' })
</script>

<template>
  <UApp>
    <NuxtPage />
  </UApp>
</template>
