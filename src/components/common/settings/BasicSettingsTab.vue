<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useLayoutStore } from '@/stores/layout'

// Store
const layoutStore = useLayoutStore()
const { screenshotMobileAdapt } = storeToRefs(layoutStore)
</script>

<template>
  <div class="space-y-6">
    <!-- 截图设置 -->
    <div>
      <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <UIcon name="i-heroicons-camera" class="h-4 w-4 text-blue-500" />
        截图设置
      </h3>
      <div class="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
        <div class="flex items-center justify-between">
          <div class="flex-1 pr-4">
            <p class="text-sm font-medium text-gray-900 dark:text-white">移动端适配</p>
            <p class="text-xs text-gray-500 dark:text-gray-400">截图时自动缩放宽度，适合移动端查看</p>
          </div>
          <USwitch v-model="screenshotMobileAdapt" />
        </div>
      </div>
    </div>
  </div>
</template>
