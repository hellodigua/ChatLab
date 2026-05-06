<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { usePromptStore } from '@/stores/prompt'

const { t } = useI18n()

const emit = defineEmits<{
  'config-changed': []
}>()

const promptStore = usePromptStore()
const { aiGlobalSettings } = storeToRefs(promptStore)

// 导出格式选项（AI 对话）
const exportFormatTabs = computed(() => [
  { label: 'Markdown', value: 'markdown' },
  { label: t('settings.aiPrompt.exportFormat.txtLabel'), value: 'txt' },
])

// 当前选中的导出格式（AI 对话）
const exportFormat = computed({
  get: () => aiGlobalSettings.value.exportFormat ?? 'markdown',
  set: (val: string) => {
    promptStore.updateAIGlobalSettings({ exportFormat: val as 'markdown' | 'txt' })
    emit('config-changed')
  },
})

// SQL Lab 导出格式选项
const sqlExportFormatTabs = computed(() => [
  { label: 'CSV', value: 'csv' },
  { label: 'JSON', value: 'json' },
])

// 当前选中的 SQL Lab 导出格式
const sqlExportFormat = computed({
  get: () => aiGlobalSettings.value.sqlExportFormat ?? 'csv',
  set: (val: string) => {
    promptStore.updateAIGlobalSettings({ sqlExportFormat: val as 'csv' | 'json' })
    emit('config-changed')
  },
})
</script>

<template>
  <div>
    <h4 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
      <UIcon name="i-heroicons-arrow-down-tray" class="h-4 w-4 text-blue-500" />
      {{ t('settings.aiPrompt.exportSettings.title') }}
    </h4>
    <div class="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
      <!-- 导出格式（AI 对话） -->
      <div class="flex items-center justify-between">
        <div class="flex-1 pr-4">
          <p class="text-sm font-medium text-gray-900 dark:text-white">
            {{ t('settings.aiPrompt.exportFormat.title') }}
          </p>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            {{ t('settings.aiPrompt.exportFormat.description') }}
          </p>
        </div>
        <UTabs v-model="exportFormat" :items="exportFormatTabs" size="xs" />
      </div>

      <!-- SQL Lab 导出格式 -->
      <div class="flex items-center justify-between">
        <div class="flex-1 pr-4">
          <p class="text-sm font-medium text-gray-900 dark:text-white">
            {{ t('settings.aiPrompt.sqlExportFormat.title') }}
          </p>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            {{ t('settings.aiPrompt.sqlExportFormat.description') }}
          </p>
        </div>
        <UTabs v-model="sqlExportFormat" :items="sqlExportFormatTabs" size="xs" />
      </div>
    </div>
  </div>
</template>
