<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { SubTabs } from '@/components/UI'
import ChatExplorer from './ai/ChatExplorer.vue'
import SQLLabTab from './SQLLabTab.vue'

const { t } = useI18n()

// Props
const props = defineProps<{
  sessionId: string
  sessionName: string
  timeFilter?: { startTs: number; endTs: number }
  chatType?: 'group' | 'private'
}>()

const route = useRoute()

// 判断是否为群聊（通过路由名称判断）
const isGroupChat = computed(() => route.name === 'group-chat')

// 仅群聊显示的功能 ID
const groupOnlyTabs = ['mbti', 'cyber-friend', 'campus']

// 所有子 Tab 配置
const allSubTabs = computed(() => [
  { id: 'chat-explorer', label: t('chatExplorer'), icon: 'i-heroicons-chat-bubble-left-ellipsis' },
  { id: 'sql-lab', label: t('sqlLab'), icon: 'i-heroicons-command-line' },
  {
    id: 'manual',
    label: t('filterAnalysis'),
    desc: t('filterAnalysisDesc'),
    icon: 'i-heroicons-adjustments-horizontal',
  },
])

// 根据聊天类型过滤显示的子 Tab
const subTabs = computed(() => {
  if (isGroupChat.value) {
    // 群聊显示所有 Tab
    return allSubTabs.value
  }
  // 私聊过滤掉群聊专属功能
  return allSubTabs.value.filter((tab) => !groupOnlyTabs.includes(tab.id))
})

const activeSubTab = ref('chat-explorer')

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

        <!-- 暂未实现的功能 -->
        <div
          v-else-if="['manual', 'mbti', 'cyber-friend', 'campus'].includes(activeSubTab)"
          class="main-content flex h-full items-center justify-center p-6"
        >
          <div
            class="flex h-full w-full items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/50"
          >
            <div class="text-center">
              <UIcon :name="subTabs.find((t) => t.id === activeSubTab)?.icon" class="mx-auto h-12 w-12 text-gray-400" />
              <p class="mt-3 text-sm font-medium text-gray-600 dark:text-gray-400">
                {{ t('featureInDev', { name: subTabs.find((tab) => tab.id === activeSubTab)?.label || '' }) }}
              </p>
              <p class="mt-1 max-w-md px-4 text-sm text-gray-500">
                {{ subTabs.find((tab) => tab.id === activeSubTab)?.desc || t('comingSoon') }}
              </p>

              <div class="mt-8 flex items-center justify-center gap-1 text-xs text-gray-400">
                <span>{{ t('followNotice') }}</span>
                <UButton
                  to="https://www.xiaohongshu.com/user/profile/6841741e000000001d0091b4"
                  target="_blank"
                  variant="link"
                  :padded="false"
                  class="text-xs font-medium"
                >
                  @地瓜
                </UButton>
              </div>
            </div>
          </div>
        </div>

        <!-- SQL 实验室 -->
        <SQLLabTab v-else-if="activeSubTab === 'sql-lab'" class="h-full" :session-id="props.sessionId" />
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

<i18n>
{
  "zh-CN": {
    "chatExplorer": "对话式探索",
    "sqlLab": "SQL实验室",
    "filterAnalysis": "筛选分析",
    "filterAnalysisDesc": "计划实现高级筛选功能，可以先按人/按时间/按搜索内容手动筛选，然后再进行AI分析",
    "featureInDev": "{name}功能开发中",
    "comingSoon": "敬请期待...",
    "followNotice": "功能上线通知，欢迎关注我的小红书"
  },
  "en-US": {
    "chatExplorer": "Chat Explorer",
    "sqlLab": "SQL Lab",
    "filterAnalysis": "Filter Analysis",
    "filterAnalysisDesc": "Advanced filtering feature is planned. You can filter by person, time, or search content before AI analysis",
    "featureInDev": "{name} is in development",
    "comingSoon": "Coming soon...",
    "followNotice": "Follow me on Xiaohongshu for updates"
  }
}
</i18n>
