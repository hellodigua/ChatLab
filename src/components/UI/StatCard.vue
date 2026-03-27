<script setup lang="ts">
/**
 * 统计卡片组件
 * 用于展示单个统计指标
 */
defineProps<{
  /** 指标标签 */
  label: string
  /** 指标值 */
  value: string | number
  /** 指标值颜色 */
  valueColor?: 'pink' | 'amber' | 'blue' | 'green' | 'red' | 'gray'
  /** 副文本/补充说明 */
  subtext?: string
  /** 可选的图标（emoji 或 icon name） */
  icon?: string
  /** 图标背景色 */
  iconBg?: 'pink' | 'amber' | 'blue' | 'green' | 'red' | 'gray'
}>()

// 颜色映射
const valueColorMap: Record<string, string> = {
  pink: 'text-pink-600 dark:text-pink-400',
  amber: 'text-amber-600 dark:text-amber-400',
  blue: 'text-blue-600 dark:text-blue-400',
  green: 'text-green-600 dark:text-green-400',
  red: 'text-red-600 dark:text-red-400',
  gray: 'text-gray-900 dark:text-white',
}

const iconBgMap: Record<string, string> = {
  pink: 'bg-pink-100 dark:bg-pink-500/10',
  amber: 'bg-amber-100 dark:bg-amber-500/10',
  blue: 'bg-blue-100 dark:bg-blue-500/10',
  green: 'bg-green-100 dark:bg-green-500/10',
  red: 'bg-red-100 dark:bg-red-500/10',
  gray: 'bg-gray-100 dark:bg-white/5',
}
</script>

<template>
  <div class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-white/5 dark:bg-card-dark">
    <!-- 带图标的布局 -->
    <template v-if="icon">
      <div class="flex items-center gap-3">
        <div
          class="flex h-12 w-12 items-center justify-center rounded-xl text-2xl"
          :class="iconBgMap[iconBg || 'gray']"
        >
          {{ icon }}
        </div>
        <div>
          <p class="text-xs font-medium text-gray-500 dark:text-gray-400">{{ label }}</p>
          <p class="text-lg font-bold text-gray-900 dark:text-white">{{ value }}</p>
        </div>
      </div>
      <div v-if="subtext || $slots.subtext" class="mt-3 flex items-baseline gap-1">
        <slot name="subtext">
          <span class="text-sm text-gray-500">{{ subtext }}</span>
        </slot>
      </div>
    </template>

    <!-- 简单布局 -->
    <template v-else>
      <p class="text-xs font-medium text-gray-500 dark:text-gray-400">{{ label }}</p>
      <p class="mt-1 text-2xl font-bold" :class="valueColorMap[valueColor || 'pink']">{{ value }}</p>
      <p v-if="subtext || $slots.subtext" class="mt-1 text-xs text-gray-400">
        <slot name="subtext">{{ subtext }}</slot>
      </p>
    </template>
  </div>
</template>
