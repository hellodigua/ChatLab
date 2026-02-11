<script setup lang="ts">
/**
 * 自定义筛选 Tab
 * 用于精准提取聊天记录上下文，供 AI 分析使用
 *
 * 支持两种互斥的筛选模式：
 * 1. 条件筛选：按关键词、时间、发送者筛选，并自动扩展上下文
 * 2. 会话筛选：直接选择已有的会话（对话段落）
 *
 * 支持分页加载，避免大数据量时内存溢出
 */

import { ref, computed, watch, toRaw } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from '@nuxt/ui/runtime/composables/useToast.js'
import { useSessionStore } from '@/stores/session'
import ConditionPanel from './ConditionPanel.vue'
import SessionPanel from './SessionPanel.vue'
import PreviewPanel from './PreviewPanel.vue'
import FilterHistory from './FilterHistory.vue'
import LocalAnalysisModal from './LocalAnalysisModal.vue'

const { t } = useI18n()
const toast = useToast()
const sessionStore = useSessionStore()

// 筛选模式：'condition' | 'session'
const filterMode = ref<'condition' | 'session'>('condition')

// 条件筛选参数
const conditionFilter = ref<{
  keywords: string[]
  timeRange: { start: number; end: number } | null
  senderIds: number[]
  contextSize: number
}>({
  keywords: [],
  timeRange: null,
  senderIds: [],
  contextSize: 10,
})

// 会话筛选参数
const selectedSessionIds = ref<number[]>([])

// 筛选结果消息类型
interface FilterMessage {
  id: number
  senderName: string
  senderPlatformId: string
  senderAliases: string[]
  senderAvatar: string | null
  content: string
  timestamp: number
  type: number
  replyToMessageId: string | null
  replyToContent: string | null
  replyToSenderName: string | null
  isHit: boolean
}

// 分页信息类型
interface PaginationInfo {
  page: number
  pageSize: number
  totalBlocks: number
  totalHits: number
  hasMore: boolean
}

// 筛选结果（带分页）
const filterResult = ref<{
  blocks: Array<{
    startTs: number
    endTs: number
    messages: FilterMessage[]
    hitCount: number
  }>
  stats: {
    totalMessages: number
    hitMessages: number
    totalChars: number
  }
  pagination: PaginationInfo
} | null>(null)

// 加载状态
const isFiltering = ref(false)
const isLoadingMore = ref(false)
const showHistory = ref(false)
const showAnalysisModal = ref(false)

// 每页块数
const PAGE_SIZE = 50

// 估算 Token 数
// 中文：1 字符 ≈ 1.5 token（因为中文分词后每个字符可能产生 1-2 个 token）
// 考虑到消息格式（时间、发送人等），使用 1.5 作为估算系数
const estimatedTokens = computed(() => {
  if (!filterResult.value) return 0
  return Math.ceil(filterResult.value.stats.totalChars * 1.5)
})

// Token 状态：green < 50000, yellow 50000-100000, red > 100000
// （基于大多数模型的上下文窗口大小）
const tokenStatus = computed(() => {
  const tokens = estimatedTokens.value
  if (tokens < 50000) return 'green'
  if (tokens < 100000) return 'yellow'
  return 'red'
})

// 是否可以执行筛选
const canExecuteFilter = computed(() => {
  if (isFiltering.value) return false

  if (filterMode.value === 'condition') {
    // 条件模式：至少有一个条件
    return (
      conditionFilter.value.keywords.length > 0 ||
      conditionFilter.value.senderIds.length > 0 ||
      conditionFilter.value.timeRange !== null
    )
  } else {
    // 会话模式：至少选择一个会话
    return selectedSessionIds.value.length > 0
  }
})

// 执行筛选（首次加载）
async function executeFilter() {
  const sessionId = sessionStore.currentSessionId
  if (!sessionId) return

  isFiltering.value = true
  filterResult.value = null

  try {
    if (filterMode.value === 'condition') {
      // 条件筛选模式 - 使用 toRaw 去除 Vue Proxy
      const rawFilter = toRaw(conditionFilter.value)
      const keywords = rawFilter.keywords.length > 0 ? [...rawFilter.keywords] : undefined
      const timeFilter = rawFilter.timeRange
        ? { startTs: rawFilter.timeRange.start, endTs: rawFilter.timeRange.end }
        : undefined
      const senderIds = rawFilter.senderIds.length > 0 ? [...rawFilter.senderIds] : undefined
      const contextSize = rawFilter.contextSize

      const result = await window.aiApi.filterMessagesWithContext(
        sessionId,
        keywords,
        timeFilter,
        senderIds,
        contextSize,
        1, // 第一页
        PAGE_SIZE
      )
      filterResult.value = result
    } else {
      // 会话筛选模式
      if (selectedSessionIds.value.length === 0) return
      const sessionIds = [...toRaw(selectedSessionIds.value)]
      const result = await window.aiApi.getMultipleSessionsMessages(sessionId, sessionIds, 1, PAGE_SIZE)
      filterResult.value = result
    }
  } catch (error) {
    console.error('筛选失败:', error)
  } finally {
    isFiltering.value = false
  }
}

// 加载更多块
async function loadMoreBlocks() {
  const sessionId = sessionStore.currentSessionId
  if (!sessionId || !filterResult.value || !filterResult.value.pagination.hasMore || isLoadingMore.value) return

  isLoadingMore.value = true
  const nextPage = filterResult.value.pagination.page + 1

  try {
    let result
    if (filterMode.value === 'condition') {
      const rawFilter = toRaw(conditionFilter.value)
      const keywords = rawFilter.keywords.length > 0 ? [...rawFilter.keywords] : undefined
      const timeFilter = rawFilter.timeRange
        ? { startTs: rawFilter.timeRange.start, endTs: rawFilter.timeRange.end }
        : undefined
      const senderIds = rawFilter.senderIds.length > 0 ? [...rawFilter.senderIds] : undefined
      const contextSize = rawFilter.contextSize

      result = await window.aiApi.filterMessagesWithContext(
        sessionId,
        keywords,
        timeFilter,
        senderIds,
        contextSize,
        nextPage,
        PAGE_SIZE
      )
    } else {
      const sessionIds = [...toRaw(selectedSessionIds.value)]
      result = await window.aiApi.getMultipleSessionsMessages(sessionId, sessionIds, nextPage, PAGE_SIZE)
    }

    // 合并新加载的块到现有结果
    if (result && result.blocks.length > 0) {
      filterResult.value = {
        blocks: [...filterResult.value.blocks, ...result.blocks],
        stats: filterResult.value.stats, // 统计信息保持不变（第一页已获取）
        pagination: result.pagination,
      }
    }
  } catch (error) {
    console.error('加载更多失败:', error)
  } finally {
    isLoadingMore.value = false
  }
}

// 导出状态
const isExporting = ref(false)
const exportProgress = ref<{
  percentage: number
  message: string
} | null>(null)

// 监听导出进度
let unsubscribeExportProgress: (() => void) | null = null

function startExportProgressListener() {
  unsubscribeExportProgress = window.aiApi.onExportProgress((progress) => {
    exportProgress.value = {
      percentage: progress.percentage,
      message: progress.message,
    }
    // 如果完成或出错，不再需要监听
    if (progress.stage === 'done' || progress.stage === 'error') {
      exportProgress.value = null
    }
  })
}

function stopExportProgressListener() {
  if (unsubscribeExportProgress) {
    unsubscribeExportProgress()
    unsubscribeExportProgress = null
  }
  exportProgress.value = null
}

// 导出投喂包（后端生成 Markdown 文件，支持大数据量）
async function exportFeedPack() {
  if (!filterResult.value || filterResult.value.blocks.length === 0) return

  const sessionId = sessionStore.currentSessionId
  if (!sessionId) return

  const sessionInfo = sessionStore.currentSession
  const sessionName = sessionInfo?.name || '未知会话'

  // 让用户选择保存目录
  const dialogResult = await window.api.dialog.showOpenDialog({
    title: '选择保存目录',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (dialogResult.canceled || !dialogResult.filePaths[0]) return
  const outputDir = dialogResult.filePaths[0]

  isExporting.value = true
  exportProgress.value = { percentage: 0, message: t('analysis.filter.exportPreparing') }

  // 开始监听进度
  startExportProgressListener()

  try {
    // 构建导出参数
    const rawFilter = toRaw(conditionFilter.value)
    const exportParams = {
      sessionId,
      sessionName,
      outputDir,
      filterMode: filterMode.value,
      keywords: rawFilter.keywords.length > 0 ? [...rawFilter.keywords] : undefined,
      timeFilter: rawFilter.timeRange
        ? { startTs: rawFilter.timeRange.start, endTs: rawFilter.timeRange.end }
        : undefined,
      senderIds: rawFilter.senderIds.length > 0 ? [...rawFilter.senderIds] : undefined,
      contextSize: rawFilter.contextSize,
      chatSessionIds: filterMode.value === 'session' ? [...toRaw(selectedSessionIds.value)] : undefined,
    }

    // 调用后端导出
    const exportResult = await window.aiApi.exportFilterResultToFile(exportParams)

    if (exportResult.success && exportResult.filePath) {
      // 导出成功
      toast.add({
        title: t('analysis.filter.exportSuccess'),
        description: exportResult.filePath,
        color: 'green',
        icon: 'i-heroicons-check-circle',
      })
    } else {
      // 导出失败
      toast.add({
        title: t('analysis.filter.exportFailed'),
        description: exportResult.error || t('common.error.unknown'),
        color: 'red',
        icon: 'i-heroicons-x-circle',
      })
    }
  } catch (error) {
    console.error('导出失败:', error)
    toast.add({
      title: t('analysis.filter.exportFailed'),
      description: String(error),
      color: 'red',
      icon: 'i-heroicons-x-circle',
    })
  } finally {
    stopExportProgressListener()
    isExporting.value = false
  }
}

// 打开本地 AI 分析
function openLocalAnalysis() {
  if (!filterResult.value || filterResult.value.blocks.length === 0) return
  showAnalysisModal.value = true
}

// 切换模式时清空结果
watch(filterMode, () => {
  filterResult.value = null
})

// 加载历史筛选条件
function loadHistoryCondition(condition: {
  mode: 'condition' | 'session'
  conditionFilter?: typeof conditionFilter.value
  selectedSessionIds?: number[]
}) {
  filterMode.value = condition.mode
  if (condition.mode === 'condition' && condition.conditionFilter) {
    conditionFilter.value = { ...condition.conditionFilter }
  } else if (condition.mode === 'session' && condition.selectedSessionIds) {
    selectedSessionIds.value = [...condition.selectedSessionIds]
  }
  showHistory.value = false
}
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- 顶部工具栏 -->
    <div class="flex-none flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
      <div class="flex items-center gap-4">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('analysis.filter.title') }}</h2>

        <!-- 模式切换 -->
        <div class="flex items-center gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg">
          <button
            class="px-3 py-1.5 text-sm font-medium rounded-md transition-colors"
            :class="
              filterMode === 'condition'
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            "
            @click="filterMode = 'condition'"
          >
            {{ t('analysis.filter.conditionMode') }}
          </button>
          <button
            class="px-3 py-1.5 text-sm font-medium rounded-md transition-colors"
            :class="
              filterMode === 'session'
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            "
            @click="filterMode = 'session'"
          >
            {{ t('analysis.filter.sessionMode') }}
          </button>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <!-- 历史记录按钮 -->
        <UButton variant="ghost" icon="i-heroicons-clock" size="sm" @click="showHistory = true">
          {{ t('analysis.filter.history') }}
        </UButton>
      </div>
    </div>

    <!-- 主体内容区 -->
    <div class="flex-1 flex overflow-hidden">
      <!-- 左侧筛选面板 -->
      <div class="w-80 flex-none border-r border-gray-200 dark:border-gray-700 flex flex-col">
        <!-- 筛选条件区域（可滚动） -->
        <div class="flex-1 min-h-0 overflow-y-auto">
          <ConditionPanel
            v-if="filterMode === 'condition'"
            v-model:keywords="conditionFilter.keywords"
            v-model:time-range="conditionFilter.timeRange"
            v-model:sender-ids="conditionFilter.senderIds"
            v-model:context-size="conditionFilter.contextSize"
          />
          <SessionPanel v-else v-model:selected-ids="selectedSessionIds" />
        </div>

        <!-- 执行筛选按钮（固定在底部） -->
        <div class="flex-none p-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          <UButton block color="primary" :loading="isFiltering" :disabled="!canExecuteFilter" @click="executeFilter">
            {{ t('analysis.filter.execute') }}
          </UButton>
        </div>
      </div>

      <!-- 右侧预览面板 -->
      <div class="flex-1 flex flex-col overflow-hidden">
        <PreviewPanel
          :result="filterResult"
          :is-loading="isFiltering"
          :is-loading-more="isLoadingMore"
          :estimated-tokens="estimatedTokens"
          :token-status="tokenStatus"
          @load-more="loadMoreBlocks"
        />

        <!-- 底部操作按钮 -->
        <div
          v-if="filterResult && filterResult.blocks.length > 0"
          class="flex-none flex flex-col gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800"
        >
          <!-- 导出进度条 -->
          <div v-if="isExporting && exportProgress" class="w-full">
            <div class="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400 mb-1">
              <span>{{ exportProgress.message }}</span>
              <span>{{ exportProgress.percentage }}%</span>
            </div>
            <div class="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                class="h-full bg-primary-500 transition-all duration-300"
                :style="{ width: `${exportProgress.percentage}%` }"
              />
            </div>
          </div>
          <!-- 操作按钮 -->
          <div class="flex items-center justify-end gap-3">
            <UButton
              variant="outline"
              icon="i-heroicons-document-arrow-down"
              :loading="isExporting"
              :disabled="isExporting"
              @click="exportFeedPack"
            >
              {{ t('analysis.filter.export') }}
            </UButton>
            <UButton color="primary" icon="i-heroicons-sparkles" @click="openLocalAnalysis">
              {{ t('analysis.filter.localAnalysis') }}
            </UButton>
          </div>
        </div>
      </div>
    </div>

    <!-- 历史记录弹窗 -->
    <FilterHistory v-model:open="showHistory" @load="loadHistoryCondition" />

    <!-- 本地 AI 分析弹窗 -->
    <LocalAnalysisModal v-model:open="showAnalysisModal" :filter-result="filterResult" :filter-mode="filterMode" />
  </div>
</template>
