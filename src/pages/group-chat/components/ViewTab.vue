<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { SubTabs } from '@/components/UI'
import { MessageView, InteractionView } from '@/components/view'
import UserSelect from '@/components/common/UserSelect.vue'

const { t } = useI18n()

interface TimeFilter {
  startTs?: number
  endTs?: number
}

// Props
const props = defineProps<{
  sessionId: string
  timeFilter?: TimeFilter
}>()

// 子 Tab 配置（群聊专属：包含互动分析）
const subTabs = computed(() => [
  { id: 'message', label: t('message'), icon: 'i-heroicons-chat-bubble-left-right' },
  { id: 'interaction', label: t('interaction'), icon: 'i-heroicons-arrows-right-left' },
])

const activeSubTab = ref('message')

// 成员筛选
const selectedMemberId = ref<number | null>(null)
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 子 Tab 导航（右侧插槽放成员筛选） -->
    <SubTabs v-model="activeSubTab" :items="subTabs" persist-key="groupViewTab">
      <template #right>
        <UserSelect v-model="selectedMemberId" :session-id="props.sessionId" />
      </template>
    </SubTabs>

    <!-- 子 Tab 内容 -->
    <div class="flex-1 min-h-0 overflow-auto">
      <Transition name="fade" mode="out-in">
        <MessageView
          v-if="activeSubTab === 'message'"
          :session-id="props.sessionId"
          :time-filter="props.timeFilter"
          :member-id="selectedMemberId"
        />
        <InteractionView
          v-else-if="activeSubTab === 'interaction'"
          :session-id="props.sessionId"
          :time-filter="props.timeFilter"
          :member-id="selectedMemberId"
        />
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
    "message": "消息",
    "interaction": "互动分析"
  },
  "en-US": {
    "message": "Messages",
    "interaction": "Interactions"
  }
}
</i18n>
