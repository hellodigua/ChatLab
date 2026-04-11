<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDark } from '@vueuse/core'
import * as echarts from 'echarts/core'
import { PieChart, BarChart } from 'echarts/charts'
import { TooltipComponent, GridComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { ThemeCard } from '@/components/UI'
import { MessageType, getMessageTypeName } from './types'
import type { MessageTypeCount, HourlyActivity, WeekdayActivity, DailyActivity, TextStats } from './types'
import { queryLongMessageCount } from './queries'
import dayjs from 'dayjs'

echarts.use([PieChart, BarChart, TooltipComponent, GridComponent, CanvasRenderer])

const { t } = useI18n()
const isDark = useDark()

interface TimeFilter {
  startTs?: number
  endTs?: number
  memberId?: number | null
}

const props = defineProps<{
  sessionId: string
  sessionName: string
  messageTypes: MessageTypeCount[]
  hourlyActivity: HourlyActivity[]
  weekdayActivity: WeekdayActivity[]
  dailyActivity: DailyActivity[]
  textStats: TextStats
  timeFilter?: TimeFilter
}>()

const weekdayNames = computed(() => [
  t('common.weekday.mon'),
  t('common.weekday.tue'),
  t('common.weekday.wed'),
  t('common.weekday.thu'),
  t('common.weekday.fri'),
  t('common.weekday.sat'),
  t('common.weekday.sun'),
])

// ==================== 核心数字 ====================

const totalMessages = computed(() => props.messageTypes.reduce((sum, item) => sum + item.count, 0))

const mediaRatio = computed(() => {
  if (totalMessages.value === 0) return 0
  const nonText = totalMessages.value - (props.messageTypes.find((m) => m.type === MessageType.TEXT)?.count ?? 0)
  return Math.round((nonText / totalMessages.value) * 100)
})

// ==================== 小作文爱好者（可调阈值） ====================

const essayThreshold = ref(30)
const essayCount = ref(0)
const isEssayLoading = ref(false)

const essayThresholdOptions = [
  { label: '20', value: 20 },
  { label: '30', value: 30 },
  { label: '50', value: 50 },
  { label: '80', value: 80 },
  { label: '100', value: 100 },
]

const essayThresholdModel = computed({
  get: () => essayThreshold.value,
  set: (val: number) => {
    if (essayThreshold.value === val) return
    essayThreshold.value = val
    loadEssayCount()
  },
})

async function loadEssayCount() {
  if (!props.sessionId) return
  isEssayLoading.value = true
  try {
    essayCount.value = await queryLongMessageCount(props.sessionId, props.timeFilter, essayThreshold.value)
  } catch (error) {
    console.error('[chart-message] Failed to load essay count:', error)
  } finally {
    isEssayLoading.value = false
  }
}

watch(
  () => [props.sessionId, props.timeFilter],
  () => loadEssayCount(),
  { immediate: true, deep: true }
)

// ==================== 短消息达人 ====================

const shortRatio = computed(() => {
  if (props.textStats.textCount === 0) return 0
  return Math.round((props.textStats.shortCount / props.textStats.textCount) * 100)
})

// ==================== 媒体丰富度 ====================

function getTypeCount(type: MessageType): number {
  return props.messageTypes.find((m) => m.type === type)?.count ?? 0
}

const mediaItems = computed(() => [
  { label: t('views.message.profile.images'), count: getTypeCount(MessageType.IMAGE) },
  { label: t('views.message.profile.emoji'), count: getTypeCount(MessageType.EMOJI) },
  { label: t('views.message.profile.voiceVideo'), count: getTypeCount(MessageType.VOICE) + getTypeCount(MessageType.VIDEO) },
])

// ==================== 巅峰记录 ====================

const peakDay = computed(() => {
  if (props.dailyActivity.length === 0) return null
  return props.dailyActivity.reduce((max, d) => (d.messageCount > max.messageCount ? d : max), props.dailyActivity[0])
})

// ==================== 最活跃时段 TOP3 ====================

const topHours = computed(() => {
  if (props.hourlyActivity.length === 0) return []
  return [...props.hourlyActivity]
    .sort((a, b) => b.messageCount - a.messageCount)
    .slice(0, 3)
})

// ==================== 文字表达力 ====================

const textExpressionValue = computed(() =>
  t('views.message.profile.avgLengthUnit', { count: props.textStats.avgLength || 0 })
)
const textExpressionDesc = computed(() => {
  if (props.textStats.maxLength > 0) {
    return t('views.message.profile.textExpressionDesc', { count: props.textStats.maxLength })
  }
  return ''
})

// ==================== 聊天时间跨度 ====================

const dateRange = computed(() => {
  if (props.dailyActivity.length === 0) return { first: '', last: '' }
  const sorted = [...props.dailyActivity].sort((a, b) => a.date.localeCompare(b.date))
  return {
    first: dayjs(sorted[0].date).format('YYYY/MM/DD'),
    last: dayjs(sorted[sorted.length - 1].date).format('YYYY/MM/DD'),
  }
})

// ==================== 指标卡片数据 ====================

interface MetricItem {
  icon: string
  label: string
  value: string
  subtext: string
  colorClass: string
  slot?: string
}

const metricItems = computed<MetricItem[]>(() => [
  {
    icon: 'i-heroicons-pencil-square',
    label: t('views.message.profile.textExpression'),
    value: textExpressionValue.value,
    subtext: textExpressionDesc.value,
    colorClass: 'text-violet-600 dark:text-violet-400',
  },
  {
    icon: 'i-heroicons-chat-bubble-bottom-center-text',
    label: t('views.message.profile.shortMaster'),
    value: `${shortRatio.value}%`,
    subtext: t('views.message.profile.shortMasterDesc', { count: props.textStats.shortCount }),
    colorClass: 'text-emerald-600 dark:text-emerald-400',
  },
  {
    icon: 'i-heroicons-document-text',
    label: t('views.message.profile.essayLover'),
    value: essayCount.value.toLocaleString(),
    subtext: t('views.message.profile.essayLoverDesc', { threshold: essayThreshold.value }),
    colorClass: 'text-indigo-600 dark:text-indigo-400',
    slot: 'essay-threshold',
  },
  {
    icon: 'i-heroicons-photo',
    label: t('views.message.profile.mediaRichness'),
    value: `${mediaRatio.value}%`,
    subtext: mediaItems.value
      .filter((m) => m.count > 0)
      .map((m) => `${m.label} ${m.count}`)
      .join(' · ') || '-',
    colorClass: 'text-pink-600 dark:text-pink-400',
  },
  {
    icon: 'i-heroicons-fire',
    label: t('views.message.profile.peakRecord'),
    value: peakDay.value ? dayjs(peakDay.value.date).format('MM/DD') : '-',
    subtext: peakDay.value
      ? t('views.message.profile.peakRecordDesc', { count: peakDay.value.messageCount })
      : '',
    colorClass: 'text-red-600 dark:text-red-400',
  },
  {
    icon: 'i-heroicons-clock',
    label: t('views.message.profile.topHours'),
    value: topHours.value.length > 0 ? `${topHours.value[0].hour}:00` : '-',
    subtext: topHours.value.length >= 2
      ? topHours.value.map((h) => `${h.hour}:00`).join(' > ')
      : '',
    colorClass: 'text-cyan-600 dark:text-cyan-400',
  },
])

// ==================== 迷你环形图 ====================

const donutRef = ref<HTMLElement | null>(null)
let donutInstance: echarts.ECharts | null = null

const typeColors = [
  '#6366f1', '#ec4899', '#f97316', '#22c55e', '#06b6d4',
  '#8b5cf6', '#f43f5e', '#eab308', '#14b8a6', '#3b82f6',
]

const donutData = computed(() => {
  const sorted = [...props.messageTypes].sort((a, b) => b.count - a.count)
  return sorted.slice(0, 6).map((item, i) => ({
    name: getMessageTypeName(item.type, t),
    value: item.count,
    itemStyle: { color: typeColors[i % typeColors.length] },
  }))
})

function initDonut() {
  if (!donutRef.value) return
  donutInstance = echarts.init(donutRef.value, undefined, { renderer: 'canvas' })
  updateDonut()
}

function updateDonut() {
  if (!donutInstance) return
  donutInstance.setOption(
    {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      series: [
        {
          type: 'pie',
          radius: ['50%', '78%'],
          center: ['50%', '50%'],
          avoidLabelOverlap: false,
          padAngle: 2,
          itemStyle: { borderRadius: 4 },
          label: { show: false },
          emphasis: { label: { show: false }, scaleSize: 4 },
          data: donutData.value,
        },
      ],
    },
    { notMerge: true }
  )
}

// ==================== 24h 迷你柱状图 ====================

const barRef = ref<HTMLElement | null>(null)
let barInstance: echarts.ECharts | null = null

function initBar() {
  barInstance = echarts.init(barRef.value, undefined, { renderer: 'canvas' })
  updateBar()
}

function updateBar() {
  if (!barInstance) return

  const hourMap = new Map(props.hourlyActivity.map((h) => [h.hour, h.messageCount]))
  const data: number[] = []
  for (let i = 0; i < 24; i++) data.push(hourMap.get(i) || 0)

  const maxVal = Math.max(...data, 1)
  const barColors = data.map((v) => {
    const ratio = v / maxVal
    if (ratio > 0.8) return isDark.value ? '#f472b6' : '#ec4899'
    if (ratio > 0.5) return isDark.value ? '#a78bfa' : '#8b5cf6'
    return isDark.value ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.08)'
  })

  barInstance.setOption(
    {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => `${params[0].axisValue}:00 — ${params[0].value}`,
      },
      grid: { left: 0, right: 0, top: 4, bottom: 16 },
      xAxis: {
        type: 'category',
        data: Array.from({ length: 24 }, (_, i) => `${i}`),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          fontSize: 9,
          color: isDark.value ? '#6b7280' : '#9ca3af',
          interval: (idx: number) => idx % 6 === 0,
        },
      },
      yAxis: { type: 'value', show: false },
      series: [
        {
          type: 'bar',
          data: data.map((v, i) => ({ value: v, itemStyle: { color: barColors[i] } })),
          barWidth: '60%',
          itemStyle: { borderRadius: [2, 2, 0, 0] },
        },
      ],
    },
    { notMerge: true }
  )
}

// ==================== 生命周期 ====================

function handleResize() {
  donutInstance?.resize()
  barInstance?.resize()
}

watch(() => props.messageTypes, () => {
  updateDonut()
  updateBar()
})

watch(() => props.hourlyActivity, () => updateBar())

watch(isDark, () => {
  donutInstance?.dispose()
  barInstance?.dispose()
  initDonut()
  initBar()
})

onMounted(() => {
  initDonut()
  initBar()
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  donutInstance?.dispose()
  barInstance?.dispose()
})
</script>

<template>
  <ThemeCard variant="elevated" decorative class="flex flex-col">
    <!-- 主视觉区域 -->
    <div class="relative z-10 px-6 pt-8 pb-4 sm:px-8">
      <div class="flex items-start gap-6 sm:gap-10">
        <!-- 左侧：叙事文字 + 核心数字 -->
        <div class="min-w-0 flex-1">
          <div class="flex flex-col text-[15px] leading-relaxed text-gray-600 dark:text-gray-300">
            <p class="mb-2 text-sm font-medium tracking-wide text-gray-500 dark:text-gray-400">
              {{ dateRange.first }} – {{ dateRange.last }}
            </p>

            <div class="mb-3 flex items-baseline gap-2">
              <span class="text-xl font-medium text-gray-700 dark:text-gray-300">
                {{ t('views.message.profile.heroLine1Prefix') }}
              </span>
              <span class="font-black text-5xl tracking-tight text-gray-900 dark:text-white">
                {{ totalMessages.toLocaleString() }}
              </span>
              <span class="text-xl font-medium text-gray-700 dark:text-gray-300">
                {{ t('views.message.profile.heroLine1Suffix') }}
              </span>
            </div>

            <div class="flex items-baseline flex-wrap gap-x-1.5 gap-y-1">
              <span class="text-base font-medium text-gray-600 dark:text-gray-300">
                {{ t('views.message.profile.heroLine2Prefix') }}
              </span>
              <span class="font-black text-3xl text-pink-500 dark:text-pink-400">
                {{ textStats.avgLength || 0 }}
              </span>
              <span class="text-base font-medium text-gray-600 dark:text-gray-300">
                {{ t('views.message.profile.heroLine2Middle') }}
              </span>
              <span class="font-bold text-xl text-gray-900 dark:text-white">
                {{ mediaRatio }}%
              </span>
              <span class="text-base font-medium text-gray-600 dark:text-gray-300">
                {{ t('views.message.profile.heroLine2Suffix') }}
              </span>
            </div>
          </div>
        </div>

        <!-- 右侧：环形图 + 24h 柱状图 并排 -->
        <div class="flex shrink-0 items-start gap-4">
          <div class="flex flex-col items-center">
            <div class="mb-1 text-[10px] font-bold text-gray-500 dark:text-gray-400">
              {{ t('views.message.profile.typeDistribution') }}
            </div>
            <div ref="donutRef" style="width: 110px; height: 110px;" />
          </div>
          <div class="flex flex-col items-center">
            <div class="mb-1 text-[10px] font-bold text-gray-500 dark:text-gray-400">
              {{ t('views.message.profile.hourlyDistribution') }}
            </div>
            <div ref="barRef" style="width: 180px; height: 100px;" />
          </div>
        </div>
      </div>
    </div>

    <!-- 指标卡片 -->
    <div class="relative z-10 px-6 pb-6 pt-4 sm:px-8">
      <div class="mb-3 flex items-center justify-between">
        <span class="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">
          Message Profile
        </span>
      </div>
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <div
          v-for="item in metricItems"
          :key="item.icon + item.label"
          class="flex items-start gap-2 rounded-lg bg-white/60 p-2.5 ring-1 ring-gray-900/5 dark:bg-white/5 dark:ring-white/10"
        >
          <UIcon :name="item.icon" class="mt-0.5 h-3.5 w-3.5 shrink-0" :class="item.colorClass" />
          <div class="min-w-0 flex-1">
            <div class="flex items-center justify-between gap-1">
              <div class="truncate font-mono text-sm font-black leading-tight tabular-nums" :class="item.colorClass">
                {{ item.value }}
              </div>
              <USelect
                v-if="item.slot === 'essay-threshold'"
                v-model="essayThresholdModel"
                :items="essayThresholdOptions"
                value-key="value"
                size="xs"
                class="relative z-120 w-16 shrink-0"
                :ui="{ content: 'z-[121]' }"
                :disabled="isEssayLoading"
              />
            </div>
            <div class="mt-0.5 truncate text-[10px] font-medium text-gray-500 dark:text-gray-400">
              {{ item.label }}
            </div>
            <div class="mt-0.5 truncate text-[9px] text-gray-400 dark:text-gray-500">
              {{ item.subtext }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 水印 -->
    <div
      class="relative z-10 flex items-center justify-between px-6 pb-4 opacity-40 mix-blend-luminosity dark:opacity-30 sm:px-8 sm:pb-5"
    >
      <div class="flex items-center gap-1.5">
        <UIcon name="i-heroicons-chat-bubble-left-right-solid" class="h-3.5 w-3.5" />
        <span class="text-[10px] font-bold uppercase tracking-wider">ChatLab</span>
      </div>
      <span class="text-[9px] font-medium uppercase tracking-widest">
        {{ t('views.message.profile.watermark') }}
      </span>
    </div>
  </ThemeCard>
</template>
