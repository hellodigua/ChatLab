<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import AIConfigTab from './settings/AIConfigTab.vue'
import AIPromptConfigTab from './settings/AIPromptConfigTab.vue'
import BasicSettingsTab from './settings/BasicSettingsTab.vue'
import StorageTab from './settings/StorageTab.vue'
import AboutTab from './settings/AboutTab.vue'

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
  { id: 'ai-config', label: t('settings.tabs.aiConfig'), icon: 'i-heroicons-sparkles' },
  { id: 'ai-prompt', label: t('settings.tabs.aiPrompt'), icon: 'i-heroicons-document-text' },
  { id: 'storage', label: t('settings.tabs.storage'), icon: 'i-heroicons-folder-open' },
  { id: 'about', label: t('settings.tabs.about'), icon: 'i-heroicons-information-circle' },
])

const activeTab = ref('settings')
const aiConfigRef = ref<InstanceType<typeof AIConfigTab> | null>(null)
const storageTabRef = ref<InstanceType<typeof StorageTab> | null>(null)

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
        <div class="mb-6 border-b border-gray-200 dark:border-gray-700">
          <div class="flex gap-1">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              class="flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors"
              :class="[
                activeTab === tab.id
                  ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300',
              ]"
              @click="activeTab = tab.id"
            >
              <UIcon :name="tab.icon" class="h-4 w-4" />
              <span>{{ tab.label }}</span>
            </button>
          </div>
        </div>

        <!-- Tab 内容 -->
        <div class="h-[500px] overflow-y-auto">
          <!-- AI 配置 Tab -->
          <div v-show="activeTab === 'ai-config'">
            <AIConfigTab ref="aiConfigRef" @config-changed="handleAIConfigChanged" />
          </div>

          <!-- AI对话配置 Tab -->
          <div v-show="activeTab === 'ai-prompt'">
            <AIPromptConfigTab @config-changed="handleAIConfigChanged" />
          </div>

          <!-- 设置 Tab -->
          <div v-show="activeTab === 'settings'">
            <BasicSettingsTab />
          </div>

          <!-- 存储管理 Tab -->
          <div v-show="activeTab === 'storage'">
            <StorageTab ref="storageTabRef" />
          </div>

          <!-- 关于 Tab -->
          <div v-show="activeTab === 'about'">
            <AboutTab />
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
