<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import dayjs from 'dayjs'
import { useToast } from '@nuxt/ui/runtime/composables/useToast.js'
import { usePromptStore } from '@/stores/prompt'
import { exportConversation, type ExportFormat } from '@/utils/conversationExport'

const { t } = useI18n()
const toast = useToast()
const promptStore = usePromptStore()
const { aiGlobalSettings } = storeToRefs(promptStore)

interface Conversation {
  id: string
  sessionId: string
  title: string | null
  createdAt: number
  updatedAt: number
}

// Props
const props = defineProps<{
  sessionId: string
  activeId: string | null
}>()

// Emits
const emit = defineEmits<{
  select: [id: string]
  create: []
  delete: [id: string]
}>()

// State
const conversations = ref<Conversation[]>([])
const isLoading = ref(false)
const isExporting = ref<string | null>(null) // 正在导出的对话 ID
const editingId = ref<string | null>(null)
const editingTitle = ref('')
const isCollapsed = ref(false)

// 加载对话列表
async function loadConversations() {
  isLoading.value = true
  try {
    conversations.value = await window.aiApi.getConversations(props.sessionId)
  } catch (error) {
    console.error('加载对话列表失败：', error)
  } finally {
    isLoading.value = false
  }
}

// 格式化时间（数据库存储的是秒级时间戳，需转换为毫秒级）
function formatTime(timestamp: number): string {
  const now = dayjs()
  const date = dayjs(timestamp * 1000)

  if (now.diff(date, 'day') === 0) {
    return date.format('HH:mm')
  } else if (now.diff(date, 'day') < 7) {
    return date.format('ddd HH:mm')
  } else {
    return date.format('MM-DD')
  }
}

// 获取对话标题
function getTitle(conv: Conversation): string {
  return conv.title || t('conversation.newChat')
}

// 开始编辑标题
function startEditing(conv: Conversation) {
  editingId.value = conv.id
  editingTitle.value = conv.title || ''
}

// 保存标题
async function saveTitle(convId: string) {
  if (editingTitle.value.trim()) {
    try {
      await window.aiApi.updateConversationTitle(convId, editingTitle.value.trim())
      const conv = conversations.value.find((c) => c.id === convId)
      if (conv) {
        conv.title = editingTitle.value.trim()
      }
    } catch (error) {
      console.error('更新标题失败：', error)
    }
  }
  editingId.value = null
}

// 删除对话
async function handleDelete(convId: string) {
  try {
    await window.aiApi.deleteConversation(convId)
    conversations.value = conversations.value.filter((c) => c.id !== convId)
    emit('delete', convId)
  } catch (error) {
    console.error('删除对话失败：', error)
  }
}

// 导出对话
async function handleExport(conv: Conversation) {
  if (isExporting.value) return

  isExporting.value = conv.id
  try {
    // 获取对话消息
    const messages = await window.aiApi.getMessages(conv.id)

    if (messages.length === 0) {
      toast.add({
        title: t('conversation.export.noMessages'),
        icon: 'i-heroicons-exclamation-triangle',
        color: 'warning',
        duration: 2000,
      })
      return
    }

    // 获取导出格式和标题
    const format = (aiGlobalSettings.value.exportFormat || 'markdown') as ExportFormat
    const title = conv.title || t('conversation.newChat')

    // 导出标签（国际化）
    const labels = {
      createdAt: t('conversation.export.createdAt'),
      user: t('conversation.export.user'),
      assistant: t('conversation.export.assistant'),
    }

    // 转换消息时间戳（数据库存储的是秒级时间戳，需转换为毫秒级）
    const messagesWithMs = messages.map((msg) => ({
      ...msg,
      timestamp: msg.timestamp * 1000,
    }))

    // 调用导出工具
    const result = await exportConversation(title, messagesWithMs, conv.createdAt * 1000, format, labels)

    if (result.success && result.filePath) {
      // 获取文件名
      const filename = result.filePath.split('/').pop() || result.filePath
      const exportedFilePath = result.filePath
      // 显示成功 toast
      toast.add({
        title: t('conversation.export.success'),
        description: filename,
        icon: 'i-heroicons-check-circle',
        color: 'primary',
        duration: 2000,
        actions: [
          {
            label: t('conversation.export.openFolder'),
            onClick: () => {
              window.cacheApi.showInFolder(exportedFilePath)
            },
          },
        ],
      })
    } else {
      toast.add({
        title: t('conversation.export.failed'),
        description: result.error,
        icon: 'i-heroicons-x-circle',
        color: 'error',
        duration: 2000,
      })
    }
  } catch (error) {
    console.error('导出对话失败：', error)
    toast.add({
      title: t('conversation.export.failed'),
      description: String(error),
      icon: 'i-heroicons-x-circle',
      color: 'error',
      duration: 2000,
    })
  } finally {
    isExporting.value = null
  }
}

// 初始化
onMounted(() => {
  loadConversations()
})

// 监听 sessionId 变化
watch(
  () => props.sessionId,
  () => {
    loadConversations()
  }
)

// 暴露刷新方法
defineExpose({
  refresh: loadConversations,
})
</script>

<template>
  <div
    class="flex flex-col border-r border-gray-200 bg-white transition-all dark:border-gray-800 dark:bg-gray-900"
    :class="isCollapsed ? 'w-10' : 'w-64'"
  >
    <!-- 头部 -->
    <div class="flex items-center justify-between border-b border-gray-200 p-2 dark:border-gray-800">
      <template v-if="!isCollapsed">
        <span class="text-xs font-medium text-gray-500 dark:text-gray-400">{{ t('conversation.title') }}</span>
        <div class="flex items-center gap-1">
          <UButton
            icon="i-heroicons-plus"
            color="gray"
            variant="ghost"
            size="xs"
            class="text-gray-500 hover:text-gray-900 dark:hover:text-white"
            @click="emit('create')"
          />
          <button
            class="rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            @click="isCollapsed = !isCollapsed"
          >
            <UIcon name="i-heroicons-chevron-left" class="h-4 w-4" />
          </button>
        </div>
      </template>
      <template v-else>
        <button
          class="mx-auto rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
          @click="isCollapsed = !isCollapsed"
        >
          <UIcon name="i-heroicons-chevron-right" class="h-4 w-4" />
        </button>
      </template>
    </div>

    <!-- 展开状态列表 -->
    <div v-if="!isCollapsed" class="flex-1 overflow-y-auto p-2">
      <!-- 加载中 -->
      <div v-if="isLoading" class="flex items-center justify-center py-8">
        <UIcon name="i-heroicons-arrow-path" class="h-5 w-5 animate-spin text-gray-400" />
      </div>

      <!-- 空状态 -->
      <div v-else-if="conversations.length === 0" class="flex flex-col items-center justify-center py-12 text-center">
        <div class="flex h-12 w-12 items-center justify-center rounded-full bg-gray-50 dark:bg-gray-800">
          <UIcon name="i-heroicons-chat-bubble-left" class="h-6 w-6 text-gray-300 dark:text-gray-600" />
        </div>
        <p class="mt-3 text-xs text-gray-400">{{ t('conversation.empty') }}</p>
        <UButton class="mt-2" size="xs" variant="link" color="primary" @click="emit('create')">
          {{ t('conversation.startNew') }}
        </UButton>
      </div>

      <!-- 对话列表 -->
      <div v-else class="space-y-0.5">
        <div
          v-for="conv in conversations"
          :key="conv.id"
          class="group relative rounded-lg px-3 py-2.5 transition-all cursor-pointer"
          :class="[
            activeId === conv.id
              ? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white'
              : 'text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800/50',
          ]"
          @click="emit('select', conv.id)"
        >
          <!-- 编辑模式 -->
          <template v-if="editingId === conv.id">
            <input
              v-model="editingTitle"
              class="w-full rounded border-none bg-white px-2 py-1 text-sm shadow-sm ring-1 ring-gray-200 focus:ring-2 focus:ring-primary-500 dark:bg-gray-900 dark:ring-gray-700"
              :placeholder="t('conversation.titlePlaceholder')"
              autoFocus
              @blur="saveTitle(conv.id)"
              @keyup.enter="saveTitle(conv.id)"
              @click.stop
            />
          </template>

          <!-- 正常模式 -->
          <template v-else>
            <div class="relative">
              <!-- 标题 -->
              <p class="line-clamp-1 pr-2 text-sm font-medium leading-snug">
                {{ getTitle(conv) }}
              </p>

              <!-- 时间 -->
              <p class="mt-1.5 text-[10px] text-gray-400">
                {{ formatTime(conv.updatedAt) }}
              </p>

              <!-- 操作按钮（垂直居中，带渐变背景） -->
              <div
                class="absolute inset-y-0 right-0 flex items-center opacity-0 transition-opacity group-hover:opacity-100"
                :class="{ 'opacity-100': activeId === conv.id }"
                @click.stop
              >
                <!-- 左侧渐变过渡区域 -->
                <div
                  class="absolute inset-y-0 -left-6 w-6 bg-linear-to-r from-transparent"
                  :class="[
                    activeId === conv.id
                      ? 'to-gray-100 dark:to-gray-800'
                      : 'to-gray-50 group-hover:to-gray-100 dark:to-gray-900 dark:group-hover:to-gray-800',
                  ]"
                />
                <!-- 按钮组背景 -->
                <div
                  class="relative flex h-full items-center gap-0.5 pl-1 pr-0.5"
                  :class="[
                    activeId === conv.id
                      ? 'bg-gray-100 dark:bg-gray-800'
                      : 'bg-gray-50 group-hover:bg-gray-100 dark:bg-gray-900 dark:group-hover:bg-gray-800',
                  ]"
                >
                  <UButton
                    :icon="isExporting === conv.id ? 'i-heroicons-arrow-path' : 'i-heroicons-arrow-down-tray'"
                    color="gray"
                    variant="ghost"
                    size="2xs"
                    :class="[
                      isExporting === conv.id ? 'animate-spin' : '',
                      'text-gray-400 hover:text-primary-500 dark:hover:text-primary-400',
                    ]"
                    :disabled="isExporting !== null"
                    @click="handleExport(conv)"
                  />
                  <UButton
                    icon="i-heroicons-pencil"
                    color="gray"
                    variant="ghost"
                    size="2xs"
                    class="text-gray-400 hover:text-primary-500 dark:hover:text-primary-400"
                    @click="startEditing(conv)"
                  />
                  <UButton
                    icon="i-heroicons-trash"
                    color="gray"
                    variant="ghost"
                    size="2xs"
                    class="text-gray-400 hover:text-primary-500 dark:hover:text-primary-400"
                    @click="handleDelete(conv.id)"
                  />
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- 折叠状态列表 -->
    <div v-else class="flex flex-1 flex-col items-center gap-2 overflow-y-auto py-2">
      <!-- 新建按钮 -->
      <button
        class="rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-pink-500 dark:hover:bg-gray-800"
        :title="t('conversation.startNew')"
        @click="emit('create')"
      >
        <UIcon name="i-heroicons-plus" class="h-4 w-4" />
      </button>

      <!-- 分隔线 -->
      <div class="h-px w-6 bg-gray-200 dark:bg-gray-800"></div>

      <!-- 对话列表图标 -->
      <button
        v-for="conv in conversations"
        :key="conv.id"
        class="rounded p-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
        :class="[activeId === conv.id ? 'text-pink-500' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300']"
        :title="getTitle(conv)"
        @click="emit('select', conv.id)"
      >
        <UIcon name="i-heroicons-chat-bubble-left" class="h-4 w-4" />
      </button>
    </div>
  </div>
</template>

<i18n>
{
  "zh-CN": {
    "conversation": {
      "title": "AI对话记录",
      "newChat": "新对话",
      "empty": "暂无历史记录",
      "startNew": "开始新对话",
      "titlePlaceholder": "输入标题...",
      "export": {
        "createdAt": "创建时间",
        "user": "用户",
        "assistant": "AI 助手",
        "success": "导出成功",
        "failed": "导出失败",
        "openFolder": "打开目录",
        "noMessages": "对话没有消息"
      }
    }
  },
  "en-US": {
    "conversation": {
      "title": "AI Conversations",
      "newChat": "New Chat",
      "empty": "No history yet",
      "startNew": "Start New Chat",
      "titlePlaceholder": "Enter title...",
      "export": {
        "createdAt": "Created",
        "user": "User",
        "assistant": "AI Assistant",
        "success": "Export successful",
        "failed": "Export failed",
        "openFolder": "Open folder",
        "noMessages": "No messages to export"
      }
    }
  }
}
</i18n>
