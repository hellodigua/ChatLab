/**
 * In-memory vector store (server-side)
 *
 * LRU cache — data lost on restart.
 * Ported from electron/main/ai/rag/store/memory.ts
 */

import type { IVectorStore, VectorSearchResult, VectorStoreStats } from './types.js'
import { aiLogger as logger } from '../../logger.js'

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
 * LRU cache node
 */
interface CacheNode {
  id: string
  vector: number[]
  metadata?: Record<string, unknown>
  prev: CacheNode | null
  next: CacheNode | null
}

/**
 * In-memory vector store (LRU cache)
 */
export class MemoryVectorStore implements IVectorStore {
  private capacity: number
  private cache: Map<string, CacheNode> = new Map()
  private head: CacheNode | null = null
  private tail: CacheNode | null = null

  constructor(capacity: number = 10000) {
    this.capacity = capacity
  }

  private moveToHead(node: CacheNode): void {
    if (node === this.head) return

    if (node.prev) {
      node.prev.next = node.next
    }
    if (node.next) {
      node.next.prev = node.prev
    }
    if (node === this.tail) {
      this.tail = node.prev
    }

    node.prev = null
    node.next = this.head
    if (this.head) {
      this.head.prev = node
    }
    this.head = node

    if (!this.tail) {
      this.tail = node
    }
  }

  private addToHead(node: CacheNode): void {
    node.prev = null
    node.next = this.head
    if (this.head) {
      this.head.prev = node
    }
    this.head = node

    if (!this.tail) {
      this.tail = node
    }
  }

  private removeTail(): CacheNode | null {
    if (!this.tail) return null

    const removed = this.tail
    this.tail = removed.prev
    if (this.tail) {
      this.tail.next = null
    } else {
      this.head = null
    }

    return removed
  }

  async add(id: string, vector: number[], metadata?: Record<string, unknown>): Promise<void> {
    if (this.cache.has(id)) {
      const node = this.cache.get(id)!
      node.vector = vector
      node.metadata = metadata
      this.moveToHead(node)
    } else {
      const node: CacheNode = {
        id,
        vector,
        metadata,
        prev: null,
        next: null,
      }

      this.cache.set(id, node)
      this.addToHead(node)

      if (this.cache.size > this.capacity) {
        const removed = this.removeTail()
        if (removed) {
          this.cache.delete(removed.id)
        }
      }
    }
  }

  async addBatch(items: Array<{ id: string; vector: number[]; metadata?: Record<string, unknown> }>): Promise<void> {
    for (const item of items) {
      await this.add(item.id, item.vector, item.metadata)
    }
  }

  async get(id: string): Promise<number[] | null> {
    const node = this.cache.get(id)
    if (!node) return null

    this.moveToHead(node)
    return node.vector
  }

  async has(id: string): Promise<boolean> {
    return this.cache.has(id)
  }

  async delete(id: string): Promise<void> {
    const node = this.cache.get(id)
    if (!node) return

    if (node.prev) {
      node.prev.next = node.next
    }
    if (node.next) {
      node.next.prev = node.prev
    }
    if (node === this.head) {
      this.head = node.next
    }
    if (node === this.tail) {
      this.tail = node.prev
    }

    this.cache.delete(id)
  }

  async search(query: number[], topK: number): Promise<VectorSearchResult[]> {
    const results: VectorSearchResult[] = []

    for (const node of this.cache.values()) {
      const score = cosineSimilarity(query, node.vector)
      results.push({
        id: node.id,
        score,
        metadata: node.metadata,
      })
    }

    results.sort((a, b) => b.score - a.score)
    return results.slice(0, topK)
  }

  async clear(): Promise<void> {
    this.cache.clear()
    this.head = null
    this.tail = null
    logger.info('[Memory Store]', 'All vectors cleared')
  }

  async getStats(): Promise<VectorStoreStats> {
    let dimensions: number | undefined
    for (const node of this.cache.values()) {
      dimensions = node.vector.length
      break
    }

    let sizeBytes: number | undefined
    if (dimensions) {
      sizeBytes = this.cache.size * dimensions * 8
    }

    return {
      count: this.cache.size,
      dimensions,
      sizeBytes,
    }
  }

  async close(): Promise<void> {
    logger.info('[Memory Store]', 'Closed')
  }
}
