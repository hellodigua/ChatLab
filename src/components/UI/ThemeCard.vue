<script setup lang="ts">
/**
 * 统一卡片容器组件
 * 提供三种视觉变体，所有背景色通过 CSS 变量 (--color-card-bg / --color-card-dark) 驱动，
 * 为未来设置页色系配置预留扩展点。
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 视觉变体 */
    variant?: 'section' | 'card' | 'elevated'
    /** 是否显示装饰性渐变光晕（仅 elevated 生效） */
    decorative?: boolean
  }>(),
  {
    variant: 'section',
    decorative: false,
  }
)

const variantClasses: Record<string, string> = {
  section:
    'rounded-xl border border-gray-200 bg-card-bg shadow-sm dark:border-white/5 dark:bg-card-dark',
  card: 'rounded-[20px] border border-gray-200/60 bg-card-bg shadow-sm transition-all hover:shadow-md dark:border-white/5 dark:bg-card-dark',
  elevated:
    'rounded-[24px] bg-card-bg shadow-xl ring-1 ring-gray-900/5 dark:bg-card-dark dark:ring-white/10',
}

const containerClass = computed(() => `relative overflow-hidden ${variantClasses[props.variant]}`)

const showDecoration = computed(() => props.decorative && props.variant === 'elevated')
</script>

<template>
  <div :class="containerClass">
    <div v-if="showDecoration" class="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        class="absolute -left-[20%] -top-[20%] h-[70%] w-[70%] rounded-full bg-blue-400/10 blur-[80px] dark:bg-blue-500/20"
      />
      <div
        class="absolute -right-[20%] top-[10%] h-[70%] w-[70%] rounded-full bg-pink-400/10 blur-[80px] dark:bg-pink-500/20"
      />
    </div>
    <slot />
  </div>
</template>
