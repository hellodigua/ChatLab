<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import AIConfigEditModal from './AIConfigEditModal.vue'
import AlertTips from './AlertTips.vue'

const { t } = useI18n()

// Emits
const emit = defineEmits<{
  'config-changed': []
}>()

// ============ 类型定义 ============

interface AIServiceConfig {
  id: string
  name: string
  provider: string
  apiKey: string
  apiKeySet: boolean
  model?: string
  baseUrl?: string
  createdAt: number
  updatedAt: number
}

interface Provider {
  id: string
  name: string
  description: string
  defaultBaseUrl: string
  models: Array<{ id: string; name: string; description?: string }>
}

const aiTips = JSON.parse(localStorage.getItem('chatlab_app_config') || '{}').aiTips || {}

// ============ 状态 ============

const isLoading = ref(false)
const providers = ref<Provider[]>([])
const configs = ref<AIServiceConfig[]>([])
const activeConfigId = ref<string | null>(null)

// 弹窗状态
const showEditModal = ref(false)
const editMode = ref<'add' | 'edit'>('add')
const editingConfig = ref<AIServiceConfig | null>(null)

// ============ 计算属性 ============

const isMaxConfigs = computed(() => configs.value.length >= 10)

// ============ 方法 ============

async function loadData() {
  isLoading.value = true
  try {
    const [providersData, configsData, activeId] = await Promise.all([
      window.llmApi.getProviders(),
      window.llmApi.getAllConfigs(),
      window.llmApi.getActiveConfigId(),
    ])
    providers.value = providersData
    configs.value = configsData
    activeConfigId.value = activeId
  } catch (error) {
    console.error('加载配置失败：', error)
  } finally {
    isLoading.value = false
  }
}

function openAddModal() {
  editMode.value = 'add'
  editingConfig.value = null
  showEditModal.value = true
}

function openEditModal(config: AIServiceConfig) {
  editMode.value = 'edit'
  editingConfig.value = config
  showEditModal.value = true
}

async function handleModalSaved() {
  await loadData()
  emit('config-changed')
}

async function deleteConfig(id: string) {
  try {
    const result = await window.llmApi.deleteConfig(id)
    if (result.success) {
      await loadData()
      emit('config-changed')
    } else {
      console.error('删除配置失败：', result.error)
    }
  } catch (error) {
    console.error('删除配置失败：', error)
  }
}

async function setActive(id: string) {
  try {
    const result = await window.llmApi.setActiveConfig(id)
    if (result.success) {
      activeConfigId.value = id
      emit('config-changed')
    } else {
      console.error('设置激活配置失败：', result.error)
    }
  } catch (error) {
    console.error('设置激活配置失败：', error)
  }
}

function getProviderName(providerId: string): string {
  return providers.value.find((p) => p.id === providerId)?.name || providerId
}

// ============ 暴露方法 ============

function refresh() {
  loadData()
}

defineExpose({ refresh })

onMounted(() => {
  loadData()
})
</script>

<template>
  <!-- 加载中 -->
  <div v-if="isLoading" class="flex items-center justify-center py-12">
    <UIcon name="i-heroicons-arrow-path" class="h-6 w-6 animate-spin text-gray-400" />
  </div>

  <!-- 配置列表视图 -->
  <div v-else class="space-y-4">
    <AlertTips v-if="configs.length === 0 && aiTips.configTab?.show" :content="aiTips.configTab?.content" />
    <!-- 配置列表 -->
    <div v-if="configs.length > 0" class="space-y-2">
      <div
        v-for="config in configs"
        :key="config.id"
        class="group flex cursor-pointer items-center justify-between rounded-lg border p-3 transition-colors"
        :class="[
          config.id === activeConfigId
            ? 'border-primary-300 bg-primary-50 dark:border-primary-700 dark:bg-primary-900/20'
            : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800',
        ]"
        @click="setActive(config.id)"
      >
        <!-- 配置信息 -->
        <div class="flex items-center gap-3">
          <div
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
            :class="[
              config.id === activeConfigId
                ? 'bg-primary-500 text-white'
                : 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
            ]"
          >
            <UIcon
              :name="config.id === activeConfigId ? 'i-heroicons-check' : 'i-heroicons-sparkles'"
              class="h-4 w-4"
            />
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span class="font-medium text-gray-900 dark:text-white">{{ config.name }}</span>
              <UBadge v-if="config.id === activeConfigId" color="primary" variant="soft" size="xs">{{ t('settings.aiConfig.inUse') }}</UBadge>
            </div>
            <div class="mt-0.5 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <span>{{ getProviderName(config.provider) }}</span>
              <span>·</span>
              <span>{{ config.model || t('settings.aiConfig.defaultModel') }}</span>
              <span v-if="config.baseUrl">·</span>
              <span v-if="config.baseUrl" class="text-violet-500">
                {{ config.provider === 'openai-compatible' ? t('settings.aiConfig.localService') : t('settings.aiConfig.customEndpoint') }}
              </span>
            </div>
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100" @click.stop>
          <UButton size="xs" color="gray" variant="ghost" @click="openEditModal(config)">{{ t('settings.aiConfig.edit') }}</UButton>
          <UButton size="xs" color="error" variant="ghost" @click="deleteConfig(config.id)">{{ t('settings.aiConfig.delete') }}</UButton>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div
      v-else
      class="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-200 py-12 dark:border-gray-700"
    >
      <UIcon name="i-heroicons-sparkles" class="h-12 w-12 text-gray-300 dark:text-gray-600" />
      <p class="mt-4 text-sm text-gray-500 dark:text-gray-400">{{ t('settings.aiConfig.empty.title') }}</p>
      <p class="text-xs text-gray-400 dark:text-gray-500">{{ t('settings.aiConfig.empty.description') }}</p>
    </div>

    <!-- 添加按钮 -->
    <div class="flex justify-center">
      <UButton variant="soft" :disabled="isMaxConfigs" class="mt-4" @click="openAddModal">
        <UIcon name="i-heroicons-plus" class="mr-2 h-4 w-4" />
        {{ isMaxConfigs ? t('settings.aiConfig.maxConfigs') : t('settings.aiConfig.addConfig') }}
      </UButton>
    </div>
  </div>

  <!-- 编辑/添加弹窗 -->
  <AIConfigEditModal
    v-model:open="showEditModal"
    :mode="editMode"
    :config="editingConfig"
    :providers="providers"
    @saved="handleModalSaved"
  />
</template>
