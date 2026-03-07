/**
 * AI Tools type definitions (server-side)
 * Ported from electron/main/ai/tools/types.ts — no Electron imports.
 */

import type { PreprocessConfig } from '../preprocessor/index.js'

/** Owner info (current user's identity in the chat) */
export interface OwnerInfo {
  /** Owner's platformId */
  platformId: string
  /** Owner's display name */
  displayName: string
}

/**
 * Tool execution context
 * Contains all context information needed for tool execution
 */
export interface ToolContext {
  /** Current session ID (database file name) */
  sessionId: string
  /** Current AI conversation ID (for context management isolation) */
  conversationId?: string
  /** Time filter */
  timeFilter?: {
    startTs: number
    endTs: number
  }
  /** User-configured message count limit (used by tools that fetch messages) */
  maxMessagesLimit?: number
  /** Owner info (current user's identity in the chat) */
  ownerInfo?: OwnerInfo
  /** Locale (for i18n of tool results) */
  locale?: string
  /** Chat record preprocessing config (global) */
  preprocessConfig?: PreprocessConfig
}
