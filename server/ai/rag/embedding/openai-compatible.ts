/**
 * OpenAI-compatible Embedding service (server-side)
 *
 * Supports OpenAI, Ollama, and other compatible APIs.
 * Ported from electron/main/ai/rag/embedding/openai-compatible.ts
 */

import type { IEmbeddingService } from './types.js'
import { aiLogger as logger } from '../../logger.js'

/**
 * OpenAI compatible API config
 */
export interface OpenAICompatibleEmbeddingConfig {
  baseUrl: string
  apiKey?: string
  model: string
}

/**
 * OpenAI-compatible Embedding service implementation
 */
export class OpenAICompatibleEmbeddingService implements IEmbeddingService {
  private baseUrl: string
  private apiKey?: string
  private model: string
  private dimensions: number = 0

  constructor(config: OpenAICompatibleEmbeddingConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
    this.apiKey = config.apiKey
    this.model = config.model
  }

  /**
   * Embed a single text
   */
  async embed(text: string): Promise<number[]> {
    const vectors = await this.callEmbeddingApi([text])
    return vectors[0]
  }

  /**
   * Batch embed texts
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    return this.callEmbeddingApi(texts)
  }

  /**
   * Call the Embedding API
   */
  private async callEmbeddingApi(input: string[]): Promise<number[][]> {
    const url = `${this.baseUrl}/embeddings`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.model,
          input,
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`API request failed (${response.status}): ${errorText}`)
      }

      const data = (await response.json()) as {
        data?: Array<{ embedding: number[]; index: number }>
      }

      if (!data.data || data.data.length === 0) {
        throw new Error('API returned empty data')
      }

      const sorted = data.data.sort((a, b) => a.index - b.index)
      const vectors = sorted.map((item) => item.embedding)

      if (vectors.length > 0 && this.dimensions === 0) {
        this.dimensions = vectors[0].length
      }

      return vectors
    } catch (error) {
      logger.error('RAG', `Embedding API call failed: ${url}`, error)
      throw error
    }
  }

  /**
   * Get provider name
   */
  getProvider(): string {
    return `OpenAI Compatible (${this.model})`
  }

  /**
   * Get vector dimensions
   */
  getDimensions(): number {
    return this.dimensions
  }

  /**
   * Validate service availability
   */
  async validate(): Promise<{ success: boolean; error?: string }> {
    try {
      const testVector = await this.embed('test')

      if (testVector.length === 0) {
        return { success: false, error: '返回的向量为空' }
      }

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Release resources
   */
  async dispose(): Promise<void> {
    // API service has no resources to release
  }
}
