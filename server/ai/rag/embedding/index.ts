/**
 * Embedding service manager (server-side)
 * Supports multi-config mode.
 * Ported from electron/main/ai/rag/embedding/index.ts
 */

import type { IEmbeddingService, EmbeddingConfig, EmbeddingServiceConfig } from './types.js'
import { OpenAICompatibleEmbeddingService } from './openai-compatible.js'
import { getActiveEmbeddingConfig, isEmbeddingEnabled } from '../config.js'
import { aiLogger as logger } from '../../logger.js'
import * as llm from '../../llm/index.js'

// Current active Embedding service instance
let activeService: IEmbeddingService | null = null
let activeConfigId: string | null = null

/**
 * Get the Embedding service
 */
export async function getEmbeddingService(): Promise<IEmbeddingService | null> {
  if (!isEmbeddingEnabled()) {
    return null
  }

  const config = getActiveEmbeddingConfig()
  if (!config) {
    return null
  }

  // Reuse existing service if config hasn't changed
  if (activeService && activeConfigId === config.id) {
    return activeService
  }

  // Config changed, recreate service
  if (activeService) {
    await activeService.dispose()
    activeService = null
  }

  try {
    activeService = await createEmbeddingService(config)
    activeConfigId = config.id
    return activeService
  } catch (error) {
    logger.error('RAG', 'Failed to create Embedding service', error)
    return null
  }
}

/**
 * Create an Embedding service instance
 */
async function createEmbeddingService(config: EmbeddingServiceConfig): Promise<IEmbeddingService> {
  const apiConfig = resolveApiConfig(config)
  logger.info('RAG', `Using Embedding: ${config.name} (${apiConfig.model})`)

  return new OpenAICompatibleEmbeddingService(apiConfig)
}

/**
 * Resolve API config
 */
function resolveApiConfig(config: EmbeddingServiceConfig): {
  baseUrl: string
  apiKey?: string
  model: string
} {
  if (config.apiSource === 'reuse_llm') {
    const llmConfig = llm.getActiveConfig()

    if (!llmConfig) {
      throw new Error('未找到激活的 LLM 配置，请先在「模型配置」中添加 AI 服务')
    }

    const baseUrl = llmConfig.baseUrl || getDefaultBaseUrl(llmConfig.provider)

    return {
      baseUrl,
      apiKey: llmConfig.apiKey || undefined,
      model: config.model,
    }
  } else {
    if (!config.baseUrl) {
      throw new Error('自定义 API 模式需要配置端点地址')
    }

    return {
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
    }
  }
}

/**
 * Get default baseUrl for a provider
 */
function getDefaultBaseUrl(provider: string): string {
  const defaultUrls: Record<string, string> = {
    deepseek: 'https://api.deepseek.com/v1',
    qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    openai: 'https://api.openai.com/v1',
    'openai-compatible': 'http://localhost:11434/v1',
  }

  return defaultUrls[provider] || 'http://localhost:11434/v1'
}

/**
 * Reset the Embedding service
 * Call after config changes.
 */
export async function resetEmbeddingService(): Promise<void> {
  if (activeService) {
    await activeService.dispose()
    activeService = null
    activeConfigId = null
    logger.info('RAG', 'Embedding service reset')
  }
}

/**
 * Validate an Embedding service config
 */
export async function validateEmbeddingConfig(
  config: EmbeddingConfig | EmbeddingServiceConfig
): Promise<{ success: boolean; error?: string }> {
  try {
    const serviceConfig: EmbeddingServiceConfig =
      'id' in config
        ? config
        : {
            id: 'temp',
            name: 'temp',
            apiSource: config.apiSource || 'reuse_llm',
            model: config.model || 'nomic-embed-text',
            baseUrl: config.baseUrl,
            apiKey: config.apiKey,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }

    const service = await createEmbeddingService(serviceConfig)
    const result = await service.validate()
    await service.dispose()
    return result
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

// Re-export types
export type { IEmbeddingService, EmbeddingConfig, EmbeddingServiceConfig }
