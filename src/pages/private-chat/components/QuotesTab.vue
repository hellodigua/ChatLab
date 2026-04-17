<script setup lang="ts">
import { KeywordAnalysis } from '@/components/analysis/quotes'

interface TimeFilter {
  startTs?: number
  endTs?: number
}

const props = defineProps<{
  sessionId: string
  timeFilter?: TimeFilter
}>()
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex-1 min-h-0 overflow-auto">
      <div class="main-content mx-auto max-w-3xl p-6">
        <KeywordAnalysis :session-id="props.sessionId" :time-filter="props.timeFilter" />
      </div>
    </div>
  </div>
</template>
