<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { DailyActivity, DivingAnalysis } from '@/types/chat'
import dayjs from 'dayjs'
import { LineChart } from '@/components/charts'
import type { LineChartData } from '@/components/charts'

interface TimeFilter {
  startTs?: number
  endTs?: number
}

const props = defineProps<{
  sessionId: string
  dailyActivity: DailyActivity[]
  timeRange: { start: number; end: number } | null
  timeFilter?: TimeFilter
}>()

// 检测是否跨年
const isMultiYear = computed(() => {
  if (props.dailyActivity.length < 2) return false
  const years = new Set(props.dailyActivity.map((d) => dayjs(d.date).year()))
  return years.size > 1
})

// 每日趋势图数据
const dailyChartData = computed<LineChartData>(() => {
  // 如果跨年，显示年份；否则只显示月/日
  const dateFormat = isMultiYear.value ? 'YYYY/MM/DD' : 'MM/DD'

  return {
    labels: props.dailyActivity.map((d) => dayjs(d.date).format(dateFormat)),
    values: props.dailyActivity.map((d) => d.messageCount),
  }
})

// 最活跃的一天
const peakDay = computed(() => {
  if (!props.dailyActivity.length) return null
  return props.dailyActivity.reduce((max, d) => (d.messageCount > max.messageCount ? d : max), props.dailyActivity[0])
})

// 平均每日消息数
const avgDailyMessages = computed(() => {
  if (!props.dailyActivity.length) return 0
  const total = props.dailyActivity.reduce((sum, d) => sum + d.messageCount, 0)
  return Math.round(total / props.dailyActivity.length)
})

// 活跃天数
const activeDays = computed(() => {
  return props.dailyActivity.filter((d) => d.messageCount > 0).length
})

// 总天数（从第一条到最后一条消息）
const totalDays = computed(() => {
  if (!props.timeRange) return 0
  const start = dayjs.unix(props.timeRange.start)
  const end = dayjs.unix(props.timeRange.end)
  return end.diff(start, 'day') + 1
})

// ==================== 潜水分析 ====================
const divingAnalysis = ref<DivingAnalysis | null>(null)
const isLoadingDiving = ref(false)

// 加载潜水分析数据
async function loadDivingAnalysis() {
  if (!props.sessionId) return

  isLoadingDiving.value = true
  try {
    divingAnalysis.value = await window.chatApi.getDivingAnalysis(props.sessionId, props.timeFilter)
  } catch (error) {
    console.error('加载潜水分析失败:', error)
  } finally {
    isLoadingDiving.value = false
  }
}

// 格式化最后发言时间（精确到时分秒）
function formatLastMessageTime(ts: number): string {
  return dayjs.unix(ts).format('YYYY-MM-DD HH:mm:ss')
}

// 格式化天数显示
function formatDaysSince(days: number): string {
  if (days === 0) return '今天'
  if (days === 1) return '昨天'
  if (days < 30) return `${days} 天前`
  if (days < 365) return `${Math.floor(days / 30)} 个月前`
  return `${Math.floor(days / 365)} 年前`
}

// 监听 sessionId 和 timeFilter 变化
watch(
  () => [props.sessionId, props.timeFilter],
  () => {
    loadDivingAnalysis()
  },
  { immediate: true, deep: true }
)
</script>

<template>
  <div class="space-y-6">
    <!-- 标题 -->
    <div>
      <h2 class="text-xl font-bold text-gray-900 dark:text-white">时间轴分析</h2>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">追踪群聊的活跃趋势变化</p>
    </div>

    <!-- 统计卡片 -->
    <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <div class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <p class="text-xs font-medium text-gray-500 dark:text-gray-400">最活跃日期</p>
        <p class="mt-1 text-2xl font-bold text-pink-600 dark:text-pink-400">
          {{ peakDay ? dayjs(peakDay.date).format('MM/DD') : '-' }}
        </p>
        <p class="mt-1 text-xs text-gray-400">{{ peakDay?.messageCount ?? 0 }} 条消息</p>
      </div>

      <div class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <p class="text-xs font-medium text-gray-500 dark:text-gray-400">日均消息</p>
        <p class="mt-1 text-2xl font-bold text-pink-600 dark:text-pink-400">
          {{ avgDailyMessages }}
        </p>
        <p class="mt-1 text-xs text-gray-400">条/天</p>
      </div>

      <div class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <p class="text-xs font-medium text-gray-500 dark:text-gray-400">活跃天数</p>
        <p class="mt-1 text-2xl font-bold text-pink-600 dark:text-pink-400">
          {{ activeDays }}
        </p>
        <p class="mt-1 text-xs text-gray-400">/ {{ totalDays }} 天</p>
      </div>

      <div class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <p class="text-xs font-medium text-gray-500 dark:text-gray-400">活跃率</p>
        <p class="mt-1 text-2xl font-bold text-pink-600 dark:text-pink-400">
          {{ totalDays > 0 ? Math.round((activeDays / totalDays) * 100) : 0 }}%
        </p>
        <p class="mt-1 text-xs text-gray-400">有消息的天数占比</p>
      </div>
    </div>

    <!-- 每日趋势 -->
    <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <h3 class="mb-4 font-semibold text-gray-900 dark:text-white">每日消息趋势</h3>
      <LineChart :data="dailyChartData" :height="288" />
    </div>

    <!-- 潜水排名 -->
    <div class="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div class="border-b border-gray-200 px-5 py-4 dark:border-gray-800">
        <h3 class="font-semibold text-gray-900 dark:text-white">🤿 潜水排名</h3>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          按最后发言时间排序，最久没发言的在前面
        </p>
      </div>

      <div v-if="isLoadingDiving" class="px-5 py-8 text-center text-sm text-gray-400">
        正在统计潜水数据...
      </div>

      <div
        v-else-if="divingAnalysis && divingAnalysis.rank.length > 0"
        class="divide-y divide-gray-100 dark:divide-gray-800"
      >
        <div
          v-for="(member, index) in divingAnalysis.rank"
          :key="member.memberId"
          class="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50"
        >
          <!-- 排名 -->
          <div
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold"
            :class="
              index === 0
                ? 'bg-gradient-to-r from-blue-400 to-cyan-500 text-white'
                : index === 1
                  ? 'bg-gradient-to-r from-blue-300 to-cyan-400 text-white'
                  : index === 2
                    ? 'bg-gradient-to-r from-blue-200 to-cyan-300 text-gray-700'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
            "
          >
            {{ index + 1 }}
          </div>

          <!-- 名字 -->
          <div class="w-32 shrink-0">
            <p class="truncate font-medium text-gray-900 dark:text-white">
              {{ member.name }}
            </p>
          </div>

          <!-- 最后发言时间 -->
          <div class="flex flex-1 items-center gap-2">
            <span class="text-sm text-gray-600 dark:text-gray-400">
              {{ formatLastMessageTime(member.lastMessageTs) }}
            </span>
          </div>

          <!-- 距今天数 -->
          <div class="shrink-0 text-right">
            <span
              class="text-sm font-medium"
              :class="
                member.daysSinceLastMessage > 30
                  ? 'text-red-600 dark:text-red-400'
                  : member.daysSinceLastMessage > 7
                    ? 'text-orange-600 dark:text-orange-400'
                    : 'text-gray-600 dark:text-gray-400'
              "
            >
              {{ formatDaysSince(member.daysSinceLastMessage) }}
            </span>
          </div>
        </div>
      </div>

      <div v-else class="px-5 py-8 text-center text-sm text-gray-400">暂无数据</div>
    </div>
  </div>
</template>
