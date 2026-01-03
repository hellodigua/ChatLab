<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { StatCard } from '@/components/UI'
import type { WeekdayActivity, DailyActivity, HourlyActivity } from '@/types/analysis'
import dayjs from 'dayjs'

const { t } = useI18n()

defineProps<{
  dailyAvgMessages: number
  durationDays: number
  imageCount: number
  peakHour: HourlyActivity | null
  peakWeekday: WeekdayActivity | null
  weekdayNames: string[]
  weekdayVsWeekend: { weekday: number; weekend: number }
  peakDay: DailyActivity | null
  activeDays: number
  totalDays: number
  activeRate: number
  maxConsecutiveDays: number
}>()
</script>

<template>
  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
    <!-- 日均消息 -->
    <StatCard :label="t('dailyAvgMessages')" :value="t('messagesCount', { count: dailyAvgMessages })" icon="📊" icon-bg="blue">
      <template #subtext>
        <span class="text-sm text-gray-500">{{ t('daysCount', { count: durationDays }) }}</span>
      </template>
    </StatCard>

    <!-- 图片/表情 -->
    <StatCard :label="t('imageMessages')" :value="t('imagesCount', { count: imageCount })" icon="📸" icon-bg="pink">
      <template #subtext>
        <span class="text-sm text-gray-500">{{ t('peakHour') }}</span>
        <span class="font-semibold text-pink-500">{{ peakHour?.hour || 0 }}:00</span>
      </template>
    </StatCard>

    <!-- 最活跃星期 -->
    <StatCard
      :label="t('mostActiveWeekday')"
      :value="peakWeekday ? weekdayNames[peakWeekday.weekday - 1] : '-'"
      icon="📅"
      icon-bg="amber"
    >
      <template #subtext>
        <span class="text-sm text-gray-500">{{ t('messagesOnDay', { count: peakWeekday?.messageCount ?? 0 }) }}</span>
      </template>
    </StatCard>

    <!-- 周末活跃度 -->
    <StatCard :label="t('weekendActivity')" :value="`${weekdayVsWeekend.weekend}%`" icon="🏖️" icon-bg="green">
      <template #subtext>
        <span class="text-sm text-gray-500">{{ t('weekendRatio') }}</span>
      </template>
    </StatCard>

    <!-- 最活跃日期 -->
    <StatCard :label="t('mostActiveDate')" :value="peakDay ? dayjs(peakDay.date).format('MM/DD') : '-'" icon="🔥" icon-bg="red">
      <template #subtext>
        <span class="text-sm text-gray-500">{{ t('messagesOnDay', { count: peakDay?.messageCount ?? 0 }) }}</span>
      </template>
    </StatCard>

    <!-- 活跃天数 -->
    <StatCard :label="t('activeDays')" :value="`${activeDays}`" icon="📆" icon-bg="blue">
      <template #subtext>
        <span class="text-sm text-gray-500">{{ t('slashDays', { count: totalDays }) }}</span>
      </template>
    </StatCard>

    <!-- 连续打卡 -->
    <StatCard :label="t('consecutiveStreak')" :value="t('daysStreak', { count: maxConsecutiveDays })" icon="⚡" icon-bg="amber">
      <template #subtext>
        <span class="text-sm text-gray-500">{{ t('longestStreak') }}</span>
      </template>
    </StatCard>

    <!-- 活跃率 -->
    <StatCard :label="t('activityRate')" :value="`${activeRate}%`" icon="📈" icon-bg="gray">
      <template #subtext>
        <span class="text-sm text-gray-500">{{ t('activeDaysRatio') }}</span>
      </template>
    </StatCard>
  </div>
</template>

<i18n>
{
  "zh-CN": {
    "dailyAvgMessages": "日均消息",
    "messagesCount": "{count} 条",
    "daysCount": "共 {count} 天",
    "imageMessages": "图片消息",
    "imagesCount": "{count} 张",
    "peakHour": "最活跃时段:",
    "mostActiveWeekday": "最活跃星期",
    "messagesOnDay": "{count} 条消息",
    "weekendActivity": "周末活跃度",
    "weekendRatio": "周末消息占比",
    "mostActiveDate": "最活跃日期",
    "activeDays": "活跃天数",
    "slashDays": "/ {count} 天",
    "consecutiveStreak": "连续打卡",
    "daysStreak": "{count} 天",
    "longestStreak": "最长连续活跃",
    "activityRate": "活跃率",
    "activeDaysRatio": "有消息的天数占比"
  },
  "en-US": {
    "dailyAvgMessages": "Daily Avg Messages",
    "messagesCount": "{count} msgs",
    "daysCount": "{count} days total",
    "imageMessages": "Image Messages",
    "imagesCount": "{count} images",
    "peakHour": "Peak hour:",
    "mostActiveWeekday": "Most Active Day",
    "messagesOnDay": "{count} messages",
    "weekendActivity": "Weekend Activity",
    "weekendRatio": "Weekend message ratio",
    "mostActiveDate": "Most Active Date",
    "activeDays": "Active Days",
    "slashDays": "/ {count} days",
    "consecutiveStreak": "Streak",
    "daysStreak": "{count} days",
    "longestStreak": "Longest active streak",
    "activityRate": "Activity Rate",
    "activeDaysRatio": "Days with messages"
  }
}
</i18n>
