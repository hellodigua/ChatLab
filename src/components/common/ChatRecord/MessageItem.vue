<script setup lang="ts">
/**
 * 单条消息展示组件 - 气泡样式
 * 支持 Owner 消息显示在右侧（类似聊天界面）
 */
import { computed, ref, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import dayjs from 'dayjs'
import type { ChatRecordMessage } from './types'
import { useSessionStore } from '@/stores/session'

const { t } = useI18n()

const props = defineProps<{
  /** 消息数据 */
  message: ChatRecordMessage
  /** 是否为目标消息（需要高亮） */
  isTarget?: boolean
  /** 高亮关键词 */
  highlightKeywords?: string[]
  /** 是否处于筛选模式（显示上下文按钮） */
  isFiltered?: boolean
}>()

const sessionStore = useSessionStore()

// 判断当前消息是否是 Owner 发送的
const isOwner = computed(() => {
  const ownerId = sessionStore.currentSession?.ownerId
  if (!ownerId) return false
  return props.message.senderPlatformId === ownerId
})

// 上下文相关状态
const showContextPopover = ref(false)
const contextMessages = ref<ChatRecordMessage[]>([])
const isLoadingContext = ref(false)

// 加载上下文消息
async function loadContext() {
  if (isLoadingContext.value) return

  const sessionId = sessionStore.currentSessionId
  if (!sessionId) return

  isLoadingContext.value = true

  try {
    // 获取前后各 10 条消息
    const result = await window.aiApi.getMessageContext(sessionId, props.message.id, 10)
    contextMessages.value = result

    // 等待 DOM 渲染后滚动到中间位置（延时确保 popover 内容渲染完成）
    await nextTick()
    setTimeout(() => {
      scrollToContextCenter()
    }, 100)
  } catch (e) {
    console.error('加载上下文失败:', e)
    contextMessages.value = []
  } finally {
    isLoadingContext.value = false
  }
}

// 滚动到当前消息（居中显示）
function scrollToContextCenter() {
  // 使用更具体的选择器，在当前组件内查找
  const containers = document.querySelectorAll('.context-popover-content')
  // 找到最后一个（当前打开的）
  const container = containers[containers.length - 1]
  if (!container) return

  const targetEl = container.querySelector('[data-is-current="true"]')
  if (targetEl) {
    targetEl.scrollIntoView({ block: 'center', behavior: 'auto' })
  }
}

// 打开上下文 popover
function openContextPopover() {
  showContextPopover.value = true
  loadContext()
}

// 关闭上下文 popover 时清空数据（释放内存）
function handlePopoverClose(isOpen: boolean) {
  showContextPopover.value = isOpen
  if (!isOpen) {
    // 延迟清空，避免闪烁
    setTimeout(() => {
      if (!showContextPopover.value) {
        contextMessages.value = []
      }
    }, 300)
  }
}

// 基于发送者名称生成一致的颜色索引
const colorIndex = computed(() => {
  const name = props.message.senderName || ''
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return Math.abs(hash) % 16
})

// 现代优雅配色方案（16 种颜色）
// 参考 Linear, Notion 等现代产品的配色风格
const colorPalette = [
  { avatar: 'bg-rose-400 dark:bg-rose-500', name: 'text-rose-600 dark:text-rose-400' },
  { avatar: 'bg-pink-400 dark:bg-pink-500', name: 'text-pink-600 dark:text-pink-400' },
  { avatar: 'bg-fuchsia-400 dark:bg-fuchsia-500', name: 'text-fuchsia-600 dark:text-fuchsia-400' },
  { avatar: 'bg-purple-400 dark:bg-purple-500', name: 'text-purple-600 dark:text-purple-400' },
  { avatar: 'bg-violet-400 dark:bg-violet-500', name: 'text-violet-600 dark:text-violet-400' },
  { avatar: 'bg-indigo-400 dark:bg-indigo-500', name: 'text-indigo-600 dark:text-indigo-400' },
  { avatar: 'bg-blue-400 dark:bg-blue-500', name: 'text-blue-600 dark:text-blue-400' },
  { avatar: 'bg-sky-400 dark:bg-sky-500', name: 'text-sky-600 dark:text-sky-400' },
  { avatar: 'bg-cyan-400 dark:bg-cyan-500', name: 'text-cyan-600 dark:text-cyan-400' },
  { avatar: 'bg-teal-400 dark:bg-teal-500', name: 'text-teal-600 dark:text-teal-400' },
  { avatar: 'bg-emerald-400 dark:bg-emerald-500', name: 'text-emerald-600 dark:text-emerald-400' },
  { avatar: 'bg-green-400 dark:bg-green-500', name: 'text-green-600 dark:text-green-400' },
  { avatar: 'bg-lime-500 dark:bg-lime-600', name: 'text-lime-600 dark:text-lime-400' },
  { avatar: 'bg-amber-400 dark:bg-amber-500', name: 'text-amber-600 dark:text-amber-400' },
  { avatar: 'bg-orange-400 dark:bg-orange-500', name: 'text-orange-600 dark:text-orange-400' },
  { avatar: 'bg-red-400 dark:bg-red-500', name: 'text-red-600 dark:text-red-400' },
]

const currentColor = computed(() => colorPalette[colorIndex.value])
const avatarColor = computed(() => currentColor.value.avatar)
const nameColor = computed(() => currentColor.value.name)

// 气泡颜色（Owner 使用绿色，其他人使用灰色）
const bubbleColor = computed(() =>
  isOwner.value ? 'bg-green-100 dark:bg-green-900/40' : 'bg-gray-100 dark:bg-gray-800'
)

// 显示名称（包含别名）
const displayName = computed(() => {
  const name = props.message.senderName || ''
  const aliases = props.message.senderAliases || []

  // 如果有别名，在名称后面括号显示第一个别名
  if (aliases.length > 0) {
    return `${name}（${aliases[0]}）`
  }
  return name
})

// 获取头像字符（支持 emoji）
const avatarLetter = computed(() => {
  const name = props.message.senderName || ''
  if (!name) return '?'

  // 使用 Intl.Segmenter 正确分割字符串（包括 emoji）
  // 对于不支持的浏览器，使用 spread operator 作为 fallback
  try {
    const segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' })
    const segments = [...segmenter.segment(name)]
    if (segments.length > 0) {
      return segments[0].segment
    }
  } catch {
    // Fallback: 使用 spread operator 处理 emoji
    const chars = [...name]
    if (chars.length > 0) {
      const firstChar = chars[0]
      // 检查是否是字母或汉字，如果是则转大写
      if (/^[a-zA-Z]$/.test(firstChar)) {
        return firstChar.toUpperCase()
      }
      return firstChar
    }
  }

  return '?'
})

// 格式化时间（筛选模式显示完整时间，普通模式显示简短时间）
function formatTime(timestamp: number): string {
  // 筛选模式下显示完整时间
  if (props.isFiltered) {
    return dayjs.unix(timestamp).format('YYYY-MM-DD HH:mm:ss')
  }
  // 普通模式显示简短时间
  return dayjs.unix(timestamp).format('HH:mm')
}

function formatFullTime(timestamp: number): string {
  return dayjs.unix(timestamp).format('YYYY-MM-DD HH:mm:ss')
}

// 高亮关键词
function highlightContent(content: string): string {
  if (!props.highlightKeywords?.length || !content) return content

  const pattern = props.highlightKeywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const regex = new RegExp(`(${pattern})`, 'gi')
  return content.replace(
    regex,
    '<mark class="bg-transparent border-b-2 border-yellow-400 dark:border-yellow-500">$1</mark>'
  )
}
</script>

<template>
  <div
    class="group px-4 py-2 transition-colors"
    :class="{
      'bg-yellow-50/50 dark:bg-yellow-900/10': isTarget,
    }"
  >
    <!-- Owner 消息显示在右侧 -->
    <div class="flex gap-3" :class="isOwner ? 'flex-row-reverse' : ''">
      <!-- 头像 -->
      <div
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-medium text-white overflow-hidden"
        :class="message.senderAvatar ? '' : avatarColor"
      >
        <img
          v-if="message.senderAvatar"
          :src="message.senderAvatar"
          :alt="message.senderName"
          class="h-full w-full object-cover"
        />
        <span v-else>{{ avatarLetter }}</span>
      </div>

      <!-- 消息内容区 -->
      <div class="min-w-0 flex-1" :class="isOwner ? 'flex flex-col items-end' : ''">
        <!-- 发送者和时间 -->
        <div class="mb-1 flex items-center gap-2" :class="isOwner ? 'flex-row-reverse' : ''">
          <span class="text-sm font-medium" :class="nameColor">
            {{ displayName }}
          </span>
          <span
            class="text-xs text-gray-400 transition-opacity"
            :class="isFiltered ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
            :title="formatFullTime(message.timestamp)"
          >
            {{ formatTime(message.timestamp) }}
          </span>
        </div>

        <!-- 气泡和上下文按钮 -->
        <!-- max-w-[calc(100%-48px)] = 100% - 头像宽度(36px) - gap(12px) -->
        <div class="flex items-start gap-1 max-w-[calc(100%-68px)]" :class="isOwner ? 'flex-row-reverse' : ''">
          <div
            class="relative inline-block rounded-lg px-3 py-2 transition-shadow"
            :class="[bubbleColor, isTarget ? 'ring-2 ring-yellow-400 dark:ring-yellow-500' : '']"
          >
            <p
              class="whitespace-pre-wrap break-words text-sm text-gray-700 dark:text-gray-200"
              v-html="highlightContent(message.content || '')"
            />
          </div>

          <!-- 上下文查看按钮 -->
          <UPopover
            v-if="isFiltered"
            :open="showContextPopover"
            :popper="{ placement: isOwner ? 'left-start' : 'right-start' }"
            @update:open="handlePopoverClose"
          >
            <button
              class="mt-1 flex h-6 w-6 items-center justify-center rounded opacity-0 transition-opacity hover:bg-gray-200 group-hover:opacity-100 dark:hover:bg-gray-700"
              :title="t('viewContext')"
              @click="openContextPopover"
            >
              <UIcon name="i-heroicons-chat-bubble-left-ellipsis" class="h-4 w-4 text-gray-400" />
            </button>

            <template #content>
              <div class="context-popover-content w-80 max-h-96 overflow-y-auto">
                <div class="px-3 py-2 border-b border-gray-200 dark:border-gray-700">
                  <span class="text-xs font-medium text-gray-500">{{ t('contextTitle') }}</span>
                </div>

                <div v-if="isLoadingContext" class="flex items-center justify-center py-8">
                  <UIcon name="i-heroicons-arrow-path" class="h-5 w-5 animate-spin text-gray-400" />
                </div>

                <div v-else-if="contextMessages.length === 0" class="py-8 text-center text-sm text-gray-400">
                  {{ t('noContext') }}
                </div>

                <div v-else class="divide-y divide-gray-100 dark:divide-gray-800">
                  <div
                    v-for="ctx in contextMessages"
                    :key="ctx.id"
                    class="px-3 py-2"
                    :class="ctx.id === message.id ? 'bg-yellow-50 dark:bg-yellow-900/20' : ''"
                    :data-is-current="ctx.id === message.id"
                  >
                    <div class="flex items-center justify-between mb-1">
                      <span class="text-xs font-medium text-gray-700 dark:text-gray-300">
                        {{ ctx.senderName }}
                      </span>
                      <span class="text-xs text-gray-400">
                        {{ dayjs.unix(ctx.timestamp).format('HH:mm:ss') }}
                      </span>
                    </div>
                    <p class="text-xs text-gray-600 dark:text-gray-400 line-clamp-3">
                      {{ ctx.content }}
                    </p>
                  </div>
                </div>
              </div>
            </template>
          </UPopover>
        </div>
      </div>
    </div>
  </div>
</template>

<i18n>
{
  "zh-CN": {
    "viewContext": "查看上下文",
    "contextTitle": "消息上下文（前后各10条）",
    "noContext": "暂无上下文"
  },
  "en-US": {
    "viewContext": "View Context",
    "contextTitle": "Message Context (10 before and after)",
    "noContext": "No context available"
  }
}
</i18n>
