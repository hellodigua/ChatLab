<script setup lang="ts">
import { computed } from 'vue'
import type { MemberActivity } from '@/types/analysis'
import { RankListPro } from '@/components/charts'
import type { RankItem } from '@/components/charts'
import { PageAnchorsNav } from '@/components/UI'
import { usePageAnchors } from '@/composables'
import DragonKingRank from './ranking/DragonKingRank.vue'
import CheckInRank from './ranking/CheckInRank.vue'
import MemeBattleRank from './ranking/MemeBattleRank.vue'
import MonologueRank from './ranking/MonologueRank.vue'
import RepeatSection from './ranking/RepeatSection.vue'
import DivingRank from './ranking/DivingRank.vue'
import NightOwlRank from './ranking/NightOwlRank.vue'

interface TimeFilter {
  startTs?: number
  endTs?: number
}

const props = defineProps<{
  sessionId: string
  memberActivity: MemberActivity[]
  timeFilter?: TimeFilter
  selectedYear?: number // 0 或 undefined 表示全部时间
  availableYears?: number[] // 可用年份列表（用于生成全部时间的标题）
}>()

// 计算赛季标题
const seasonTitle = computed(() => {
  if (props.selectedYear && props.selectedYear > 0) {
    return `${props.selectedYear} 赛季`
  }
  // 全部时间：显示年份范围
  if (props.availableYears && props.availableYears.length > 0) {
    const sorted = [...props.availableYears].sort((a, b) => a - b)
    const minYear = sorted[0]
    const maxYear = sorted[sorted.length - 1]
    if (minYear === maxYear) {
      return `${minYear} 赛季`
    }
    return `${minYear}-${maxYear} 赛季`
  }
  return '全部赛季'
})

// 锚点导航配置
const anchors = [
  { id: 'dragon-king', label: '🐉 龙王榜' },
  { id: 'member-activity', label: '📊 水群榜' },
  { id: 'streak-rank', label: '🔥 火花榜' },
  { id: 'loyalty-rank', label: '💎 忠臣榜' },
  { id: 'meme-battle', label: '⚔️ 斗图榜' },
  { id: 'monologue', label: '🎤 自言自语榜' },
  { id: 'repeat', label: '🔁 复读榜' },
  { id: 'night-owl', label: '🦉 修仙榜' },
  { id: 'diving', label: '🤿 潜水榜' },
]

// 使用锚点导航 composable
const { contentRef, activeAnchor, scrollToAnchor } = usePageAnchors(anchors, { threshold: 350 })
// Template ref - used via ref="contentRef" in template
void contentRef

// ==================== 成员活跃度排行 ====================
const memberRankData = computed<RankItem[]>(() => {
  return props.memberActivity.map((m) => ({
    id: m.memberId.toString(),
    name: m.name,
    value: m.messageCount,
    percentage: m.percentage,
  }))
})
</script>

<template>
  <div ref="contentRef" class="flex gap-6 p-6">
    <!-- 主内容区 -->
    <div class="main-content min-w-0 flex-1 px-8 mx-auto max-w-3xl space-y-6">
      <!-- 赛季大标题 -->
      <div class="mb-8 mt-4">
        <h1
          class="bg-gradient-to-r from-amber-500 via-pink-500 to-purple-600 bg-clip-text text-5xl font-extrabold tracking-wider text-transparent"
        >
          🏆 {{ seasonTitle }}
        </h1>
        <p class="mt-4 text-sm text-gray-500 dark:text-gray-400">各榜单前三名请找群主领取奖励 🎁</p>
      </div>

      <!-- 龙王排名 -->
      <div id="dragon-king" class="scroll-mt-24">
        <DragonKingRank :session-id="sessionId" :time-filter="timeFilter" />
      </div>

      <!-- 成员活跃度排行 -->
      <div id="member-activity" class="scroll-mt-24">
        <RankListPro :members="memberRankData" title="水群榜" />
      </div>

      <!-- 火花榜 + 忠臣榜 -->
      <CheckInRank :session-id="sessionId" :time-filter="timeFilter" />

      <!-- 斗图榜 -->
      <div id="meme-battle" class="scroll-mt-24">
        <MemeBattleRank :session-id="sessionId" :time-filter="timeFilter" />
      </div>

      <!-- 自言自语榜 -->
      <div id="monologue" class="scroll-mt-24">
        <MonologueRank :session-id="sessionId" :time-filter="timeFilter" />
      </div>

      <!-- 复读分析 -->
      <div id="repeat" class="scroll-mt-24">
        <RepeatSection :session-id="sessionId" :time-filter="timeFilter" />
      </div>

      <!-- 修仙排行榜 -->
      <div id="night-owl" class="scroll-mt-24">
        <NightOwlRank :session-id="sessionId" :time-filter="timeFilter" />
      </div>

      <!-- 潜水排名 -->
      <div id="diving" class="scroll-mt-24">
        <DivingRank :session-id="sessionId" :time-filter="timeFilter" />
      </div>
      <!-- 底部间距，确保最后一个锚点可以滚动到顶部 -->
      <div class="h-48 no-capture" />
    </div>

    <!-- 右侧锚点导航 -->
    <PageAnchorsNav :anchors="anchors" :active-anchor="activeAnchor" @click="scrollToAnchor" />
  </div>
</template>
