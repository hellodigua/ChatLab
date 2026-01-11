<script setup lang="ts">
/**
 * 会话索引生成弹窗组件
 * 自动检测索引状态，未生成时通过 v-model 自动弹出
 * 使用 v-model 控制显示状态
 */
import { ref, watch, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  sessionId: string
  /** 弹窗打开状态（v-model） */
  modelValue?: boolean
}>()

const emit = defineEmits<{
  /** 更新 v-model */
  (e: 'update:modelValue', value: boolean): void
  /** 生成完成 */
  (e: 'generated', sessionCount: number): void
}>()

const { t } = useI18n()

// 状态
const hasIndex = ref(false)
const sessionCount = ref(0)
const isGenerating = ref(false)
const isLoading = ref(true)
// 是否是强制模式（未生成索引时自动弹出的情况）
const forceMode = ref(false)

// 是否打开（双向绑定）
const isOpen = computed({
  get: () => props.modelValue ?? false,
  set: (value) => emit('update:modelValue', value),
})

// 是否可以关闭弹窗
const canClose = computed(() => {
  // 强制模式下不允许关闭
  return !forceMode.value
})

// 检查会话索引状态并自动弹出
async function checkAndAutoOpen() {
  if (!props.sessionId) return

  isLoading.value = true
  try {
    const stats = await window.sessionApi.getStats(props.sessionId)
    hasIndex.value = stats.hasIndex
    sessionCount.value = stats.sessionCount

    // 如果未生成索引，自动弹出（强制模式）
    if (!hasIndex.value) {
      forceMode.value = true
      isOpen.value = true
    }
  } catch (error) {
    console.error('检查会话索引失败:', error)
  } finally {
    isLoading.value = false
  }
}

// 刷新状态（不自动弹出，用于手动打开时）
async function refreshStatus() {
  if (!props.sessionId) return

  isLoading.value = true
  try {
    const stats = await window.sessionApi.getStats(props.sessionId)
    hasIndex.value = stats.hasIndex
    sessionCount.value = stats.sessionCount
  } catch (error) {
    console.error('检查会话索引失败:', error)
  } finally {
    isLoading.value = false
  }
}

// 生成会话索引
async function generateSessionIndex() {
  if (!props.sessionId) return

  isGenerating.value = true
  try {
    // 从 localStorage 获取全局阈值配置
    const savedThreshold = localStorage.getItem('sessionGapThreshold')
    const gapThreshold = savedThreshold ? parseInt(savedThreshold, 10) : 1800 // 默认30分钟

    const count = await window.sessionApi.generate(props.sessionId, gapThreshold)
    hasIndex.value = true
    sessionCount.value = count
    emit('generated', count)

    // 生成完成后自动关闭
    forceMode.value = false
    isOpen.value = false
  } catch (error) {
    console.error('生成会话索引失败:', error)
  } finally {
    isGenerating.value = false
  }
}

// 关闭弹窗
function close() {
  if (!canClose.value) return
  isOpen.value = false
}

// 处理弹窗状态变化
function handleOpenChange(value: boolean) {
  if (!value && !canClose.value) {
    // 强制模式下不允许关闭
    return
  }

  isOpen.value = value

  // 手动打开时（非强制模式），刷新状态
  if (value && !forceMode.value) {
    refreshStatus()
  }
}

// sessionId 变化时重新检查并自动弹出
watch(
  () => props.sessionId,
  () => {
    checkAndAutoOpen()
  }
)

// 组件挂载时检查
onMounted(() => {
  checkAndAutoOpen()
})
</script>

<template>
  <UModal :open="isOpen" @update:open="handleOpenChange" :dismissible="canClose">
    <template #content>
      <div class="p-6">
        <!-- 头部 -->
        <div class="mb-4 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <div class="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
              <UIcon name="i-heroicons-clock" class="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
                {{ t('sessionIndex.title') }}
              </h3>
              <p class="text-sm text-gray-500 dark:text-gray-400">
                {{ t('sessionIndex.subtitle') }}
              </p>
            </div>
          </div>
          <UButton
            v-if="canClose"
            icon="i-heroicons-x-mark"
            color="neutral"
            variant="ghost"
            size="sm"
            @click="close"
          />
        </div>

        <!-- 加载中 -->
        <div v-if="isLoading" class="flex items-center justify-center py-8">
          <UIcon name="i-heroicons-arrow-path" class="h-6 w-6 animate-spin text-gray-400" />
        </div>

        <!-- 内容 -->
        <template v-else>
          <!-- 未生成索引 -->
          <div v-if="!hasIndex" class="space-y-4">
            <div class="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800/50 dark:bg-amber-900/20">
              <div class="flex gap-3">
                <UIcon name="i-heroicons-exclamation-triangle" class="h-5 w-5 shrink-0 text-amber-500" />
                <div>
                  <p class="text-sm font-medium text-amber-800 dark:text-amber-200">
                    {{ t('sessionIndex.notGenerated') }}
                  </p>
                  <p class="mt-1 text-sm text-amber-700 dark:text-amber-300">
                    {{ t('sessionIndex.notGeneratedHint') }}
                  </p>
                </div>
              </div>
            </div>

            <div class="rounded-lg bg-gray-50 p-4 dark:bg-gray-800/50">
              <h4 class="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                {{ t('sessionIndex.whatIsIt') }}
              </h4>
              <ul class="space-y-1 text-sm text-gray-600 dark:text-gray-400">
                <li class="flex items-start gap-2">
                  <UIcon name="i-heroicons-check" class="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                  {{ t('sessionIndex.benefit1') }}
                </li>
                <li class="flex items-start gap-2">
                  <UIcon name="i-heroicons-check" class="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                  {{ t('sessionIndex.benefit2') }}
                </li>
                <li class="flex items-start gap-2">
                  <UIcon name="i-heroicons-check" class="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                  {{ t('sessionIndex.benefit3') }}
                </li>
              </ul>
            </div>
          </div>

          <!-- 已生成索引 -->
          <div v-else class="space-y-4">
            <div class="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800/50 dark:bg-green-900/20">
              <div class="flex gap-3">
                <UIcon name="i-heroicons-check-circle" class="h-5 w-5 shrink-0 text-green-500" />
                <div>
                  <p class="text-sm font-medium text-green-800 dark:text-green-200">
                    {{ t('sessionIndex.generated') }}
                  </p>
                  <p class="mt-1 text-sm text-green-700 dark:text-green-300">
                    {{ t('sessionIndex.sessionCount', { count: sessionCount }) }}
                  </p>
                </div>
              </div>
            </div>

            <p class="text-sm text-gray-500 dark:text-gray-400">
              {{ t('sessionIndex.regenerateHint') }}
            </p>
          </div>
        </template>

        <!-- 操作按钮 -->
        <div class="mt-6 flex justify-end gap-2">
          <UButton v-if="canClose" variant="ghost" @click="close">
            {{ t('sessionIndex.cancel') }}
          </UButton>
          <UButton
            color="primary"
            :loading="isGenerating"
            @click="generateSessionIndex"
          >
            <UIcon v-if="!isGenerating" :name="hasIndex ? 'i-heroicons-arrow-path' : 'i-heroicons-sparkles'" class="mr-1 h-4 w-4" />
            {{ isGenerating ? t('sessionIndex.generating') : (hasIndex ? t('sessionIndex.regenerate') : t('sessionIndex.generate')) }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>

<i18n>
{
  "zh-CN": {
    "sessionIndex": {
      "title": "会话索引",
      "subtitle": "用于聊天记录的时间线导航",
      "notGenerated": "尚未生成会话索引",
      "notGeneratedHint": "生成会话索引后，您可以在聊天记录查看器中使用时间线快速导航到不同的会话。",
      "whatIsIt": "会话索引的作用：",
      "benefit1": "根据消息时间间隔自动识别会话边界",
      "benefit2": "在聊天记录查看器中提供时间线导航",
      "benefit3": "为 AI 分析提供对话上下文理解能力",
      "generated": "会话索引已生成",
      "sessionCount": "共识别出 {count} 个会话",
      "regenerateHint": "如果您调整了会话间隔阈值，可以重新生成索引。",
      "generate": "生成索引",
      "regenerate": "重新生成",
      "generating": "生成中...",
      "cancel": "取消"
    }
  },
  "en-US": {
    "sessionIndex": {
      "title": "Session Index",
      "subtitle": "For timeline navigation in chat records",
      "notGenerated": "Session index not generated",
      "notGeneratedHint": "After generating session index, you can use timeline navigation in the chat record viewer to quickly jump to different sessions.",
      "whatIsIt": "What session index does:",
      "benefit1": "Identify conversation boundaries based on message time gaps",
      "benefit2": "Provide timeline navigation in chat record viewer",
      "benefit3": "Enable AI analysis to understand conversation context",
      "generated": "Session index generated",
      "sessionCount": "{count} sessions identified",
      "regenerateHint": "You can regenerate the index if you've adjusted the session gap threshold.",
      "generate": "Generate Index",
      "regenerate": "Regenerate",
      "generating": "Generating...",
      "cancel": "Cancel"
    }
  }
}
</i18n>
