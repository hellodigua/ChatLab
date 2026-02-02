<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

interface TimeFilter {
  startTs?: number
  endTs?: number
}

// Props
defineProps<{
  sessionId: string
  timeFilter?: TimeFilter
}>()
</script>

<template>
  <div class="main-content flex h-full items-center justify-center p-6">
    <div
      class="flex h-full w-full items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/50"
    >
      <div class="text-center">
        <UIcon name="i-heroicons-chart-bar" class="mx-auto h-12 w-12 text-gray-400" />
        <p class="mt-3 text-sm font-medium text-gray-600 dark:text-gray-400">
          {{ t('title') }}
        </p>
        <p class="mt-1 max-w-md px-4 text-sm text-gray-500">
          {{ t('description') }}
        </p>
      </div>
    </div>
  </div>
</template>

<i18n>
{
  "zh-CN": {
    "title": "时间线视图",
    "description": "消息时间分布、活跃周期变化趋势等可视化内容"
  },
  "en-US": {
    "title": "Timeline View",
    "description": "Message time distribution, active period trends and other visualizations"
  }
}
</i18n>
