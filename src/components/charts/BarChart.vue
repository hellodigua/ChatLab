<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Bar } from 'vue-chartjs'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

const { t } = useI18n()

export interface BarChartData {
  labels: string[]
  values: number[]
  colors?: string[]
}

interface Props {
  data: BarChartData
  height?: number
  showLegend?: boolean
  borderRadius?: number
  colorMode?: 'static' | 'gradient' // static: 使用提供的colors, gradient: 根据值自动渐变
  xLabelFilter?: (label: string, index: number) => string
}

const props = withDefaults(defineProps<Props>(), {
  height: 256,
  showLegend: false,
  borderRadius: 4,
  colorMode: 'gradient',
})

// 根据数据值计算渐变颜色
const calculateColors = computed(() => {
  if (props.colorMode === 'static' && props.data.colors) {
    return props.data.colors
  }

  const maxValue = Math.max(...props.data.values)
  return props.data.values.map((value) => {
    const intensity = value / maxValue
    if (intensity > 0.8) return '#6366f1'
    if (intensity > 0.6) return '#818cf8'
    if (intensity > 0.4) return '#a5b4fc'
    if (intensity > 0.2) return '#c7d2fe'
    return '#e0e7ff'
  })
})

const chartData = computed(() => {
  return {
    labels: props.data.labels,
    datasets: [
      {
        label: t('count'),
        data: props.data.values,
        backgroundColor: calculateColors.value,
        borderRadius: props.borderRadius,
        borderSkipped: false,
      },
    ],
  }
})

const chartOptions = computed(() => {
  const options: any = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: props.showLegend,
      },
      tooltip: {
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        padding: 12,
        cornerRadius: 8,
      },
    },
    scales: {
      x: {
        grid: {
          display: false,
        },
        ticks: {
          font: {
            size: 10,
          },
        },
      },
      y: {
        beginAtZero: true,
        grid: {
          color: 'rgba(0, 0, 0, 0.05)',
        },
        ticks: {
          font: {
            size: 11,
          },
        },
      },
    },
  }

  // 添加自定义 x 轴标签过滤器
  if (props.xLabelFilter) {
    options.scales.x.ticks.callback = function (this: any, _: unknown, index: number) {
      const label = this.getLabelForValue(index)
      return props.xLabelFilter!(label, index)
    }
  }

  return options
})
</script>

<template>
  <div :style="{ height: `${height}px` }">
    <Bar :data="chartData" :options="chartOptions" />
  </div>
</template>

<i18n>
{
  "zh-CN": {
    "count": "数量"
  },
  "en-US": {
    "count": "Count"
  }
}
</i18n>
