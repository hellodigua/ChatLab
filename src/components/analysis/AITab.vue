<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { SubTabs } from '@/components/UI'
import { ChatExplorer } from '../AIChat'
import SQLLabTab from './SQLLabTab.vue'
import ToolTestTab from './ToolTestTab.vue'
import { useSettingsStore } from '@/stores/settings'

const { t } = useI18n()
const route = useRoute()
const settingsStore = useSettingsStore()

// Props
const props = defineProps<{
  sessionId: string
  sessionName: string
  timeFilter?: { startTs: number; endTs: number }
  chatType?: 'group' | 'private'
  mode?: 'full' | 'sql-only'
}>()

const subTabs = computed(() => {
  if (props.mode === 'sql-only') {
    const tabs = [
      { id: 'sql-lab', label: t('ai.tab.sqlLab'), icon: 'i-heroicons-command-line' },
    ]
    if (settingsStore.debugMode) {
      tabs.push({ id: 'tool-test', label: t('ai.lab.basicTools'), icon: 'i-heroicons-wrench-screwdriver' })
    }
    return tabs
  }

  return [
    { id: 'chat-explorer', label: t('ai.tab.chatExplorer'), icon: 'i-heroicons-chat-bubble-left-ellipsis' },
    { id: 'sql-lab', label: t('ai.tab.sqlLab'), icon: 'i-heroicons-command-line' },
  ]
})

const activeSubTab = ref(props.mode === 'sql-only' ? 'sql-lab' : (route.query.aiSubTab as string) || 'chat-explorer')

watch(
  () => route.query.aiSubTab,
  (nextTab) => {
    if (props.mode === 'sql-only') {
      if (nextTab === 'sql-lab' || (nextTab === 'tool-test' && settingsStore.debugMode)) {
        activeSubTab.value = nextTab
      }
      return
    }

    if (nextTab === 'chat-explorer' || nextTab === 'sql-lab') {
      activeSubTab.value = nextTab
    }
  }
)

watch(
  () => settingsStore.debugMode,
  (enabled) => {
    if (!enabled && activeSubTab.value === 'tool-test') {
      activeSubTab.value = 'sql-lab'
    }
  }
)

// ChatExplorer 组件引用
const chatExplorerRef = ref<InstanceType<typeof ChatExplorer> | null>(null)

// 刷新 AI 配置（供父组件调用）
function refreshAIConfig() {
  chatExplorerRef.value?.refreshConfig()
}

// 暴露方法供父组件调用
defineExpose({
  refreshAIConfig,
})
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 子 Tab 导航 -->
    <SubTabs v-model="activeSubTab" :items="subTabs" persist-key="aiTab" />

    <!-- 子 Tab 内容 -->
    <div class="flex-1 min-h-0 overflow-hidden">
      <Transition name="fade" mode="out-in">
        <!-- 对话式探索 -->
        <ChatExplorer
          v-if="activeSubTab === 'chat-explorer'"
          ref="chatExplorerRef"
          class="h-full"
          :session-id="sessionId"
          :session-name="sessionName"
          :time-filter="timeFilter"
          :chat-type="chatType"
        />
        <!-- 基础工具测试 -->
        <ToolTestTab
          v-else-if="activeSubTab === 'tool-test'"
          class="h-full"
          :session-id="props.sessionId"
        />
        <!-- SQL 实验室 -->
        <SQLLabTab v-else class="h-full" :session-id="props.sessionId" :chat-type="props.chatType" />
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
