<script setup lang="ts">
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { usePromptStore } from '@/stores/prompt'
import { useLayoutStore } from '@/stores/layout'

const { t } = useI18n()

// Props
const props = defineProps<{
  chatType: 'group' | 'private'
  sessionTokenUsage: { totalTokens: number }
  hasLLMConfig: boolean
  isCheckingConfig: boolean
}>()

// Store
const promptStore = usePromptStore()
const layoutStore = useLayoutStore()
const { aiPromptSettings, activePreset, aiGlobalSettings } = storeToRefs(promptStore)

// 当前类型对应的预设列表（根据 applicableTo 过滤）
const currentPresets = computed(() => promptStore.getPresetsForChatType(props.chatType))

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
</script>

<template>
  <div class="flex items-center justify-between px-1">
    <!-- 左侧：预设选择器 -->
    <UPopover v-model:open="isPresetPopoverOpen" :ui="{ content: 'p-0' }">
      <button
        class="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-300"
      >
        <UIcon name="i-heroicons-chat-bubble-bottom-center-text" class="h-3.5 w-3.5" />
        <span class="max-w-[120px] truncate">{{ currentActivePreset?.name || t('preset.default') }}</span>
        <UIcon name="i-heroicons-chevron-down" class="h-3 w-3" />
      </button>
      <template #content>
        <div class="w-48 py-1">
          <div class="px-3 py-1.5 text-xs font-medium text-gray-400 dark:text-gray-500">
            {{ chatType === 'group' ? t('preset.groupTitle') : t('preset.privateTitle') }}
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

          <!-- 新增预设按钮 -->
          <button
            class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            @click="openPresetSettings"
          >
            <UIcon name="i-heroicons-plus" class="h-4 w-4 shrink-0" />
            <span>{{ t('preset.new') }}</span>
          </button>
        </div>
      </template>
    </UPopover>

    <!-- 右侧：配置状态指示 -->
    <div class="flex items-center gap-3">
      <!-- 消息条数限制（点击跳转设置） -->
      <button
        class="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
        :title="t('messageLimit.title')"
        @click="openChatSettings"
      >
        <span>{{ t('messageLimit.label') }}{{ aiGlobalSettings.maxMessagesPerRequest }}</span>
      </button>
      <!-- Token 使用量 -->
      <div
        v-if="sessionTokenUsage.totalTokens > 0"
        class="flex items-center gap-1.5 text-xs text-gray-400"
        :title="t('tokenUsageTitle')"
      >
        <UIcon name="i-heroicons-chart-bar-square" class="h-3.5 w-3.5" />
        <span>{{ sessionTokenUsage.totalTokens.toLocaleString() }} tokens</span>
      </div>

      <!-- 配置状态 -->
      <div
        v-if="!isCheckingConfig"
        class="flex items-center gap-1.5 text-xs transition-colors"
        :class="[hasLLMConfig ? 'text-gray-400' : 'text-amber-500 font-medium']"
      >
        <span class="h-1.5 w-1.5 rounded-full" :class="[hasLLMConfig ? 'bg-green-500' : 'bg-amber-500']" />
        {{ hasLLMConfig ? t('status.connected') : t('status.notConfigured') }}
      </div>
    </div>
  </div>
</template>

<i18n>
{
  "zh-CN": {
    "preset": {
      "default": "默认预设",
      "groupTitle": "群聊提示词预设",
      "privateTitle": "私聊提示词预设",
      "new": "新增提示词"
    },
    "messageLimit": {
      "label": "消息上限：",
      "title": "每次发送的最大消息条数，点击配置"
    },
    "tokenUsageTitle": "本次会话累计 Token 使用量",
    "status": {
      "connected": "AI 已连接",
      "notConfigured": "请在全局设置中配置 AI 服务"
    }
  },
  "en-US": {
    "preset": {
      "default": "Default Preset",
      "groupTitle": "Group Chat Presets",
      "privateTitle": "Private Chat Presets",
      "new": "New Preset"
    },
    "messageLimit": {
      "label": "Limit: ",
      "title": "Max messages per request, click to configure"
    },
    "tokenUsageTitle": "Total token usage in this session",
    "status": {
      "connected": "AI Connected",
      "notConfigured": "Please configure AI service in Settings"
    }
  }
}
</i18n>
