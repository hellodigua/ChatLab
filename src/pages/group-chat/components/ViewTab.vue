<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { SubTabs } from '@/components/UI'
import { MessageView, InteractionView } from '@/components/view'
import UserSelect from '@/components/common/UserSelect.vue'
import RankingTab from './RankingTab.vue'
import { isFeatureSupported, type LocaleType } from '@/i18n'
import type { MemberActivity } from '@/types/analysis'

const { t, locale } = useI18n()

interface TimeFilter {
  startTs?: number
  endTs?: number
}

// Props
const props = defineProps<{
  sessionId: string
  timeFilter?: TimeFilter
  // 榜单相关 props
  memberActivity?: MemberActivity[]
  selectedYear?: number
  availableYears?: number[]
}>()

// 子 Tab 配置（群聊专属：包含互动分析和榜单）
const subTabs = computed(() => {
  const tabs = [
    { id: 'message', label: t('analysis.subTabs.view.message'), icon: 'i-heroicons-chat-bubble-left-right' },
    { id: 'interaction', label: t('analysis.subTabs.view.interaction'), icon: 'i-heroicons-arrows-right-left' },
  ]
  // 榜单仅在中文下显示
  if (isFeatureSupported('groupRanking', locale.value as LocaleType)) {
    tabs.push({ id: 'ranking', label: t('analysis.subTabs.view.ranking'), icon: 'i-heroicons-trophy' })
  }
  return tabs
})

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
    <div class="flex-1 min-h-0 overflow-y-auto">
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
        <RankingTab
          v-else-if="activeSubTab === 'ranking'"
          :session-id="props.sessionId"
          :member-activity="props.memberActivity || []"
          :time-filter="props.timeFilter"
          :selected-year="props.selectedYear"
          :available-years="props.availableYears"
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
