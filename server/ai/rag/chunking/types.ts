/**
 * Chunking type definitions (server-side)
 * Re-exports from parent types for convenience.
 */

export type { Chunk, ChunkMetadata } from '../types.js'

/**
 * Invalid message types to filter out
 * These messages have no semantic value and degrade embedding quality
 */
export const INVALID_MESSAGE_TYPES = [
  0, // system message
  3, // image
  4, // voice
  5, // video
  6, // file
  7, // location
  8, // contact card
  10, // recalled message
  11, // red packet
  12, // transfer
] as const

/**
 * Placeholder text patterns to filter
 */
export const INVALID_TEXT_PATTERNS = [
  '[图片]',
  '[语音]',
  '[视频]',
  '[文件]',
  '[表情]',
  '[动画表情]',
  '[位置]',
  '[名片]',
  '[红包]',
  '[转账]',
  '[撤回消息]',
  '撤回了一条消息',
  '你撤回了一条消息',
]

/**
 * Session message (from database query)
 */
export interface SessionMessage {
  id: number
  senderName: string
  content: string | null
  timestamp: number
  type?: number
}

/**
 * Session basic info
 */
export interface SessionInfo {
  id: number
  startTs: number
  endTs: number
  messageCount: number
}

/**
 * Chunking options
 */
export interface ChunkingOptions {
  /** Max number of chunks */
  limit?: number

  /** Time filter */
  timeFilter?: {
    startTs: number
    endTs: number
  }

  /** Whether to filter invalid messages */
  filterInvalid?: boolean

  /** Max chars per chunk (splits into sub-chunks if exceeded) */
  maxChunkChars?: number
}
