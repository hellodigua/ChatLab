<script setup lang="ts">
/**
 * 消息列表组件
 * 支持无限滚动加载
 */
import { ref, watch, nextTick, toRaw, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import MessageItem from './MessageItem.vue'
import type { ChatRecordMessage, ChatRecordQuery } from './types'
import { useSessionStore } from '@/stores/session'

const { t } = useI18n()

const props = defineProps<{
  /** 当前查询条件 */
  query: ChatRecordQuery
}>()

const emit = defineEmits<{
  /** 消息数量变化 */
  (e: 'count-change', count: number): void
}>()

const sessionStore = useSessionStore()

// 判断是否处于筛选模式（有筛选条件且消息不连贯时显示上下文按钮）
// 注意：通过消息 ID 定位时上下文是连贯的，不需要显示
const isFiltered = computed(() => {
  const q = props.query
  // 只有关键词、成员筛选时才需要显示上下文按钮
  return !!(q.memberId || q.keywords?.length)
})

// 消息列表
const messages = ref<ChatRecordMessage[]>([])
const isLoading = ref(false)
const isLoadingMore = ref(false)
const hasMoreBefore = ref(false)
const hasMoreAfter = ref(false)

// 搜索模式相关状态
const isSearchMode = ref(false)
const searchOffset = ref(0)

// 滚动容器引用
const scrollContainerRef = ref<HTMLElement | null>(null)

// 构建筛选参数
function buildFilterParams(query: ChatRecordQuery) {
  return {
    filter: query.startTs || query.endTs ? { startTs: query.startTs, endTs: query.endTs } : undefined,
    senderId: query.memberId,
    keywords: query.keywords ? [...toRaw(query.keywords)] : undefined,
  }
}

// 初始加载消息
async function loadInitialMessages() {
  const sessionId = sessionStore.currentSessionId
  if (!sessionId) {
    messages.value = []
    emit('count-change', 0)
    return
  }

  isLoading.value = true
  messages.value = []

  try {
    const query = toRaw(props.query)
    const { filter, senderId, keywords } = buildFilterParams(query)
    const targetId = query.scrollToMessageId

    if (targetId) {
      // 以目标消息为中心，加载前后各 50 条
      const [beforeResult, afterResult] = await Promise.all([
        window.aiApi.getMessagesBefore(sessionId, targetId, 50, filter, senderId, keywords),
        window.aiApi.getMessagesAfter(sessionId, targetId, 50, filter, senderId, keywords),
      ])

      // 获取目标消息本身
      const targetMessages = await window.aiApi.getMessageContext(sessionId, targetId, 0)

      // 合并消息列表
      messages.value = [...beforeResult.messages, ...targetMessages, ...afterResult.messages]

      hasMoreBefore.value = beforeResult.hasMore
      hasMoreAfter.value = afterResult.hasMore

      // 滚动到目标消息（延时确保 DOM 完全渲染）
      await nextTick()
      setTimeout(() => {
        scrollToMessage(targetId)
      }, 100)
    } else if (keywords && keywords.length > 0) {
      // 有关键词，使用搜索功能
      isSearchMode.value = true
      searchOffset.value = 0
      const result = await window.aiApi.searchMessages(sessionId, keywords, filter, 100, 0, senderId)
      messages.value = result.messages
      hasMoreBefore.value = false // 搜索结果从最新开始，没有更早的
      hasMoreAfter.value = result.messages.length >= 100
      searchOffset.value = result.messages.length

      // 滚动到顶部
      await nextTick()
      scrollToTop()
    } else {
      // 没有目标消息和关键词，加载最新的 100 条
      isSearchMode.value = false
      searchOffset.value = 0
      const result = await window.aiApi.getAllRecentMessages(sessionId, filter, 100)
      messages.value = result.messages
      hasMoreBefore.value = result.messages.length >= 100
      hasMoreAfter.value = false

      // 滚动到顶部
      await nextTick()
      scrollToTop()
    }

    emit('count-change', messages.value.length)
  } catch (e) {
    console.error('加载消息失败:', e)
    messages.value = []
    emit('count-change', 0)
  } finally {
    isLoading.value = false
  }
}

// 滚动到顶部
function scrollToTop() {
  const container = scrollContainerRef.value
  if (container) {
    container.scrollTop = 0
  }
}

// 加载更早的消息（向上滚动）
async function loadMoreBefore() {
  if (isLoadingMore.value || !hasMoreBefore.value || messages.value.length === 0) return

  const sessionId = sessionStore.currentSessionId
  if (!sessionId) return

  const firstMessage = messages.value[0]
  if (!firstMessage) return

  isLoadingMore.value = true

  try {
    const query = toRaw(props.query)
    const { filter, senderId, keywords } = buildFilterParams(query)
    const result = await window.aiApi.getMessagesBefore(sessionId, firstMessage.id, 50, filter, senderId, keywords)

    if (result.messages.length > 0) {
      // 记录当前滚动位置
      const container = scrollContainerRef.value
      const oldScrollHeight = container?.scrollHeight || 0

      // prepend 消息
      messages.value = [...result.messages, ...messages.value]

      // 恢复滚动位置
      await nextTick()
      if (container) {
        const newScrollHeight = container.scrollHeight
        container.scrollTop = newScrollHeight - oldScrollHeight
      }

      emit('count-change', messages.value.length)
    }

    hasMoreBefore.value = result.hasMore
  } catch (e) {
    console.error('加载更早消息失败:', e)
  } finally {
    isLoadingMore.value = false
  }
}

// 加载更多消息（向下滚动）
async function loadMoreAfter() {
  if (isLoadingMore.value || !hasMoreAfter.value || messages.value.length === 0) return

  const sessionId = sessionStore.currentSessionId
  if (!sessionId) return

  isLoadingMore.value = true

  try {
    const query = toRaw(props.query)
    const { filter, senderId, keywords } = buildFilterParams(query)

    if (isSearchMode.value && keywords && keywords.length > 0) {
      // 搜索模式：使用分页加载
      const result = await window.aiApi.searchMessages(sessionId, keywords, filter, 50, searchOffset.value, senderId)

      if (result.messages.length > 0) {
        messages.value = [...messages.value, ...result.messages]
        searchOffset.value += result.messages.length
        emit('count-change', messages.value.length)
      }

      hasMoreAfter.value = result.messages.length >= 50
    } else {
      // 普通模式：使用消息 ID 加载
      const lastMessage = messages.value[messages.value.length - 1]
      if (!lastMessage) return

      const result = await window.aiApi.getMessagesAfter(sessionId, lastMessage.id, 50, filter, senderId, keywords)

      if (result.messages.length > 0) {
        messages.value = [...messages.value, ...result.messages]
        emit('count-change', messages.value.length)
      }

      hasMoreAfter.value = result.hasMore
    }
  } catch (e) {
    console.error('加载更多消息失败:', e)
  } finally {
    isLoadingMore.value = false
  }
}

// 滚动到指定消息
function scrollToMessage(messageId: number) {
  const container = scrollContainerRef.value
  if (!container) return

  const messageEl = container.querySelector(`[data-message-id="${messageId}"]`)
  if (messageEl) {
    messageEl.scrollIntoView({ block: 'center', behavior: 'auto' })
  }
}

// 处理滚动事件（检测边界）
function handleScroll() {
  const container = scrollContainerRef.value
  if (!container || isLoadingMore.value) return

  // 接近顶部时加载更多
  if (container.scrollTop < 100 && hasMoreBefore.value) {
    loadMoreBefore()
  }

  // 接近底部时加载更多
  const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
  if (distanceFromBottom < 100 && hasMoreAfter.value) {
    loadMoreAfter()
  }
}

// 判断是否是目标消息
function isTargetMessage(msgId: number): boolean {
  return msgId === props.query.scrollToMessageId
}

// 监听查询变化
watch(
  () => props.query,
  () => {
    loadInitialMessages()
  },
  { deep: true }
)

// 暴露刷新方法
defineExpose({
  refresh: loadInitialMessages,
})
</script>

<template>
  <div class="flex-1 overflow-hidden">
    <!-- 加载中 -->
    <div v-if="isLoading" class="flex h-full items-center justify-center">
      <div class="text-center">
        <UIcon name="i-heroicons-arrow-path" class="h-8 w-8 animate-spin text-gray-400" />
        <p class="mt-2 text-sm text-gray-500">{{ t('loading') }}</p>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else-if="messages.length === 0" class="flex h-full items-center justify-center">
      <div class="text-center">
        <UIcon name="i-heroicons-chat-bubble-left-right" class="h-12 w-12 text-gray-300 dark:text-gray-600" />
        <p class="mt-2 text-sm text-gray-500">{{ t('noMessages') }}</p>
        <p class="mt-1 text-xs text-gray-400">{{ t('tryAdjustFilter') }}</p>
      </div>
    </div>

    <!-- 消息滚动容器 -->
    <div v-else ref="scrollContainerRef" class="h-full overflow-y-auto" @scroll="handleScroll">
      <!-- 顶部加载指示器 -->
      <div v-if="hasMoreBefore" class="flex justify-center py-2">
        <span v-if="isLoadingMore" class="text-xs text-gray-400">
          <UIcon name="i-heroicons-arrow-path" class="mr-1 inline h-3 w-3 animate-spin" />
          {{ t('loadingMore') }}
        </span>
        <span v-else class="text-xs text-gray-400">{{ t('scrollUpForMore') }}</span>
      </div>

      <!-- 消息列表 -->
      <div class="space-y-1 py-2">
        <MessageItem
          v-for="msg in messages"
          :key="msg.id"
          :data-message-id="msg.id"
          :message="msg"
          :is-target="isTargetMessage(msg.id)"
          :highlight-keywords="query.highlightKeywords"
          :is-filtered="isFiltered"
        />
      </div>

      <!-- 底部加载指示器 -->
      <div v-if="hasMoreAfter" class="flex justify-center py-2">
        <span v-if="isLoadingMore" class="text-xs text-gray-400">
          <UIcon name="i-heroicons-arrow-path" class="mr-1 inline h-3 w-3 animate-spin" />
          {{ t('loadingMore') }}
        </span>
        <span v-else class="text-xs text-gray-400">{{ t('scrollDownForMore') }}</span>
      </div>
    </div>
  </div>
</template>

<i18n>
{
  "zh-CN": {
    "loading": "加载中...",
    "noMessages": "暂无消息",
    "tryAdjustFilter": "尝试调整筛选条件",
    "loadingMore": "加载更多...",
    "scrollUpForMore": "↑ 向上滚动加载更多",
    "scrollDownForMore": "↓ 向下滚动加载更多"
  },
  "en-US": {
    "loading": "Loading...",
    "noMessages": "No messages",
    "tryAdjustFilter": "Try adjusting the filter",
    "loadingMore": "Loading more...",
    "scrollUpForMore": "↑ Scroll up to load more",
    "scrollDownForMore": "↓ Scroll down to load more"
  }
}
</i18n>
