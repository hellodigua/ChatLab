/**
 * RAG module type definitions (server-side)
 * Ported from electron/main/ai/rag/types.ts — no Electron dependencies.
 */

// ==================== Embedding Service Config (multi-config mode) ====================

/**
 * Single Embedding service config
 */
export interface EmbeddingServiceConfig {
  /** Config ID */
  id: string

  /** User-defined name */
  name: string

  /**
   * API config source
   * - 'reuse_llm': reuse current LLM config's baseUrl/apiKey
   * - 'custom': independent config
   */
  apiSource: 'reuse_llm' | 'custom'

  /** Embedding model name (e.g. 'nomic-embed-text') */
  model: string

  // Used when apiSource === 'custom'
  baseUrl?: string
  apiKey?: string

  /** Creation timestamp */
  createdAt: number

  /** Update timestamp */
  updatedAt: number
}

/**
 * Display-safe version of EmbeddingServiceConfig (API key masked)
 */
export interface EmbeddingServiceConfigDisplay {
  id: string
  name: string
  apiSource: 'reuse_llm' | 'custom'
  model: string
  baseUrl?: string
  apiKey: string  // masked
  createdAt: number
  updatedAt: number
}

/**
 * Embedding config store
 */
export interface EmbeddingConfigStore {
  /** All configs */
  configs: EmbeddingServiceConfig[]

  /** Currently active config ID */
  activeConfigId: string | null

  /** Whether semantic search is enabled */
  enabled: boolean
}

/**
 * Maximum number of configs
 */
export const MAX_EMBEDDING_CONFIG_COUNT = 10

/**
 * Default Embedding config store
 */
export const DEFAULT_EMBEDDING_CONFIG_STORE: EmbeddingConfigStore = {
  configs: [],
  activeConfigId: null,
  enabled: false,
}

// ==================== Legacy EmbeddingConfig (compatibility) ====================

/**
 * Embedding config (legacy, for compatibility)
 * @deprecated Use EmbeddingServiceConfig instead
 */
export interface EmbeddingConfig {
  /** Whether Embedding is enabled */
  enabled: boolean

  /** Provider type (currently always 'api') */
  provider: 'api'

  /**
   * API config source
   * - 'reuse_llm': reuse current LLM config
   * - 'custom': independent config
   */
  apiSource?: 'reuse_llm' | 'custom'

  /** Embedding model name */
  model?: string

  // Used when apiSource === 'custom'
  baseUrl?: string
  apiKey?: string
}

// ==================== Vector Store Types ====================

/**
 * Vector store config
 */
export interface VectorStoreConfig {
  /** Whether vector cache is enabled */
  enabled: boolean

  /**
   * Storage type
   * - 'memory': in-memory cache only (lost on restart)
   * - 'sqlite': SQLite persistent (recommended)
   * - 'lancedb': LanceDB (reserved)
   */
  type: 'memory' | 'sqlite' | 'lancedb'

  // Options for type === 'memory'
  /** LRU cache size (number of entries) */
  memoryCacheSize?: number

  // Options for type === 'sqlite'
  /** Database path */
  dbPath?: string
}

// ==================== Rerank Types (reserved) ====================

/**
 * Rerank config (reserved)
 */
export interface RerankConfig {
  /** Whether reranking is enabled */
  enabled: boolean

  /** Provider */
  provider: 'jina' | 'cohere' | 'bge' | 'custom'

  /** Model name */
  model?: string

  /** API endpoint */
  baseUrl?: string

  /** API Key */
  apiKey?: string

  /** Number of results after reranking */
  topK?: number
}

// ==================== RAG Config ====================

/**
 * Complete RAG config
 */
export interface RAGConfig {
  /** Embedding config */
  embedding?: EmbeddingConfig

  /** Vector store config */
  vectorStore?: VectorStoreConfig

  /** Rerank config (reserved) */
  rerank?: RerankConfig

  // Pipeline config

  /** Whether Semantic Pipeline is enabled */
  enableSemanticPipeline?: boolean

  /** Max candidate chunk count */
  candidateLimit?: number

  /** Number of results to return */
  topK?: number
}

/**
 * Default RAG config
 */
export const DEFAULT_RAG_CONFIG: RAGConfig = {
  embedding: {
    enabled: false,
    provider: 'api',
    apiSource: 'reuse_llm',
  },
  vectorStore: {
    enabled: true,
    type: 'sqlite',
  },
  enableSemanticPipeline: true,
  candidateLimit: 50,
  topK: 10,
}

// ==================== Embedding Service Interface ====================

/**
 * Embedding service interface
 */
export interface IEmbeddingService {
  /** Get provider name */
  getProvider(): string

  /** Get vector dimensions */
  getDimensions(): number

  /** Embed a single text */
  embed(text: string): Promise<number[]>

  /** Batch embed texts */
  embedBatch(texts: string[]): Promise<number[][]>

  /** Validate service availability */
  validate(): Promise<{ success: boolean; error?: string }>

  /** Release resources */
  dispose(): Promise<void>
}

/**
 * Embedding result
 */
export interface EmbeddingResult {
  /** Original text */
  text: string
  /** Vector */
  vector: number[]
  /** Vector dimensions */
  dimensions: number
}

// ==================== Vector Store Service Interface ====================

/**
 * Vector store interface
 */
export interface IVectorStore {
  /** Add vector */
  add(id: string, vector: number[], metadata?: Record<string, unknown>): Promise<void>

  /** Batch add vectors */
  addBatch(items: Array<{ id: string; vector: number[]; metadata?: Record<string, unknown> }>): Promise<void>

  /** Get vector */
  get(id: string): Promise<number[] | null>

  /** Check if exists */
  has(id: string): Promise<boolean>

  /** Delete vector */
  delete(id: string): Promise<void>

  /** Similarity search */
  search(query: number[], topK: number): Promise<VectorSearchResult[]>

  /** Clear all */
  clear(): Promise<void>

  /** Get store stats */
  getStats(): Promise<VectorStoreStats>

  /** Close store */
  close(): Promise<void>
}

/**
 * Vector search result
 */
export interface VectorSearchResult {
  id: string
  score: number
  metadata?: Record<string, unknown>
}

/**
 * Store statistics
 */
export interface VectorStoreStats {
  count: number
  dimensions?: number
  sizeBytes?: number
}

// ==================== Chunk Types ====================

/**
 * Chunk result
 */
export interface Chunk {
  /** Chunk ID (e.g. session_123) */
  id: string

  /** Chunk type */
  type: 'session' | 'window' | 'time'

  /** Text content for embedding */
  content: string

  /** Metadata */
  metadata: ChunkMetadata
}

/**
 * Chunk metadata
 */
export interface ChunkMetadata {
  sessionId?: number
  startTs: number
  endTs: number
  messageCount: number
  participants: string[]

  /** Sub-chunk index (0-based, only when session is split) */
  subChunkIndex?: number

  /** Total sub-chunk count (only when session is split) */
  totalSubChunks?: number
}

// ==================== Rerank Service Interface (reserved) ====================

/**
 * Rerank service interface (reserved)
 */
export interface IRerankService {
  /** Rerank documents */
  rerank(query: string, documents: string[], topK?: number): Promise<RerankResult[]>

  /** Validate service availability */
  validate(): Promise<{ success: boolean; error?: string }>
}

/**
 * Rerank result
 */
export interface RerankResult {
  index: number
  score: number
  text: string
}

// ==================== Pipeline Types ====================

/**
 * Semantic Pipeline options
 */
export interface SemanticPipelineOptions {
  /** User's original question */
  userMessage: string

  /** Database path */
  dbPath: string

  /** Time filter */
  timeFilter?: { startTs: number; endTs: number }

  /** Candidate chunk count */
  candidateLimit?: number

  /** Number of results to return */
  topK?: number

  /** Whether to use reranking */
  useRerank?: boolean

  /** Abort signal */
  abortSignal?: AbortSignal
}

/**
 * Semantic Pipeline result
 */
export interface SemanticPipelineResult {
  /** Whether execution was successful */
  success: boolean

  /** Rewritten query */
  rewrittenQuery?: string

  /** Search results */
  results: Array<{
    score: number
    chunkId: string
    content: string
    metadata?: ChunkMetadata
  }>

  /** Formatted evidence block (for injecting into System Prompt) */
  evidenceBlock?: string

  /** Error message */
  error?: string
}
