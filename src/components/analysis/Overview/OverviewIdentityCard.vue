<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { AnalysisSession } from '@/types/base'

const { t } = useI18n()

defineProps<{
  session: AnalysisSession
  totalDurationDays: number
  totalDailyAvgMessages: number
}>()
</script>

<template>
  <div
    class="relative overflow-hidden rounded-3xl bg-gradient-to-br from-pink-500 to-pink-600 p-8 shadow-sm ring-1 ring-pink-600 dark:bg-gray-800/50 dark:from-transparent dark:to-transparent dark:ring-gray-800"
  >
    <div class="relative">
      <div>
        <div class="flex items-center gap-3">
          <h2 class="text-3xl font-black tracking-tight text-white">{{ session.name }}</h2>
          <span
            class="rounded-full bg-white px-3 py-1 text-xs font-medium text-pink-600 dark:bg-pink-500/10 dark:text-pink-400"
          >
            {{ session.platform.toUpperCase() }}
          </span>
        </div>
        <p class="mt-2 text-lg font-medium text-pink-100 dark:text-gray-400">
          {{ session.type === 'private' ? t('privateChat') : t('groupChat') }} ·
          <span class="opacity-80">{{ t('analysisReport') }}</span>
        </p>
      </div>

      <div class="mt-8 grid grid-cols-3 gap-6">
        <div class="rounded-2xl bg-white/10 px-6 py-4 dark:bg-gray-800">
          <p class="text-3xl font-black tracking-tight text-white">
            {{ session.messageCount.toLocaleString() }}
          </p>
          <p class="mt-1 text-sm font-medium text-pink-100 dark:text-gray-400">{{ t('totalMessages') }}</p>
        </div>
        <div class="rounded-2xl bg-white/10 px-6 py-4 dark:bg-gray-800">
          <p class="text-3xl font-black tracking-tight text-white">{{ totalDurationDays }}</p>
          <p class="mt-1 text-sm font-medium text-pink-100 dark:text-gray-400">{{ t('durationDays') }}</p>
        </div>
        <div class="rounded-2xl bg-white/10 px-6 py-4 dark:bg-gray-800">
          <p class="text-3xl font-black tracking-tight text-white">{{ totalDailyAvgMessages }}</p>
          <p class="mt-1 text-sm font-medium text-pink-100 dark:text-gray-400">{{ t('dailyAvgMessages') }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<i18n>
{
  "zh-CN": {
    "privateChat": "私聊",
    "groupChat": "群聊",
    "analysisReport": "数据分析报告",
    "totalMessages": "消息总数",
    "durationDays": "跨度天数",
    "dailyAvgMessages": "日均消息"
  },
  "en-US": {
    "privateChat": "Private",
    "groupChat": "Group",
    "analysisReport": "Analysis Report",
    "totalMessages": "Total Messages",
    "durationDays": "Duration Days",
    "dailyAvgMessages": "Daily Avg"
  }
}
</i18n>
