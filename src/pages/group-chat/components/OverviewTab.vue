<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AnalysisSession, MessageType } from '@/types/base'
import { getMessageTypeName } from '@/types/base'
import type {
  MemberActivity,
  HourlyActivity,
  DailyActivity,
  WeekdayActivity,
  MonthlyActivity,
} from '@/types/analysis'
import { DoughnutChart } from '@/components/charts'
import type { DoughnutChartData } from '@/components/charts'
import { SectionCard } from '@/components/UI'
import { useOverviewStatistics } from '@/composables/analysis/useOverviewStatistics'
import { useDailyTrend } from '@/composables/analysis/useDailyTrend'
import OverviewStatCards from '@/components/analysis/Overview/OverviewStatCards.vue'
import OverviewIdentityCard from '@/components/analysis/Overview/OverviewIdentityCard.vue'
import ActivityTimeDistribution from '@/components/analysis/Overview/ActivityTimeDistribution.vue'
import DailyTrendCard from '@/components/analysis/Overview/DailyTrendCard.vue'

const { t } = useI18n()

const props = defineProps<{
  session: AnalysisSession
  memberActivity: MemberActivity[]
  topMembers: MemberActivity[]
  bottomMembers: MemberActivity[]
  messageTypes: Array<{ type: MessageType; count: number }>
  hourlyActivity: HourlyActivity[]
  dailyActivity: DailyActivity[]
  timeRange: { start: number; end: number } | null
  selectedYear: number | null
  filteredMessageCount: number
  filteredMemberCount: number
  timeFilter?: { startTs?: number; endTs?: number }
}>()

// 星期活跃度数据
const weekdayActivity = ref<WeekdayActivity[]>([])
const isLoadingWeekday = ref(false)

// 使用 Composables
const {
  durationDays,
  dailyAvgMessages,
  totalDurationDays,
  totalDailyAvgMessages,
  imageCount,
  peakHour,
  peakWeekday,
  weekdayNames,
  weekdayVsWeekend,
  peakDay,
  activeDays,
  totalDays,
  activeRate,
  maxConsecutiveDays,
} = useOverviewStatistics(props, weekdayActivity)

const { dailyChartData } = useDailyTrend(props.dailyActivity)

// 消息类型图表数据
const typeChartData = computed<DoughnutChartData>(() => {
  return {
    labels: props.messageTypes.map((t) => getMessageTypeName(t.type)),
    values: props.messageTypes.map((t) => t.count),
  }
})

// 成员水群分布图表数据
const memberChartData = computed<DoughnutChartData>(() => {
  const sortedMembers = [...props.memberActivity].sort((a, b) => b.messageCount - a.messageCount)
  const top10 = sortedMembers.slice(0, 10)
  const othersCount = sortedMembers.slice(10).reduce((sum, m) => sum + m.messageCount, 0)

  const labels = top10.map((m) => m.name)
  const values = top10.map((m) => m.messageCount)

  if (othersCount > 0) {
    labels.push(t('others'))
    values.push(othersCount)
  }

  return {
    labels,
    values,
  }
})

// 月份活跃度数据
const monthlyActivity = ref<MonthlyActivity[]>([])
const isLoadingMonthly = ref(false)

// 加载星期活跃度数据
async function loadWeekdayActivity() {
  if (!props.session.id) return
  isLoadingWeekday.value = true
  try {
    weekdayActivity.value = await window.chatApi.getWeekdayActivity(props.session.id, props.timeFilter)
  } catch (error) {
    console.error('加载星期活跃度失败:', error)
  } finally {
    isLoadingWeekday.value = false
  }
}

// 加载月份活跃度数据
async function loadMonthlyActivity() {
  if (!props.session.id) return
  isLoadingMonthly.value = true
  try {
    monthlyActivity.value = await window.chatApi.getMonthlyActivity(props.session.id, props.timeFilter)
  } catch (error) {
    console.error('加载月份活跃度失败:', error)
  } finally {
    isLoadingMonthly.value = false
  }
}

// 监听 session.id 和 timeFilter 变化
watch(
  () => [props.session.id, props.timeFilter],
  () => {
    loadWeekdayActivity()
    loadMonthlyActivity()
  },
  { immediate: true, deep: true }
)
</script>

<template>
  <div class="main-content space-y-6 p-6">
    <!-- 群聊身份卡 -->
    <OverviewIdentityCard
      :session="session"
      :total-duration-days="totalDurationDays"
      :total-daily-avg-messages="totalDailyAvgMessages"
    />

    <!-- 关键指标卡片 -->
    <OverviewStatCards
      :daily-avg-messages="dailyAvgMessages"
      :duration-days="durationDays"
      :image-count="imageCount"
      :peak-hour="peakHour"
      :peak-weekday="peakWeekday"
      :weekday-names="weekdayNames"
      :weekday-vs-weekend="weekdayVsWeekend"
      :peak-day="peakDay"
      :active-days="activeDays"
      :total-days="totalDays"
      :active-rate="activeRate"
      :max-consecutive-days="maxConsecutiveDays"
    />

    <!-- 图表区域：消息类型 & 成员分布 -->
    <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <!-- 消息类型分布 -->
      <SectionCard :title="t('messageTypeDistribution')" :show-divider="false">
        <div class="p-5">
          <DoughnutChart :data="typeChartData" :height="256" />
        </div>
      </SectionCard>

      <!-- 成员水群分布 -->
      <SectionCard :title="t('memberDistribution')" :show-divider="false">
        <div class="p-5">
          <DoughnutChart :data="memberChartData" :height="256" />
        </div>
      </SectionCard>
    </div>

    <!-- 时间分布图表 -->
    <ActivityTimeDistribution
      :hourly-activity="hourlyActivity"
      :weekday-activity="weekdayActivity"
      :monthly-activity="monthlyActivity"
      :is-loading-weekday="isLoadingWeekday"
      :is-loading-monthly="isLoadingMonthly"
      :weekday-names="weekdayNames"
      :weekday-vs-weekend="weekdayVsWeekend"
    />

    <!-- 每日消息趋势 -->
    <DailyTrendCard :daily-activity="dailyActivity" :daily-chart-data="dailyChartData" />
  </div>
</template>

<i18n>
{
  "zh-CN": {
    "messageTypeDistribution": "消息类型分布",
    "memberDistribution": "成员水群分布",
    "others": "其他人"
  },
  "en-US": {
    "messageTypeDistribution": "Message Type Distribution",
    "memberDistribution": "Member Activity Distribution",
    "others": "Others"
  }
}
</i18n>
