<script setup lang="ts">
/**
 * 互动分析视图（群聊专属）
 * 展示成员间的 @ 互动关系图
 */
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { EChartGraph } from '@/components/charts'
import type { EChartGraphData } from '@/components/charts'

const { t } = useI18n()

interface TimeFilter {
  startTs?: number
  endTs?: number
}

// Props
const props = defineProps<{
  sessionId: string
  timeFilter?: TimeFilter
  memberId?: number | null
}>()

// 数据状态
const isLoading = ref(true)
const graphData = ref<EChartGraphData>({ nodes: [], links: [], maxLinkValue: 0 })

// 布局切换
const layoutType = ref<'circular' | 'force'>('circular')

// 方向切换（有向图 vs 无向图）
const showDirection = ref(false)

// 图表引用
const graphRef = ref<InstanceType<typeof EChartGraph> | null>(null)

// 重置视图
function handleResetView() {
  graphRef.value?.resetView()
}

// 合并 timeFilter 和 memberId 的 filter
const effectiveFilter = computed(() => ({
  ...props.timeFilter,
  memberId: props.memberId,
}))

// 加载数据
async function loadData() {
  if (!props.sessionId) return

  isLoading.value = true
  try {
    const data = await window.chatApi.getMentionGraph(props.sessionId, effectiveFilter.value)
    graphData.value = {
      nodes: data.nodes,
      links: data.links,
      maxLinkValue: data.maxLinkValue,
    }
  } catch (error) {
    console.error('加载互动关系图数据失败:', error)
  } finally {
    isLoading.value = false
  }
}

// 监听 props 变化
watch(
  () => [props.sessionId, props.timeFilter, props.memberId],
  () => {
    loadData()
  },
  { immediate: true, deep: true }
)
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 顶部工具栏（仅右上角控制） -->
    <div class="flex items-center justify-end px-4 py-2">
      <div class="flex items-center gap-4">
        <!-- 布局切换 -->
        <div class="flex items-center gap-2">
          <span class="text-xs text-gray-400">{{ t('layout') }}:</span>
          <UButtonGroup size="xs">
            <UButton
              :color="layoutType === 'circular' ? 'primary' : 'neutral'"
              :variant="layoutType === 'circular' ? 'solid' : 'ghost'"
              @click="layoutType = 'circular'"
            >
              {{ t('circular') }}
            </UButton>
            <UButton
              :color="layoutType === 'force' ? 'primary' : 'neutral'"
              :variant="layoutType === 'force' ? 'solid' : 'ghost'"
              @click="layoutType = 'force'"
            >
              {{ t('force') }}
            </UButton>
          </UButtonGroup>
        </div>
        <!-- 方向切换 -->
        <div class="flex items-center gap-2">
          <span class="text-xs text-gray-400">{{ t('directed') }}:</span>
          <USwitch v-model="showDirection" size="xs" />
        </div>
        <!-- 重置视图 -->
        <UButton size="xs" color="neutral" variant="ghost" icon="i-heroicons-arrow-path" @click="handleResetView">
          {{ t('reset') }}
        </UButton>
      </div>
    </div>

    <!-- 图表区域（全屏） -->
    <div class="flex-1 min-h-0 relative">
      <!-- 加载状态 -->
      <div v-if="isLoading" class="absolute inset-0 flex items-center justify-center">
        <UIcon name="i-heroicons-arrow-path" class="h-8 w-8 animate-spin text-pink-500" />
      </div>

      <!-- 图表 -->
      <template v-else>
        <div v-if="graphData.nodes.length > 0" class="h-full">
          <EChartGraph
            ref="graphRef"
            :data="graphData"
            :layout="layoutType"
            :directed="showDirection"
            :height="'100%'"
          />
          <!-- 底部统计信息 -->
          <div
            class="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-gray-100/80 px-3 py-1 text-xs text-gray-500 backdrop-blur-sm dark:bg-gray-800/80 dark:text-gray-400"
          >
            {{ t('graphHint', { nodes: graphData.nodes.length, links: graphData.links.length }) }}
          </div>
        </div>
        <div v-else class="flex h-full items-center justify-center text-gray-400">
          <div class="text-center">
            <UIcon name="i-heroicons-user-group" class="mx-auto h-10 w-10 text-gray-300 dark:text-gray-600" />
            <p class="mt-2 text-sm">{{ t('noInteraction') }}</p>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<i18n>
{
  "zh-CN": {
    "mentionGraph": "艾特互动关系图",
    "layout": "布局",
    "circular": "环形",
    "force": "力导向",
    "directed": "有向",
    "reset": "重置",
    "graphHint": "共 {nodes} 位成员，{links} 条互动关系",
    "noInteraction": "暂无艾特互动数据"
  },
  "en-US": {
    "mentionGraph": "Mention Interaction Graph",
    "layout": "Layout",
    "circular": "Circular",
    "force": "Force",
    "directed": "Directed",
    "reset": "Reset",
    "graphHint": "{nodes} members, {links} interactions",
    "noInteraction": "No mention interaction data"
  }
}
</i18n>
