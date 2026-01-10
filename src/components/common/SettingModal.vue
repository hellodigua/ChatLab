<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import AISettingsTab from './settings/AISettingsTab.vue'
import BasicSettingsTab from './settings/BasicSettingsTab.vue'
import StorageTab from './settings/StorageTab.vue'
import AboutTab from './settings/AboutTab.vue'
import SubTabs from '@/components/UI/SubTabs.vue'

const { t } = useI18n()

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
// Template refs - used via ref="xxx" in template
const storageTabRef = ref<InstanceType<typeof StorageTab> | null>(null)
// Ensure refs are tracked for vue-tsc
void storageTabRef

// AI 配置变更回调
function handleAIConfigChanged() {
  emit('ai-config-saved')
}

// 关闭弹窗
function closeModal() {
  emit('update:open', false)
}

// 监听打开状态
watch(
  () => props.open,
  (newVal) => {
    if (newVal) {
      activeTab.value = 'settings' // 默认打开基础设置 Tab
      // 刷新存储管理（如果需要的话，或者在切换到 storage tab 时刷新）
      storageTabRef.value?.refresh()
    }
  }
)

// 监听 Tab 切换，刷新对应数据
watch(
  () => activeTab.value,
  (newTab) => {
    if (newTab === 'storage') {
      storageTabRef.value?.refresh()
    }
  }
)
</script>

<template>
  <UModal :open="open" @update:open="emit('update:open', $event)" :ui="{ content: 'md:w-full max-w-2xl' }">
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
            <AISettingsTab @config-changed="handleAIConfigChanged" />
          </div>

          <!-- 存储管理 -->
          <div v-show="activeTab === 'storage'">
            <StorageTab ref="storageTabRef" />
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
