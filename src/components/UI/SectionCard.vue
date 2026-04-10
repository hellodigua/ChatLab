<script setup lang="ts">
/**
 * 带标题的卡片容器组件
 * 基于 ThemeCard 的组合封装，提供标题、描述、分隔线等布局能力
 */
import { computed } from 'vue'
import ThemeCard from './ThemeCard.vue'

const props = withDefaults(
  defineProps<{
    /** 卡片标题 */
    title: string
    /** 可选的描述文字 */
    description?: string
    /** 是否显示边框分隔线（默认 true） */
    showDivider?: boolean
    /** 是否启用内容滚动 */
    scrollable?: boolean
    /** 最大高度（vh 单位），默认 60vh */
    maxHeightVh?: number
  }>(),
  {
    showDivider: true,
    scrollable: false,
    maxHeightVh: 60,
  }
)

const contentStyle = computed(() => {
  if (!props.scrollable) return undefined
  return {
    maxHeight: `${props.maxHeightVh}vh`,
    overflowY: 'auto' as const,
  }
})
</script>

<template>
  <ThemeCard variant="section">
    <!-- 标题区域 -->
    <div class="px-5 py-3" :class="{ 'border-b border-gray-200 dark:border-white/5': showDivider && $slots.default }">
      <div class="flex items-center justify-between">
        <div>
          <p class="font-semibold text-gray-900 dark:text-white whitespace-nowrap">{{ title }}</p>
          <p v-if="description" class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {{ description }}
          </p>
        </div>
        <slot name="headerRight" />
      </div>
    </div>

    <!-- 内容区域 -->
    <div v-if="scrollable" :style="contentStyle">
      <slot />
    </div>
    <slot v-else />

    <!-- 底部区域（在滚动区域外） -->
    <slot name="footer" />
  </ThemeCard>
</template>
