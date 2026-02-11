<script setup lang="ts">
/**
 * 小团体关系视图
 * 支持两种展示模式：矩阵热力图 和 圈子视图
 */
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import * as echarts from 'echarts/core'
import { HeatmapChart } from 'echarts/charts'
import { TooltipComponent, GridComponent, VisualMapComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { useDark } from '@vueuse/core'
import type { EChartsOption } from 'echarts'
import type { ClusterGraphData, ClusterGraphOptions, ClusterGraphNode } from '@/types/analysis'

echarts.use([HeatmapChart, TooltipComponent, GridComponent, VisualMapComponent, CanvasRenderer])

const { t } = useI18n()

interface TimeFilter {
  startTs?: number
  endTs?: number
}

const props = defineProps<{
  sessionId: string
  timeFilter?: TimeFilter
  memberId?: number | null
}>()

// 数据状态
const isLoading = ref(true)
const graphData = ref<ClusterGraphData | null>(null)

// 视图模式
const viewMode = ref<'matrix' | 'member' | 'circle'>('matrix')

// 成员视图状态
const selectedMemberId = ref<number | null>(null)

// 模型参数
const modelOptions = ref<ClusterGraphOptions>({
  lookAhead: 3,
  decaySeconds: 120,
  topEdges: 150,
})

// 图表引用
const chartRef = ref<HTMLElement | null>(null)
let chartInstance: echarts.ECharts | null = null
const isDark = useDark()

// 加载数据
async function loadData() {
  console.log('[ClusterView] loadData called', {
    sessionId: props.sessionId,
    viewMode: viewMode.value,
    hasChartInstance: !!chartInstance,
  })
  if (!props.sessionId) return

  isLoading.value = true
  try {
    const filter = props.timeFilter ? { ...props.timeFilter } : undefined
    const options = {
      lookAhead: modelOptions.value.lookAhead,
      decaySeconds: modelOptions.value.decaySeconds,
      topEdges: modelOptions.value.topEdges,
    }
    console.log('[ClusterView] calling getClusterGraph with options', options)
    graphData.value = await window.chatApi.getClusterGraph(props.sessionId, filter, options)
    console.log('[ClusterView] getClusterGraph returned', {
      nodeCount: graphData.value?.nodes?.length,
      linkCount: graphData.value?.links?.length,
    })
  } catch (error) {
    console.error('加载小团体关系数据失败:', error)
    graphData.value = null
  } finally {
    isLoading.value = false
    console.log('[ClusterView] loadData finished, isLoading =', isLoading.value)
  }
}

// ==================== 矩阵热力图 ====================

// 构建矩阵数据
const matrixData = computed(() => {
  if (!graphData.value || graphData.value.nodes.length === 0) return null

  const { nodes, links, maxLinkValue } = graphData.value

  // 按消息数排序的成员名（限制数量避免过于拥挤）
  const sortedNodes = [...nodes].sort((a, b) => b.messageCount - a.messageCount).slice(0, 20)
  const names = sortedNodes.map((n) => n.name)

  // 构建关系矩阵
  const linkMap = new Map<string, number>()
  for (const link of links) {
    linkMap.set(`${link.source}-${link.target}`, link.value)
    linkMap.set(`${link.target}-${link.source}`, link.value)
  }

  // 生成热力图数据
  const data: Array<[number, number, number]> = []
  for (let i = 0; i < names.length; i++) {
    for (let j = 0; j < names.length; j++) {
      if (i === j) {
        data.push([i, j, -1]) // 对角线标记为 -1
      } else {
        const value = linkMap.get(`${names[i]}-${names[j]}`) || 0
        data.push([i, j, value])
      }
    }
  }

  return { names, data, maxValue: maxLinkValue }
})

// 构建热力图选项
function buildHeatmapOptions(): EChartsOption {
  if (!matrixData.value) {
    return { graphic: { type: 'text', style: { text: t('views.cluster.noData'), fill: '#999' } } }
  }

  const { names, data, maxValue } = matrixData.value

  return {
    tooltip: {
      position: 'top',
      formatter: (params: any) => {
        const [x, y, value] = params.data
        if (value < 0) return `${names[x]}`
        if (value === 0) return `${names[x]} ↔ ${names[y]}<br/>暂无关系数据`
        return `${names[x]} ↔ ${names[y]}<br/>临近度: ${value.toFixed(2)}`
      },
    },
    grid: {
      left: 120,
      right: 40,
      top: 40,
      bottom: 120,
    },
    xAxis: {
      type: 'category',
      data: names,
      splitArea: { show: true },
      axisLabel: {
        rotate: 45,
        fontSize: 10,
        color: isDark.value ? '#ccc' : '#333',
      },
    },
    yAxis: {
      type: 'category',
      data: names,
      splitArea: { show: true },
      axisLabel: {
        fontSize: 10,
        color: isDark.value ? '#ccc' : '#333',
      },
    },
    visualMap: {
      min: 0,
      max: maxValue || 1,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: 10,
      inRange: {
        color: isDark.value
          ? ['#1a1a2e', '#16213e', '#0f3460', '#e94560']
          : ['#f7f7f7', '#fce4ec', '#f8bbd9', '#ee4567'],
      },
      textStyle: { color: isDark.value ? '#ccc' : '#333' },
    },
    series: [
      {
        type: 'heatmap',
        data: data.filter((d) => d[2] >= 0), // 排除对角线
        label: { show: false },
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowColor: 'rgba(0, 0, 0, 0.5)',
          },
        },
      },
    ],
    backgroundColor: 'transparent',
  }
}

// ==================== 成员视图（选择一个人，查看所有关系） ====================

// 所有参与的成员列表（按消息数排序）
const memberList = computed(() => {
  if (!graphData.value) return []
  return [...graphData.value.nodes].sort((a, b) => b.messageCount - a.messageCount)
})

// 选中的成员信息
const selectedMember = computed(() => {
  if (!graphData.value || selectedMemberId.value === null) return null
  return graphData.value.nodes.find((n) => n.id === selectedMemberId.value) || null
})

// 选中成员的所有关系（按分数排序）
const selectedMemberRelations = computed(() => {
  if (!graphData.value || !selectedMember.value) return []

  const memberName = selectedMember.value.name
  const relations: Array<{
    otherName: string
    value: number
    coOccurrenceCount: number
  }> = []

  for (const link of graphData.value.links) {
    if (link.source === memberName) {
      relations.push({
        otherName: link.target,
        value: link.value,
        coOccurrenceCount: link.coOccurrenceCount,
      })
    } else if (link.target === memberName) {
      relations.push({
        otherName: link.source,
        value: link.value,
        coOccurrenceCount: link.coOccurrenceCount,
      })
    }
  }

  // 按分数从高到低排序
  relations.sort((a, b) => b.value - a.value)
  return relations
})

// ==================== 排行视图 ====================

// Top 关系排行（显示更多条目）
const topRelations = computed(() => {
  if (!graphData.value) return []
  return graphData.value.links.slice(0, 50)
})

// ==================== 图表管理 ====================

function updateChart() {
  console.log('[ClusterView] updateChart called', {
    hasChartInstance: !!chartInstance,
    viewMode: viewMode.value,
    isLoading: isLoading.value,
  })
  if (!chartInstance) {
    console.log('[ClusterView] updateChart: no chartInstance, skipping')
    return
  }
  if (viewMode.value === 'matrix') {
    console.log('[ClusterView] updateChart: setting heatmap options')
    chartInstance.setOption(buildHeatmapOptions(), { notMerge: true })
  }
}

function initChart() {
  console.log('[ClusterView] initChart called', {
    hasChartRef: !!chartRef.value,
    chartRefSize: chartRef.value ? { width: chartRef.value.clientWidth, height: chartRef.value.clientHeight } : null,
  })
  if (!chartRef.value) {
    console.log('[ClusterView] initChart: no chartRef, skipping')
    return
  }
  chartInstance = echarts.init(chartRef.value, isDark.value ? 'dark' : undefined)
  console.log('[ClusterView] initChart: echarts instance created')
  updateChart()
}

function handleResize() {
  chartInstance?.resize()
}

// 切换视图时重新初始化图表
watch(viewMode, async (newMode, oldMode) => {
  console.log('[ClusterView] viewMode changed', { oldMode, newMode })
  // 切换到非矩阵视图时，销毁图表实例
  if (oldMode === 'matrix' && chartInstance) {
    console.log('[ClusterView] disposing chart instance')
    chartInstance.dispose()
    chartInstance = null
  }

  // 切换到矩阵视图时，重新初始化
  if (newMode === 'matrix') {
    await nextTick()
    console.log('[ClusterView] reinitializing chart after view change')
    initChart()
  }
})

watch([graphData, isDark], () => {
  console.log('[ClusterView] graphData/isDark changed', {
    hasGraphData: !!graphData.value,
    nodeCount: graphData.value?.nodes?.length,
    viewMode: viewMode.value,
    isLoading: isLoading.value,
  })
  if (viewMode.value === 'matrix') {
    updateChart()
  }
}, { deep: true })

// 加载完成后重新初始化图表（因为 v-if 会重新创建 DOM）
watch(isLoading, async (loading, wasLoading) => {
  console.log('[ClusterView] isLoading changed', { wasLoading, loading, viewMode: viewMode.value })
  if (wasLoading && !loading && viewMode.value === 'matrix') {
    // 销毁旧的图表实例（如果存在）
    if (chartInstance) {
      console.log('[ClusterView] disposing old chart instance after loading')
      chartInstance.dispose()
      chartInstance = null
    }
    // 等待 DOM 更新
    await nextTick()
    console.log('[ClusterView] reinitializing chart after loading complete')
    initChart()
  }
})

watch(
  () => [props.sessionId, props.timeFilter, props.memberId],
  () => loadData(),
  { immediate: true, deep: true }
)

onMounted(() => {
  window.addEventListener('resize', handleResize)
  if (viewMode.value === 'matrix') {
    nextTick(() => initChart())
  }
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  chartInstance?.dispose()
  chartInstance = null
})
</script>

<template>
  <div class="p-4 h-full">
    <div class="flex h-full flex-col rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm overflow-hidden">
      <!-- 顶部工具栏 -->
      <div class="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
      <div class="flex items-center gap-3">
        <!-- 视图切换 -->
        <UButtonGroup size="xs">
          <UButton
            :color="viewMode === 'matrix' ? 'primary' : 'neutral'"
            :variant="viewMode === 'matrix' ? 'solid' : 'ghost'"
            @click="viewMode = 'matrix'"
          >
            {{ t('views.cluster.matrixView') }}
          </UButton>
          <UButton
            :color="viewMode === 'member' ? 'primary' : 'neutral'"
            :variant="viewMode === 'member' ? 'solid' : 'ghost'"
            @click="viewMode = 'member'"
          >
            {{ t('views.cluster.memberView') }}
          </UButton>
          <UButton
            :color="viewMode === 'circle' ? 'primary' : 'neutral'"
            :variant="viewMode === 'circle' ? 'solid' : 'ghost'"
            @click="viewMode = 'circle'"
          >
            {{ t('views.cluster.rankingView') }}
          </UButton>
        </UButtonGroup>
      </div>

      <div class="flex items-center gap-3">
        <!-- 参数设置 -->
        <UPopover>
          <UButton variant="ghost" size="xs" icon="i-heroicons-adjustments-horizontal" />
          <template #content>
            <div class="p-3 w-64">
              <h4 class="text-sm font-medium mb-3">{{ t('views.cluster.modelSettings') }}</h4>
              <div class="space-y-3">
                <div>
                  <label class="text-xs text-gray-500 mb-1 block">{{ t('views.cluster.lookAhead') }}</label>
                  <UInput
                    v-model.number="modelOptions.lookAhead"
                    type="number"
                    :min="1"
                    :max="10"
                    size="xs"
                    placeholder="1-10"
                  />
                  <p class="text-xs text-gray-400 mt-1">{{ t('views.cluster.lookAheadDesc') }}</p>
                </div>
                <div>
                  <label class="text-xs text-gray-500 mb-1 block">{{ t('views.cluster.decaySeconds') }}</label>
                  <UInput
                    v-model.number="modelOptions.decaySeconds"
                    type="number"
                    :min="30"
                    :max="3600"
                    size="xs"
                    placeholder="30-3600"
                  />
                  <p class="text-xs text-gray-400 mt-1">{{ t('views.cluster.decaySecondsDesc') }}</p>
                </div>
                <UButton size="xs" color="primary" class="w-full mt-2" @click="loadData">
                  {{ t('views.cluster.applySettings') }}
                </UButton>
              </div>
            </div>
          </template>
        </UPopover>

        <!-- 刷新 -->
        <UButton variant="ghost" size="xs" icon="i-heroicons-arrow-path" @click="loadData" />
      </div>
    </div>

    <!-- 内容区域 -->
    <div class="flex-1 min-h-0 overflow-hidden">
      <!-- 加载中 -->
      <div v-if="isLoading" class="h-full flex items-center justify-center">
        <UIcon name="i-heroicons-arrow-path" class="w-6 h-6 animate-spin text-gray-400" />
      </div>

      <!-- 无数据 -->
      <div v-else-if="!graphData || graphData.nodes.length === 0" class="h-full flex items-center justify-center">
        <div class="text-center text-gray-400">
          <UIcon name="i-heroicons-user-group" class="w-12 h-12 mx-auto mb-2 opacity-50" />
          <p>{{ t('views.cluster.noData') }}</p>
        </div>
      </div>

      <!-- 矩阵热力图 -->
      <div v-else-if="viewMode === 'matrix'" class="h-full">
        <div ref="chartRef" class="w-full h-full" />
      </div>

      <!-- 成员视图 -->
      <div v-else-if="viewMode === 'member'" class="h-full flex overflow-hidden">
        <!-- 左侧：成员列表 -->
        <div class="w-64 border-r border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden">
          <div class="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <h3 class="text-sm font-medium flex items-center gap-2">
              <UIcon name="i-heroicons-users" class="w-4 h-4" />
              {{ t('views.cluster.selectMember') }}
            </h3>
          </div>
          <div class="flex-1 overflow-y-auto">
            <div
              v-for="member in memberList"
              :key="member.id"
              class="px-4 py-2 cursor-pointer border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50"
              :class="{ 'bg-primary-50 dark:bg-primary-900/30': selectedMemberId === member.id }"
              @click="selectedMemberId = member.id"
            >
              <div class="flex items-center justify-between">
                <span class="text-sm truncate">{{ member.name }}</span>
                <span class="text-xs text-gray-400">{{ member.messageCount }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 右侧：选中成员的关系 -->
        <div class="flex-1 overflow-hidden flex flex-col">
          <div v-if="!selectedMember" class="flex-1 flex items-center justify-center">
            <div class="text-center text-gray-400">
              <UIcon name="i-heroicons-cursor-arrow-rays" class="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>{{ t('views.cluster.selectMemberHint') }}</p>
            </div>
          </div>

          <template v-else>
            <!-- 选中成员信息 -->
            <div class="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
              <div
                class="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold bg-primary-500"
              >
                {{ selectedMember.name.charAt(0) }}
              </div>
              <div>
                <div class="font-medium">{{ selectedMember.name }}</div>
                <div class="text-xs text-gray-400">
                  {{ t('views.cluster.msgCount') }}: {{ selectedMember.messageCount }} |
                  {{ t('views.cluster.relationCount') }}: {{ selectedMemberRelations.length }}
                </div>
              </div>
            </div>

            <!-- 关系排行 -->
            <div class="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <h3 class="text-sm font-medium flex items-center gap-2">
                <UIcon name="i-heroicons-heart" class="w-4 h-4 text-pink-500" />
                {{ t('views.cluster.relationsByIntimacy') }}
              </h3>
            </div>

            <div class="flex-1 overflow-y-auto">
              <div v-if="selectedMemberRelations.length === 0" class="p-4 text-center text-gray-400">
                {{ t('views.cluster.noRelations') }}
              </div>
              <div
                v-for="(relation, index) in selectedMemberRelations"
                :key="relation.otherName"
                class="px-4 py-3 border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50"
              >
                <div class="flex items-center gap-3">
                  <span
                    class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                    :class="index < 3 ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'"
                  >
                    {{ index + 1 }}
                  </span>
                  <div class="flex-1 min-w-0">
                    <div class="text-sm font-medium truncate">{{ relation.otherName }}</div>
                    <div class="flex items-center gap-3 mt-0.5 text-xs text-gray-400">
                      <span>{{ t('views.cluster.intimacy') }}: {{ (relation.value * 100).toFixed(0) }}%</span>
                      <span>{{ t('views.cluster.coOccurrence') }}: {{ relation.coOccurrenceCount }}{{ t('views.cluster.times') }}</span>
                    </div>
                  </div>
                  <!-- 亲密度条（以最高分为100%基准） -->
                  <div class="w-20 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      class="h-full bg-linear-to-r from-pink-400 to-pink-600"
                      :style="{ width: `${selectedMemberRelations[0]?.value ? (relation.value / selectedMemberRelations[0].value * 100) : 0}%` }"
                    />
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>

      <!-- 排行视图 -->
      <div v-else class="h-full flex flex-col overflow-hidden">
        <div class="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h3 class="text-sm font-medium flex items-center gap-2">
            <UIcon name="i-heroicons-trophy" class="w-4 h-4 text-yellow-500" />
            {{ t('views.cluster.interactionRanking') }}
          </h3>
        </div>
        <div class="flex-1 overflow-y-auto">
          <div v-for="(link, index) in topRelations" :key="index" class="px-4 py-3 border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">
            <div class="flex items-center gap-3">
              <span
                class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
                :class="index < 3 ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'"
              >
                {{ index + 1 }}
              </span>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 text-sm">
                  <span class="font-medium truncate">{{ link.source }}</span>
                  <span class="text-gray-400">↔</span>
                  <span class="font-medium truncate">{{ link.target }}</span>
                </div>
                <div class="flex items-center gap-3 mt-1 text-xs text-gray-400">
                  <span>{{ t('views.cluster.score') }}: {{ link.value.toFixed(2) }}</span>
                  <span>{{ t('views.cluster.coOccurrence') }}: {{ link.coOccurrenceCount }}{{ t('views.cluster.times') }}</span>
                </div>
              </div>
              <!-- 临近度条（以最高分为100%基准） -->
              <div class="w-24 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  class="h-full bg-linear-to-r from-yellow-400 to-orange-500"
                  :style="{ width: `${topRelations[0]?.value ? (link.value / topRelations[0].value * 100) : 0}%` }"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

      <!-- 底部统计 -->
      <div v-if="graphData" class="px-4 py-2 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-400 flex items-center gap-4 bg-gray-50 dark:bg-gray-800/50">
        <span>{{ t('views.cluster.totalMembers') }}: {{ graphData.stats.totalMembers }}</span>
        <span>{{ t('views.cluster.totalMessages') }}: {{ graphData.stats.totalMessages.toLocaleString() }}</span>
        <span>{{ t('views.cluster.involvedMembers') }}: {{ graphData.stats.involvedMembers }}</span>
        <span>{{ t('views.cluster.edgeCount') }}: {{ graphData.stats.edgeCount }}</span>
      </div>
    </div>
  </div>
</template>

