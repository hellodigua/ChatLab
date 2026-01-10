<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { MemeBattleAnalysis } from '@/types/analysis'
import { RankListPro, ListPro } from '@/components/charts'
import type { RankItem } from '@/components/charts'
import { LoadingState, Tabs } from '@/components/UI'
import { formatDate } from '@/utils/dateFormat'

interface TimeFilter {
  startTs?: number
  endTs?: number
}

const props = defineProps<{
  sessionId: string
  timeFilter?: TimeFilter
}>()

const analysis = ref<MemeBattleAnalysis | null>(null)
const isLoading = ref(false)
const activeTab = ref(0) // 0: 参与场次, 1: 图片数量

async function loadData() {
  if (!props.sessionId) return
  isLoading.value = true
  try {
    analysis.value = await window.chatApi.getMemeBattleAnalysis(props.sessionId, props.timeFilter)
  } catch (error) {
    console.error('加载斗图分析失败:', error)
  } finally {
    isLoading.value = false
  }
}

const rankDataByCount = computed<RankItem[]>(() => {
  if (!analysis.value) return []
  return analysis.value.rankByCount.map((m) => ({
    id: m.memberId.toString(),
    name: m.name,
    value: m.count,
    percentage: m.percentage,
  }))
})

const rankDataByImageCount = computed<RankItem[]>(() => {
  if (!analysis.value) return []
  return analysis.value.rankByImageCount.map((m) => ({
    id: m.memberId.toString(),
    name: m.name,
    value: m.count,
    percentage: m.percentage,
  }))
})

const currentRankData = computed(() => {
  return activeTab.value === 0 ? rankDataByCount.value : rankDataByImageCount.value
})

const rankTitle = computed(() => {
  return activeTab.value === 0 ? '斗图达人榜 (按场次)' : '斗图达人榜 (按图量)'
})

const rankUnit = computed(() => {
  return activeTab.value === 0 ? '场' : '张'
})

const rankDescription = computed(() => {
  return activeTab.value === 0 ? '参与斗图次数最多的人' : '在斗图中发送图片最多的人'
})

watch(
  () => [props.sessionId, props.timeFilter],
  () => loadData(),
  { immediate: true, deep: true }
)
</script>

<template>
  <div class="space-y-6">
    <LoadingState v-if="isLoading" text="正在统计斗图数据..." />

    <template v-else-if="analysis">
      <!-- 史诗级斗图榜 -->
      <ListPro
        v-if="analysis.topBattles.length > 0"
        :items="analysis.topBattles"
        title="⚔️ 史诗级斗图榜"
        description="记录最激烈的斗图大战（按图片数量排名）"
        :top-n="10"
        count-template="共 {count} 场战役"
      >
        <template #item="{ item, index }">
          <div class="flex items-start gap-4">
            <div
              class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
              :class="
                index === 0
                  ? 'bg-amber-500'
                  : index === 1
                    ? 'bg-gray-400'
                    : index === 2
                      ? 'bg-amber-700'
                      : 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
              "
            >
              {{ index + 1 }}
            </div>
            <div class="flex-1 space-y-2">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-medium text-gray-900 dark:text-white">
                    {{ formatDate(item.startTime) }}
                  </span>
                  <span class="text-xs text-gray-500">{{ item.participantCount }} 人参战</span>
                </div>
                <span class="text-sm font-bold text-pink-500">{{ item.totalImages }} 张</span>
              </div>

              <!-- 参战人员 -->
              <div class="flex flex-wrap gap-2">
                <div
                  v-for="p in item.participants.slice(0, 5)"
                  :key="p.memberId"
                  class="flex items-center gap-1.5 rounded-full bg-gray-50 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                >
                  <span class="font-medium">{{ p.name }}</span>
                  <span class="text-gray-400">{{ p.imageCount }}</span>
                </div>
                <span v-if="item.participants.length > 5" class="text-xs text-gray-400">
                  +{{ item.participants.length - 5 }}
                </span>
              </div>
            </div>
          </div>
        </template>
      </ListPro>

      <!-- 斗图达人榜 -->
      <div v-if="currentRankData.length > 0" class="relative">
        <div class="absolute top-5 right-42">
          <Tabs
            v-model="activeTab"
            :items="[
              { label: '按场次', value: 0 },
              { label: '按图量', value: 1 },
            ]"
            size="sm"
          />
        </div>
        <RankListPro :members="currentRankData" :title="rankTitle" :description="rankDescription" :unit="rankUnit" />
      </div>
    </template>
  </div>
</template>
