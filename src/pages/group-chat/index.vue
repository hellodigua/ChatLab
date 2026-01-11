<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import type { AnalysisSession, MessageType } from '@/types/base'
import type { MemberActivity, HourlyActivity, DailyActivity } from '@/types/analysis'
import { formatDateRange } from '@/utils'
import CaptureButton from '@/components/common/CaptureButton.vue'
import UITabs from '@/components/UI/Tabs.vue'
import AITab from '@/components/analysis/AITab.vue'
import OverviewTab from './components/OverviewTab.vue'
import RankingTab from './components/RankingTab.vue'
import QuotesTab from './components/QuotesTab.vue'
import MemberTab from './components/MemberTab.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import SessionIndexModal from '@/components/analysis/SessionIndexModal.vue'
import { useSessionStore } from '@/stores/session'
import { useLayoutStore } from '@/stores/layout'
import { isFeatureSupported, type LocaleType } from '@/i18n'

const { t, locale } = useI18n()

const route = useRoute()
const router = useRouter()
const sessionStore = useSessionStore()
const layoutStore = useLayoutStore()
const { currentSessionId } = storeToRefs(sessionStore)

// 会话索引弹窗状态
const showSessionIndexModal = ref(false)

// 打开聊天记录查看器
function openChatRecordViewer() {
  layoutStore.openChatRecordDrawer({})
}

// 数据状态
const isLoading = ref(true)
const session = ref<AnalysisSession | null>(null)
const memberActivity = ref<MemberActivity[]>([])
const hourlyActivity = ref<HourlyActivity[]>([])
const dailyActivity = ref<DailyActivity[]>([])
const messageTypes = ref<Array<{ type: MessageType; count: number }>>([])
const timeRange = ref<{ start: number; end: number } | null>(null)

// 年份筛选
const availableYears = ref<number[]>([])
const selectedYear = ref<number>(0) // 0 表示全部
const isInitialLoad = ref(true) // 用于跳过初始加载时的 watch 触发，并控制首屏加载状态

// Tab 配置（带语言限制）
const allTabs = [
  { id: 'overview', labelKey: 'analysis.tabs.overview', icon: 'i-heroicons-chart-pie' },
  { id: 'ranking', labelKey: 'analysis.tabs.ranking', icon: 'i-heroicons-trophy', feature: 'groupRanking' },
  { id: 'quotes', labelKey: 'analysis.tabs.groupQuotes', icon: 'i-heroicons-chat-bubble-bottom-center-text' },
  { id: 'members', labelKey: 'analysis.tabs.members', icon: 'i-heroicons-user-group' },
  { id: 'ai', labelKey: 'analysis.tabs.ai', icon: 'i-heroicons-sparkles' },
]

// 根据当前语言过滤 Tab
const tabs = computed(() =>
  allTabs.filter((tab) => !tab.feature || isFeatureSupported(tab.feature, locale.value as LocaleType))
)

const activeTab = ref((route.query.tab as string) || 'overview')

// 计算时间过滤参数
const timeFilter = computed(() => {
  if (selectedYear.value === 0) {
    return undefined
  }
  // 计算年份的开始和结束时间戳
  const startDate = new Date(selectedYear.value, 0, 1, 0, 0, 0)
  const endDate = new Date(selectedYear.value, 11, 31, 23, 59, 59)
  return {
    startTs: Math.floor(startDate.getTime() / 1000),
    endTs: Math.floor(endDate.getTime() / 1000),
  }
})

// 年份选项
const yearOptions = computed(() => {
  const options = [{ label: t('analysis.yearFilter.allTime'), value: 0 }]
  for (const year of availableYears.value) {
    options.push({ label: t('analysis.yearFilter.year', { year }), value: year })
  }
  return options
})

// 计算属性
const topMembers = computed(() => memberActivity.value.slice(0, 3))
const bottomMembers = computed(() => {
  if (memberActivity.value.length <= 1) return []
  return [...memberActivity.value].sort((a, b) => a.messageCount - b.messageCount).slice(0, 1)
})

// 当前筛选后的消息总数
const filteredMessageCount = computed(() => {
  return memberActivity.value.reduce((sum, m) => sum + m.messageCount, 0)
})

// 当前筛选后的活跃成员数
const filteredMemberCount = computed(() => {
  return memberActivity.value.filter((m) => m.messageCount > 0).length
})

// 格式化时间范围显示
const dateRangeText = computed(() => {
  if (selectedYear.value) {
    return t('analysis.yearFilter.year', { year: selectedYear.value })
  }
  if (!timeRange.value) return ''
  return formatDateRange(timeRange.value.start, timeRange.value.end)
})

// Sync route param to store
function syncSession() {
  const id = route.params.id as string
  if (id) {
    sessionStore.selectSession(id)
    // If selection failed (e.g. invalid ID), redirect to home
    if (sessionStore.currentSessionId !== id) {
      router.replace('/')
    }
  }
}

// 加载基础数据（不受年份筛选影响）
async function loadBaseData() {
  if (!currentSessionId.value) return

  try {
    const [sessionData, years, range] = await Promise.all([
      window.chatApi.getSession(currentSessionId.value),
      window.chatApi.getAvailableYears(currentSessionId.value),
      window.chatApi.getTimeRange(currentSessionId.value),
    ])

    session.value = sessionData
    availableYears.value = years
    timeRange.value = range

    // 初始化年份选择
    // 1. 优先使用 URL 参数中的年份
    // 2. 否则默认选择最近的年份（years 已按降序排列）
    // 3. 如果没有年份数据，选 0 (全部)
    const queryYear = Number(route.query.year)
    if (queryYear === 0 || (queryYear && years.includes(queryYear))) {
      selectedYear.value = queryYear
    } else if (years.length > 0) {
      selectedYear.value = years[0]
    } else {
      selectedYear.value = 0
    }
  } catch (error) {
    console.error('加载基础数据失败:', error)
  }
}

// 加载分析数据（受年份筛选影响）
async function loadAnalysisData() {
  if (!currentSessionId.value) return

  isLoading.value = true

  try {
    const filter = timeFilter.value

    const [members, hourly, daily, types] = await Promise.all([
      window.chatApi.getMemberActivity(currentSessionId.value, filter),
      window.chatApi.getHourlyActivity(currentSessionId.value, filter),
      window.chatApi.getDailyActivity(currentSessionId.value, filter),
      window.chatApi.getMessageTypeDistribution(currentSessionId.value, filter),
    ])

    memberActivity.value = members
    hourlyActivity.value = hourly
    dailyActivity.value = daily
    messageTypes.value = types
  } catch (error) {
    console.error('加载分析数据失败:', error)
  } finally {
    isLoading.value = false
  }
}

// 加载所有数据
async function loadData() {
  isInitialLoad.value = true
  await loadBaseData()
  await loadAnalysisData()
  isInitialLoad.value = false
}

// 监听路由参数变化
watch(
  () => route.params.id,
  () => {
    // 切换会话时，重置 activeTab 为默认值（如果 URL 中没有 tab 参数）
    // 注意：sidebar 导航通常会 push 新的 URL，不带 query 参数，所以这里会自动重置
    // 但为了保险，我们可以在这里强制重置，或者依赖 activeTab 的初始化逻辑（它只在组件创建时初始化）
    // 由于组件是复用的，我们需要手动处理
    if (!route.query.tab) {
      activeTab.value = 'overview'
    } else {
      activeTab.value = route.query.tab as string
    }
    syncSession()
  }
)

// 监听会话变化 (syncSession 会触发 currentSessionId 变化)
watch(
  currentSessionId,
  () => {
    // 年份筛选会在 loadBaseData 中自动设置为最近年份
    loadData()
  },
  { immediate: true }
)

// 监听年份筛选变化（仅用户手动切换年份时触发）
watch(selectedYear, () => {
  // 跳过初始加载时的触发，避免重复加载
  if (isInitialLoad.value) return
  loadAnalysisData()
})

// 同步状态到 URL
watch([activeTab, selectedYear], ([newTab, newYear]) => {
  // 避免在初始化过程中频繁更新 URL
  if (isInitialLoad.value) return

  router.replace({
    query: {
      ...route.query,
      tab: newTab,
      year: newYear,
    },
  })
})

onMounted(() => {
  syncSession()
  // loadData is triggered by currentSessionId watch
})
</script>

<template>
  <div class="flex h-full flex-col bg-gray-50 dark:bg-gray-950">
    <!-- Loading State -->
    <div v-if="isInitialLoad" class="flex h-full items-center justify-center">
      <div class="flex flex-col items-center justify-center text-center">
        <UIcon name="i-heroicons-arrow-path" class="h-8 w-8 animate-spin text-pink-500" />
        <p class="mt-2 text-sm text-gray-500">{{ t('analysis.groupChat.loading') }}</p>
      </div>
    </div>

    <!-- Content -->
    <template v-else-if="session">
      <!-- Header -->
      <PageHeader
        :title="session.name"
        :description="
          t('analysis.groupChat.description', {
            dateRange: dateRangeText,
            memberCount: selectedYear ? filteredMemberCount : session.memberCount,
            messageCount: selectedYear ? filteredMessageCount : session.messageCount,
          })
        "
        :avatar="session.groupAvatar"
        icon="i-heroicons-chat-bubble-left-right"
      >
        <template #actions>
          <UTooltip :text="t('analysis.tooltip.chatViewer')">
            <UButton
              icon="i-heroicons-chat-bubble-bottom-center-text"
              color="neutral"
              variant="ghost"
              size="sm"
              @click="openChatRecordViewer"
            />
          </UTooltip>
          <UTooltip :text="t('analysis.tooltip.sessionIndex')">
            <UButton
              icon="i-heroicons-clock"
              color="neutral"
              variant="ghost"
              size="sm"
              @click="showSessionIndexModal = true"
            />
          </UTooltip>
          <CaptureButton />
        </template>
        <!-- Tabs -->
        <div class="mt-4 flex items-center justify-between gap-4">
          <div class="flex shrink-0 items-center gap-1 overflow-x-auto scrollbar-hide">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all"
              :class="[
                activeTab === tab.id
                  ? 'bg-pink-500 text-white dark:bg-pink-900/30 dark:text-pink-300'
                  : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800',
              ]"
              @click="activeTab = tab.id"
            >
              <UIcon :name="tab.icon" class="h-4 w-4" />
              <span class="whitespace-nowrap">{{ t(tab.labelKey) }}</span>
            </button>
          </div>
          <!-- 年份选择器靠右，允许收缩（AI实验室时隐藏） -->
          <UITabs
            v-if="activeTab !== 'ai'"
            v-model="selectedYear"
            :items="yearOptions"
            size="sm"
            class="min-w-0 shrink"
          />
        </div>
      </PageHeader>

      <!-- Tab Content -->
      <div class="relative flex-1 overflow-y-auto">
        <!-- Loading Overlay -->
        <div
          v-if="isLoading"
          class="absolute inset-0 z-10 flex items-center justify-center bg-white/50 backdrop-blur-sm dark:bg-gray-950/50"
        >
          <UIcon name="i-heroicons-arrow-path" class="h-8 w-8 animate-spin text-pink-500" />
        </div>

        <div class="h-full">
          <Transition name="tab-slide" mode="out-in">
            <OverviewTab
              v-if="activeTab === 'overview'"
              :key="'overview-' + selectedYear"
              :session="session"
              :member-activity="memberActivity"
              :top-members="topMembers"
              :bottom-members="bottomMembers"
              :message-types="messageTypes"
              :hourly-activity="hourlyActivity"
              :daily-activity="dailyActivity"
              :time-range="timeRange"
              :selected-year="selectedYear"
              :filtered-message-count="filteredMessageCount"
              :filtered-member-count="filteredMemberCount"
              :time-filter="timeFilter"
            />
            <RankingTab
              v-else-if="activeTab === 'ranking'"
              :key="'ranking-' + selectedYear"
              :session-id="currentSessionId!"
              :member-activity="memberActivity"
              :time-filter="timeFilter"
              :selected-year="selectedYear"
              :available-years="availableYears"
            />
            <QuotesTab
              v-else-if="activeTab === 'quotes'"
              :key="'quotes-' + selectedYear"
              :session-id="currentSessionId!"
              :time-filter="timeFilter"
            />
            <MemberTab
              v-else-if="activeTab === 'members'"
              :key="'members-' + selectedYear"
              :session-id="currentSessionId!"
              :time-filter="timeFilter"
              @data-changed="loadData"
            />
            <AITab
              v-else-if="activeTab === 'ai'"
              :key="'ai'"
              :session-id="currentSessionId!"
              :session-name="session.name"
              chat-type="group"
            />
          </Transition>
        </div>
      </div>
    </template>

    <!-- Empty State -->
    <div v-else class="flex h-full items-center justify-center">
      <p class="text-gray-500">{{ t('analysis.groupChat.loadError') }}</p>
    </div>

    <!-- 会话索引弹窗（内部自动检测并弹出） -->
    <SessionIndexModal v-if="currentSessionId" v-model="showSessionIndexModal" :session-id="currentSessionId" />
  </div>
</template>

<style scoped>
.tab-slide-enter-active,
.tab-slide-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.tab-slide-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.tab-slide-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>
