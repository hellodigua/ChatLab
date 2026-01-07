<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLayoutStore } from '@/stores/layout'
import DynamicIcon from './DynamicIcon.vue'
import SidebarButton from './SidebarButton.vue'
import { defaultFooterLinks, type FooterLinkConfig } from '@/types/sidebar'

const { t, locale } = useI18n()
const layoutStore = useLayoutStore()

// 配置 URL 根据语言动态获取
const CONFIG_BASE_URL = 'https://chatlab.fun'
const configUrl = computed(() => {
  const langPath = locale.value === 'zh-CN' ? 'cn' : 'en'
  return `${CONFIG_BASE_URL}/${langPath}/config.json`
})

// 存储 key 也根据语言区分
const storageKey = computed(() => `chatlab_app_config_${locale.value}`)

// Footer 链接配置
const footerLinks = ref<FooterLinkConfig[]>(defaultFooterLinks)

/**
 * 从 localStorage 加载缓存配置
 */
function loadCachedConfig(): FooterLinkConfig[] | null {
  try {
    const cached = localStorage.getItem(storageKey.value)
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
  // 先加载缓存
  const cached = loadCachedConfig()
  if (cached) {
    footerLinks.value = cached
  }

  try {
    const result = await window.api.app.fetchRemoteConfig(configUrl.value)
    if (!result.success || !result.data) return

    // 保存整个配置对象（包括 footerLinkConfig、AITips 等）
    const config = result.data as Record<string, unknown>
    localStorage.setItem(storageKey.value, JSON.stringify(config))

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

// 语言切换时重新获取配置
watch(locale, () => {
  fetchConfig()
})
</script>

<template>
  <div class="px-4 py-2 dark:border-gray-800 space-y-2 mb-4">
    <!-- 帮助和反馈 -->
    <UPopover :popper="{ placement: 'right' }">
      <SidebarButton icon="i-heroicons-information-circle" :title="t('sidebar.footer.helpAndFeedback')" />

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
    <SidebarButton
      icon="i-heroicons-cog-6-tooth"
      :title="t('sidebar.footer.settings')"
      @click="layoutStore.showSettingModal = true"
    />
  </div>
</template>
