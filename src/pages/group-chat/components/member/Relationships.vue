<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { MentionAnalysis, MemberMentionDetail } from '@/types/analysis'
import { RankListPro } from '@/components/charts'
import type { RankItem } from '@/components/charts'
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

// ==================== @ 互动分析 ====================
const mentionAnalysis = ref<MentionAnalysis | null>(null)
const isLoadingMention = ref(false)
const selectedMemberDetail = ref<MemberMentionDetail | null>(null)
const showMemberDetailModal = ref(false)

async function loadMentionAnalysis() {
  if (!props.sessionId) return
  isLoadingMention.value = true
  try {
    mentionAnalysis.value = await window.chatApi.getMentionAnalysis(props.sessionId, props.timeFilter)
  } catch (error) {
    console.error('加载 @ 互动分析失败:', error)
  } finally {
    isLoadingMention.value = false
  }
}

const mentionerRankData = computed<RankItem[]>(() => {
  if (!mentionAnalysis.value) return []
  return mentionAnalysis.value.topMentioners.map((m) => ({
    id: m.memberId.toString(),
    name: m.name,
    value: m.count,
    percentage: m.percentage,
  }))
})

const mentionedRankData = computed<RankItem[]>(() => {
  if (!mentionAnalysis.value) return []
  return mentionAnalysis.value.topMentioned.map((m) => ({
    id: m.memberId.toString(),
    name: m.name,
    value: m.count,
    percentage: m.percentage,
  }))
})

function openMemberDetail(memberId: number) {
  if (!mentionAnalysis.value) return
  const detail = mentionAnalysis.value.memberDetails.find((d) => d.memberId === memberId)
  if (detail) {
    selectedMemberDetail.value = detail
    showMemberDetailModal.value = true
  }
}

watch(
  () => [props.sessionId, props.timeFilter],
  () => {
    loadMentionAnalysis()
  },
  { immediate: true, deep: true }
)
</script>

<template>
  <div class="main-content space-y-6 p-6">
    <!-- @ 互动分析模块 -->
    <LoadingState v-if="isLoadingMention" :text="t('loading')" />

    <template v-else-if="mentionAnalysis && mentionAnalysis.totalMentions > 0">
      <!-- @ 排行榜 -->
      <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RankListPro
          v-if="mentionerRankData.length > 0"
          :members="mentionerRankData"
          :title="t('topMentioners')"
          :description="t('totalMentions', { count: mentionAnalysis.totalMentions })"
          :unit="t('times')"
        />

        <RankListPro
          v-if="mentionedRankData.length > 0"
          :members="mentionedRankData"
          :title="t('topMentioned')"
          :description="t('popularMember')"
          :unit="t('times')"
        />
      </div>

      <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <!-- 单向关注 -->
        <!-- 有严重BUG，很不准，先隐藏 -->
        <SectionCard
          class="hidden"
          v-if="mentionAnalysis.oneWay.length > 0"
          :title="t('oneWay.title')"
          :description="t('oneWay.description', { count: mentionAnalysis.oneWay.length })"
        >
          <div class="divide-y divide-gray-100 dark:divide-gray-800">
            <div
              v-for="(pair, index) in mentionAnalysis.oneWay.slice(0, 10)"
              :key="index"
              class="flex items-center gap-4 px-5 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50"
            >
              <!-- 排名 -->
              <span
                class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                :class="
                  index === 0
                    ? 'bg-pink-100 text-pink-600 dark:bg-pink-900/30 dark:text-pink-400'
                    : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500'
                "
              >
                {{ index + 1 }}
              </span>

              <!-- 关系展示 -->
              <div class="flex flex-1 items-center gap-2">
                <button
                  class="font-medium text-gray-900 hover:text-pink-600 dark:text-white dark:hover:text-pink-600"
                  @click="openMemberDetail(pair.fromMemberId)"
                >
                  {{ pair.fromName }}
                </button>
                <div class="flex items-center gap-1 text-pink-500">
                  <span class="text-lg">→</span>
                  <span class="text-xs">{{ pair.fromToCount }}次</span>
                </div>
                <button
                  class="font-medium text-gray-900 hover:text-pink-600 dark:text-white dark:hover:text-pink-600"
                  @click="openMemberDetail(pair.toMemberId)"
                >
                  {{ pair.toName }}
                </button>
              </div>

              <!-- 反向数据 -->
              <div class="shrink-0 text-right text-sm text-gray-500">
                <span v-if="pair.toFromCount === 0" class="text-red-500">{{ t('oneWay.neverRespond') }}</span>
                <span v-else>{{ t('oneWay.reverse', { count: pair.toFromCount }) }}</span>
              </div>

              <!-- 单向比例标签 -->
              <UBadge color="pink" variant="soft" size="xs">{{ t('oneWay.ratio', { value: Math.round(pair.ratio * 100) }) }}</UBadge>
            </div>
          </div>
        </SectionCard>

        <!-- 双向奔赴（CP检测） -->
        <SectionCard
          v-if="mentionAnalysis.twoWay.length > 0"
          :title="t('twoWay.title')"
          :description="t('twoWay.description', { count: mentionAnalysis.twoWay.length })"
        >
          <div class="divide-y divide-gray-100 dark:divide-gray-800">
            <div
              v-for="(pair, index) in mentionAnalysis.twoWay.slice(0, 10)"
              :key="index"
              class="flex items-center gap-4 px-5 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50"
            >
              <!-- 排名 -->
              <span
                class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                :class="
                  index === 0
                    ? 'bg-linear-to-r from-pink-400 to-red-400 text-white'
                    : index === 1
                      ? 'bg-linear-to-r from-pink-300 to-red-300 text-white'
                      : index === 2
                        ? 'bg-linear-to-r from-pink-200 to-red-200 text-pink-700'
                        : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500'
                "
              >
                {{ index + 1 }}
              </span>

              <!-- CP 关系展示 -->
              <div class="flex flex-1 items-center gap-2">
                <button
                  class="font-medium text-gray-900 hover:text-pink-600 dark:text-white dark:hover:text-pink-600"
                  @click="openMemberDetail(pair.member1Id)"
                >
                  {{ pair.member1Name }}
                </button>
                <div class="flex items-center gap-1">
                  <span class="text-xs text-gray-400">{{ pair.member1To2 }}</span>
                  <span class="text-lg text-pink-500">⇄</span>
                  <span class="text-xs text-gray-400">{{ pair.member2To1 }}</span>
                </div>
                <button
                  class="font-medium text-gray-900 hover:text-pink-600 dark:text-white dark:hover:text-pink-600"
                  @click="openMemberDetail(pair.member2Id)"
                >
                  {{ pair.member2Name }}
                </button>
              </div>

              <!-- 总互动次数 -->
              <div class="shrink-0 text-right">
                <span class="text-lg font-bold text-pink-600">{{ pair.total }}</span>
                <span class="ml-1 text-sm text-gray-500">{{ t('twoWay.interactions') }}</span>
              </div>

              <!-- 平衡度标签 -->
              <UBadge
                :color="pair.balance >= 0.7 ? 'green' : pair.balance >= 0.5 ? 'blue' : 'gray'"
                variant="soft"
                size="xs"
              >
                {{ t('twoWay.balance', { value: Math.round(pair.balance * 100) }) }}
              </UBadge>
            </div>
          </div>
        </SectionCard>
      </div>
    </template>

    <SectionCard v-else-if="!isLoadingMention" :title="t('emptyTitle')">
      <EmptyState :text="t('empty')" />
    </SectionCard>

    <!-- 成员 @ 详情弹窗 -->
    <UModal v-model:open="showMemberDetailModal">
      <template #content>
        <div v-if="selectedMemberDetail" class="p-5">
          <h3 class="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
            {{ t('modal.title', { name: selectedMemberDetail.name }) }}
          </h3>

          <!-- 该成员最常 @ 的人 -->
          <div v-if="selectedMemberDetail.topMentioned.length > 0" class="mb-4">
            <h4 class="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">{{ t('modal.topMentioned') }}</h4>
            <div class="space-y-2">
              <div
                v-for="(item, index) in selectedMemberDetail.topMentioned"
                :key="index"
                class="flex items-center gap-3 rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-800"
              >
                <span class="text-sm font-medium text-gray-900 dark:text-white">
                  {{ item.toName }}
                </span>
                <span class="text-xs text-gray-500">{{ t('modal.timesCount', { count: item.count }) }}</span>
              </div>
            </div>
          </div>

          <!-- 最常 @ 该成员的人 -->
          <div v-if="selectedMemberDetail.topMentioners.length > 0">
            <h4 class="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">{{ t('modal.topMentioners') }}</h4>
            <div class="space-y-2">
              <div
                v-for="(item, index) in selectedMemberDetail.topMentioners"
                :key="index"
                class="flex items-center gap-3 rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-800"
              >
                <span class="text-sm font-medium text-gray-900 dark:text-white">
                  {{ item.fromName }}
                </span>
                <span class="text-xs text-gray-500">{{ t('modal.timesCount', { count: item.count }) }}</span>
              </div>
            </div>
          </div>

          <div class="mt-4 flex justify-end">
            <UButton variant="soft" @click="showMemberDetailModal = false">{{ t('modal.close') }}</UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>

<i18n>
{
  "zh-CN": {
    "loading": "正在分析 {'@'} 互动数据...",
    "topMentioners": "📢 谁最喜欢 {'@'} 别人",
    "totalMentions": "共 {count} 次 {'@'}",
    "topMentioned": "🎯 谁最常被 {'@'}",
    "popularMember": "群里的人气王",
    "times": "次",
    "oneWay": {
      "title": "🐕 单向关注检测",
      "description": "发现 {count} 对单向关注关系（一方 {'@'} 另一方占比 ≥80%）",
      "neverRespond": "从不回应",
      "reverse": "反向 {count} 次",
      "ratio": "{value}% 单向"
    },
    "twoWay": {
      "title": "💕 双向奔赴检测",
      "description": "发现 {count} 对互动频繁的 CP（互相 {'@'} 且平衡度 ≥30%）",
      "interactions": "次互动",
      "balance": "{value}% 平衡"
    },
    "emptyTitle": "📱 {'@'} 互动分析",
    "empty": "暂无 {'@'} 互动数据",
    "modal": {
      "title": "{name} 的 {'@'} 关系",
      "topMentioned": "最常 {'@'} 的人",
      "topMentioners": "最常 {'@'} TA 的人",
      "timesCount": "{count} 次",
      "close": "关闭"
    }
  },
  "en-US": {
    "loading": "Analyzing {'@'} interaction data...",
    "topMentioners": "📢 Top {'@'} Initiators",
    "totalMentions": "{count} total {'@'}s",
    "topMentioned": "🎯 Most {'@'} Mentioned",
    "popularMember": "Most popular in the group",
    "times": "times",
    "oneWay": {
      "title": "🐕 One-way Detection",
      "description": "Found {count} one-way relationships (one party {'@'} another ≥80%)",
      "neverRespond": "Never responds",
      "reverse": "{count}x reverse",
      "ratio": "{value}% one-way"
    },
    "twoWay": {
      "title": "💕 Mutual Detection",
      "description": "Found {count} frequent CP pairs (mutual {'@'} with ≥30% balance)",
      "interactions": "interactions",
      "balance": "{value}% balanced"
    },
    "emptyTitle": "📱 {'@'} Interaction Analysis",
    "empty": "No {'@'} interaction data available",
    "modal": {
      "title": "{name}'s {'@'} Relationships",
      "topMentioned": "Most frequently {'@'}s",
      "topMentioners": "Most frequently {'@'}d by",
      "timesCount": "{count}x",
      "close": "Close"
    }
  }
}
</i18n>
