<script setup lang="ts">
/**
 * ECharts 关系图组件（支持 circular 和 force 布局）
 */
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import * as echarts from 'echarts/core'
import { GraphChart } from 'echarts/charts'
import { TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { useDark } from '@vueuse/core'
import type { EChartsOption } from 'echarts'

// 注册必要的组件
echarts.use([GraphChart, TooltipComponent, LegendComponent, CanvasRenderer])

type ECOption = EChartsOption

export interface GraphNode {
  id: number | string
  name: string
  value?: number
  symbolSize?: number
  category?: number
  messageCount?: number
  weightedDegree?: number
  totalMentions?: number
  communitySize?: number
}

export interface GraphLink {
  source: string
  target: string
  value?: number
  mentionCount?: number
  temporalTurns?: number
  temporalScore?: number
  reciprocity?: number
  avgDeltaSec?: number | null
}

export interface GraphData {
  nodes: GraphNode[]
  links: GraphLink[]
  maxLinkValue?: number
  categories?: Array<{ name: string }>
}

interface Props {
  data: GraphData
  height?: number | string
  layout?: 'circular' | 'force' // 布局类型
  directed?: boolean // 是否显示箭头（有向图）
  showLegend?: boolean
  neon?: boolean
  selectedNode?: string | null
}

const props = withDefaults(defineProps<Props>(), {
  height: 400,
  layout: 'circular',
  directed: false,
  showLegend: false,
  neon: false,
  selectedNode: null,
})

const emit = defineEmits<{
  (event: 'node-click', nodeName: string | null): void
}>()

// 计算高度样式
const heightStyle = computed(() => {
  if (typeof props.height === 'number') {
    return `${props.height}px`
  }
  return props.height
})

const isDark = useDark()
const chartRef = ref<HTMLElement | null>(null)
let chartInstance: echarts.ECharts | null = null

// 丰富的调色板（为每个节点分配不同颜色）
const colorPalette = [
  '#ee4567', // pink-500
  '#f7758c', // pink-400
  '#8b5cf6', // violet
  '#6366f1', // indigo
  '#14b8a6', // teal
  '#3b82f6', // blue
  '#22c55e', // green
  '#f97316', // orange
  '#eab308', // yellow
  '#ec4899', // pink-600
  '#06b6d4', // cyan
  '#64748b', // slate
]

// 去重后的节点（ECharts 要求节点名称唯一）
const uniqueNodes = computed(() => {
  const seen = new Set<string>()
  return props.data.nodes.filter((node) => {
    if (seen.has(node.name)) {
      return false
    }
    seen.add(node.name)
    return true
  })
})

const graphCategories = computed(() => {
  if (props.data.categories && props.data.categories.length > 0) {
    return props.data.categories
  }
  const categorySet = new Set<number>()
  for (const node of uniqueNodes.value) {
    if (typeof node.category === 'number') categorySet.add(node.category)
  }
  return [...categorySet].sort((a, b) => a - b).map((id) => ({ name: `Community ${id + 1}` }))
})

// 节点名称到颜色的映射
const nodeColorMap = computed(() => {
  const map = new Map<string, string>()
  uniqueNodes.value.forEach((node, index) => {
    const colorIdx = typeof node.category === 'number' ? node.category : index
    map.set(node.name, colorPalette[colorIdx % colorPalette.length])
  })
  return map
})

const selectedAdjacency = computed(() => {
  if (!props.selectedNode) return new Set<string>()
  const neighbors = new Set<string>()
  for (const link of props.data.links) {
    if (link.source === props.selectedNode) neighbors.add(link.target)
    if (link.target === props.selectedNode) neighbors.add(link.source)
  }
  return neighbors
})

// 计算边的宽度（根据 value 归一化）
function getLinkWidth(value: number, maxValue: number): number {
  if (maxValue <= 0) return 1
  // 宽度范围约 1-4.5，避免低权重边过于抢眼
  return 1 + (value / maxValue) * 3.5
}

function getMetricLine(label: string, value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return `${label}: ${value}`
}

const option = computed<ECOption>(() => {
  const maxLinkValue = props.data.maxLinkValue || Math.max(...props.data.links.map((l) => l.value || 1), 1)

  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      backgroundColor: isDark.value ? 'rgba(12, 18, 26, 0.94)' : 'rgba(255, 255, 255, 0.96)',
      borderColor: isDark.value ? 'rgba(148, 163, 184, 0.2)' : 'rgba(15, 23, 42, 0.08)',
      textStyle: {
        color: isDark.value ? '#e2e8f0' : '#334155',
      },
      formatter: (params: any) => {
        if (params.dataType === 'node') {
          const lines: string[] = [`<b>${params.data.name}</b>`]
          const messageLine = getMetricLine('Messages', params.data.messageCount)
          const degreeLine = getMetricLine('Weight', params.data.weightedDegree)
          const mentionLine = getMetricLine('@ Mentions', params.data.totalMentions)
          const communityLine = getMetricLine('Community Size', params.data.communitySize)
          if (messageLine) lines.push(messageLine)
          if (degreeLine) lines.push(degreeLine)
          if (mentionLine) lines.push(mentionLine)
          if (communityLine) lines.push(communityLine)
          return lines.join('<br/>')
        } else if (params.dataType === 'edge') {
          const lines: string[] = [
            `${params.data.source} ↔ ${params.data.target}`,
            `Strength: ${params.data.value || 0}`,
          ]
          const mentionLine = getMetricLine('@ Interactions', params.data.mentionCount)
          const temporalLine = getMetricLine('Temporal Turns', params.data.temporalTurns)
          const reciprocityLine = getMetricLine('Reciprocity', params.data.reciprocity)
          if (mentionLine) lines.push(mentionLine)
          if (temporalLine) lines.push(temporalLine)
          if (reciprocityLine) lines.push(reciprocityLine)
          return lines.join('<br/>')
        }
        return ''
      },
    },
    legend:
      props.showLegend && graphCategories.value.length > 0
        ? {
            top: 0,
            left: 'center',
            itemWidth: 10,
            itemHeight: 10,
            textStyle: {
              color: isDark.value ? '#94a3b8' : '#475569',
              fontSize: 11,
            },
            data: graphCategories.value.map((item) => item.name),
          }
        : undefined,
    // 动画效果
    animationDuration: 1000,
    animationDurationUpdate: 500,
    animationEasingUpdate: 'quinticInOut',
    series: [
      {
        type: 'graph',
        layout: props.layout,
        circular: props.layout === 'circular' ? { rotateLabel: true } : undefined,
        force:
          props.layout === 'force'
            ? {
                initLayout: 'circular',
                repulsion: 360,
                gravity: 0.28,
                edgeLength: [32, 150],
                friction: 0.6,
                layoutAnimation: true,
              }
            : undefined,
        roam: true,
        progressiveThreshold: 1200,
        progressive: 240,
        scaleLimit: {
          min: 0.3, // 最小缩放 30%
          max: 3, // 最大缩放 300%
        },
        draggable: true,
        label: {
          show: true,
          position: 'right',
          formatter: '{b}',
          color: isDark.value ? '#e5e7eb' : '#374151',
          fontSize: 11,
          fontWeight: 500,
        },
        edgeSymbol: props.directed ? ['none', 'arrow'] : ['none', 'none'],
        edgeSymbolSize: props.directed ? [0, 10] : [0, 0],
        lineStyle: {
          color: 'source',
          curveness: 0.28,
          opacity: 0.28,
          width: 1.5,
        },
        emphasis: {
          focus: 'adjacency',
          label: {
            show: true,
            fontSize: 13,
            fontWeight: 600,
          },
          lineStyle: {
            width: 4.5,
            opacity: 0.95,
          },
          itemStyle: {
            shadowBlur: 15,
            shadowColor: 'rgba(0, 0, 0, 0.3)',
          },
        },
        blur: {
          itemStyle: {
            opacity: 0.22,
          },
          lineStyle: {
            opacity: 0.04,
          },
          label: {
            opacity: 0.22,
          },
        },
        // 节点数据（使用去重后的节点）
        data: uniqueNodes.value.map((node) => {
          const color = nodeColorMap.value.get(node.name) || colorPalette[0]
          const hasSelection = Boolean(props.selectedNode)
          const isSelected = props.selectedNode === node.name
          const isAdjacent = selectedAdjacency.value.has(node.name)
          const isContextNode = !hasSelection || isSelected || isAdjacent
          const baseSize = node.symbolSize || 30
          return {
            ...node,
            id: String(node.id),
            name: node.name,
            value: node.value,
            category: node.category,
            symbolSize: isSelected ? baseSize + 6 : baseSize,
            // circular 布局显示所有标签，force 布局只显示大节点的标签
            label: {
              show: hasSelection ? isContextNode : props.layout === 'circular' ? true : baseSize > 35,
              color: isDark.value ? '#f1f5f9' : '#1e293b',
              textBorderColor: isDark.value ? '#0f172a' : '#ffffff',
              textBorderWidth: isSelected ? 2 : 1.5,
            },
            itemStyle: {
              color: color,
              borderColor: isDark.value ? '#1e293b' : '#ffffff',
              borderWidth: isSelected ? 4 : baseSize > 20 ? 3 : 1.5,
              shadowBlur: props.neon ? (isSelected ? 26 : 20) : isSelected ? 12 : 6,
              shadowColor: props.neon ? color : `${color}66`,
              opacity: isContextNode ? 1 : 0.22,
            },
          }
        }),
        categories: graphCategories.value,
        // 连接线数据（颜色跟随源节点，过滤掉引用不存在节点的链接）
        links: props.data.links
          .filter((link) => nodeColorMap.value.has(link.source) && nodeColorMap.value.has(link.target))
          .map((link) => {
            const sourceColor = nodeColorMap.value.get(link.source) || colorPalette[0]
            const weight = link.value || 1
            const baseOpacity = maxLinkValue > 0 ? 0.2 + (weight / maxLinkValue) * 0.5 : 0.3
            const isContextLink =
              !props.selectedNode || link.source === props.selectedNode || link.target === props.selectedNode
            return {
              ...link,
              source: link.source,
              target: link.target,
              value: link.value,
              lineStyle: {
                color: sourceColor,
                width: isContextLink
                  ? getLinkWidth(weight, maxLinkValue) + (props.selectedNode ? 0.8 : 0)
                  : Math.max(0.8, getLinkWidth(weight, maxLinkValue) * 0.45),
                opacity: isContextLink ? baseOpacity : 0.03,
              },
            }
          }),
      },
    ],
  }
})

// 初始化图表
function initChart() {
  if (!chartRef.value) return

  chartInstance = echarts.init(chartRef.value, isDark.value ? 'dark' : undefined, {
    renderer: 'canvas',
  })
  chartInstance.setOption(option.value)

  chartInstance.on('click', (params: any) => {
    if (params?.dataType === 'node') {
      emit('node-click', params?.data?.name || null)
    }
  })

  chartInstance.getZr().on('click', (event: any) => {
    if (!event?.target) {
      emit('node-click', null)
    }
  })
}

// 更新图表
function updateChart() {
  if (!chartInstance) return
  chartInstance.setOption(option.value, { notMerge: true })
}

// 响应窗口大小变化
function handleResize() {
  chartInstance?.resize()
}

// 重置视图（居中 + 重置缩放）
function resetView() {
  if (!chartInstance) return
  chartInstance.dispatchAction({
    type: 'restore',
  })
}

// 暴露方法给父组件
defineExpose({
  resetView,
})

// 监听数据和主题变化
watch(
  [() => props.data, () => props.layout, () => props.directed, () => props.selectedNode, isDark],
  () => {
    if (chartInstance) {
      updateChart()
    } else {
      initChart()
    }
  },
  { deep: true }
)

onMounted(() => {
  initChart()
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  chartInstance?.dispose()
})
</script>

<template>
  <div ref="chartRef" :style="{ height: heightStyle, width: '100%' }" />
</template>
