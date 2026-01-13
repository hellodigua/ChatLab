<script setup lang="ts">
/**
 * 本地 AI 分析弹窗
 * 支持预设分析和自定义提问
 */

import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSessionStore } from '@/stores/session'
import MarkdownIt from 'markdown-it'

// 创建 markdown-it 实例
const md = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
  typographer: true,
})

const { t } = useI18n()
const sessionStore = useSessionStore()

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

// Props
const props = defineProps<{
  filterResult: {
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
  } | null
  filterMode: 'condition' | 'session'
}>()

const open = defineModel<boolean>('open', { default: false })

// 分析模式：'preset' | 'custom'
const analysisMode = ref<'preset' | 'custom'>('preset')

// 预设分析选项
const presetOptions = [
  { id: 'summary', label: '总结对话要点', prompt: '请总结这段对话的主要内容和关键要点。' },
  { id: 'sentiment', label: '情感分析', prompt: '请分析这段对话中参与者的情感变化和整体氛围。' },
  { id: 'topics', label: '话题提取', prompt: '请提取这段对话中讨论的主要话题，并简要说明每个话题的内容。' },
  { id: 'insights', label: '洞察分析', prompt: '请对这段对话进行深度分析，包括参与者的关系、互动模式、潜在问题等。' },
]

const selectedPreset = ref(presetOptions[0].id)
const customPrompt = ref('')

// 可编辑的预设提示词（允许用户临时修改）
const editablePresetPrompt = ref(presetOptions[0].prompt)

// 分析状态
const isAnalyzing = ref(false)
const analysisResult = ref('')
const analysisError = ref('')

// 当前请求 ID（用于中止）
let currentRequestId: string | null = null

// 构建上下文内容
const contextContent = computed(() => {
  if (!props.filterResult) return ''

  let content = ''
  for (const block of props.filterResult.blocks) {
    const startTime = new Date(block.startTs * 1000).toLocaleString()
    content += `\n--- 对话段落 (${startTime}) ---\n`

    for (const msg of block.messages) {
      const time = new Date(msg.timestamp * 1000).toLocaleTimeString()
      content += `[${time}] ${msg.senderName}: ${msg.content || '[非文本消息]'}\n`
    }
  }
  return content
})

// 获取用户提问
const userQuestion = computed(() => {
  if (analysisMode.value === 'preset') {
    return editablePresetPrompt.value
  }
  return customPrompt.value
})

// 执行分析
async function executeAnalysis() {
  if (!props.filterResult || !userQuestion.value) return

  isAnalyzing.value = true
  analysisResult.value = ''
  analysisError.value = ''

  try {
    // 构建完整的消息
    const fullMessage = `以下是一段聊天记录，请根据用户的问题进行分析：

${contextContent.value}

---
用户问题：${userQuestion.value}`

    // 调用 Agent API
    const context = {
      sessionId: sessionStore.currentSessionId || '',
    }

    const { requestId, promise } = window.agentApi.runStream(
      fullMessage,
      context,
      (chunk) => {
        if (chunk.type === 'content' && chunk.content) {
          analysisResult.value += chunk.content
        } else if (chunk.type === 'error') {
          analysisError.value = chunk.error || '分析出错'
        }
      },
      [], // 不需要历史消息
      sessionStore.currentSession?.type === 'group' ? 'group' : 'private'
    )

    currentRequestId = requestId

    const result = await promise

    if (!result.success && result.error) {
      analysisError.value = result.error
    }
  } catch (error) {
    console.error('分析失败:', error)
    analysisError.value = String(error)
  } finally {
    isAnalyzing.value = false
    currentRequestId = null
  }
}

// 中止分析
async function abortAnalysis() {
  if (currentRequestId) {
    try {
      await window.agentApi.abort(currentRequestId)
    } catch (error) {
      console.error('中止失败:', error)
    }
    isAnalyzing.value = false
    currentRequestId = null
  }
}

// 复制结果
async function copyResult() {
  try {
    await navigator.clipboard.writeText(analysisResult.value)
  } catch (error) {
    console.error('复制失败:', error)
  }
}

// 监听预设选择变化，更新可编辑的提示词
watch(selectedPreset, (newPresetId) => {
  const preset = presetOptions.find((p) => p.id === newPresetId)
  if (preset) {
    editablePresetPrompt.value = preset.prompt
  }
})

// 关闭时重置状态
watch(open, (val) => {
  if (!val) {
    analysisResult.value = ''
    analysisError.value = ''
    if (isAnalyzing.value) {
      abortAnalysis()
    }
  } else {
    // 打开时重置为默认预设
    editablePresetPrompt.value = presetOptions.find((p) => p.id === selectedPreset.value)?.prompt || ''
  }
})
</script>

<template>
  <UModal v-model:open="open" :ui="{ width: 'max-w-3xl' }">
    <template #content>
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <h3 class="text-lg font-semibold">{{ t('analysis.filter.localAnalysisTitle') }}</h3>
            <UButton variant="ghost" icon="i-heroicons-x-mark" size="sm" @click="open = false" />
          </div>
        </template>

        <div class="space-y-4">
          <!-- 上下文摘要 -->
          <div class="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm">
            <div class="flex items-center gap-4 text-gray-600 dark:text-gray-400">
              <span>{{ filterResult?.blocks.length || 0 }} 个对话块</span>
              <span>{{ filterResult?.stats.totalMessages || 0 }} 条消息</span>
              <span>{{ filterResult?.stats.totalChars.toLocaleString() || 0 }} 字符</span>
            </div>
          </div>

          <!-- 分析模式切换 -->
          <div class="flex items-center gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg w-fit">
            <button
              class="px-3 py-1.5 text-sm font-medium rounded-md transition-colors"
              :class="
                analysisMode === 'preset'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              "
              @click="analysisMode = 'preset'"
            >
              {{ t('analysis.filter.presetAnalysis') }}
            </button>
            <button
              class="px-3 py-1.5 text-sm font-medium rounded-md transition-colors"
              :class="
                analysisMode === 'custom'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              "
              @click="analysisMode = 'custom'"
            >
              {{ t('analysis.filter.customAnalysis') }}
            </button>
          </div>

          <!-- 预设分析选项 -->
          <div v-if="analysisMode === 'preset'" class="space-y-3">
            <div class="grid grid-cols-2 gap-2">
              <label
                v-for="option in presetOptions"
                :key="option.id"
                class="flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-colors"
                :class="
                  selectedPreset === option.id
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                "
              >
                <input v-model="selectedPreset" type="radio" :value="option.id" class="text-primary-500" />
                <span class="text-sm text-gray-700 dark:text-gray-300">{{ option.label }}</span>
              </label>
            </div>

            <!-- 可编辑的提示词 -->
            <div class="space-y-1">
              <label class="text-xs text-gray-500 dark:text-gray-400">
                {{ t('analysis.filter.editablePromptLabel') }}
              </label>
              <UTextarea v-model="editablePresetPrompt" :rows="2" class="w-full text-sm" />
            </div>
          </div>

          <!-- 自定义提问 -->
          <div v-else>
            <UTextarea
              v-model="customPrompt"
              :placeholder="t('analysis.filter.customPromptPlaceholder')"
              :rows="3"
              class="w-full"
            />
          </div>

          <!-- 分析按钮 -->
          <div class="flex justify-end gap-2">
            <UButton v-if="isAnalyzing" color="red" variant="outline" @click="abortAnalysis">
              {{ t('common.cancel') }}
            </UButton>
            <UButton
              color="primary"
              :loading="isAnalyzing"
              :disabled="isAnalyzing || (analysisMode === 'custom' && !customPrompt.trim())"
              @click="executeAnalysis"
            >
              <UIcon name="i-heroicons-sparkles" class="w-4 h-4 mr-1" />
              {{ isAnalyzing ? t('analysis.filter.analyzing') : t('analysis.filter.startAnalysis') }}
            </UButton>
          </div>

          <!-- 分析结果 -->
          <div v-if="analysisResult || analysisError" class="border-t border-gray-200 dark:border-gray-700 pt-4">
            <div class="flex items-center justify-between mb-2">
              <h4 class="text-sm font-medium text-gray-700 dark:text-gray-300">
                {{ t('analysis.filter.analysisResult') }}
              </h4>
              <UButton v-if="analysisResult" size="xs" variant="ghost" @click="copyResult">
                <UIcon name="i-heroicons-clipboard" class="w-4 h-4 mr-1" />
                {{ t('common.copy') }}
              </UButton>
            </div>

            <!-- 错误提示 -->
            <div
              v-if="analysisError"
              class="p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm"
            >
              {{ analysisError }}
            </div>

            <!-- 结果内容 -->
            <div
              v-else-if="analysisResult"
              class="prose prose-sm dark:prose-invert max-w-none p-4 bg-gray-50 dark:bg-gray-800 rounded-lg max-h-80 overflow-y-auto"
              v-html="md.render(analysisResult)"
            />
          </div>
        </div>
      </UCard>
    </template>
  </UModal>
</template>
