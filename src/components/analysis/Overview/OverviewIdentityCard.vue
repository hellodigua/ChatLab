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
  <div class="relative overflow-hidden rounded-3xl bg-pink-500 p-8 text-white shadow-xl">
    <div class="relative">
      <div>
        <div class="flex items-center gap-3">
          <h2 class="text-3xl font-black tracking-tight">{{ session.name }}</h2>
          <span class="rounded-full bg-white/20 px-3 py-1 text-xs font-medium backdrop-blur-md">
            {{ session.platform.toUpperCase() }}
          </span>
        </div>
        <p class="mt-2 text-lg text-white/90 font-medium">
          {{ session.type === 'private' ? t('privateChat') : t('groupChat') }} ·
          <span class="opacity-80">{{ t('analysisReport') }}</span>
        </p>
      </div>

      <div class="mt-8 grid grid-cols-3 gap-6">
        <div class="rounded-2xl bg-white/10 px-6 py-4 backdrop-blur-md">
          <p class="text-3xl font-black tracking-tight">{{ session.messageCount.toLocaleString() }}</p>
          <p class="mt-1 text-sm font-medium text-white/70">{{ t('totalMessages') }}</p>
        </div>
        <div class="rounded-2xl bg-white/10 px-6 py-4 backdrop-blur-md">
          <p class="text-3xl font-black tracking-tight">{{ totalDurationDays }}</p>
          <p class="mt-1 text-sm font-medium text-white/70">{{ t('durationDays') }}</p>
        </div>
        <div class="rounded-2xl bg-white/10 px-6 py-4 backdrop-blur-md">
          <p class="text-3xl font-black tracking-tight">{{ totalDailyAvgMessages }}</p>
          <p class="mt-1 text-sm font-medium text-white/70">{{ t('dailyAvgMessages') }}</p>
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
