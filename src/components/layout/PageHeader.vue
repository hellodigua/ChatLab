<script setup lang="ts">
/**
 * 页面 Header 通用组件
 * 包含标题、描述、可选头像/图标，以及默认 slot 用于额外内容
 */

defineProps<{
  title: string
  description?: string
  icon?: string // fallback 图标
  iconClass?: string // 图标背景样式类
  avatar?: string | null // 头像图片（base64 Data URL），优先级高于 icon
}>()
</script>

<template>
  <div class="relative border-b border-gray-200/50 px-6 pb-2 dark:border-gray-800/50">
    <!-- 拖拽区域 - 仅覆盖顶部区域 (包含上方 padding 的 32px + 头部内部 16px) -->
    <!-- 这样既保证了顶部可以拖拽，又不会遮挡 Header 内部的按钮和交互元素 -->
    <div class="absolute -top-8 left-0 right-0 h-12 z-50" style="-webkit-app-region: drag" />

    <!-- 标题区域 -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <!-- 头像图片（优先显示） -->
        <img v-if="avatar" :src="avatar" :alt="title" class="h-10 w-10 rounded-xl object-cover" />
        <!-- 可选图标（fallback） -->
        <div v-else-if="icon" class="flex h-10 w-10 items-center justify-center rounded-xl" :class="iconClass">
          <UIcon :name="icon" class="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 class="text-lg font-semibold text-gray-900 dark:text-white">
            {{ title }}
          </h1>
          <p v-if="description" class="text-xs text-gray-500 dark:text-gray-400">
            {{ description }}
          </p>
        </div>
      </div>

      <!-- 中间拖拽占位符 - 填充中间空白区域 -->
      <div class="flex-1 self-stretch mx-4" style="-webkit-app-region: drag" />

      <!-- 右侧操作区域 -->
      <div class="flex items-center gap-2">
        <slot name="actions" />
      </div>
    </div>

    <!-- 额外内容 slot（如 Tabs） -->
    <slot />
  </div>
</template>
