/**
 * Semantic Pipeline implementation (server-side)
 *
 * RAG flow: Query rewrite → Chunk retrieval → Vector similarity ranking → Evidence block generation
 * Ported from electron/main/ai/rag/pipeline/semantic.ts
 */

import type { SemanticPipelineOptions, SemanticPipelineResult, ChunkMetadata } from './types.js'
import type { Chunk } from '../types.js'
import { getEmbeddingService } from '../embedding/index.js'
import { getVectorStore } from '../store/index.js'
import { getSessionChunks } from '../chunking/index.js'
import { loadRAGConfig } from '../config.js'
import { completeSimple, type TextContent as PiTextContent } from '@mariozechner/pi-ai'
import { getActiveConfig, buildPiModel } from '../../llm/index.js'
import { aiLogger as logger } from '../../logger.js'

/**
 * Query rewrite prompt
 */
const QUERY_REWRITE_PROMPT = `你是一个查询优化专家。请将用户的问题改写为更适合语义检索的查询。

要求：
1. 保留核心语义，去除口语化表达
2. 提取关键实体和概念
3. 扩展同义词或相关表达
4. 输出一个简洁的检索查询，不要解释

用户问题：{query}

改写后的查询：`

/**
 * Execute Query rewrite
 */
async function rewriteQuery(query: string, abortSignal?: AbortSignal): Promise<string> {
  try {
    const activeConfig = getActiveConfig()
    if (!activeConfig) return query

    const piModel = buildPiModel(activeConfig)
    const prompt = QUERY_REWRITE_PROMPT.replace('{query}', query)

    const result = await completeSimple(
      piModel,
      {
        systemPrompt: '你是一个查询优化专家，专门将用户问题改写为更适合语义检索的形式。',
        messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
      },
      {
        apiKey: activeConfig.apiKey,
        temperature: 0.3,
        maxTokens: 200,
        signal: abortSignal,
      }
    )

    const rewritten = result.content
      .filter((item): item is PiTextContent => item.type === 'text')
      .map((item) => item.text)
      .join('')
      .trim()

    return rewritten || query
  } catch (error) {
    logger.warn('[Semantic Pipeline]', 'Query rewrite failed, using original query:', error)
    return query
  }
}

/**
 * Cosine similarity
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  const len = Math.min(a.length, b.length)

  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-12)
}

/**
 * Format evidence block (for injecting into System Prompt)
 */
function formatEvidenceBlock(
  rewrittenQuery: string,
  results: Array<{ score: number; chunkId: string; content: string; metadata?: ChunkMetadata }>
): string {
  if (results.length === 0) {
    return ''
  }

  const lines = [`<evidence query="${rewrittenQuery}">`, `以下是与用户问题语义相关的历史对话片段（按相关度排序）：`, '']

  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    const score = (result.score * 100).toFixed(1)
    lines.push(`--- 片段 ${i + 1} (相关度: ${score}%) ---`)
    lines.push(result.content)
    lines.push('')
  }

  lines.push('</evidence>')
  lines.push('')
  lines.push('请基于以上历史对话片段回答用户的问题。如果片段中没有相关信息，请说明。')

  return lines.join('\n')
}

/**
 * Execute Semantic Pipeline
 */
export async function executeSemanticPipeline(options: SemanticPipelineOptions): Promise<SemanticPipelineResult> {
  const { userMessage, dbPath, timeFilter, abortSignal } = options

  const ragConfig = loadRAGConfig()
  const candidateLimit = options.candidateLimit ?? ragConfig.candidateLimit ?? 50
  const topK = options.topK ?? ragConfig.topK ?? 10

  logger.info('RAG', `🔍 Starting semantic search: "${userMessage.slice(0, 50)}..."`)

  try {
    // 1. Check Embedding service
    const embeddingService = await getEmbeddingService()
    if (!embeddingService) {
      logger.warn('RAG', 'Semantic search skipped: Embedding service not enabled')
      return {
        success: false,
        results: [],
        error: 'Embedding 服务未启用或未配置',
      }
    }

    // 2. Query rewrite
    const rewrittenQuery = await rewriteQuery(userMessage, abortSignal)

    if (abortSignal?.aborted) {
      return { success: false, results: [], error: '操作已取消' }
    }

    // 3. Get session-level chunks
    const chunks = getSessionChunks(dbPath, {
      limit: candidateLimit,
      timeFilter,
      filterInvalid: true,
    })

    if (chunks.length === 0) {
      logger.warn('RAG', 'Semantic search skipped: no session chunks available')
      return {
        success: true,
        rewrittenQuery,
        results: [],
        evidenceBlock: '',
      }
    }

    // 4. Get or compute Embeddings
    const vectorStore = await getVectorStore()
    const chunkVectors = new Map<string, number[]>()
    const uncachedChunks: Chunk[] = []

    for (const chunk of chunks) {
      if (vectorStore) {
        const cached = await vectorStore.get(chunk.id)
        if (cached) {
          chunkVectors.set(chunk.id, cached)
          continue
        }
      }
      uncachedChunks.push(chunk)
    }

    if (abortSignal?.aborted) {
      return { success: false, results: [], error: '操作已取消' }
    }

    // Batch compute uncached Embeddings
    if (uncachedChunks.length > 0) {
      const contents = uncachedChunks.map((c) => c.content)
      const vectors = await embeddingService.embedBatch(contents)

      for (let i = 0; i < uncachedChunks.length; i++) {
        const chunk = uncachedChunks[i]
        const vector = vectors[i]
        chunkVectors.set(chunk.id, vector)

        if (vectorStore) {
          await vectorStore.add(chunk.id, vector, chunk.metadata as unknown as Record<string, unknown>)
        }
      }
    }

    if (abortSignal?.aborted) {
      return { success: false, results: [], error: '操作已取消' }
    }

    // 5. Compute Query Embedding
    const queryVector = await embeddingService.embed(rewrittenQuery)

    // 6. Vector similarity ranking
    const scoredResults: Array<{
      score: number
      chunkId: string
      content: string
      metadata?: ChunkMetadata
    }> = []

    for (const chunk of chunks) {
      const vector = chunkVectors.get(chunk.id)
      if (!vector) continue

      const score = cosineSimilarity(queryVector, vector)
      scoredResults.push({
        score,
        chunkId: chunk.id,
        content: chunk.content,
        metadata: chunk.metadata,
      })
    }

    scoredResults.sort((a, b) => b.score - a.score)
    const topResults = scoredResults.slice(0, topK)

    const topScore = topResults[0]?.score ?? 0
    logger.info(
      'RAG',
      `✅ Semantic search done: returned ${topResults.length} results, top relevance ${(topScore * 100).toFixed(1)}%`
    )

    // 7. Generate evidence block
    const evidenceBlock = formatEvidenceBlock(rewrittenQuery, topResults)

    return {
      success: true,
      rewrittenQuery,
      results: topResults,
      evidenceBlock,
    }
  } catch (error) {
    logger.error('RAG', '❌ Semantic search failed', error)
    return {
      success: false,
      results: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
