<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useLayoutStore } from '@/stores/layout'
import DynamicIcon from './DynamicIcon.vue'
import { defaultFooterLinks, type FooterLinkConfig } from '@/types/sidebar'

const { t } = useI18n()
const layoutStore = useLayoutStore()
const { isSidebarCollapsed: isCollapsed } = storeToRefs(layoutStore)

// 配置常量
const CONFIG_URL = 'https://chatlab.fun/config.json'
const STORAGE_KEY = 'chatlab_app_config'

// Footer 链接配置
const footerLinks = ref<FooterLinkConfig[]>(loadCachedConfig() || defaultFooterLinks)

/**
 * 从 localStorage 加载缓存配置
 */
function loadCachedConfig(): FooterLinkConfig[] | null {
  try {
    const cached = localStorage.getItem(STORAGE_KEY)
    if (cached) {
      const config = JSON.parse(cached)
      return config.footerLinkConfig || null
    }
  } catch {}
  return null
}

/**
 * 获取远程配置
 */
async function fetchConfig(): Promise<void> {
  try {
    const result = await window.api.app.fetchRemoteConfig(CONFIG_URL)
    if (!result.success || !result.data) return

    // 保存整个配置对象（包括 footerLinkConfig、AITips 等）
    const config = result.data as Record<string, unknown>
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))

    // 更新 footerLinks
    if (config.footerLinkConfig && Array.isArray(config.footerLinkConfig)) {
      footerLinks.value = config.footerLinkConfig as FooterLinkConfig[]
    }
  } catch {}
}

// 组件挂载时获取配置
onMounted(() => {
  fetchConfig()
})
</script>

<template>
  <div class="px-4 py-2 dark:border-gray-800 space-y-2 mb-4">
    <!-- 帮助和反馈 -->
    <UPopover :popper="{ placement: 'right' }">
      <UTooltip :text="isCollapsed ? t('sidebar.footer.helpAndFeedback') : ''" :popper="{ placement: 'right' }">
        <UButton
          :block="!isCollapsed"
          class="transition-all rounded-full hover:bg-gray-200/60 dark:hover:bg-gray-800 h-12 cursor-pointer"
          :class="[isCollapsed ? 'flex w-12 items-center justify-center px-0' : 'justify-start pl-4']"
          color="gray"
          variant="ghost"
        >
          <UIcon name="i-heroicons-information-circle" class="h-5 w-5 shrink-0" :class="[isCollapsed ? '' : 'mr-2']" />
          <span v-if="!isCollapsed" class="truncate">{{ t('sidebar.footer.helpAndFeedback') }}</span>
        </UButton>
      </UTooltip>

      <template #content>
        <div class="flex flex-col p-2 min-w-[200px] gap-1">
          <UButton
            v-for="link in footerLinks"
            :key="link.id"
            :to="link.url"
            target="_blank"
            variant="ghost"
            color="gray"
            class="justify-start h-auto py-2 hover:bg-gray-200/60 dark:hover:bg-gray-800 rounded-md transition-colors"
            block
          >
            <template #leading>
              <DynamicIcon :name="link.icon" class="w-5 h-5 shrink-0 mr-2" />
            </template>
            <div class="flex flex-col items-start text-left">
              <span class="text-sm font-medium">{{ link.title }}</span>
              <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">{{ link.subtitle }}</span>
            </div>
          </UButton>
        </div>
      </template>
    </UPopover>

    <!-- 设置 -->
    <UTooltip :text="isCollapsed ? t('sidebar.footer.settings') : ''" :popper="{ placement: 'right' }">
      <UButton
        :block="!isCollapsed"
        class="transition-all rounded-full hover:bg-gray-200/60 dark:hover:bg-gray-800 h-12 cursor-pointer"
        :class="[isCollapsed ? 'flex w-12 items-center justify-center px-0' : 'justify-start pl-4']"
        color="gray"
        variant="ghost"
        @click="layoutStore.showSettingModal = true"
      >
        <UIcon name="i-heroicons-cog-6-tooth" class="h-5 w-5 shrink-0" :class="[isCollapsed ? '' : 'mr-2']" />
        <span v-if="!isCollapsed" class="truncate">{{ t('sidebar.footer.settings') }}</span>
      </UButton>
    </UTooltip>
  </div>
</template>
