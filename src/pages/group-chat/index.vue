<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import type { AnalysisSession, MessageType } from '@/types/base'
import type { MemberActivity, HourlyActivity, DailyActivity } from '@/types/analysis'
import CaptureButton from '@/components/common/CaptureButton.vue'
import TimeSelect from '@/components/common/TimeSelect.vue'
import AITab from '@/components/analysis/AITab.vue'
import OverviewTab from './components/OverviewTab.vue'
import ViewTab from './components/ViewTab.vue'
import QuotesTab from './components/QuotesTab.vue'
import MemberTab from './components/MemberTab.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import SessionIndexModal from '@/components/analysis/SessionIndexModal.vue'
import IncrementalImportModal from '@/components/analysis/IncrementalImportModal.vue'
import LoadingState from '@/components/UI/LoadingState.vue'
import { useSessionStore } from '@/stores/session'
import { useLayoutStore } from '@/stores/layout'
import { useTimeSelect } from '@/composables'

const { t } = useI18n()

const route = useRoute()
const router = useRouter()
const sessionStore = useSessionStore()
const layoutStore = useLayoutStore()
const { currentSessionId } = storeToRefs(sessionStore)

// 会话索引弹窗状态
const showSessionIndexModal = ref(false)

// 增量导入弹窗状态
const showIncrementalImportModal = ref(false)

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
const isInitialLoad = ref(true)

// Tab 配置
const allTabs = [
  { id: 'overview', labelKey: 'analysis.tabs.overview', icon: 'i-heroicons-chart-pie' },
  { id: 'view', labelKey: 'analysis.tabs.view', icon: 'i-heroicons-presentation-chart-bar' },
  { id: 'quotes', labelKey: 'analysis.tabs.groupQuotes', icon: 'i-heroicons-chat-bubble-bottom-center-text' },
  { id: 'members', labelKey: 'analysis.tabs.members', icon: 'i-heroicons-user-group' },
  { id: 'ai', labelKey: 'analysis.tabs.ai', icon: 'i-heroicons-sparkles' },
]

// Tab 列表
const tabs = computed(() => allTabs)

const activeTab = ref((route.query.tab as string) || 'overview')

// 时间范围筛选（composable 统一管理状态、派生计算、URL 同步）
const {
  timeRangeValue,
  fullTimeRange,
  availableYears,
  timeFilter,
  timeFilterKey,
  selectedYearForOverview,
  initialTimeState,
  resetTimeRange,
} = useTimeSelect(route, router, {
  activeTab,
  isInitialLoad,
  currentSessionId,
  onTimeRangeChange: () => loadAnalysisData(),
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

// 加载基础数据（仅会话信息，时间范围由 TimeSelect 内部拉取）
async function loadBaseData() {
  if (!currentSessionId.value) return

  try {
    const sessionData = await window.chatApi.getSession(currentSessionId.value)
    session.value = sessionData
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
  if (!currentSessionId.value) return

  isInitialLoad.value = true
  await loadBaseData()
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

// 监听会话变化（切换会话时清空时间范围，等待 TimeSelect 重新拉取）
watch(
  currentSessionId,
  (newId, oldId) => {
    if (oldId !== undefined && newId !== oldId) {
      resetTimeRange()
    }
    loadData()
  },
  { immediate: true }
)

onMounted(() => {
  syncSession()
})
</script>

<template>
  <div class="flex h-full flex-col bg-white pt-8 dark:bg-gray-900">
    <!-- Loading State -->
    <LoadingState v-if="isInitialLoad" variant="page" :text="t('analysis.groupChat.loading')" />

    <!-- Content -->
    <template v-else-if="session">
      <!-- Header -->
      <PageHeader
        :title="session.name"
        :description="
          t('analysis.groupChat.description', {
            dateRange: timeRangeValue?.displayLabel ?? '',
            memberCount: timeRangeValue?.isFullRange !== false ? session.memberCount : filteredMemberCount,
            messageCount: timeRangeValue?.isFullRange !== false ? session.messageCount : filteredMessageCount,
          })
        "
        :avatar="session.groupAvatar"
        icon="i-heroicons-chat-bubble-left-right"
        icon-class="bg-primary-600 text-white dark:bg-primary-500 dark:text-white"
      >
        <template #actions>
          <UButton
            color="neutral"
            variant="soft"
            size="sm"
            icon="i-heroicons-plus-circle"
            @click="showIncrementalImportModal = true"
          >
            {{ t('analysis.incrementalImport', '增量导入') }}
          </UButton>
          <UButton
            color="primary"
            variant="soft"
            size="sm"
            icon="i-heroicons-chat-bubble-bottom-center-text"
            @click="openChatRecordViewer"
          >
            {{ t('analysis.chatViewer', '聊天记录查看器') }}
          </UButton>
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
          <!-- 时间范围选择器靠右（AI实验室时隐藏） -->
          <TimeSelect
            v-model="timeRangeValue"
            :session-id="currentSessionId ?? undefined"
            :visible="activeTab !== 'ai'"
            :initial-state="initialTimeState"
            @update:full-range="fullTimeRange = $event"
            @update:available-years="availableYears = $event"
          />
        </div>
      </PageHeader>

      <!-- Tab Content -->
      <div class="relative flex-1 overflow-y-auto">
        <!-- Loading Overlay -->
        <LoadingState v-if="isLoading" variant="overlay" />

        <div class="h-full">
          <Transition name="tab-slide" mode="out-in">
            <OverviewTab
              v-if="activeTab === 'overview'"
              :key="'overview-' + timeFilterKey"
              :session="session"
              :member-activity="memberActivity"
              :top-members="topMembers"
              :bottom-members="bottomMembers"
              :message-types="messageTypes"
              :hourly-activity="hourlyActivity"
              :daily-activity="dailyActivity"
              :time-range="fullTimeRange"
              :selected-year="selectedYearForOverview"
              :filtered-message-count="filteredMessageCount"
              :filtered-member-count="filteredMemberCount"
              :time-filter="timeFilter"
            />
            <ViewTab
              v-else-if="activeTab === 'view'"
              :key="'view-' + timeFilterKey"
              :session-id="currentSessionId!"
              :time-filter="timeFilter"
              :member-activity="memberActivity"
              :selected-year="selectedYearForOverview ?? undefined"
              :available-years="availableYears"
            />
            <QuotesTab
              v-else-if="activeTab === 'quotes'"
              :key="'quotes-' + timeFilterKey"
              :session-id="currentSessionId!"
              :time-filter="timeFilter"
            />
            <MemberTab
              v-else-if="activeTab === 'members'"
              :key="'members-' + timeFilterKey"
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

    <!-- 增量导入弹窗 -->
    <IncrementalImportModal
      v-if="currentSessionId && session"
      v-model="showIncrementalImportModal"
      :session-id="currentSessionId"
      :session-name="session.name"
      @imported="loadData"
    />
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
