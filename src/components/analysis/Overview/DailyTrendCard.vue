<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { SectionCard } from '@/components/UI'
import { LineChart } from '@/components/charts'
import type { LineChartData } from '@/components/charts'
import type { DailyActivity } from '@/types/analysis'

const { t } = useI18n()

defineProps<{
  dailyActivity: DailyActivity[]
  dailyChartData: LineChartData
}>()
</script>

<template>
  <SectionCard v-if="dailyActivity.length > 0" :title="t('title')" :show-divider="false">
    <div class="p-5">
      <LineChart :data="dailyChartData" :height="288" />
    </div>
  </SectionCard>
</template>

<i18n>
{
  "zh-CN": {
    "title": "每日消息趋势"
  },
  "en-US": {
    "title": "Daily Message Trend"
  }
}
</i18n>
