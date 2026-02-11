<script setup lang="ts">
import { ref, watch, computed, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLayoutStore } from '@/stores/layout'
import AISettingsTab from './settings/AISettingsTab.vue'
import BasicSettingsTab from './settings/BasicSettingsTab.vue'
import StorageTab from './settings/StorageTab.vue'
import AboutTab from './settings/AboutTab.vue'
import SubTabs from '@/components/UI/SubTabs.vue'

const { t } = useI18n()
const layoutStore = useLayoutStore()

// 可滚动 Tab 的通用接口（支持 section 跳转的 Tab 需实现此接口）
interface ScrollableTab {
  scrollToSection?: (sectionId: string) => void
  refresh?: () => void
}

// Props
const props = defineProps<{
  open: boolean
}>()

// Emits
const emit = defineEmits<{
  'update:open': [value: boolean]
  'ai-config-saved': []
}>()

// Tab 配置（使用 computed 以便语言切换时自动更新）
const tabs = computed(() => [
  { id: 'settings', label: t('settings.tabs.basic'), icon: 'i-heroicons-cog-6-tooth' },
  { id: 'ai', label: t('settings.tabs.ai'), icon: 'i-heroicons-sparkles' },
  { id: 'storage', label: t('settings.tabs.storage'), icon: 'i-heroicons-folder-open' },
  { id: 'about', label: t('settings.tabs.about'), icon: 'i-heroicons-information-circle' },
])

const activeTab = ref('settings')

// 统一的 Tab 引用管理（通过 setTabRef 动态设置）
const tabRefs = ref<Record<string, ScrollableTab | null>>({})

/**
 * 设置 Tab 引用（在模板中通过 :ref 调用）
 */
function setTabRef(tabId: string, el: unknown) {
  tabRefs.value[tabId] = el as ScrollableTab | null
}

// AI 配置变更回调
function handleAIConfigChanged() {
  emit('ai-config-saved')
}

// 关闭弹窗
function closeModal() {
  emit('update:open', false)
  layoutStore.clearSettingTarget()
}

// 监听打开状态
watch(
  () => props.open,
  async (newVal) => {
    if (newVal) {
      // 检查是否有指定的跳转目标
      const target = layoutStore.settingTarget
      if (target) {
        activeTab.value = target.tab
        // 如果有指定 section，等待渲染后滚动（通用逻辑）
        if (target.section) {
          await nextTick()
          // 延迟一下确保目标 Tab 已渲染
          setTimeout(() => {
            const tabRef = tabRefs.value[target.tab]
            tabRef?.scrollToSection?.(target.section!)
          }, 100)
        }
      } else {
        activeTab.value = 'settings' // 默认打开基础设置 Tab
      }
      // 刷新存储管理
      tabRefs.value['storage']?.refresh?.()
    } else {
      // 弹窗关闭时清空 target
      layoutStore.clearSettingTarget()
    }
  }
)

// 监听 Tab 切换，刷新对应数据
watch(
  () => activeTab.value,
  (newTab) => {
    // 通用刷新逻辑
    tabRefs.value[newTab]?.refresh?.()
  }
)
</script>

<template>
  <UModal
    :open="open"
    :ui="{ overlay: 'app-region-no-drag', content: 'md:w-full max-w-2xl app-region-no-drag' }"
    @update:open="emit('update:open', $event)"
  >
    <template #content>
      <div class="p-6">
        <!-- Header -->
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('settings.title') }}</h2>
          <UButton icon="i-heroicons-x-mark" variant="ghost" size="sm" @click="closeModal" />
        </div>

        <!-- Tab 导航 -->
        <div class="mb-6 -mx-6">
          <SubTabs v-model="activeTab" :items="tabs" />
        </div>

        <!-- Tab 内容 -->
        <div class="h-[500px] overflow-y-auto">
          <!-- 基础设置 -->
          <div v-show="activeTab === 'settings'">
            <BasicSettingsTab />
          </div>

          <!-- AI 设置 -->
          <div v-show="activeTab === 'ai'" class="h-full">
            <AISettingsTab :ref="(el) => setTabRef('ai', el)" @config-changed="handleAIConfigChanged" />
          </div>

          <!-- 存储管理 -->
          <div v-show="activeTab === 'storage'" class="h-full">
            <StorageTab :ref="(el) => setTabRef('storage', el)" />
          </div>

          <!-- 关于 -->
          <div v-show="activeTab === 'about'">
            <AboutTab />
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
