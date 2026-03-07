/**
 * Vector store manager (server-side)
 * Ported from electron/main/ai/rag/store/index.ts
 */

import * as path from 'path'
import type { IVectorStore, VectorStoreConfig } from './types.js'
import { SQLiteVectorStore } from './sqlite.js'
import { MemoryVectorStore } from './memory.js'
import { getVectorStoreDir, loadRAGConfig } from '../config.js'
import { aiLogger as logger } from '../../logger.js'

// Current active vector store instance
let activeStore: IVectorStore | null = null

/**
 * Get the vector store
 * Automatically selects storage type based on config.
 */
export async function getVectorStore(): Promise<IVectorStore | null> {
  const config = loadRAGConfig()

  if (!config.vectorStore?.enabled) {
    return null
  }

  if (activeStore) {
    return activeStore
  }

  try {
    activeStore = await createVectorStore(config.vectorStore)
    return activeStore
  } catch (error) {
    logger.error('[Store Manager]', 'Failed to create store:', error)
    return null
  }
}

/**
 * Create a vector store instance
 */
async function createVectorStore(config: VectorStoreConfig): Promise<IVectorStore> {
  switch (config.type) {
    case 'memory': {
      const capacity = config.memoryCacheSize || 10000
      logger.info('[Store Manager]', `Using memory store, capacity: ${capacity}`)
      return new MemoryVectorStore(capacity)
    }

    case 'sqlite': {
      const dbPath = config.dbPath || path.join(getVectorStoreDir(), 'embeddings.db')
      logger.info('[Store Manager]', `Using SQLite store: ${dbPath}`)
      return new SQLiteVectorStore(dbPath)
    }

    case 'lancedb': {
      throw new Error('LanceDB storage not yet implemented')
    }

    default:
      throw new Error(`Unknown storage type: ${config.type}`)
  }
}

/**
 * Reset the vector store
 * Call after config changes.
 */
export async function resetVectorStore(): Promise<void> {
  if (activeStore) {
    await activeStore.close()
    activeStore = null
    logger.info('[Store Manager]', 'Store reset')
  }
}

/**
 * Get store statistics
 */
export async function getVectorStoreStats(): Promise<{
  enabled: boolean
  type?: string
  count?: number
  dimensions?: number
  sizeBytes?: number
}> {
  const config = loadRAGConfig()

  if (!config.vectorStore?.enabled) {
    return { enabled: false }
  }

  const store = await getVectorStore()
  if (!store) {
    return { enabled: true, type: config.vectorStore.type }
  }

  const stats = await store.getStats()
  return {
    enabled: true,
    type: config.vectorStore.type,
    ...stats,
  }
}

// Re-exports
export { SQLiteVectorStore } from './sqlite.js'
export { MemoryVectorStore } from './memory.js'
export type { IVectorStore, VectorSearchResult, VectorStoreStats, VectorStoreConfig } from './types.js'
