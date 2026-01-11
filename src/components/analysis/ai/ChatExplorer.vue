<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import ConversationList from './ConversationList.vue'
import DataSourcePanel from './DataSourcePanel.vue'
import ChatMessage from './ChatMessage.vue'
import ChatInput from './ChatInput.vue'
import { useAIChat } from '@/composables/useAIChat'
import CaptureButton from '@/components/common/CaptureButton.vue'
import { usePromptStore } from '@/stores/prompt'
import { useSettingsStore } from '@/stores/settings'

const { t } = useI18n()
const settingsStore = useSettingsStore()

// Props
const props = defineProps<{
  sessionId: string
  sessionName: string
  timeFilter?: { startTs: number; endTs: number }
  chatType?: 'group' | 'private'
}>()

// 使用 AI 对话 Composable
const {
  messages,
  sourceMessages,
  currentKeywords,
  isLoadingSource,
  isAIThinking,
  currentConversationId,
  currentToolStatus,
  toolsUsedInCurrentRound,
  sessionTokenUsage,
  sendMessage,
  loadConversation,
  startNewConversation,
  loadMoreSourceMessages,
  updateMaxMessages,
  stopGeneration,
} = useAIChat(props.sessionId, props.timeFilter, props.chatType ?? 'group', settingsStore.locale)

// Store
const promptStore = usePromptStore()
const { aiPromptSettings, activePreset } = storeToRefs(promptStore)

// 当前聊天类型
const currentChatType = computed(() => props.chatType ?? 'group')

// 当前类型对应的预设列表（根据 applicableTo 过滤）
const currentPresets = computed(() => promptStore.getPresetsForChatType(currentChatType.value))

// 当前激活的预设 ID
const currentActivePresetId = computed(() => aiPromptSettings.value.activePresetId)

// 当前激活的预设（如果当前激活的预设不适用于当前类型，使用第一个可用预设）
const currentActivePreset = computed(() => {
  const activeInList = currentPresets.value.find((p) => p.id === currentActivePresetId.value)
  return activeInList || activePreset.value
})

// 预设下拉菜单状态
const isPresetPopoverOpen = ref(false)

// 设置激活预设
function setActivePreset(presetId: string) {
  promptStore.setActivePreset(presetId)
  // 关闭下拉菜单
  isPresetPopoverOpen.value = false
}

// UI 状态
const isSourcePanelCollapsed = ref(false)
const hasLLMConfig = ref(false)
const isCheckingConfig = ref(true)
const messagesContainer = ref<HTMLElement | null>(null)
const conversationListRef = ref<InstanceType<typeof ConversationList> | null>(null)

// 智能滚动状态
const isStickToBottom = ref(true) // 是否粘在底部（自动滚动）
const showScrollToBottom = ref(false) // 是否显示"返回底部"按钮
const RESTICK_THRESHOLD = 30 // 距离底部此距离内时重新粘住

// 截屏功能
const conversationContentRef = ref<HTMLElement | null>(null)

// 将消息分组为 QA 对（用户问题 + AI 回复）
const qaPairs = computed(() => {
  const pairs: Array<{
    user: (typeof messages.value)[0] | null
    assistant: (typeof messages.value)[0] | null
    id: string
  }> = []
  let currentUser: (typeof messages.value)[0] | null = null

  for (const msg of messages.value) {
    if (msg.role === 'user') {
      // 如果已有用户消息但没有对应的 AI 回复，先保存
      if (currentUser) {
        pairs.push({ user: currentUser, assistant: null, id: currentUser.id })
      }
      currentUser = msg
    } else if (msg.role === 'assistant') {
      pairs.push({ user: currentUser, assistant: msg, id: currentUser?.id || msg.id })
      currentUser = null
    }
  }

  // 处理最后一个未配对的用户消息
  if (currentUser) {
    pairs.push({ user: currentUser, assistant: null, id: currentUser.id })
  }

  return pairs
})

// 检查 LLM 配置
async function checkLLMConfig() {
  isCheckingConfig.value = true
  try {
    hasLLMConfig.value = await window.llmApi.hasConfig()
  } catch (error) {
    console.error('检查 LLM 配置失败：', error)
    hasLLMConfig.value = false
  } finally {
    isCheckingConfig.value = false
  }
}

// 刷新配置状态（供外部调用）
async function refreshConfig() {
  await checkLLMConfig()
  if (hasLLMConfig.value) {
    await updateMaxMessages()
  }
  // 更新欢迎消息
  const welcomeMsg = messages.value.find((m) => m.id.startsWith('welcome'))
  if (welcomeMsg) {
    welcomeMsg.content = generateWelcomeMessage()
  }
}

// 暴露方法供父组件调用
defineExpose({
  refreshConfig,
})

// 生成欢迎消息
function generateWelcomeMessage() {
  const configHint = hasLLMConfig.value ? t('ai.welcome.configReady') : t('ai.welcome.configNeeded')

  return t('ai.welcome.message', { sessionName: props.sessionName, configHint })
}

// 发送消息
async function handleSend(content: string) {
  await sendMessage(content)
  // 强制滚动到底部（用户发送消息后应该看到响应）
  scrollToBottom(true)
  // 刷新对话列表
  conversationListRef.value?.refresh()
}

// 滚动到底部（强制滚动，用于发送消息等场景）
function scrollToBottom(force = false) {
  setTimeout(() => {
    if (messagesContainer.value) {
      // 如果强制滚动，或者处于粘性模式，才执行滚动
      if (force || isStickToBottom.value) {
        messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
        isStickToBottom.value = true
        showScrollToBottom.value = false
      }
    }
  }, 100)
}

// 处理用户滚轮/触控板事件（可靠地检测用户主动滚动）
function handleWheel(event: WheelEvent) {
  // deltaY < 0 表示向上滚动
  if (event.deltaY < 0 && isAIThinking.value) {
    // 用户在 AI 生成时主动向上滚动，解除粘性
    isStickToBottom.value = false
    showScrollToBottom.value = true
  }
}

// 检测滚动位置（仅用于检测是否滚动到底部以重新粘住）
function checkScrollPosition() {
  if (!messagesContainer.value) return

  const { scrollTop, scrollHeight, clientHeight } = messagesContainer.value
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight

  // 如果用户手动滚动到接近底部，重新启用粘性
  if (distanceFromBottom < RESTICK_THRESHOLD) {
    isStickToBottom.value = true
    showScrollToBottom.value = false
  }
}

// 点击"返回底部"按钮
function handleScrollToBottom() {
  scrollToBottom(true)
}

// 切换数据源面板
function toggleSourcePanel() {
  isSourcePanelCollapsed.value = !isSourcePanelCollapsed.value
}

// 加载更多数据源
async function handleLoadMore() {
  await loadMoreSourceMessages()
}

// 选择对话
async function handleSelectConversation(convId: string) {
  await loadConversation(convId)
  scrollToBottom(true) // 切换对话时强制滚动到底部
}

// 创建新对话
function handleCreateConversation() {
  startNewConversation(generateWelcomeMessage())
}

// 删除对话
function handleDeleteConversation(convId: string) {
  // 如果删除的是当前对话，创建新对话
  if (currentConversationId.value === convId) {
    startNewConversation(generateWelcomeMessage())
  }
}

// 初始化
onMounted(async () => {
  await checkLLMConfig()
  await updateMaxMessages()

  // 初始化欢迎消息
  startNewConversation(generateWelcomeMessage())

  // 添加事件监听
  if (messagesContainer.value) {
    messagesContainer.value.addEventListener('scroll', checkScrollPosition)
    messagesContainer.value.addEventListener('wheel', handleWheel, { passive: true })
  }
})

// 组件卸载时清理
onBeforeUnmount(() => {
  stopGeneration()
  if (messagesContainer.value) {
    messagesContainer.value.removeEventListener('scroll', checkScrollPosition)
    messagesContainer.value.removeEventListener('wheel', handleWheel)
  }
})

// 处理停止按钮
function handleStop() {
  stopGeneration()
}

// 监听消息变化，自动滚动
watch(
  () => messages.value.length,
  () => {
    scrollToBottom()
  }
)

// 监听 AI 响应流式更新
watch(
  () => messages.value[messages.value.length - 1]?.content,
  () => {
    scrollToBottom()
  }
)

// 监听 AI 响应 contentBlocks 更新（工具调用状态变化）
watch(
  () => messages.value[messages.value.length - 1]?.contentBlocks?.length,
  () => {
    scrollToBottom()
  }
)

// 监听全局 AI 配置变化（从设置弹窗保存时触发）
watch(
  () => promptStore.aiConfigVersion,
  async () => {
    await refreshConfig()
  }
)
</script>

<template>
  <div class="main-content flex h-full overflow-hidden">
    <!-- 左侧：对话记录列表 -->
    <ConversationList
      ref="conversationListRef"
      :session-id="sessionId"
      :active-id="currentConversationId"
      @select="handleSelectConversation"
      @create="handleCreateConversation"
      @delete="handleDeleteConversation"
      class="h-full shrink-0"
    />

    <!-- 中间：对话区域 -->
    <div class="flex h-full flex-1">
      <div class="relative flex min-w-[480px] flex-1 flex-col overflow-hidden">
        <!-- 消息列表 -->
        <div ref="messagesContainer" class="min-h-0 flex-1 overflow-y-auto p-4">
          <div ref="conversationContentRef" class="mx-auto max-w-3xl space-y-4">
            <!-- 对话截屏按钮 -->
            <div v-if="qaPairs.length > 0 && !isAIThinking" class="flex justify-end">
              <CaptureButton
                :label="t('ai.capture')"
                size="xs"
                type="element"
                :target-element="conversationContentRef"
              />
            </div>

            <!-- QA 对渲染 -->
            <template v-for="pair in qaPairs" :key="pair.id">
              <div class="qa-pair space-y-4">
                <!-- 用户问题 -->
                <ChatMessage
                  v-if="pair.user && (pair.user.role === 'user' || pair.user.content)"
                  :role="pair.user.role"
                  :content="pair.user.content"
                  :timestamp="pair.user.timestamp"
                  :is-streaming="pair.user.isStreaming"
                  :content-blocks="pair.user.contentBlocks"
                />
                <!-- AI 回复 -->
                <ChatMessage
                  v-if="
                    pair.assistant &&
                    (pair.assistant.content ||
                      (pair.assistant.contentBlocks && pair.assistant.contentBlocks.length > 0))
                  "
                  :role="pair.assistant.role"
                  :content="pair.assistant.content"
                  :timestamp="pair.assistant.timestamp"
                  :is-streaming="pair.assistant.isStreaming"
                  :content-blocks="pair.assistant.contentBlocks"
                  :show-capture-button="!pair.assistant.isStreaming"
                />
              </div>
            </template>

            <!-- AI 思考中指示器（仅在没有任何内容块时显示） -->
            <div
              v-if="
                isAIThinking &&
                !messages[messages.length - 1]?.content &&
                !(messages[messages.length - 1]?.contentBlocks?.length ?? 0)
              "
              class="flex items-start gap-3"
            >
              <div
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-pink-500 to-pink-600"
              >
                <UIcon name="i-heroicons-sparkles" class="h-4 w-4 text-white" />
              </div>
              <div class="rounded-2xl rounded-tl-sm bg-gray-100 px-4 py-3 dark:bg-gray-800">
                <!-- 工具执行状态 -->
                <div v-if="currentToolStatus" class="space-y-2">
                  <div class="flex items-center gap-2">
                    <span
                      class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
                      :class="[
                        currentToolStatus.status === 'running'
                          ? 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300'
                          : currentToolStatus.status === 'done'
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                            : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
                      ]"
                    >
                      <UIcon
                        :name="
                          currentToolStatus.status === 'running'
                            ? 'i-heroicons-cog-6-tooth'
                            : currentToolStatus.status === 'done'
                              ? 'i-heroicons-check-circle'
                              : 'i-heroicons-x-circle'
                        "
                        class="h-3 w-3"
                        :class="{ 'animate-spin': currentToolStatus.status === 'running' }"
                      />
                      {{ currentToolStatus.displayName }}
                    </span>
                    <span v-if="currentToolStatus.status === 'running'" class="flex gap-1">
                      <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-pink-500 [animation-delay:0ms]" />
                      <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-pink-500 [animation-delay:150ms]" />
                      <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-pink-500 [animation-delay:300ms]" />
                    </span>
                    <span
                      v-else-if="currentToolStatus.status === 'done'"
                      class="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400"
                    >
                      <span>{{ t('ai.status.processingResult') }}</span>
                      <span class="flex gap-1">
                        <span class="h-1 w-1 animate-bounce rounded-full bg-gray-400 [animation-delay:0ms]" />
                        <span class="h-1 w-1 animate-bounce rounded-full bg-gray-400 [animation-delay:150ms]" />
                        <span class="h-1 w-1 animate-bounce rounded-full bg-gray-400 [animation-delay:300ms]" />
                      </span>
                    </span>
                  </div>
                  <!-- 已使用的工具列表 -->
                  <div v-if="toolsUsedInCurrentRound.length > 1" class="flex flex-wrap gap-1">
                    <span class="text-xs text-gray-400">{{ t('ai.status.called') }}</span>
                    <span
                      v-for="tool in toolsUsedInCurrentRound.slice(0, -1)"
                      :key="tool"
                      class="inline-flex items-center gap-1 rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-400"
                    >
                      <UIcon name="i-heroicons-check" class="h-3 w-3 text-green-500" />
                      {{ tool }}
                    </span>
                  </div>
                </div>
                <!-- 默认状态 -->
                <div v-else class="flex items-center gap-2">
                  <span class="text-sm text-gray-600 dark:text-gray-400">{{ t('ai.status.analyzing') }}</span>
                  <span class="flex gap-1">
                    <span class="h-2 w-2 animate-bounce rounded-full bg-pink-500 [animation-delay:0ms]" />
                    <span class="h-2 w-2 animate-bounce rounded-full bg-pink-500 [animation-delay:150ms]" />
                    <span class="h-2 w-2 animate-bounce rounded-full bg-pink-500 [animation-delay:300ms]" />
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 返回底部浮动按钮（固定在输入框上方） -->
        <Transition name="fade-up">
          <button
            v-if="showScrollToBottom"
            @click="handleScrollToBottom"
            class="absolute bottom-20 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-gray-800/90 px-3 py-1.5 text-xs text-white shadow-lg backdrop-blur-sm transition-all hover:bg-gray-700 dark:bg-gray-700/90 dark:hover:bg-gray-600"
          >
            <UIcon name="i-heroicons-arrow-down" class="h-3.5 w-3.5" />
            <span>{{ t('ai.scrollToBottom') }}</span>
          </button>
        </Transition>

        <!-- 输入框区域 -->
        <div class="px-4 pb-2">
          <div class="mx-auto max-w-3xl">
            <ChatInput
              :disabled="isAIThinking"
              :status="isAIThinking ? 'streaming' : 'ready'"
              @send="handleSend"
              @stop="handleStop"
            />

            <!-- 底部状态栏 -->
            <div class="flex items-center justify-between px-1">
              <!-- 左侧：预设选择器 -->
              <UPopover v-model:open="isPresetPopoverOpen" :ui="{ content: 'p-0' }">
                <button
                  class="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                >
                  <UIcon name="i-heroicons-chat-bubble-bottom-center-text" class="h-3.5 w-3.5" />
                  <span class="max-w-[120px] truncate">{{ currentActivePreset?.name || t('ai.preset.default') }}</span>
                  <UIcon name="i-heroicons-chevron-down" class="h-3 w-3" />
                </button>
                <template #content>
                  <div class="w-48 py-1">
                    <div class="px-3 py-1.5 text-xs font-medium text-gray-400 dark:text-gray-500">
                      {{ currentChatType === 'group' ? t('ai.preset.groupTitle') : t('ai.preset.privateTitle') }}
                    </div>
                    <button
                      v-for="preset in currentPresets"
                      :key="preset.id"
                      class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
                      :class="[
                        preset.id === currentActivePresetId
                          ? 'text-pink-600 dark:text-pink-400'
                          : 'text-gray-700 dark:text-gray-300',
                      ]"
                      @click="setActivePreset(preset.id)"
                    >
                      <UIcon
                        :name="
                          preset.id === currentActivePresetId
                            ? 'i-heroicons-check-circle-solid'
                            : 'i-heroicons-document-text'
                        "
                        class="h-4 w-4 shrink-0"
                        :class="[preset.id === currentActivePresetId ? 'text-pink-500' : 'text-gray-400']"
                      />
                      <span class="truncate">{{ preset.name }}</span>
                    </button>
                  </div>
                </template>
              </UPopover>

              <!-- 右侧：Token 使用量 + 配置状态指示 -->
              <div class="flex items-center gap-3">
                <!-- Token 使用量 -->
                <div
                  v-if="sessionTokenUsage.totalTokens > 0"
                  class="flex items-center gap-1.5 text-xs text-gray-400"
                  title="本次会话累计 Token 使用量"
                >
                  <UIcon name="i-heroicons-chart-bar-square" class="h-3.5 w-3.5" />
                  <span>{{ sessionTokenUsage.totalTokens.toLocaleString() }} tokens</span>
                </div>

                <div
                  v-if="!isCheckingConfig"
                  class="flex items-center gap-1.5 text-xs transition-colors"
                  :class="[hasLLMConfig ? 'text-gray-400' : 'text-amber-500 font-medium']"
                >
                  <span class="h-1.5 w-1.5 rounded-full" :class="[hasLLMConfig ? 'bg-green-500' : 'bg-amber-500']" />
                  {{ hasLLMConfig ? t('ai.status.connected') : t('ai.status.notConfigured') }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 右侧：数据源面板 -->
    <Transition name="slide-fade">
      <div
        v-if="sourceMessages.length > 0 && !isSourcePanelCollapsed"
        class="w-80 shrink-0 border-l border-gray-200 bg-gray-50/50 p-4 dark:border-gray-800 dark:bg-gray-900/50"
      >
        <DataSourcePanel
          :messages="sourceMessages"
          :keywords="currentKeywords"
          :is-loading="isLoadingSource"
          :is-collapsed="isSourcePanelCollapsed"
          class="h-full"
          @toggle="toggleSourcePanel"
          @load-more="handleLoadMore"
        />
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* Transition styles for slide-fade */
.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.3s ease-out;
}

.slide-fade-enter-from,
.slide-fade-leave-to {
  transform: translateX(20px);
  opacity: 0;
}

/* Transition styles for slide-up (status bar) */
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.3s ease-out;
}

.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(10px);
  opacity: 0;
}

/* Transition styles for fade-up (scroll to bottom button) */
.fade-up-enter-active,
.fade-up-leave-active {
  transition: opacity 0.2s ease-out;
}

.fade-up-enter-from,
.fade-up-leave-to {
  opacity: 0;
}
</style>

<i18n>
{
  "zh-CN": {
    "ai": {
      "welcome": {
        "configReady": "✅ AI 服务已配置，可以开始对话了！",
        "configNeeded": "**注意**：使用前请先在侧边栏底部的「设置」中配置 AI 服务 ⚙️",
        "message": "👋 你好！我是 AI 助手，可以帮你探索「{sessionName}」的聊天记录。\n\n你可以这样问我：\n- 大家最近聊了什么有趣的话题\n- 谁是群里最活跃的人\n- 帮我找一下群里讨论买房的记录\n\n{configHint}"
      },
      "capture": "截屏对话",
      "scrollToBottom": "返回底部",
      "preset": {
        "default": "默认预设",
        "groupTitle": "群聊提示词预设",
        "privateTitle": "私聊提示词预设"
      },
      "status": {
        "processingResult": "处理结果中",
        "called": "已调用:",
        "analyzing": "正在分析问题...",
        "connected": "AI 已连接",
        "notConfigured": "请在全局设置中配置 AI 服务"
      }
    }
  },
  "en-US": {
    "ai": {
      "welcome": {
        "configReady": "✅ AI service is configured and ready!",
        "configNeeded": "**Note**: Please configure AI service in Settings (sidebar bottom) before using ⚙️",
        "message": "👋 Hi! I'm your AI assistant, here to help you explore the chat history of \"{sessionName}\".\n\nYou can ask me things like:\n- What interesting topics have people been discussing lately?\n- Who is the most active person in this chat?\n- Find me the conversations about travel plans\n\n{configHint}"
      },
      "capture": "Capture Chat",
      "scrollToBottom": "Back to Bottom",
      "preset": {
        "default": "Default Preset",
        "groupTitle": "Group Chat Presets",
        "privateTitle": "Private Chat Presets"
      },
      "status": {
        "processingResult": "Processing result",
        "called": "Called:",
        "analyzing": "Analyzing question...",
        "connected": "AI Connected",
        "notConfigured": "Please configure AI service in Settings"
      }
    }
  }
}
</i18n>
