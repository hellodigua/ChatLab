<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Bar } from 'vue-chartjs'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

const { t } = useI18n()

export interface HorizontalBarChartData {
  labels: string[]
  values: number[]
  colors?: string[]
}

interface Props {
  data: HorizontalBarChartData
  height?: number
  showLegend?: boolean
  borderRadius?: number
}

const props = withDefaults(defineProps<Props>(), {
  height: 320,
  showLegend: false,
  borderRadius: 8,
})

// 默认渐变色方案
const defaultColors = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#a855f7', // purple
  '#d946ef', // fuchsia
  '#ec4899', // pink
  '#f43f5e', // rose
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
]

const chartData = computed(() => {
  return {
    labels: props.data.labels,
    datasets: [
      {
        label: t('count'),
        data: props.data.values,
        backgroundColor: props.data.colors || defaultColors.slice(0, props.data.values.length),
        borderRadius: props.borderRadius,
        borderSkipped: false,
      },
    ],
  }
})

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  indexAxis: 'y' as const,
  plugins: {
    legend: {
      display: props.showLegend,
    },
    tooltip: {
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      padding: 12,
      cornerRadius: 8,
      titleFont: {
        size: 14,
      },
      bodyFont: {
        size: 13,
      },
    },
  },
  scales: {
    x: {
      grid: {
        display: false,
      },
      ticks: {
        font: {
          size: 12,
        },
      },
    },
    y: {
      grid: {
        display: false,
      },
      ticks: {
        font: {
          size: 12,
        },
      },
    },
  },
}
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
