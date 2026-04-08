<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@/stores/settings'
import { useLLMStore } from '@/stores/llm'
import UITabs from '@/components/UI/Tabs.vue'
import AlertTips from './AlertTips.vue'
import ApiKeyInput from './ApiKeyInput.vue'

const { t, locale } = useI18n()
const settingsStore = useSettingsStore()
const llmStore = useLLMStore()

const CHINA_MARKET_PROVIDERS = ['doubao', 'siliconflow']

function getLocalizedProviderName(providerId: string): string {
  const key = `providers.${providerId}.name`
  const translated = t(key)
  return translated === key ? providerId : translated
}

// ============ 类型定义 ============

interface AIServiceConfig {
  id: string
  name: string
  provider: string
  apiKey?: string
  apiKeySet: boolean
  model?: string
  baseUrl?: string
  disableThinking?: boolean
  isReasoningModel?: boolean
  createdAt: number
  updatedAt: number
}

interface Provider {
  id: string
  name: string
  defaultBaseUrl: string
  models: Array<{ id: string; name: string; description?: string }>
}

const aiTips = computed(() => {
  const config = JSON.parse(
    localStorage.getItem(`chatlab_app_config_${locale.value}`) || localStorage.getItem('chatlab_app_config') || '{}'
  )
  return config.aiTips || {}
})

// ============ Props & Emits ============

const props = defineProps<{
  open: boolean
  mode: 'add' | 'edit'
  config: AIServiceConfig | null
  providers: Provider[]
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  saved: []
}>()

// ============ 状态 ============

type ConnectionMode = 'preset' | 'local' | 'openai-compat'

const connectionMode = ref<ConnectionMode>('preset')
const connectionModeItems = computed(() => [
  { label: t('settings.aiConfig.modal.presetService'), value: 'preset' },
  { label: t('settings.aiConfig.modal.thirdPartyService'), value: 'openai-compat' },
  { label: t('settings.aiConfig.modal.localService'), value: 'local' },
])

const isValidating = ref(false)
const isSaving = ref(false)
const showValidationFailConfirm = ref(false)
const validationFailMessage = ref('')

const showAddModelDialog = ref(false)
const newModelName = ref('')
const newModelId = ref('')
const compatModels = ref<Array<{ id: string; name: string }>>([])

const formData = ref({
  provider: '',
  apiKey: '',
  model: '',
  baseUrl: '',
  disableThinking: true,
  isReasoningModel: false,
})

const validationResult = ref<'idle' | 'valid' | 'invalid'>('idle')
const validationMessage = ref('')

// ============ 计算属性 ============

const registryProviders = computed(() => {
  return llmStore.providerRegistry.filter((p) => {
    if (!settingsStore.locale.startsWith('zh') && CHINA_MARKET_PROVIDERS.includes(p.id)) {
      return false
    }
    return true
  })
})

const officialProviders = computed(() =>
  registryProviders.value.filter((p) => p.kind === 'official' && p.id !== 'openai-compatible')
)

const customProviders = computed(() => registryProviders.value.filter((p) => !p.builtin))

const currentProviderDef = computed(() => llmStore.providerRegistry.find((p) => p.id === formData.value.provider))

const isLocalMode = computed(() => connectionMode.value === 'local')
const isOpenAICompat = computed(() => connectionMode.value === 'openai-compat')
const isPresetMode = computed(() => connectionMode.value === 'preset')
const isCompatMode = computed(() => isLocalMode.value || isOpenAICompat.value)

const catalogModels = computed(() => {
  if (!formData.value.provider) return []
  return llmStore
    .getModelsByProviderId(formData.value.provider)
    .filter((m) => !m.capabilities.includes('embedding') && !m.capabilities.includes('ranking'))
})

const modelTabItems = computed(() => {
  if (isCompatMode.value) {
    return compatModels.value.map((m) => ({ label: m.name, value: m.id }))
  }
  return catalogModels.value.map((m) => ({
    label: m.name,
    value: m.id,
  }))
})

const selectedModelIsCustom = computed(() => {
  if (!formData.value.model) return false
  if (isCompatMode.value) {
    return compatModels.value.some((m) => m.id === formData.value.model)
  }
  const model = catalogModels.value.find((m) => m.id === formData.value.model)
  return model ? !model.builtin : false
})

const canSave = computed(() => {
  const { provider, apiKey, baseUrl, model } = formData.value

  if (isLocalMode.value) {
    return baseUrl.trim() && model.trim()
  }

  if (isOpenAICompat.value) {
    return baseUrl.trim() && apiKey.trim() && model.trim()
  }

  if (!provider) return false
  return apiKey.trim()
})

const modalTitle = computed(() =>
  props.mode === 'add' ? t('settings.aiConfig.modal.addConfig') : t('settings.aiConfig.modal.editConfig')
)

// ============ 方法 ============

function resetForm() {
  connectionMode.value = 'preset'
  compatModels.value = []
  const defaultProvider = officialProviders.value[0]?.id || ''
  const defaultModels = defaultProvider ? llmStore.getModelsByProviderId(defaultProvider) : []
  const defaultChat = defaultModels.find((m) => m.recommendedFor.includes('chat'))
  const defaultProviderDef = defaultProvider ? llmStore.providerRegistry.find((p) => p.id === defaultProvider) : null
  formData.value = {
    provider: defaultProvider,
    apiKey: '',
    model: defaultChat?.id || defaultModels[0]?.id || '',
    baseUrl: defaultProviderDef?.defaultBaseUrl || '',
    disableThinking: true,
    isReasoningModel: false,
  }
  validationResult.value = 'idle'
  validationMessage.value = ''
}

function initFromConfig(config: AIServiceConfig) {
  const providerDef = llmStore.providerRegistry.find((p) => p.id === config.provider)
  const isCompat = config.provider === 'openai-compatible' || config.provider.startsWith('custom:')
  const hasModelInCatalog = !!(config.model && llmStore.getModelById(config.provider, config.model))

  if (isCompat) {
    const looksLocal = !config.apiKeySet || (config.baseUrl?.includes('localhost') ?? false)
    connectionMode.value = looksLocal ? 'local' : 'openai-compat'
    compatModels.value = config.model ? [{ id: config.model, name: config.model }] : []
  } else {
    connectionMode.value = 'preset'
    compatModels.value = []
  }

  formData.value = {
    provider: config.provider,
    apiKey: config.apiKey || '',
    model: isCompat ? config.model || '' : hasModelInCatalog ? config.model || '' : '',
    baseUrl: config.baseUrl || providerDef?.defaultBaseUrl || '',
    disableThinking: config.disableThinking ?? true,
    isReasoningModel: config.isReasoningModel ?? false,
  }
  validationResult.value = 'idle'
  validationMessage.value = ''
}

function selectProvider(providerId: string) {
  formData.value.provider = providerId
  validationResult.value = 'idle'
  validationMessage.value = ''

  formData.value.baseUrl = llmStore.providerRegistry.find((p) => p.id === providerId)?.defaultBaseUrl || ''
  const models = llmStore.getModelsByProviderId(providerId)
  const chatModels = models.filter((m) => m.recommendedFor.includes('chat'))
  formData.value.model = chatModels[0]?.id || models[0]?.id || ''
  formData.value.apiKey = ''
}

function onConnectionModeChange(mode: string | number) {
  connectionMode.value = mode as ConnectionMode
  validationResult.value = 'idle'
  validationMessage.value = ''

  if (mode === 'local') {
    formData.value.provider = 'openai-compatible'
    formData.value.baseUrl = 'http://localhost:11434/v1'
    formData.value.model = compatModels.value[0]?.id || ''
    formData.value.apiKey = ''
  } else if (mode === 'openai-compat') {
    formData.value.provider = 'openai-compatible'
    formData.value.baseUrl = ''
    formData.value.model = compatModels.value[0]?.id || ''
    formData.value.apiKey = ''
  } else {
    compatModels.value = []
    const defaultProvider = officialProviders.value[0]?.id || ''
    formData.value.provider = defaultProvider
    formData.value.baseUrl = llmStore.providerRegistry.find((p) => p.id === defaultProvider)?.defaultBaseUrl || ''
    const models = defaultProvider ? llmStore.getModelsByProviderId(defaultProvider) : []
    const chatModels = models.filter((m) => m.recommendedFor.includes('chat'))
    formData.value.model = chatModels[0]?.id || models[0]?.id || ''
    formData.value.apiKey = ''
  }
}

function openAddModelDialog() {
  newModelName.value = ''
  newModelId.value = ''
  showAddModelDialog.value = true
}

async function confirmAddModel() {
  const modelId = newModelId.value.trim()
  const modelName = newModelName.value.trim() || modelId
  if (!modelId) return

  if (isCompatMode.value) {
    if (!compatModels.value.some((m) => m.id === modelId)) {
      compatModels.value.push({ id: modelId, name: modelName })
    }
    formData.value.model = modelId
    showAddModelDialog.value = false
    return
  }

  const providerId = formData.value.provider || 'openai-compatible'

  try {
    await window.llmApi.addCustomModel({
      id: modelId,
      providerId,
      name: modelName,
      capabilities: ['chat'],
      recommendedFor: [],
      description: '',
      status: 'stable',
    })
    await llmStore.refreshConfigs()
    formData.value.model = modelId
    showAddModelDialog.value = false
  } catch (error) {
    console.error('添加自定义模型失败：', error)
  }
}

async function deleteCustomModel(modelId: string) {
  if (isCompatMode.value) {
    const index = compatModels.value.findIndex((m) => m.id === modelId)
    if (index !== -1) compatModels.value.splice(index, 1)
    if (formData.value.model === modelId) {
      formData.value.model = compatModels.value[0]?.id || ''
    }
    return
  }

  const providerId = formData.value.provider || 'openai-compatible'
  try {
    await window.llmApi.deleteCustomModel(providerId, modelId)
    await llmStore.refreshConfigs()
    if (formData.value.model === modelId) {
      const models = catalogModels.value
      formData.value.model = models[0]?.id || ''
    }
  } catch (error) {
    console.error('删除自定义模型失败：', error)
  }
}

async function validateKey() {
  const { provider, apiKey, baseUrl } = formData.value

  if (!isPresetMode.value) {
    if (!baseUrl) return
    if (isOpenAICompat.value && !apiKey) return
  } else {
    if (!provider || !apiKey) {
      validationResult.value = 'idle'
      validationMessage.value = ''
      return
    }
  }

  isValidating.value = true
  validationResult.value = 'idle'

  try {
    const testApiKey = apiKey || 'sk-no-key-required'
    const result = await window.llmApi.validateApiKey(
      provider || 'openai-compatible',
      testApiKey,
      baseUrl || undefined,
      formData.value.model || undefined
    )
    validationResult.value = result.success ? 'valid' : 'invalid'
    if (result.success) {
      validationMessage.value = t('settings.aiConfig.modal.validationSuccess')
    } else {
      validationMessage.value = result.error || t('settings.aiConfig.modal.validationFailed')
    }
  } catch (error) {
    validationResult.value = 'invalid'
    validationMessage.value = t('settings.aiConfig.modal.validationError') + String(error)
  } finally {
    isValidating.value = false
  }
}

function generateName(): string {
  const def = currentProviderDef.value
  const providerName = def
    ? getLocalizedProviderName(def.id) || def.name
    : (() => {
        const legacy = props.providers.find((p) => p.id === formData.value.provider)
        if (legacy) return legacy.name
        try {
          return new URL(formData.value.baseUrl).hostname
        } catch {
          /* ignore */
        }
        return formData.value.baseUrl || t('settings.aiConfig.modal.customService')
      })()

  const modelId = formData.value.model.trim()
  if (!modelId) return providerName

  const modelDef = llmStore.getModelById(formData.value.provider, modelId)
  const modelName = modelDef?.name || modelId
  return `${providerName} - ${modelName}`
}

async function doSave() {
  isSaving.value = true
  try {
    const finalProvider = formData.value.provider
    let finalApiKey = formData.value.apiKey.trim()
    if (!finalApiKey && isLocalMode.value) {
      finalApiKey = 'sk-no-key-required'
    }
    const finalName = generateName()

    const isReasoning = formData.value.isReasoningModel
    if (props.mode === 'add') {
      const result = await window.llmApi.addConfig({
        name: finalName,
        provider: finalProvider,
        apiKey: finalApiKey,
        model: formData.value.model.trim() || undefined,
        baseUrl: formData.value.baseUrl.trim() || undefined,
        disableThinking: isReasoning ? formData.value.disableThinking : undefined,
        isReasoningModel: isReasoning || undefined,
      })

      if (result.success) {
        emit('update:open', false)
        emit('saved')
      } else {
        console.error('添加配置失败：', result.error)
      }
    } else {
      const updates: Record<string, unknown> = {
        name: finalName,
        provider: finalProvider,
        model: formData.value.model.trim() || undefined,
        baseUrl: formData.value.baseUrl.trim() || undefined,
        disableThinking: isReasoning ? formData.value.disableThinking : undefined,
        isReasoningModel: isReasoning || undefined,
      }

      if (formData.value.apiKey.trim()) {
        updates.apiKey = formData.value.apiKey.trim()
      }

      const result = await window.llmApi.updateConfig(props.config!.id, updates)

      if (result.success) {
        emit('update:open', false)
        emit('saved')
      } else {
        console.error('更新配置失败：', result.error)
      }
    }
  } catch (error) {
    console.error('保存配置失败：', error)
  } finally {
    isSaving.value = false
  }
}

async function saveConfig() {
  if (!canSave.value) return

  if (validationResult.value === 'valid') {
    return doSave()
  }

  isValidating.value = true
  try {
    const testApiKey = formData.value.apiKey.trim() || 'sk-no-key-required'
    const result = await window.llmApi.validateApiKey(
      formData.value.provider || 'openai-compatible',
      testApiKey,
      formData.value.baseUrl.trim() || undefined,
      formData.value.model.trim() || undefined
    )

    if (result.success) {
      validationResult.value = 'valid'
      validationMessage.value = ''
      return doSave()
    }

    validationResult.value = 'invalid'
    validationFailMessage.value = result.error || t('settings.aiConfig.modal.validationFailed')
    showValidationFailConfirm.value = true
  } catch (error) {
    validationFailMessage.value = String(error)
    showValidationFailConfirm.value = true
  } finally {
    isValidating.value = false
  }
}

function confirmSaveAnyway() {
  showValidationFailConfirm.value = false
  doSave()
}

function cancelSave() {
  showValidationFailConfirm.value = false
}

function closeModal() {
  emit('update:open', false)
}

// ============ 监听器 ============

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      if (props.mode === 'edit' && props.config) {
        initFromConfig(props.config)
      } else {
        resetForm()
      }
    }
  }
)

watch(
  () => formData.value.apiKey,
  () => {
    validationResult.value = 'idle'
    validationMessage.value = ''
  }
)
</script>

<template>
  <UModal :open="open" :ui="{ content: 'max-w-2xl' }" @update:open="emit('update:open', $event)">
    <template #content>
      <div class="max-h-[80vh] overflow-y-auto p-6">
        <h3 class="mb-4 text-lg font-semibold text-gray-900 dark:text-white">{{ modalTitle }}</h3>

        <div class="space-y-4">
          <!-- ===== 连接模式 Tab ===== -->
          <UITabs
            :model-value="connectionMode"
            :items="connectionModeItems"
            size="sm"
            @update:model-value="onConnectionModeChange"
          />

          <!-- ===== 预设服务模式 ===== -->
          <template v-if="isPresetMode">
            <!-- Provider 选择 -->
            <div>
              <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {{ t('settings.aiConfig.modal.aiProvider') }}
              </label>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="p in officialProviders"
                  :key="p.id"
                  class="rounded-lg border-2 px-3 py-1.5 text-xs font-medium transition-colors"
                  :class="[
                    formData.provider === p.id
                      ? 'border-primary-500 bg-primary-50 text-primary-700 dark:border-primary-400 dark:bg-primary-900/20 dark:text-primary-300'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-600',
                  ]"
                  @click="selectProvider(p.id)"
                >
                  {{ getLocalizedProviderName(p.id) || p.name }}
                </button>

                <button
                  v-for="p in customProviders"
                  :key="p.id"
                  class="rounded-lg border-2 px-3 py-1.5 text-xs font-medium transition-colors"
                  :class="[
                    formData.provider === p.id
                      ? 'border-primary-500 bg-primary-50 text-primary-700 dark:border-primary-400 dark:bg-primary-900/20 dark:text-primary-300'
                      : 'border-dashed border-gray-300 text-gray-500 hover:border-gray-400 dark:border-gray-600 dark:text-gray-400',
                  ]"
                  @click="selectProvider(p.id)"
                >
                  {{ p.name }}
                </button>
              </div>

              <!-- Provider 说明卡片 -->
              <div
                v-if="currentProviderDef && (currentProviderDef.website || currentProviderDef.consoleUrl)"
                class="mt-3 rounded-lg border border-gray-100 bg-gray-50/50 px-3 py-2 dark:border-gray-800 dark:bg-gray-800/50"
              >
                <div class="flex gap-3">
                  <a
                    v-if="currentProviderDef.website"
                    :href="currentProviderDef.website"
                    target="_blank"
                    rel="noopener"
                    class="text-[10px] text-primary-500 hover:underline"
                  >
                    {{ t('settings.aiConfig.modal.visitWebsite') }}
                  </a>
                  <a
                    v-if="currentProviderDef.consoleUrl"
                    :href="currentProviderDef.consoleUrl"
                    target="_blank"
                    rel="noopener"
                    class="text-[10px] text-primary-500 hover:underline"
                  >
                    {{ t('settings.aiConfig.modal.getApiKey') }}
                  </a>
                </div>
              </div>
            </div>

            <!-- API Key -->
            <ApiKeyInput
              v-model="formData.apiKey"
              :placeholder="t('settings.aiConfig.modal.apiKeyPlaceholder')"
              :validate-loading="isValidating"
              :validate-disabled="!formData.apiKey"
              :validate-text="t('settings.aiConfig.modal.validate')"
              :validation-result="validationResult"
              :validation-message="validationMessage"
              @validate="validateKey"
            />

            <!-- API 端点（官方 Provider 自定义 URL） -->
            <div>
              <label class="text-sm font-medium text-gray-700 dark:text-gray-300">
                {{ t('settings.aiConfig.modal.apiEndpoint') }}
              </label>
              <UInput
                v-model="formData.baseUrl"
                class="mt-2 w-full"
                :placeholder="currentProviderDef?.defaultBaseUrl || 'https://api.example.com/v1'"
              />
              <p class="mt-1 text-[10px] text-gray-400">
                {{ t('settings.aiConfig.modal.apiEndpointOverrideHint') }}
              </p>
            </div>

            <!-- 模型选择 -->
            <div>
              <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {{ t('settings.aiConfig.modal.model') }}
              </label>

              <UITabs v-if="modelTabItems.length > 0" v-model="formData.model" :items="modelTabItems" size="xs" />
              <p v-if="formData.model" class="mt-2 text-xs text-gray-500 dark:text-gray-400">
                {{ t('settings.aiConfig.modal.customModelId') }}: {{ formData.model }}
              </p>

              <div class="mt-2 flex items-center gap-2">
                <button
                  v-if="currentProviderDef?.supportsCustomModels"
                  class="text-xs text-primary-500 hover:underline"
                  @click="openAddModelDialog"
                >
                  + {{ t('settings.aiConfig.modal.addCustomModel') }}
                </button>
                <button
                  v-if="selectedModelIsCustom"
                  class="text-xs text-red-400 hover:text-red-500 hover:underline"
                  @click="deleteCustomModel(formData.model)"
                >
                  {{ t('settings.aiConfig.modal.deleteCustomModel') }}
                </button>
              </div>
            </div>
          </template>

          <!-- ===== 本地服务模式 ===== -->
          <template v-else-if="isLocalMode">
            <!-- API Key -->
            <ApiKeyInput
              v-model="formData.apiKey"
              :placeholder="t('settings.aiConfig.modal.apiKeyPlaceholderLocal')"
              :optional-text="t('settings.aiConfig.modal.optional')"
              :hint="t('settings.aiConfig.modal.apiKeyHintLocal')"
            />

            <!-- API 端点 -->
            <div>
              <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {{ t('settings.aiConfig.modal.apiEndpoint') }}
              </label>
              <div class="flex gap-2">
                <UInput v-model="formData.baseUrl" placeholder="http://localhost:11434/v1" class="flex-1" />
                <UButton :loading="isValidating" :disabled="!formData.baseUrl" variant="soft" @click="validateKey">
                  {{ t('settings.aiConfig.modal.validate') }}
                </UButton>
              </div>
            </div>

            <!-- 模型选择 -->
            <div>
              <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {{ t('settings.aiConfig.modal.model') }}
              </label>

              <UITabs v-if="modelTabItems.length > 0" v-model="formData.model" :items="modelTabItems" size="xs" />
              <p v-if="formData.model" class="mt-2 text-xs text-gray-500 dark:text-gray-400">
                {{ t('settings.aiConfig.modal.customModelId') }}: {{ formData.model }}
              </p>

              <div class="mt-2 flex items-center gap-2">
                <button
                  v-if="currentProviderDef?.supportsCustomModels"
                  class="text-xs text-primary-500 hover:underline"
                  @click="openAddModelDialog"
                >
                  + {{ t('settings.aiConfig.modal.addCustomModel') }}
                </button>
                <button
                  v-if="selectedModelIsCustom"
                  class="text-xs text-red-400 hover:text-red-500 hover:underline"
                  @click="deleteCustomModel(formData.model)"
                >
                  {{ t('settings.aiConfig.modal.deleteCustomModel') }}
                </button>
              </div>
            </div>

            <!-- 验证结果 -->
            <div v-if="validationMessage">
              <div
                v-if="validationResult === 'valid'"
                class="flex items-center gap-1 text-sm text-green-600 dark:text-green-400"
              >
                <UIcon name="i-heroicons-check-circle" class="h-4 w-4" />
                {{ validationMessage }}
              </div>
              <div
                v-else-if="validationResult === 'invalid'"
                class="flex items-center gap-1 text-sm text-amber-600 dark:text-amber-400"
              >
                <UIcon name="i-heroicons-exclamation-triangle" class="h-4 w-4" />
                {{ validationMessage }}
              </div>
            </div>
          </template>

          <!-- ===== OpenAI 兼容模式 ===== -->
          <template v-else-if="isOpenAICompat">
            <AlertTips
              v-if="aiTips.thirdPartyApi?.show"
              icon="i-heroicons-exclamation-triangle"
              :content="aiTips.thirdPartyApi?.content"
            />

            <!-- API Key -->
            <ApiKeyInput
              v-model="formData.apiKey"
              :placeholder="t('settings.aiConfig.modal.apiKeyPlaceholder')"
              :validate-loading="isValidating"
              :validate-disabled="!formData.apiKey || !formData.baseUrl"
              :validate-text="t('settings.aiConfig.modal.validate')"
              :validation-result="validationResult"
              :validation-message="validationMessage"
              @validate="validateKey"
            />

            <!-- API 端点 -->
            <div>
              <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {{ t('settings.aiConfig.modal.apiEndpoint') }}
              </label>
              <UInput v-model="formData.baseUrl" class="w-full" placeholder="https://api.example.com/v1" />
              <p class="mt-1 text-xs text-gray-500">{{ t('settings.aiConfig.modal.apiEndpointHint') }}</p>
            </div>

            <!-- 模型选择 -->
            <div>
              <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {{ t('settings.aiConfig.modal.model') }}
              </label>

              <UITabs v-if="modelTabItems.length > 0" v-model="formData.model" :items="modelTabItems" size="xs" />
              <p v-if="formData.model" class="mt-2 text-xs text-gray-500 dark:text-gray-400">
                {{ t('settings.aiConfig.modal.customModelId') }}: {{ formData.model }}
              </p>

              <div class="mt-2 flex items-center gap-2">
                <button
                  v-if="currentProviderDef?.supportsCustomModels"
                  class="text-xs text-primary-500 hover:underline"
                  @click="openAddModelDialog"
                >
                  + {{ t('settings.aiConfig.modal.addCustomModel') }}
                </button>
                <button
                  v-if="selectedModelIsCustom"
                  class="text-xs text-red-400 hover:text-red-500 hover:underline"
                  @click="deleteCustomModel(formData.model)"
                >
                  {{ t('settings.aiConfig.modal.deleteCustomModel') }}
                </button>
              </div>
            </div>
          </template>

          <!-- ===== 通用：推理模型选项 ===== -->
          <template v-if="formData.provider || !isPresetMode">
            <div class="flex items-center justify-between rounded-lg bg-gray-50 p-3 dark:bg-gray-800">
              <div>
                <p class="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {{ t('settings.aiConfig.modal.isReasoningModel') }}
                </p>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  {{ t('settings.aiConfig.modal.isReasoningModelDesc') }}
                </p>
              </div>
              <USwitch v-model="formData.isReasoningModel" />
            </div>

            <div
              v-if="formData.isReasoningModel"
              class="flex items-center justify-between rounded-lg bg-gray-50 p-3 dark:bg-gray-800"
            >
              <div>
                <p class="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {{ t('settings.aiConfig.modal.disableThinking') }}
                </p>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  {{ t('settings.aiConfig.modal.disableThinkingDesc') }}
                </p>
              </div>
              <USwitch v-model="formData.disableThinking" />
            </div>
          </template>
        </div>

        <!-- 底部按钮 -->
        <div class="mt-6 flex justify-end gap-2">
          <UButton variant="soft" @click="closeModal">{{ t('common.cancel') }}</UButton>
          <UButton color="primary" :disabled="!canSave" :loading="isSaving || isValidating" @click="saveConfig">
            {{ mode === 'add' ? t('common.add') : t('common.save') }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>

  <!-- 验证失败确认弹窗 -->
  <UModal :open="showValidationFailConfirm" @update:open="showValidationFailConfirm = $event">
    <template #content>
      <div class="p-6">
        <div class="mb-4 flex items-start gap-3">
          <UIcon name="i-heroicons-exclamation-triangle" class="mt-0.5 h-6 w-6 shrink-0 text-amber-500" />
          <div>
            <h4 class="font-medium text-gray-900 dark:text-white">
              {{ t('settings.aiConfig.modal.validationFailedTitle') }}
            </h4>
            <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">{{ validationFailMessage }}</p>
            <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
              {{ t('settings.aiConfig.modal.saveAnywayHint') }}
            </p>
          </div>
        </div>
        <div class="flex justify-end gap-2">
          <UButton variant="soft" @click="cancelSave">{{ t('common.cancel') }}</UButton>
          <UButton color="warning" @click="confirmSaveAnyway">
            {{ t('settings.aiConfig.modal.saveAnyway') }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>

  <!-- 添加自定义模型小弹窗 -->
  <UModal :open="showAddModelDialog" @update:open="showAddModelDialog = $event">
    <template #content>
      <div class="p-5">
        <h4 class="mb-4 text-base font-semibold text-gray-900 dark:text-white">
          {{ t('settings.aiConfig.modal.addCustomModel') }}
        </h4>
        <div class="space-y-3">
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {{ t('settings.aiConfig.modal.customModelId') }}
            </label>
            <UInput v-model="newModelId" class="w-full" placeholder="gpt-4o-custom, deepseek-r1, ..." />
            <p class="mt-1 text-[10px] text-gray-400">
              {{ t('settings.aiConfig.modal.customModelIdHint') }}
            </p>
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {{ t('settings.aiConfig.modal.customModelDisplayName') }}
              <span class="font-normal text-gray-400">{{ t('settings.aiConfig.modal.optional') }}</span>
            </label>
            <UInput
              v-model="newModelName"
              class="w-full"
              :placeholder="newModelId || t('settings.aiConfig.modal.customModelDisplayNamePlaceholder')"
            />
          </div>
        </div>
        <div class="mt-4 flex justify-end gap-2">
          <UButton variant="soft" @click="showAddModelDialog = false">{{ t('common.cancel') }}</UButton>
          <UButton color="primary" :disabled="!newModelId.trim()" @click="confirmAddModel">
            {{ t('common.add') }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
