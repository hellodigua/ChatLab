<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CatchphraseAnalysis } from '@/types/analysis'
import { ListPro } from '@/components/charts'
import { SectionCard, EmptyState, LoadingState } from '@/components/UI'

const { t } = useI18n()

interface TimeFilter {
  startTs?: number
  endTs?: number
}

const props = defineProps<{
  sessionId: string
  timeFilter?: TimeFilter
}>()

// ==================== 口头禅分析 ====================
const catchphraseAnalysis = ref<CatchphraseAnalysis | null>(null)
const isLoading = ref(false)

async function loadCatchphraseAnalysis() {
  if (!props.sessionId) return
  isLoading.value = true
  try {
    catchphraseAnalysis.value = await window.chatApi.getCatchphraseAnalysis(props.sessionId, props.timeFilter)
  } catch (error) {
    console.error('Failed to load catchphrase analysis:', error)
  } finally {
    isLoading.value = false
  }
}

function truncateContent(content: string, maxLength = 20): string {
  if (content.length <= maxLength) return content
  return content.slice(0, maxLength) + '...'
}

// 监听 sessionId 和 timeFilter 变化
watch(
  () => [props.sessionId, props.timeFilter],
  () => {
    loadCatchphraseAnalysis()
  },
  { immediate: true, deep: true }
)
</script>

<template>
  <div class="main-content mx-auto max-w-3xl p-6">
    <!-- 加载中 -->
    <LoadingState v-if="isLoading" :text="t('loading')" />

    <!-- 口头禅列表 -->
    <ListPro
      v-else-if="catchphraseAnalysis && catchphraseAnalysis.members.length > 0"
      :items="catchphraseAnalysis.members"
      :title="t('title')"
      :description="t('description', { count: catchphraseAnalysis.members.length })"
      :countTemplate="t('countTemplate')"
    >
      <template #item="{ item: member }">
        <div class="flex items-start gap-4">
          <div class="w-28 shrink-0 pt-1 font-medium text-gray-900 dark:text-white">
            {{ member.name }}
          </div>

          <div class="flex flex-1 flex-wrap items-center gap-2">
            <div
              v-for="(phrase, index) in member.catchphrases"
              :key="index"
              class="flex items-center gap-1.5 rounded-lg px-3 py-1.5"
              :class="
                index === 0
                  ? 'bg-amber-50 dark:bg-amber-900/20'
                  : index === 1
                    ? 'bg-gray-100 dark:bg-gray-800'
                    : 'bg-gray-50 dark:bg-gray-800/50'
              "
            >
              <span
                class="text-sm"
                :class="
                  index === 0 ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-gray-700 dark:text-gray-300'
                "
                :title="phrase.content"
              >
                {{ truncateContent(phrase.content) }}
              </span>
              <span class="text-xs text-gray-400">{{ t('times', { count: phrase.count }) }}</span>
            </div>
          </div>
        </div>
      </template>
    </ListPro>

    <!-- 空状态 -->
    <SectionCard v-else :title="t('title')">
      <EmptyState :text="t('empty')" />
    </SectionCard>
  </div>
</template>

<i18n>
{
  "zh-CN": {
    "title": "💬 口头禅分析",
    "loading": "正在分析口头禅数据...",
    "description": "分析了 {count} 位成员的高频发言",
    "countTemplate": "共 {count} 位成员",
    "times": "{count}次",
    "empty": "暂无口头禅数据"
  },
  "en-US": {
    "title": "💬 Catchphrase Analysis",
    "loading": "Analyzing catchphrases...",
    "description": "Analyzed frequent phrases from {count} members",
    "countTemplate": "{count} members",
    "times": "{count}x",
    "empty": "No catchphrase data available"
  }
}
</i18n>
