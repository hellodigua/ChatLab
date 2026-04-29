import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { ProviderDefinition, ModelDefinition } from '@electron/preload/index'

/**
 * LLM 服务配置（展示用，不含敏感信息）
 */
export interface AIServiceConfigDisplay {
  id: string
  name: string
  provider: string
  apiKeySet: boolean
  model?: string
  baseUrl?: string
  createdAt: number
  updatedAt: number
}

/**
 * @deprecated 使用 ProviderDefinition 代替
 */
export interface LLMProvider {
  id: string
  name: string
  defaultBaseUrl: string
  models: Array<{ id: string; name: string; description?: string }>
}

/**
 * LLM 配置状态管理
 */
export const useLLMStore = defineStore('llm', () => {
  // ============ 状态 ============

  const configs = ref<AIServiceConfigDisplay[]>([])

  /** @deprecated 使用 providerRegistry 代替 */
  const providers = ref<LLMProvider[]>([])

  const activeConfigId = ref<string | null>(null)
  const isLoading = ref(false)
  const isInitialized = ref(false)

  /** 新模型系统：Provider Registry（内置 + 自定义） */
  const providerRegistry = ref<ProviderDefinition[]>([])

  /** 新模型系统：Model Catalog（内置 + 自定义） */
  const modelCatalog = ref<ModelDefinition[]>([])

  // ============ 计算属性 ============

  const activeConfig = computed(() => configs.value.find((c) => c.id === activeConfigId.value) || null)
  const hasConfig = computed(() => !!activeConfigId.value)
  const isMaxConfigs = computed(() => configs.value.length >= 99)

  // ============ 新模型系统 computed ============

  function getProviderById(id: string): ProviderDefinition | undefined {
    return providerRegistry.value.find((p) => p.id === id)
  }

  function getModelsByProviderId(providerId: string): ModelDefinition[] {
    return modelCatalog.value.filter((m) => m.providerId === providerId)
  }

  function getModelById(providerId: string, modelId: string): ModelDefinition | undefined {
    return modelCatalog.value.find((m) => m.providerId === providerId && m.id === modelId)
  }

  function findModelAcrossProviders(modelId: string): ModelDefinition | undefined {
    return modelCatalog.value.find((m) => m.id === modelId)
  }

  // ============ 方法 ============

  async function init() {
    if (isInitialized.value) return
    await loadConfigs()
    isInitialized.value = true
  }

  async function loadConfigs() {
    isLoading.value = true
    try {
      const [providersData, registryData, catalogData, configsData, activeId] = await Promise.all([
        window.llmApi.getProviders(),
        window.llmApi.getProviderRegistry(),
        window.llmApi.getModelCatalog(),
        window.llmApi.getAllConfigs(),
        window.llmApi.getActiveConfigId(),
      ])
      providers.value = providersData
      providerRegistry.value = registryData
      modelCatalog.value = catalogData
      configs.value = configsData
      activeConfigId.value = activeId
    } catch (error) {
      console.error('[LLM Store] 加载配置失败：', error)
    } finally {
      isLoading.value = false
    }
  }

  async function setActiveConfig(id: string): Promise<boolean> {
    try {
      const result = await window.llmApi.setActiveConfig(id)
      if (result.success) {
        activeConfigId.value = id
        return true
      }
      console.error('[LLM Store] 设置激活配置失败：', result.error)
      return false
    } catch (error) {
      console.error('[LLM Store] 设置激活配置失败：', error)
      return false
    }
  }

  async function refreshConfigs() {
    await loadConfigs()
  }

  function getProviderName(providerId: string): string {
    const def = providerRegistry.value.find((p) => p.id === providerId)
    if (def) return def.name
    return providers.value.find((p) => p.id === providerId)?.name || providerId
  }

  return {
    // 状态
    configs,
    providers,
    providerRegistry,
    modelCatalog,
    activeConfigId,
    isLoading,
    isInitialized,
    // 计算属性
    activeConfig,
    hasConfig,
    isMaxConfigs,
    // 方法
    init,
    loadConfigs,
    setActiveConfig,
    refreshConfigs,
    getProviderName,
    getProviderById,
    getModelsByProviderId,
    getModelById,
    findModelAcrossProviders,
  }
})
