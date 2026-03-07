/**
 * Agent module type definitions (server-side)
 * Ported from electron/main/ai/agent/types.ts — no Electron imports.
 */

import type { TokenUsage, AgentRuntimeStatus } from '../shared-types.js'

export type { TokenUsage, AgentRuntimeStatus } from '../shared-types.js'

/**
 * Agent configuration
 */
export interface AgentConfig {
  /** Maximum tool call rounds (prevents infinite loops) */
  maxToolRounds?: number
  /** Maximum history messages injected into the model */
  contextHistoryLimit?: number
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal
}

/**
 * Agent streaming response chunk
 */
export interface AgentStreamChunk {
  /** Chunk type */
  type: 'content' | 'think' | 'tool_start' | 'tool_result' | 'status' | 'done' | 'error'
  /** Text content (when type=content) */
  content?: string
  /** Thinking tag name (when type=think) */
  thinkTag?: string
  /** Thinking duration in ms (when type=think, optional) */
  thinkDurationMs?: number
  /** Tool name (when type=tool_start/tool_result) */
  toolName?: string
  /** Tool call parameters (when type=tool_start) */
  toolParams?: Record<string, unknown>
  /** Tool execution result (when type=tool_result) */
  toolResult?: unknown
  /** Error message (when type=error) */
  error?: string
  /** Whether finished */
  isFinished?: boolean
  /** Token usage (when type=done, cumulative) */
  usage?: TokenUsage
  /** Runtime status (when type=status) */
  status?: AgentRuntimeStatus
}

/**
 * Agent execution result
 */
export interface AgentResult {
  /** Final text response */
  content: string
  /** List of tools used */
  toolsUsed: string[]
  /** Tool call rounds */
  toolRounds: number
  /** Total token usage (cumulative across all LLM calls) */
  totalUsage?: TokenUsage
}

/**
 * User-customizable prompt configuration
 */
export interface PromptConfig {
  /** Role definition (editable section) */
  roleDefinition: string
  /** Response rules (editable section) */
  responseRules: string
}
