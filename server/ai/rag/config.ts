/**
 * RAG config management (server-side)
 * Supports multi-config Embedding mode (similar to LLM config).
 * Ported from electron/main/ai/rag/config.ts — uses server paths.
 */

import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import {
  DEFAULT_RAG_CONFIG,
  DEFAULT_EMBEDDING_CONFIG_STORE,
  MAX_EMBEDDING_CONFIG_COUNT,
  type RAGConfig,
  type EmbeddingServiceConfig,
  type EmbeddingConfigStore,
} from './types.js'
import { aiLogger as logger } from '../logger.js'
import { getAiDataDir } from '../../paths.js'

// ==================== Path management ====================

let CONFIG_PATH: string | null = null
let EMBEDDING_CONFIG_PATH: string | null = null

/**
 * Get RAG config file path
 */
function getConfigPath(): string {
  if (CONFIG_PATH) return CONFIG_PATH
  CONFIG_PATH = path.join(getAiDataDir(), 'rag-config.json')
  return CONFIG_PATH
}

/**
 * Get Embedding config file path
 */
function getEmbeddingConfigPath(): string {
  if (EMBEDDING_CONFIG_PATH) return EMBEDDING_CONFIG_PATH
  EMBEDDING_CONFIG_PATH = path.join(getAiDataDir(), 'embedding-config.json')
  return EMBEDDING_CONFIG_PATH
}

/**
 * Reset config path caches (for testing)
 */
export function _resetConfigPaths(): void {
  CONFIG_PATH = null
  EMBEDDING_CONFIG_PATH = null
}

/**
 * Get vector store directory
 */
export function getVectorStoreDir(): string {
  const dir = path.join(getAiDataDir(), 'vectors')

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  return dir
}

// ==================== Embedding multi-config management ====================

/**
 * Load Embedding config store
 */
export function loadEmbeddingConfigStore(): EmbeddingConfigStore {
  const configPath = getEmbeddingConfigPath()

  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_EMBEDDING_CONFIG_STORE, configs: [] }
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8')
    const data = JSON.parse(content) as EmbeddingConfigStore

    return {
      configs: data.configs || [],
      activeConfigId: data.activeConfigId || null,
      enabled: data.enabled ?? false,
    }
  } catch (error) {
    logger.error('RAG', 'Failed to load Embedding configs', error)
    return { ...DEFAULT_EMBEDDING_CONFIG_STORE, configs: [] }
  }
}

/**
 * Save Embedding config store
 */
export function saveEmbeddingConfigStore(store: EmbeddingConfigStore): void {
  const configPath = getEmbeddingConfigPath()
  const dir = path.dirname(configPath)

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  fs.writeFileSync(configPath, JSON.stringify(store, null, 2), 'utf-8')
  logger.info('RAG', 'Embedding configs saved')
}

/**
 * Get all Embedding configs
 */
export function getAllEmbeddingConfigs(): EmbeddingServiceConfig[] {
  return loadEmbeddingConfigStore().configs
}

/**
 * Get the currently active Embedding config
 */
export function getActiveEmbeddingConfig(): EmbeddingServiceConfig | null {
  const store = loadEmbeddingConfigStore()
  if (!store.activeConfigId || !store.enabled) return null
  return store.configs.find((c) => c.id === store.activeConfigId) || null
}

/**
 * Get a single Embedding config by ID
 */
export function getEmbeddingConfigById(id: string): EmbeddingServiceConfig | null {
  const store = loadEmbeddingConfigStore()
  return store.configs.find((c) => c.id === id) || null
}

/**
 * Add a new Embedding config
 */
export function addEmbeddingConfig(config: Omit<EmbeddingServiceConfig, 'id' | 'createdAt' | 'updatedAt'>): {
  success: boolean
  config?: EmbeddingServiceConfig
  error?: string
} {
  const store = loadEmbeddingConfigStore()

  if (store.configs.length >= MAX_EMBEDDING_CONFIG_COUNT) {
    return { success: false, error: `最多只能添加 ${MAX_EMBEDDING_CONFIG_COUNT} 个配置` }
  }

  const now = Date.now()
  const newConfig: EmbeddingServiceConfig = {
    ...config,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
  }

  store.configs.push(newConfig)

  // Auto-activate if this is the first config
  if (store.configs.length === 1) {
    store.activeConfigId = newConfig.id
  }

  saveEmbeddingConfigStore(store)
  logger.info('RAG', `Adding Embedding config: ${newConfig.name}`)
  return { success: true, config: newConfig }
}

/**
 * Update an Embedding config
 */
export function updateEmbeddingConfig(
  id: string,
  updates: Partial<Omit<EmbeddingServiceConfig, 'id' | 'createdAt' | 'updatedAt'>>
): { success: boolean; error?: string } {
  const store = loadEmbeddingConfigStore()
  const index = store.configs.findIndex((c) => c.id === id)

  if (index === -1) {
    return { success: false, error: '配置不存在' }
  }

  store.configs[index] = {
    ...store.configs[index],
    ...updates,
    updatedAt: Date.now(),
  }

  saveEmbeddingConfigStore(store)
  logger.info('RAG', `Updating Embedding config: ${store.configs[index].name}`)
  return { success: true }
}

/**
 * Delete an Embedding config
 */
export function deleteEmbeddingConfig(id: string): { success: boolean; error?: string } {
  const store = loadEmbeddingConfigStore()
  const index = store.configs.findIndex((c) => c.id === id)

  if (index === -1) {
    return { success: false, error: '配置不存在' }
  }

  const deletedName = store.configs[index].name
  store.configs.splice(index, 1)

  // If deleted config was active, promote the first remaining config
  if (store.activeConfigId === id) {
    store.activeConfigId = store.configs.length > 0 ? store.configs[0].id : null
  }

  saveEmbeddingConfigStore(store)
  logger.info('RAG', `Deleting Embedding config: ${deletedName}`)
  return { success: true }
}

/**
 * Set the active Embedding config
 */
export function setActiveEmbeddingConfig(id: string): { success: boolean; error?: string } {
  const store = loadEmbeddingConfigStore()
  const config = store.configs.find((c) => c.id === id)

  if (!config) {
    return { success: false, error: '配置不存在' }
  }

  store.activeConfigId = id
  saveEmbeddingConfigStore(store)
  logger.info('RAG', `Activating Embedding config: ${config.name}`)
  return { success: true }
}

/**
 * Check if semantic search / embedding is enabled
 */
export function isEmbeddingEnabled(): boolean {
  const store = loadEmbeddingConfigStore()
  return store.activeConfigId !== null && store.configs.some((c) => c.id === store.activeConfigId)
}

/**
 * Get active config ID
 */
export function getActiveEmbeddingConfigId(): string | null {
  return loadEmbeddingConfigStore().activeConfigId
}

// ==================== Legacy RAG config (compatibility) ====================

/**
 * Load RAG config
 */
export function loadRAGConfig(): RAGConfig {
  try {
    const configPath = getConfigPath()

    if (!fs.existsSync(configPath)) {
      return { ...DEFAULT_RAG_CONFIG }
    }

    const content = fs.readFileSync(configPath, 'utf-8')
    const config = JSON.parse(content) as RAGConfig

    return mergeConfig(DEFAULT_RAG_CONFIG, config)
  } catch (error) {
    logger.error('RAG', 'Failed to load configs', error)
    return { ...DEFAULT_RAG_CONFIG }
  }
}

/**
 * Save RAG config
 */
export function saveRAGConfig(config: RAGConfig): void {
  try {
    const configPath = getConfigPath()
    const dir = path.dirname(configPath)

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
    logger.info('RAG', 'Configs saved')
  } catch (error) {
    logger.error('RAG', 'Failed to save configs', error)
    throw error
  }
}

/**
 * Update RAG config (partial update)
 */
export function updateRAGConfig(updates: Partial<RAGConfig>): RAGConfig {
  const current = loadRAGConfig()
  const updated = mergeConfig(current, updates)
  saveRAGConfig(updated)
  return updated
}

/**
 * Deep merge config
 */
function mergeConfig<T extends object>(base: T, override: Partial<T>): T {
  const result = { ...base }

  for (const key in override) {
    if (Object.prototype.hasOwnProperty.call(override, key)) {
      const overrideValue = override[key]
      const baseValue = base[key]

      if (overrideValue !== undefined) {
        if (
          typeof overrideValue === 'object' &&
          overrideValue !== null &&
          !Array.isArray(overrideValue) &&
          typeof baseValue === 'object' &&
          baseValue !== null &&
          !Array.isArray(baseValue)
        ) {
          ;(result as Record<string, unknown>)[key] = mergeConfig(baseValue as object, overrideValue as object)
        } else {
          ;(result as Record<string, unknown>)[key] = overrideValue
        }
      }
    }
  }

  return result
}

/**
 * Reset RAG config to defaults
 */
export function resetRAGConfig(): RAGConfig {
  const config = { ...DEFAULT_RAG_CONFIG }
  saveRAGConfig(config)
  return config
}
