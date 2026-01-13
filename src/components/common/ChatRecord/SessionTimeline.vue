<script setup lang="ts">
/**
 * 会话时间线组件
 * 使用 @tanstack/vue-virtual 实现虚拟滚动
 */
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVirtualizer } from '@tanstack/vue-virtual'

interface ChatSessionItem {
  id: number
  startTs: number
  endTs: number
  messageCount: number
  firstMessageId: number
}

// 扁平化列表项类型
type FlatListItem =
  | { type: 'date'; date: string; label: string; count: number }
  | { type: 'session'; session: ChatSessionItem }

const props = defineProps<{
  sessionId: string
  /** 当前激活的会话 ID（用于高亮） */
  activeSessionId?: number
  /** 是否折叠整个面板 */
  collapsed?: boolean
}>()

const emit = defineEmits<{
  /** 选择会话 */
  (e: 'select', sessionId: number, firstMessageId: number): void
  /** 折叠状态变化 */
  (e: 'update:collapsed', value: boolean): void
}>()

const { t } = useI18n()

// 状态
const allSessions = ref<ChatSessionItem[]>([])
const isLoading = ref(true)
const scrollContainerRef = ref<HTMLElement | null>(null)

// 是否折叠
const isCollapsed = computed({
  get: () => props.collapsed ?? false,
  set: (v) => emit('update:collapsed', v),
})

// 将会话列表转换为扁平化列表（日期头 + 会话项）
const flatList = computed<FlatListItem[]>(() => {
  const sessions = allSessions.value
  if (sessions.length === 0) return []

  const result: FlatListItem[] = []
  const dateGroups = new Map<string, { label: string; sessions: ChatSessionItem[] }>()

  // 按日期分组
  for (const session of sessions) {
    const dateKey = getDateKey(session.startTs)
    let group = dateGroups.get(dateKey)
    if (!group) {
      group = {
        label: formatDate(session.startTs),
        sessions: [],
      }
      dateGroups.set(dateKey, group)
    }
    group.sessions.push(session)
  }

  // 按日期升序排列
  const sortedDates = Array.from(dateGroups.entries()).sort((a, b) => a[0].localeCompare(b[0]))

  // 扁平化：日期头 + 会话项
  for (const [dateKey, group] of sortedDates) {
    // 日期头
    result.push({
      type: 'date',
      date: dateKey,
      label: group.label,
      count: group.sessions.length,
    })

    // 该日期下的会话（按时间升序）
    const sortedSessions = group.sessions.sort((a, b) => a.startTs - b.startTs)
    for (const session of sortedSessions) {
      result.push({ type: 'session', session })
    }
  }

  return result
})

// 估算项目高度
const ESTIMATED_DATE_HEIGHT = 28 // 日期头高度
const ESTIMATED_SESSION_HEIGHT = 28 // 会话项高度

// 虚拟化器
const virtualizer = useVirtualizer(
  computed(() => ({
    count: flatList.value.length,
    getScrollElement: () => scrollContainerRef.value,
    estimateSize: (index: number) => {
      const item = flatList.value[index]
      return item?.type === 'date' ? ESTIMATED_DATE_HEIGHT : ESTIMATED_SESSION_HEIGHT
    },
    overscan: 10,
    getItemKey: (index: number) => {
      const item = flatList.value[index]
      if (!item) return index
      if (item.type === 'date') return `date-${item.date}`
      return `session-${item.session.id}`
    },
  }))
)

// 虚拟化后的项目
const virtualItems = computed(() => virtualizer.value.getVirtualItems())

// 总高度
const totalSize = computed(() => virtualizer.value.getTotalSize())

// 格式化日期
function formatDate(ts: number): string {
  const date = new Date(ts * 1000)
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

// 格式化时间
function formatTime(ts: number): string {
  const date = new Date(ts * 1000)
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

// 获取日期键
function getDateKey(ts: number): string {
  const date = new Date(ts * 1000)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// 加载会话列表
async function loadSessions() {
  if (!props.sessionId) return

  isLoading.value = true
  try {
    const data = await window.sessionApi.getSessions(props.sessionId)
    allSessions.value = data
    // 滚动到底部（最新会话在下面）
    await nextTick()
    scrollToBottom()
  } catch (error) {
    console.error('加载会话列表失败:', error)
  } finally {
    isLoading.value = false
  }
}

// 滚动到底部
function scrollToBottom() {
  if (flatList.value.length > 0) {
    virtualizer.value.scrollToIndex(flatList.value.length - 1, { align: 'end' })
  }
}

// 滚动到指定会话
function scrollToSession(sessionId: number) {
  const index = flatList.value.findIndex((item) => item.type === 'session' && item.session.id === sessionId)
  if (index !== -1) {
    virtualizer.value.scrollToIndex(index, { align: 'center' })
  }
}

// 选择会话
function handleSelectSession(session: ChatSessionItem) {
  emit('select', session.id, session.firstMessageId)
}

// 测量元素高度
function measureElement(el: Element | null) {
  if (el) {
    virtualizer.value.measureElement(el)
  }
}

// 当 activeSessionId 变化时，滚动到对应会话
watch(
  () => props.activeSessionId,
  (newId) => {
    if (newId) {
      scrollToSession(newId)
    }
  }
)

// 监听 sessionId 变化，重新加载
watch(
  () => props.sessionId,
  () => {
    loadSessions()
  },
  { immediate: true }
)

onMounted(() => {
  loadSessions()
})
</script>

<template>
  <!-- 折叠状态 -->
  <div
    v-if="isCollapsed"
    class="flex h-full w-10 flex-col items-center border-r border-gray-200 bg-gray-50 py-2 dark:border-gray-700 dark:bg-gray-800/50"
  >
    <UButton icon="i-heroicons-chevron-right" variant="ghost" size="xs" @click="isCollapsed = false" />
    <div class="mt-2 flex flex-1 items-center">
      <span class="vertical-text text-xs text-gray-400">{{ t('timeline') }}</span>
    </div>
  </div>

  <!-- 展开状态 -->
  <div
    v-else
    class="flex h-full w-40 flex-col border-r border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50"
  >
    <!-- 头部 -->
    <div class="flex items-center justify-between border-b border-gray-200 px-2 py-1.5 dark:border-gray-700">
      <span class="text-xs font-medium text-gray-600 dark:text-gray-300">{{ t('timeline') }}</span>
      <UButton icon="i-heroicons-chevron-left" variant="ghost" size="xs" @click="isCollapsed = true" />
    </div>

    <!-- 加载中 -->
    <div v-if="isLoading" class="flex flex-1 items-center justify-center">
      <UIcon name="i-heroicons-arrow-path" class="h-4 w-4 animate-spin text-gray-400" />
    </div>

    <!-- 空状态 -->
    <div v-else-if="allSessions.length === 0" class="flex flex-1 items-center justify-center p-2">
      <span class="text-xs text-gray-400">{{ t('noSessions') }}</span>
    </div>

    <!-- 虚拟滚动会话列表 -->
    <div v-else ref="scrollContainerRef" class="flex-1 overflow-y-auto py-1">
      <div class="relative w-full" :style="{ height: `${totalSize}px` }">
        <div
          v-for="virtualItem in virtualItems"
          :key="String(virtualItem.key)"
          :ref="(el) => measureElement(el as Element)"
          class="absolute left-0 top-0 w-full"
          :style="{ transform: `translateY(${virtualItem.start}px)` }"
        >
          <!-- 日期头 -->
          <template v-if="flatList[virtualItem.index]?.type === 'date'">
            <div class="flex w-full items-center gap-1 px-2 py-1">
              <span class="text-xs font-medium text-gray-700 dark:text-gray-200">
                {{ (flatList[virtualItem.index] as { label: string }).label }}
              </span>
              <span class="text-xs text-gray-400">
                ({{ (flatList[virtualItem.index] as { count: number }).count }})
              </span>
            </div>
          </template>

          <!-- 会话项 -->
          <template v-else-if="flatList[virtualItem.index]?.type === 'session'">
            <button
              class="flex w-full items-center justify-between rounded px-2 py-1 pl-4 text-left transition-colors"
              :class="[
                activeSessionId === (flatList[virtualItem.index] as { session: ChatSessionItem }).session.id
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                  : 'hover:bg-gray-100 dark:hover:bg-gray-700',
              ]"
              @click="handleSelectSession((flatList[virtualItem.index] as { session: ChatSessionItem }).session)"
            >
              <span class="text-xs text-gray-600 dark:text-gray-300">
                {{ formatTime((flatList[virtualItem.index] as { session: ChatSessionItem }).session.startTs) }}
              </span>
              <span class="text-xs text-gray-400">
                ({{ (flatList[virtualItem.index] as { session: ChatSessionItem }).session.messageCount }})
              </span>
            </button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.vertical-text {
  writing-mode: vertical-rl;
  text-orientation: mixed;
}
</style>

<i18n>
{
  "zh-CN": {
    "timeline": "会话",
    "noSessions": "暂无会话"
  },
  "en-US": {
    "timeline": "Sessions",
    "noSessions": "No sessions"
  }
}
</i18n>
