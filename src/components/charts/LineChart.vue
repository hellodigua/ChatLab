<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Line } from 'vue-chartjs'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler)

const { t } = useI18n()

export interface LineChartData {
  labels: string[]
  values: number[]
}

interface Props {
  data: LineChartData
  height?: number
  fill?: boolean
  lineColor?: string
  fillColor?: string
  tension?: number
  showLegend?: boolean
  xAxisRotation?: number
}

const props = withDefaults(defineProps<Props>(), {
  height: 288,
  fill: true,
  lineColor: '#6366f1',
  fillColor: 'rgba(99, 102, 241, 0.1)',
  tension: 0.4,
  showLegend: false,
  xAxisRotation: 45,
})

const chartData = computed(() => {
  return {
    labels: props.data.labels,
    datasets: [
      {
        label: t('count'),
        data: props.data.values,
        fill: props.fill,
        borderColor: props.lineColor,
        backgroundColor: props.fillColor,
        tension: props.tension,
        pointBackgroundColor: props.lineColor,
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6,
      },
    ],
  }
})

const chartOptions = computed(() => ({
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
        maxRotation: props.xAxisRotation,
        minRotation: props.xAxisRotation,
        font: {
          size: 11,
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
  interaction: {
    intersect: false,
    mode: 'index' as const,
  },
}))
</script>

<template>
  <div :style="{ height: `${height}px` }">
    <Line :data="chartData" :options="chartOptions" />
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
