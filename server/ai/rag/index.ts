/**
 * RAG module main entry point (server-side)
 *
 * Provides RAG (Retrieval-Augmented Generation) functionality:
 * - Embedding service (API-based, multi-config mode)
 * - Session-level chunking
 * - Vector store (SQLite BLOB + in-memory LRU)
 * - Semantic Pipeline
 */

// ==================== Config management ====================

export {
  // Multi-config management
  loadEmbeddingConfigStore,
  saveEmbeddingConfigStore,
  getAllEmbeddingConfigs,
  getActiveEmbeddingConfig,
  getEmbeddingConfigById,
  addEmbeddingConfig,
  updateEmbeddingConfig,
  deleteEmbeddingConfig,
  setActiveEmbeddingConfig,
  isEmbeddingEnabled,
  getActiveEmbeddingConfigId,
  _resetConfigPaths,
  // Legacy compatibility
  loadRAGConfig,
  saveRAGConfig,
  updateRAGConfig,
  resetRAGConfig,
  getVectorStoreDir,
} from './config.js'

// ==================== Type definitions ====================

export type {
  RAGConfig,
  EmbeddingConfig,
  EmbeddingServiceConfig,
  EmbeddingServiceConfigDisplay,
  EmbeddingConfigStore,
  VectorStoreConfig,
  RerankConfig,
  IEmbeddingService,
  IVectorStore,
  IRerankService,
  Chunk,
  ChunkMetadata,
  VectorSearchResult,
  VectorStoreStats,
  SemanticPipelineOptions,
  SemanticPipelineResult,
} from './types.js'

export { DEFAULT_RAG_CONFIG, DEFAULT_EMBEDDING_CONFIG_STORE, MAX_EMBEDDING_CONFIG_COUNT } from './types.js'

// ==================== Embedding service ====================

export { getEmbeddingService, resetEmbeddingService, validateEmbeddingConfig } from './embedding/index.js'

// ==================== Chunking service ====================

export { getSessionChunks, getSessionChunk, formatSessionChunk } from './chunking/index.js'
export type { ChunkingOptions, SessionMessage, SessionInfo } from './chunking/index.js'

// ==================== Vector store ====================

export { getVectorStore, resetVectorStore, getVectorStoreStats, SQLiteVectorStore, MemoryVectorStore } from './store/index.js'

// ==================== Pipeline ====================

export { executeSemanticPipeline } from './pipeline/index.js'
