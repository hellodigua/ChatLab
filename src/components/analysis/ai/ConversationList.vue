<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import dayjs from 'dayjs'

const { t } = useI18n()

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

// 格式化时间
function formatTime(timestamp: number): string {
  const now = dayjs()
  const date = dayjs(timestamp)

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
        <UButton class="mt-2" size="xs" variant="link" color="primary" @click="emit('create')">{{ t('conversation.startNew') }}</UButton>
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
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">
                  {{ getTitle(conv) }}
                </p>
                <p class="mt-1 text-[10px] text-gray-400 opacity-80">
                  {{ formatTime(conv.updatedAt) }}
                </p>
              </div>

              <!-- 操作按钮 -->
              <div
                class="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                :class="{ 'opacity-100': activeId === conv.id }"
                @click.stop
              >
                <UButton
                  icon="i-heroicons-pencil"
                  color="gray"
                  variant="ghost"
                  size="2xs"
                  class="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                  @click="startEditing(conv)"
                />
                <UButton
                  icon="i-heroicons-trash"
                  color="gray"
                  variant="ghost"
                  size="2xs"
                  class="text-gray-400 hover:text-red-500 dark:hover:text-red-400"
                  @click="handleDelete(conv.id)"
                />
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
      "titlePlaceholder": "输入标题..."
    }
  },
  "en-US": {
    "conversation": {
      "title": "AI Conversations",
      "newChat": "New Chat",
      "empty": "No history yet",
      "startNew": "Start New Chat",
      "titlePlaceholder": "Enter title..."
    }
  }
}
</i18n>
