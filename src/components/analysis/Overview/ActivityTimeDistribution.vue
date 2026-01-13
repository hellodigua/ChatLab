<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { HourlyActivity, WeekdayActivity, MonthlyActivity } from '@/types/analysis'
import { BarChart } from '@/components/charts'
import type { BarChartData } from '@/components/charts'
import { SectionCard } from '@/components/UI'

const { t, locale } = useI18n()

const props = defineProps<{
  hourlyActivity: HourlyActivity[]
  weekdayActivity: WeekdayActivity[]
  monthlyActivity: MonthlyActivity[]
  isLoadingWeekday: boolean
  isLoadingMonthly: boolean
  weekdayNames: string[]
  weekdayVsWeekend: { weekday: number; weekend: number }
}>()

// --- 24小时分布逻辑 ---
// 24小时分布图数据
const hourlyChartData = computed<BarChartData>(() => {
  return {
    labels: props.hourlyActivity.map((h) => `${h.hour}:00`),
    values: props.hourlyActivity.map((h) => h.messageCount),
  }
})

// 时段占比计算
const totalMessages = computed(() => props.hourlyActivity.reduce((sum, h) => sum + h.messageCount, 0))

const lateNightRatio = computed(() => {
  const lateNight = props.hourlyActivity
    .filter((h) => h.hour >= 0 && h.hour < 6)
    .reduce((sum, h) => sum + h.messageCount, 0)
  return totalMessages.value > 0 ? Math.round((lateNight / totalMessages.value) * 100) : 0
})

const morningRatio = computed(() => {
  const morning = props.hourlyActivity
    .filter((h) => h.hour >= 6 && h.hour < 12)
    .reduce((sum, h) => sum + h.messageCount, 0)
  return totalMessages.value > 0 ? Math.round((morning / totalMessages.value) * 100) : 0
})

const afternoonRatio = computed(() => {
  const afternoon = props.hourlyActivity
    .filter((h) => h.hour >= 12 && h.hour < 18)
    .reduce((sum, h) => sum + h.messageCount, 0)
  return totalMessages.value > 0 ? Math.round((afternoon / totalMessages.value) * 100) : 0
})

const eveningRatio = computed(() => {
  const evening = props.hourlyActivity
    .filter((h) => h.hour >= 18 && h.hour < 24)
    .reduce((sum, h) => sum + h.messageCount, 0)
  return totalMessages.value > 0 ? Math.round((evening / totalMessages.value) * 100) : 0
})

// --- 星期分布逻辑 ---
// 星期分布图数据
const weekdayChartData = computed<BarChartData>(() => {
  return {
    labels: props.weekdayActivity.map((w) => props.weekdayNames[w.weekday - 1]),
    values: props.weekdayActivity.map((w) => w.messageCount),
  }
})

// --- 月份分布逻辑 ---
// 月份分布图数据
const monthlyChartData = computed<BarChartData>(() => {
  return {
    labels: props.monthlyActivity.map((m) => {
      // 中文用 X月，英文用 Jan, Feb 等
      if (locale.value === 'zh-CN') {
        return `${m.month}月`
      }
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      return monthNames[m.month - 1] || `${m.month}`
    }),
    values: props.monthlyActivity.map((m) => m.messageCount),
  }
})
</script>

<template>
  <div class="grid grid-cols-1 gap-6 lg:grid-cols-2 2xl:grid-cols-3">
    <!-- 24小时分布 -->
    <SectionCard :title="t('hourlyTitle')" :show-divider="false">
      <div class="p-5">
        <BarChart
          :data="hourlyChartData"
          :height="256"
          :x-label-filter="(_, index) => (index % 3 === 0 ? `${index}:00` : '')"
        />

        <div class="mt-6 grid grid-cols-4 gap-2">
          <div class="text-center">
            <div class="text-xs text-gray-500 dark:text-gray-400">{{ t('lateNight') }}</div>
            <div class="mt-1 text-base font-semibold text-gray-900 dark:text-white">{{ lateNightRatio }}%</div>
            <div class="mx-auto mt-1 h-1 w-full max-w-12 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
              <div class="h-full rounded-full bg-pink-300 transition-all" :style="{ width: `${lateNightRatio}%` }" />
            </div>
          </div>
          <div class="text-center">
            <div class="text-xs text-gray-500 dark:text-gray-400">{{ t('morning') }}</div>
            <div class="mt-1 text-base font-semibold text-gray-900 dark:text-white">{{ morningRatio }}%</div>
            <div class="mx-auto mt-1 h-1 w-full max-w-12 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
              <div class="h-full rounded-full bg-pink-400 transition-all" :style="{ width: `${morningRatio}%` }" />
            </div>
          </div>
          <div class="text-center">
            <div class="text-xs text-gray-500 dark:text-gray-400">{{ t('afternoon') }}</div>
            <div class="mt-1 text-base font-semibold text-gray-900 dark:text-white">{{ afternoonRatio }}%</div>
            <div class="mx-auto mt-1 h-1 w-full max-w-12 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
              <div class="h-full rounded-full bg-pink-500 transition-all" :style="{ width: `${afternoonRatio}%` }" />
            </div>
          </div>
          <div class="text-center">
            <div class="text-xs text-gray-500 dark:text-gray-400">{{ t('evening') }}</div>
            <div class="mt-1 text-base font-semibold text-gray-900 dark:text-white">{{ eveningRatio }}%</div>
            <div class="mx-auto mt-1 h-1 w-full max-w-12 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
              <div class="h-full rounded-full bg-pink-600 transition-all" :style="{ width: `${eveningRatio}%` }" />
            </div>
          </div>
        </div>
      </div>
    </SectionCard>

    <!-- 星期分布 -->
    <SectionCard :title="t('weekdayTitle')" :show-divider="false">
      <div class="p-5">
        <div v-if="isLoadingWeekday" class="flex h-64 items-center justify-center">
          <UIcon name="i-heroicons-arrow-path" class="h-6 w-6 animate-spin text-pink-500" />
        </div>
        <template v-else>
          <BarChart :data="weekdayChartData" :height="256" />

          <div class="mt-6 grid grid-cols-2 gap-4">
            <div class="text-center">
              <div class="text-xs text-gray-500 dark:text-gray-400">{{ t('weekdays') }}</div>
              <div class="mt-1 text-lg font-semibold text-gray-900 dark:text-white">
                {{ weekdayVsWeekend.weekday }}%
              </div>
              <div class="mx-auto mt-2 h-1 w-full max-w-24 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                <div
                  class="h-full rounded-full bg-pink-500 transition-all"
                  :style="{ width: `${weekdayVsWeekend.weekday}%` }"
                />
              </div>
            </div>
            <div class="text-center">
              <div class="text-xs text-gray-500 dark:text-gray-400">{{ t('weekend') }}</div>
              <div class="mt-1 text-lg font-semibold text-gray-900 dark:text-white">
                {{ weekdayVsWeekend.weekend }}%
              </div>
              <div class="mx-auto mt-2 h-1 w-full max-w-24 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                <div
                  class="h-full rounded-full bg-blue-500 transition-all"
                  :style="{ width: `${weekdayVsWeekend.weekend}%` }"
                />
              </div>
            </div>
          </div>
        </template>
      </div>
    </SectionCard>

    <!-- 月份活跃分布 -->
    <SectionCard :title="t('monthlyTitle')" :show-divider="false">
      <div class="p-5">
        <div v-if="isLoadingMonthly" class="flex h-64 items-center justify-center">
          <UIcon name="i-heroicons-arrow-path" class="h-6 w-6 animate-spin text-pink-500" />
        </div>
        <BarChart v-else :data="monthlyChartData" :height="256" />
      </div>
    </SectionCard>
  </div>
</template>

<i18n>
{
  "zh-CN": {
    "hourlyTitle": "24小时活跃分布",
    "lateNight": "凌晨",
    "morning": "上午",
    "afternoon": "下午",
    "evening": "晚上",
    "weekdayTitle": "星期活跃分布",
    "weekdays": "工作日",
    "weekend": "周末",
    "monthlyTitle": "月份活跃分布"
  },
  "en-US": {
    "hourlyTitle": "24-Hour Activity",
    "lateNight": "Late Night",
    "morning": "Morning",
    "afternoon": "Afternoon",
    "evening": "Evening",
    "weekdayTitle": "Weekly Activity",
    "weekdays": "Weekdays",
    "weekend": "Weekend",
    "monthlyTitle": "Monthly Activity"
  }
}
</i18n>
