<script setup lang="ts">
import { aiApi } from '@/services'
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useToast } from '@nuxt/ui/runtime/composables/useToast.js'
import { usePromptStore } from '@/stores/prompt'
import { useLayoutStore } from '@/stores/layout'
import { useLLMStore } from '@/stores/llm'
import type { AgentRuntimeStatus } from '@/services/agent'

const { t, locale } = useI18n()
const toast = useToast()

// Props
const props = defineProps<{
  chatType: 'group' | 'private'
  sessionTokenUsage: { totalTokens: number }
  agentStatus?: AgentRuntimeStatus | null
  hasLLMConfig: boolean
  isCheckingConfig: boolean
}>()

// Store
const promptStore = usePromptStore()
const layoutStore = useLayoutStore()
const llmStore = useLLMStore()
const { aiPromptSettings, activePreset, aiGlobalSettings } = storeToRefs(promptStore)
const { configs, activeConfig, isLoading: isLoadingLLM } = storeToRefs(llmStore)

// 当前类型对应的预设列表（根据 applicableTo 过滤）
const currentPresets = computed(() => promptStore.getPresetsForChatType(props.chatType))

// 当前激活的预设 ID
const currentActivePresetId = computed(() => aiPromptSettings.value.activePresetId)

// 当前激活的预设（如果当前激活的预设不适用于当前类型，使用第一个可用预设）
const currentActivePreset = computed(() => {
  const activeInList = currentPresets.value.find((p) => p.id === currentActivePresetId.value)
  return activeInList || activePreset.value
})

// 下拉菜单状态
const isPresetPopoverOpen = ref(false)
const isModelPopoverOpen = ref(false)
const isOpeningLog = ref(false)

const agentPhaseText = computed(() => {
  if (!props.agentStatus) return ''
  return t(`ai.chat.statusBar.agent.phase.${props.agentStatus.phase}`)
})

const agentPhaseShortText = computed(() => {
  if (!props.agentStatus) return ''
  return t(`ai.chat.statusBar.agent.phaseShort.${props.agentStatus.phase}`)
})

const agentPhaseClass = computed(() => {
  if (!props.agentStatus) return 'text-gray-500 bg-gray-100 dark:bg-gray-800 dark:text-gray-300'

  switch (props.agentStatus.phase) {
    case 'tool_running':
      return 'text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 dark:text-indigo-300'
    case 'thinking':
      return 'text-blue-600 bg-blue-50 dark:bg-blue-900/30 dark:text-blue-300'
    case 'responding':
      return 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-300'
    case 'completed':
      return 'text-green-600 bg-green-50 dark:bg-green-900/30 dark:text-green-300'
    case 'aborted':
      return 'text-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-300'
    case 'error':
      return 'text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-300'
    default:
      return 'text-gray-500 bg-gray-100 dark:bg-gray-800 dark:text-gray-300'
  }
})

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return new Intl.NumberFormat().format(Math.max(0, Math.round(value)))
}

const contextTokensText = computed(() => {
  if (!props.agentStatus) return '--'
  return formatCompactNumber(props.agentStatus.contextTokens)
})

function formatCompactNumber(value: number): string {
  const num = Math.max(0, Math.round(value))
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (num >= 1_000) return `${(num / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  return String(num)
}

const totalTokenUsageText = computed(() => formatNumber(props.sessionTokenUsage.totalTokens))
const totalTokenUsageCompactText = computed(() => formatCompactNumber(props.sessionTokenUsage.totalTokens))

const agentCompactTitle = computed(() => {
  if (!props.agentStatus) return ''
  return [
    `${t('ai.chat.statusBar.agent.label')}: ${agentPhaseText.value}`,
    `${t('ai.chat.statusBar.agent.contextTokens')}: ${formatNumber(props.agentStatus.contextTokens)}`,
    `${t('ai.chat.statusBar.tokenUsageTitle')}: ${totalTokenUsageText.value}`,
  ].join('\n')
})

// 设置激活预设
function setActivePreset(presetId: string) {
  promptStore.setActivePreset(presetId)
  isPresetPopoverOpen.value = false
}

// 打开设置弹窗并跳转到预设配置
function openPresetSettings() {
  isPresetPopoverOpen.value = false
  layoutStore.openSettingAt('ai', 'preset')
}

// 打开设置弹窗并跳转到对话配置（消息条数限制）
function openChatSettings() {
  layoutStore.openSettingAt('ai', 'chat')
}

// 切换 AI 模型配置
async function switchModelConfig(configId: string) {
  const success = await llmStore.setActiveConfig(configId)
  if (success) {
    isModelPopoverOpen.value = false
  } else {
    toast.add({
      title: t('ai.chat.statusBar.model.switchFailed'),
      icon: 'i-heroicons-x-circle',
      color: 'error',
      duration: 2000,
    })
  }
}

// 打开设置弹窗并跳转到模型配置
function openModelSettings() {
  isModelPopoverOpen.value = false
  layoutStore.openSettingAt('ai', 'model')
}

// 打开当前 AI 日志文件并定位到文件
async function openAiLogFile() {
  if (isOpeningLog.value) return
  isOpeningLog.value = true
  try {
    const result = await aiApi.showAiLogFile()
    if (!result?.success) {
      toast.add({
        title: t('ai.chat.statusBar.log.openFailed'),
        description: result?.error || t('ai.chat.statusBar.log.openFailedDesc'),
        icon: 'i-heroicons-x-circle',
        color: 'error',
        duration: 2000,
      })
    }
  } catch (error) {
    console.error('打开 AI 日志失败：', error)
    toast.add({
      title: t('ai.chat.statusBar.log.openFailed'),
      description: String(error),
      icon: 'i-heroicons-x-circle',
      color: 'error',
      duration: 2000,
    })
  } finally {
    isOpeningLog.value = false
  }
}
</script>

<template>
  <div class="flex items-center justify-between px-1">
    <!-- 左侧：预设选择器 + 模型切换器 -->
    <div class="flex items-center gap-1">
      <UPopover v-model:open="isPresetPopoverOpen" :ui="{ content: 'p-0' }">
        <button
          class="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-300"
        >
          <UIcon name="i-heroicons-chat-bubble-bottom-center-text" class="h-3.5 w-3.5" />
          <span class="max-w-[120px] truncate">
            {{ currentActivePreset?.name || t('ai.chat.statusBar.preset.default') }}
          </span>
          <UIcon name="i-heroicons-chevron-down" class="h-3 w-3" />
        </button>
        <template #content>
          <div class="w-48 py-1">
            <div class="px-3 py-1.5 text-xs font-medium text-gray-400 dark:text-gray-500">
              {{
                chatType === 'group'
                  ? t('ai.chat.statusBar.preset.groupTitle')
                  : t('ai.chat.statusBar.preset.privateTitle')
              }}
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
                  preset.id === currentActivePresetId ? 'i-heroicons-check-circle-solid' : 'i-heroicons-document-text'
                "
                class="h-4 w-4 shrink-0"
                :class="[preset.id === currentActivePresetId ? 'text-pink-500' : 'text-gray-400']"
              />
              <span class="truncate">{{ preset.name }}</span>
            </button>

            <!-- 分隔线 -->
            <div class="my-1 border-t border-gray-200 dark:border-gray-700" />

            <!-- 管理预设按钮 -->
            <button
              class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-300"
              @click="openPresetSettings"
            >
              <UIcon name="i-heroicons-cog-6-tooth" class="h-4 w-4 shrink-0" />
              <span>{{ t('ai.chat.statusBar.preset.manage') }}</span>
            </button>
          </div>
        </template>
      </UPopover>

      <!-- 模型切换器 -->
      <UPopover v-model:open="isModelPopoverOpen" :ui="{ content: 'p-0' }">
        <button
          class="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-300"
          :disabled="isLoadingLLM"
        >
          <UIcon name="i-heroicons-cpu-chip" class="h-3.5 w-3.5" />
          <span class="max-w-[120px] truncate">
            {{ activeConfig?.name || t('ai.chat.statusBar.model.notConfigured') }}
          </span>
          <UIcon name="i-heroicons-chevron-down" class="h-3 w-3" />
        </button>
        <template #content>
          <div class="w-48 py-1">
            <div class="px-3 py-1.5 text-xs font-medium text-gray-400 dark:text-gray-500">
              {{ t('ai.chat.statusBar.model.title') }}
            </div>

            <!-- 配置列表 -->
            <template v-if="configs.length > 0">
              <button
                v-for="config in configs"
                :key="config.id"
                class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
                :class="[
                  config.id === activeConfig?.id
                    ? 'text-pink-600 dark:text-pink-400'
                    : 'text-gray-700 dark:text-gray-300',
                ]"
                @click="switchModelConfig(config.id)"
              >
                <UIcon
                  :name="config.id === activeConfig?.id ? 'i-heroicons-check-circle-solid' : 'i-heroicons-cpu-chip'"
                  class="h-4 w-4 shrink-0"
                  :class="[config.id === activeConfig?.id ? 'text-pink-500' : 'text-gray-400']"
                />
                <span class="truncate">{{ config.name }}</span>
              </button>
            </template>

            <!-- 空状态 -->
            <div v-else class="px-3 py-2 text-sm text-gray-400 dark:text-gray-500">
              {{ t('ai.chat.statusBar.model.empty') }}
            </div>

            <!-- 分隔线 -->
            <div class="my-1 border-t border-gray-200 dark:border-gray-700" />

            <!-- 管理配置按钮 -->
            <button
              class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-300"
              @click="openModelSettings"
            >
              <UIcon name="i-heroicons-cog-6-tooth" class="h-4 w-4 shrink-0" />
              <span>{{ t('ai.chat.statusBar.model.manage') }}</span>
            </button>
          </div>
        </template>
      </UPopover>
    </div>

    <!-- 右侧：配置状态指示 -->
    <div class="flex items-center gap-1">
      <div
        v-if="agentStatus"
        class="hidden shrink-0 items-center gap-1 rounded-md border border-gray-200 bg-white px-1.5 py-1 text-xs dark:border-gray-700 dark:bg-gray-900 lg:flex"
        :title="agentCompactTitle"
      >
        <span class="rounded px-1 py-0.5 text-[10px] font-medium" :class="agentPhaseClass">
          {{ agentPhaseShortText }}
        </span>
        <UIcon name="i-heroicons-document-text" class="h-3 w-3 text-gray-400 dark:text-gray-500" />
        <span class="text-[10px] text-gray-500 dark:text-gray-400">{{ contextTokensText }}</span>
      </div>

      <div
        class="hidden shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs text-gray-400 dark:text-gray-500 md:flex"
        :title="t('ai.chat.statusBar.tokenUsageTitle')"
      >
        <UIcon name="i-heroicons-circle-stack" class="h-3.5 w-3.5" />
        <span>{{ totalTokenUsageCompactText }}</span>
      </div>

      <!-- 消息条数限制（点击跳转设置） -->
      <button
        class="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
        :title="t('ai.chat.statusBar.messageLimit.title')"
        @click="openChatSettings"
      >
        <UIcon name="i-heroicons-adjustments-horizontal" class="h-3.5 w-3.5" />
        <span class="hidden lg:inline">{{ t('ai.chat.statusBar.messageLimit.label') }}</span>
        <span>{{ aiGlobalSettings.maxMessagesPerRequest }}</span>
      </button>
      <!-- 日志按钮 -->
      <button
        class="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-gray-800 dark:hover:text-gray-300"
        :title="t('ai.chat.statusBar.log.title')"
        :disabled="isOpeningLog"
        @click="openAiLogFile"
      >
        <UIcon name="i-heroicons-folder-open" class="h-3.5 w-3.5" />
        <span class="hidden xl:inline">{{ t('ai.chat.statusBar.log.label') }}</span>
      </button>
    </div>
  </div>
</template>
