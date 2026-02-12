/**
 * LLM 服务模块入口
 * 提供统一的 LLM 服务管理（支持多配置）
 */

import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { getAiDataDir } from '../../paths'
import type {
  LLMConfig,
  LLMProvider,
  ILLMService,
  ProviderInfo,
  ChatMessage,
  ChatOptions,
  ChatStreamChunk,
  AIServiceConfig,
  AIConfigStore,
} from './types'
import { MAX_CONFIG_COUNT } from './types'
import { GeminiService, GEMINI_INFO } from './gemini'
import { OpenAICompatibleService, OPENAI_COMPATIBLE_INFO } from './openai-compatible'
import { aiLogger, extractErrorInfo, extractErrorStack } from '../logger'
import { encryptApiKey, decryptApiKey, isEncrypted } from './crypto'
import { t } from '../../i18n'

// 导出类型
export * from './types'

// ==================== 新增提供商信息 ====================

/** DeepSeek 提供商信息 */
const DEEPSEEK_INFO: ProviderInfo = {
  id: 'deepseek',
  name: 'DeepSeek',
  description: 'DeepSeek AI 大语言模型',
  defaultBaseUrl: 'https://api.deepseek.com/v1',
  models: [
    { id: 'deepseek-chat', name: 'DeepSeek Chat', description: '通用对话模型' },
    { id: 'deepseek-coder', name: 'DeepSeek Coder', description: '代码生成模型' },
  ],
}

/** 通义千问 (Qwen) 提供商信息 */
const QWEN_INFO: ProviderInfo = {
  id: 'qwen',
  name: '通义千问',
  description: '阿里云通义千问大语言模型',
  defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  models: [
    { id: 'qwen-turbo', name: 'Qwen Turbo', description: '通义千问超大规模语言模型，速度快' },
    { id: 'qwen-plus', name: 'Qwen Plus', description: '通义千问超大规模语言模型，效果好' },
    { id: 'qwen-max', name: 'Qwen Max', description: '通义千问千亿级别超大规模语言模型' },
  ],
}

/** MiniMax 提供商信息 */
const MINIMAX_INFO: ProviderInfo = {
  id: 'minimax',
  name: 'MiniMax',
  description: 'MiniMax 大语言模型，支持多模态和长上下文',
  defaultBaseUrl: 'https://api.minimaxi.com/v1',
  models: [
    { id: 'MiniMax-M2', name: 'MiniMax-M2', description: '旗舰模型' },
    { id: 'MiniMax-M2-Stable', name: 'MiniMax-M2-Stable', description: '稳定版本' },
  ],
}

/** 智谱 GLM 提供商信息 */
const GLM_INFO: ProviderInfo = {
  id: 'glm',
  name: 'GLM',
  description: '智谱 AI 大语言模型，ChatGLM 系列',
  defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  models: [
    { id: 'glm-4-plus', name: 'GLM-4-Plus', description: '旗舰模型，效果最佳' },
    { id: 'glm-4-flash', name: 'GLM-4-Flash', description: '高速模型，性价比高' },
    { id: 'glm-4', name: 'GLM-4', description: '标准模型' },
    { id: 'glm-4v-plus', name: 'GLM-4V-Plus', description: '多模态视觉模型' },
    { id: 'glm-4.6v-flash', name: '4.6V免费版', description: '4.6V免费版模型' },
    { id: 'glm-4.5-flash', name: '4.5免费版', description: '4.5免费版模型' },
  ],
}

/** Kimi (月之暗面 Moonshot) 提供商信息 */
const KIMI_INFO: ProviderInfo = {
  id: 'kimi',
  name: 'Kimi',
  description: 'Moonshot AI 大语言模型，支持超长上下文',
  defaultBaseUrl: 'https://api.moonshot.cn/v1',
  models: [
    { id: 'moonshot-v1-8k', name: 'Moonshot-V1-8K', description: '8K 上下文' },
    { id: 'moonshot-v1-32k', name: 'Moonshot-V1-32K', description: '32K 上下文' },
    { id: 'moonshot-v1-128k', name: 'Moonshot-V1-128K', description: '128K 超长上下文' },
  ],
}

/** 豆包 (字节跳动 ByteDance) 提供商信息 */
const DOUBAO_INFO: ProviderInfo = {
  id: 'doubao',
  name: '豆包',
  description: '字节跳动豆包 AI 大语言模型',
  defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  models: [
    { id: 'doubao-seed-1-6-lite-251015', name: '豆包1.6-lite', description: '豆包1.6模型，性价比' },
    { id: 'doubao-seed-1-6-251015', name: '豆包1.6', description: '更强豆包1.6模型' },
    { id: 'doubao-seed-1-6-flash-250828', name: '豆包1.6-flash', description: '更快的豆包1.6模型' },
    { id: 'doubao-1-5-lite-32k-250115', name: '豆包1.5-lite', description: '豆包1.5Pro模型模型' },
  ],
}

// 所有支持的提供商信息
export const PROVIDERS: ProviderInfo[] = [
  DEEPSEEK_INFO,
  QWEN_INFO,
  GEMINI_INFO,
  MINIMAX_INFO,
  GLM_INFO,
  KIMI_INFO,
  DOUBAO_INFO,
  OPENAI_COMPATIBLE_INFO,
]

// 配置文件路径
let CONFIG_PATH: string | null = null

function getConfigPath(): string {
  if (CONFIG_PATH) return CONFIG_PATH
  CONFIG_PATH = path.join(getAiDataDir(), 'llm-config.json')
  return CONFIG_PATH
}

// ==================== 旧配置格式（用于迁移）====================

interface LegacyStoredConfig {
  provider: LLMProvider
  apiKey: string
  model?: string
  maxTokens?: number
}

/**
 * 检测是否为旧格式配置
 */
function isLegacyConfig(data: unknown): data is LegacyStoredConfig {
  if (!data || typeof data !== 'object') return false
  const obj = data as Record<string, unknown>
  return 'provider' in obj && 'apiKey' in obj && !('configs' in obj)
}

/**
 * 迁移旧配置到新格式
 */
function migrateLegacyConfig(legacy: LegacyStoredConfig): AIConfigStore {
  const now = Date.now()
  const newConfig: AIServiceConfig = {
    id: randomUUID(),
    name: getProviderInfo(legacy.provider)?.name || legacy.provider,
    provider: legacy.provider,
    apiKey: legacy.apiKey,
    model: legacy.model,
    maxTokens: legacy.maxTokens,
    createdAt: now,
    updatedAt: now,
  }

  return {
    configs: [newConfig],
    activeConfigId: newConfig.id,
  }
}

// ==================== 多配置管理 ====================

/**
 * 加载配置存储（自动处理迁移和解密）
 * 返回的配置中 API Key 已解密
 */
export function loadConfigStore(): AIConfigStore {
  const configPath = getConfigPath()

  if (!fs.existsSync(configPath)) {
    return { configs: [], activeConfigId: null }
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8')
    const data = JSON.parse(content)

    // 检查是否需要迁移旧格式
    if (isLegacyConfig(data)) {
      aiLogger.info('LLM', '检测到旧配置格式，执行迁移')
      const migrated = migrateLegacyConfig(data)
      saveConfigStore(migrated)
      return loadConfigStore() // 重新加载以触发加密迁移
    }

    const store = data as AIConfigStore

    // 检查是否需要加密迁移（明文 -> 加密）
    let needsEncryptionMigration = false
    const decryptedConfigs = store.configs.map((config) => {
      if (config.apiKey && !isEncrypted(config.apiKey)) {
        // 发现明文 API Key，需要加密迁移
        needsEncryptionMigration = true
        aiLogger.info('LLM', `配置 "${config.name}" 的 API Key 需要加密迁移`)
      }
      return {
        ...config,
        apiKey: config.apiKey ? decryptApiKey(config.apiKey) : '',
      }
    })

    // 如果有明文 API Key，执行加密迁移
    if (needsEncryptionMigration) {
      aiLogger.info('LLM', '执行 API Key 加密迁移')
      saveConfigStoreRaw({
        ...store,
        configs: store.configs.map((config) => ({
          ...config,
          apiKey: config.apiKey ? encryptApiKey(decryptApiKey(config.apiKey)) : '',
        })),
      })
    }

    return {
      ...store,
      configs: decryptedConfigs,
    }
  } catch (error) {
    aiLogger.error('LLM', '加载配置失败', error)
    return { configs: [], activeConfigId: null }
  }
}

/**
 * 保存配置存储（自动加密 API Key）
 * 传入的配置中 API Key 应为明文
 */
export function saveConfigStore(store: AIConfigStore): void {
  // 加密所有 API Key 后保存
  const encryptedStore: AIConfigStore = {
    ...store,
    configs: store.configs.map((config) => ({
      ...config,
      apiKey: config.apiKey ? encryptApiKey(config.apiKey) : '',
    })),
  }
  saveConfigStoreRaw(encryptedStore)
}

/**
 * 保存配置存储（原始写入，不加密）
 * 内部使用
 */
function saveConfigStoreRaw(store: AIConfigStore): void {
  const configPath = getConfigPath()
  const dir = path.dirname(configPath)

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  fs.writeFileSync(configPath, JSON.stringify(store, null, 2), 'utf-8')
}

/**
 * 获取所有配置列表
 */
export function getAllConfigs(): AIServiceConfig[] {
  return loadConfigStore().configs
}

/**
 * 获取当前激活的配置
 */
export function getActiveConfig(): AIServiceConfig | null {
  const store = loadConfigStore()
  if (!store.activeConfigId) return null
  return store.configs.find((c) => c.id === store.activeConfigId) || null
}

/**
 * 获取单个配置
 */
export function getConfigById(id: string): AIServiceConfig | null {
  const store = loadConfigStore()
  return store.configs.find((c) => c.id === id) || null
}

/**
 * 添加新配置
 */
export function addConfig(config: Omit<AIServiceConfig, 'id' | 'createdAt' | 'updatedAt'>): {
  success: boolean
  config?: AIServiceConfig
  error?: string
} {
  const store = loadConfigStore()

  if (store.configs.length >= MAX_CONFIG_COUNT) {
    return { success: false, error: t('llm.maxConfigs', { count: MAX_CONFIG_COUNT }) }
  }

  const now = Date.now()
  const newConfig: AIServiceConfig = {
    ...config,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
  }

  store.configs.push(newConfig)

  // 如果是第一个配置，自动设为激活
  if (store.configs.length === 1) {
    store.activeConfigId = newConfig.id
  }

  saveConfigStore(store)
  return { success: true, config: newConfig }
}

/**
 * 更新配置
 */
export function updateConfig(
  id: string,
  updates: Partial<Omit<AIServiceConfig, 'id' | 'createdAt' | 'updatedAt'>>
): { success: boolean; error?: string } {
  const store = loadConfigStore()
  const index = store.configs.findIndex((c) => c.id === id)

  if (index === -1) {
    return { success: false, error: t('llm.configNotFound') }
  }

  store.configs[index] = {
    ...store.configs[index],
    ...updates,
    updatedAt: Date.now(),
  }

  saveConfigStore(store)
  return { success: true }
}

/**
 * 删除配置
 */
export function deleteConfig(id: string): { success: boolean; error?: string } {
  const store = loadConfigStore()
  const index = store.configs.findIndex((c) => c.id === id)

  if (index === -1) {
    return { success: false, error: t('llm.configNotFound') }
  }

  store.configs.splice(index, 1)

  // 如果删除的是当前激活的配置，选择第一个作为新的激活配置
  if (store.activeConfigId === id) {
    store.activeConfigId = store.configs.length > 0 ? store.configs[0].id : null
  }

  saveConfigStore(store)
  return { success: true }
}

/**
 * 设置激活的配置
 */
export function setActiveConfig(id: string): { success: boolean; error?: string } {
  const store = loadConfigStore()
  const config = store.configs.find((c) => c.id === id)

  if (!config) {
    return { success: false, error: t('llm.configNotFound') }
  }

  store.activeConfigId = id
  saveConfigStore(store)
  return { success: true }
}

/**
 * 检查是否有激活的配置
 */
export function hasActiveConfig(): boolean {
  const config = getActiveConfig()
  return config !== null
}

/**
 * 扩展的 LLM 配置（包含本地服务特有选项）
 */
interface ExtendedLLMConfig extends LLMConfig {
  disableThinking?: boolean
  /** 标记为推理模型（如 DeepSeek-R1、QwQ 等） */
  isReasoningModel?: boolean
}

/**
 * 不再自动补齐 Base URL，对 DeepSeek/Qwen 的格式做显式校验
 */
function validateProviderBaseUrl(provider: LLMProvider, baseUrl?: string): void {
  if (!baseUrl) return

  const normalized = baseUrl.replace(/\/+$/, '')

  if (provider === 'deepseek') {
    if (normalized.endsWith('/chat/completions')) {
      throw new Error('DeepSeek Base URL 请填写到 /v1 层级，不要包含 /chat/completions')
    }
    if (!normalized.endsWith('/v1')) {
      throw new Error('DeepSeek Base URL 需要以 /v1 结尾')
    }
  }

  if (provider === 'qwen') {
    if (normalized.endsWith('/chat/completions')) {
      throw new Error('通义千问 Base URL 请填写到 /v1 层级，不要包含 /chat/completions')
    }
    if (!normalized.endsWith('/v1')) {
      throw new Error('通义千问 Base URL 需要以 /v1 结尾')
    }
    if (normalized.includes('dashscope.aliyuncs.com') && !normalized.includes('/compatible-mode/')) {
      throw new Error('通义千问 Base URL 需要包含 /compatible-mode/v1')
    }
  }
}

/**
 * 创建 LLM 服务实例
 */
export function createLLMService(config: ExtendedLLMConfig): ILLMService {
  // 获取提供商的默认 baseUrl
  const providerInfo = getProviderInfo(config.provider)
  const baseUrl = config.baseUrl || providerInfo?.defaultBaseUrl
  // 未显式指定时使用提供商的首个模型作为默认模型
  const resolvedModel = config.model || providerInfo?.models?.[0]?.id
  // 不自动补齐，发现不合法直接抛错给用户
  validateProviderBaseUrl(config.provider, baseUrl)

  switch (config.provider) {
    case 'gemini':
      return new GeminiService(config.apiKey, resolvedModel, config.baseUrl)
    // 新增的官方API都使用 OpenAI 兼容格式
    case 'deepseek':
    case 'qwen':
    case 'minimax':
    case 'glm':
    case 'kimi':
    case 'doubao':
      // DeepSeek/Qwen 走 OpenAI 兼容实现时，禁用本地思考注入
      return new OpenAICompatibleService(
        config.apiKey,
        resolvedModel,
        baseUrl,
        config.provider === 'deepseek' || config.provider === 'qwen' ? false : undefined,
        config.provider,
        providerInfo?.models
      )
    case 'openai-compatible':
      return new OpenAICompatibleService(
        config.apiKey,
        resolvedModel,
        config.baseUrl,
        config.disableThinking,
        config.provider,
        providerInfo?.models,
        config.isReasoningModel
      )
    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`)
  }
}

/**
 * 获取当前配置的 LLM 服务实例
 */
export function getCurrentLLMService(): ILLMService | null {
  const activeConfig = getActiveConfig()
  if (!activeConfig) {
    return null
  }

  return createLLMService({
    provider: activeConfig.provider,
    apiKey: activeConfig.apiKey,
    model: activeConfig.model,
    baseUrl: activeConfig.baseUrl,
    maxTokens: activeConfig.maxTokens,
    disableThinking: activeConfig.disableThinking,
    isReasoningModel: activeConfig.isReasoningModel,
  })
}

/**
 * 获取提供商信息
 */
export function getProviderInfo(provider: LLMProvider): ProviderInfo | null {
  return PROVIDERS.find((p) => p.id === provider) || null
}

/**
 * 验证 API Key
 */
export async function validateApiKey(
  provider: LLMProvider,
  apiKey: string
): Promise<{ success: boolean; error?: string }> {
  const service = createLLMService({ provider, apiKey })
  return service.validateApiKey()
}

/**
 * 发送聊天请求（使用当前配置）
 * 返回完整的 ChatResponse 对象，包含 finishReason 和 tool_calls
 */
export async function chat(
  messages: ChatMessage[],
  options?: ChatOptions
): Promise<{ content: string; finishReason: string; tool_calls?: import('./types').ToolCall[] }> {
  const activeConfig = getActiveConfig()

  aiLogger.info('LLM', '开始非流式聊天请求', {
    messagesCount: messages.length,
    firstMessageRole: messages[0]?.role,
    firstMessageLength: messages[0]?.content?.length,
    config: activeConfig
      ? {
          name: activeConfig.name,
          provider: activeConfig.provider,
          model: activeConfig.model,
          baseUrl: activeConfig.baseUrl,
        }
      : null,
    options,
  })

  const service = getCurrentLLMService()
  if (!service) {
    aiLogger.error('LLM', '服务未配置')
    throw new Error(t('llm.notConfigured'))
  }

  try {
    const response = await service.chat(messages, options)
    aiLogger.info('LLM', '非流式请求成功', {
      contentLength: response.content?.length,
      finishReason: response.finishReason,
      usage: response.usage,
    })
    return response
  } catch (error) {
    // 配置信息
    const configStr = activeConfig
      ? `${activeConfig.name} (${activeConfig.provider}/${activeConfig.model}) baseUrl=${activeConfig.baseUrl || '默认'}`
      : '未配置'
    // 错误信息
    const errorInfo = extractErrorInfo(error)
    const errorStr = `${errorInfo.name || 'Error'}: ${errorInfo.message}`

    aiLogger.error('LLM', `非流式请求失败 | 配置: ${configStr}`)
    aiLogger.error('LLM', `错误: ${errorStr}`)

    // 堆栈单独一行
    const stack = extractErrorStack(error)
    if (stack) {
      aiLogger.error('LLM', `堆栈:\n${stack}`)
    }
    throw error
  }
}

/**
 * 发送聊天请求（流式，使用当前配置）
 */
export async function* chatStream(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<ChatStreamChunk> {
  const activeConfig = getActiveConfig()

  aiLogger.info('LLM', '开始流式聊天请求', {
    messagesCount: messages.length,
    firstMessageRole: messages[0]?.role,
    firstMessageLength: messages[0]?.content?.length,
    config: activeConfig
      ? {
          name: activeConfig.name,
          provider: activeConfig.provider,
          model: activeConfig.model,
          baseUrl: activeConfig.baseUrl,
        }
      : null,
  })

  const service = getCurrentLLMService()
  if (!service) {
    aiLogger.error('LLM', '服务未配置（流式）')
    throw new Error(t('llm.notConfigured'))
  }

  let chunkCount = 0
  let totalContent = ''

  let receivedFinish = false
  let contentChunkCount = 0

  try {
    for await (const chunk of service.chatStream(messages, options)) {
      chunkCount++
      totalContent += chunk.content

      // 追踪内容 chunk
      if (chunk.content) {
        contentChunkCount++
      }

      yield chunk

      if (chunk.isFinished) {
        receivedFinish = true
        aiLogger.info('LLM', '流式请求完成', {
          chunkCount,
          contentChunkCount,
          totalContentLength: totalContent.length,
          finishReason: chunk.finishReason,
        })
      }
    }

    // 如果循环正常结束但没有收到 isFinished 的 chunk，记录警告
    if (chunkCount > 0 && !receivedFinish) {
      aiLogger.warn('LLM', '流式请求循环结束但未收到完成信号', {
        chunkCount,
        totalContentLength: totalContent.length,
      })
    }
  } catch (error) {
    // 配置信息
    const configStr = activeConfig
      ? `${activeConfig.name} (${activeConfig.provider}/${activeConfig.model}) baseUrl=${activeConfig.baseUrl || '默认'}`
      : '未配置'
    // 错误信息
    const errorInfo = extractErrorInfo(error)
    const errorStr = `${errorInfo.name || 'Error'}: ${errorInfo.message}`

    aiLogger.error('LLM', `流式请求失败 | 配置: ${configStr} | 已接收: ${chunkCount}块/${totalContent.length}字符`)
    aiLogger.error('LLM', `错误: ${errorStr}`)

    // 堆栈单独一行
    const stack = extractErrorStack(error)
    if (stack) {
      aiLogger.error('LLM', `堆栈:\n${stack}`)
    }
    throw error
  }
}
