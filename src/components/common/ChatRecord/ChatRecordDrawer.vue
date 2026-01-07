<script setup lang="ts">
/**
 * 聊天记录查看器 Drawer
 * 主组件，组合筛选面板、消息列表等子组件
 */
import { ref, watch, toRaw, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import FilterPanel from './FilterPanel.vue'
import MessageList from './MessageList.vue'
import type { ChatRecordQuery } from './types'
import { useLayoutStore } from '@/stores/layout'

const { t } = useI18n()
const layoutStore = useLayoutStore()

// 消息列表组件引用
const messageListRef = ref<InstanceType<typeof MessageList> | null>(null)

// 本地查询条件（可编辑的副本）
const localQuery = ref<ChatRecordQuery>({})

// 消息数量
const messageCount = ref(0)

// 应用筛选
function handleApplyFilter(query: ChatRecordQuery) {
  localQuery.value = query
}

// 重置筛选
function handleResetFilter() {
  localQuery.value = {}
}

// 处理消息数量变化
function handleCountChange(count: number) {
  messageCount.value = count
}

// 监听 Drawer 打开
watch(
  () => layoutStore.showChatRecordDrawer,
  async (isOpen) => {
    if (isOpen) {
      // 复制查询参数到本地
      const query = toRaw(layoutStore.chatRecordQuery)
      localQuery.value = query ? { ...query } : {}
      // 等待 DOM 更新后主动触发加载
      await nextTick()
      messageListRef.value?.refresh()
    } else {
      // 关闭时清理
      localQuery.value = {}
      messageCount.value = 0
    }
  }
)
</script>

<template>
  <UDrawer v-model:open="layoutStore.showChatRecordDrawer" direction="right" :handle="false" :ui="{ content: 'z-100' }">
    <template #content>
      <div class="flex h-full w-[580px] flex-col bg-white dark:bg-gray-900">
        <!-- 头部 -->
        <div class="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('title') }}</h3>
          <UButton
            icon="i-heroicons-x-mark"
            color="neutral"
            variant="ghost"
            size="sm"
            @click="layoutStore.closeChatRecordDrawer()"
          />
        </div>

        <!-- 筛选面板 -->
        <FilterPanel :query="localQuery" @apply="handleApplyFilter" @reset="handleResetFilter" />

        <!-- 消息列表 -->
        <MessageList ref="messageListRef" :query="localQuery" @count-change="handleCountChange" />

        <!-- 底部统计 -->
        <div v-if="messageCount > 0" class="border-t border-gray-200 px-4 py-2 dark:border-gray-800">
          <span class="text-xs text-gray-500">{{ t('loadedCount', { count: messageCount }) }}</span>
        </div>
      </div>
    </template>
  </UDrawer>
</template>

<i18n>
{
  "zh-CN": {
    "title": "聊天记录查看器",
    "loadedCount": "已加载 {count} 条消息"
  },
  "en-US": {
    "title": "Chat Record Viewer",
    "loadedCount": "{count} messages loaded"
  }
}
</i18n>
