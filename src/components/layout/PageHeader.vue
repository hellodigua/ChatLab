<script setup lang="ts">
/**
 * 页面 Header 通用组件
 * 包含标题、描述、可选头像/图标，以及默认 slot 用于额外内容
 */

defineProps<{
  title: string
  description?: string
  icon?: string // fallback 图标
  avatar?: string | null // 头像图片（base64 Data URL），优先级高于 icon
}>()
</script>

<template>
  <div class="border-b border-gray-200 bg-white px-6 pt-4 pb-2 dark:border-gray-800 dark:bg-gray-900">
    <!-- 标题区域 -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <!-- 头像图片（优先显示） -->
        <img v-if="avatar" :src="avatar" :alt="title" class="h-10 w-10 rounded-xl object-cover" />
        <!-- 可选图标（fallback） -->
        <div
          v-else-if="icon"
          class="flex h-10 w-10 items-center justify-center rounded-xl bg-linear-to-br from-pink-400 to-pink-600"
        >
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
      <!-- 右侧操作区域 -->
      <div class="flex items-center gap-2">
        <slot name="actions" />
      </div>
    </div>

    <!-- 额外内容 slot（如 Tabs） -->
    <slot />
  </div>
</template>
