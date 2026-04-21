<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t, te } = useI18n()

defineProps<{
  sessionId: string
  sessionName?: string
}>()

const joinLink = computed(() => (te('analysis.memory.joinLink') ? t('analysis.memory.joinLink') : ''))
</script>

<template>
  <div class="flex h-full items-center justify-center">
    <div class="max-w-sm text-center">
      <UIcon name="i-heroicons-light-bulb" class="mx-auto h-12 w-12 text-gray-300 dark:text-gray-600" />
      <p class="mt-3 text-sm text-gray-400 dark:text-gray-500">
        {{ t('analysis.memory.comingSoon') }}
      </p>
      <a
        v-if="joinLink"
        :href="joinLink"
        target="_blank"
        rel="noopener noreferrer"
        class="mt-2 inline-block text-sm text-primary-500 hover:text-primary-600 dark:text-primary-400 dark:hover:text-primary-300"
      >
        {{ joinLink }}
      </a>
    </div>
  </div>
</template>
