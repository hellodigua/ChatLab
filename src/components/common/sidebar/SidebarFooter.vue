<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter, useRoute } from 'vue-router'
import { useLayoutStore } from '@/stores/layout'
import SidebarButton from './SidebarButton.vue'

const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const layoutStore = useLayoutStore()

// 是否在管理页面
const isManagePage = computed(() => route.name === 'manage')

// 注意：帮助和反馈功能已迁移到首页 Footer (HomeFooter.vue)
// 如需恢复，请参考 git 历史记录
</script>

<template>
  <div class="px-4 py-2 dark:border-gray-800 space-y-2 mb-2">
    <!-- 管理 -->
    <SidebarButton
      icon="i-heroicons-rectangle-stack"
      :title="t('tools.title')"
      :active="isManagePage"
      @click="router.push({ name: 'manage' })"
    />
    <!-- 设置 -->
    <SidebarButton
      icon="i-heroicons-cog-6-tooth"
      :title="t('sidebar.footer.settings')"
      @click="layoutStore.showSettingModal = true"
    />
  </div>
</template>
