/**
 * Shared AI type definitions (server-side)
 * Single source of truth for TokenUsage, AgentRuntimeStatus, etc.
 * Ported from electron/shared/types.ts — no Electron dependencies.
 */

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface AgentRuntimeStatus {
  phase: 'preparing' | 'thinking' | 'tool_running' | 'responding' | 'completed' | 'aborted' | 'error'
  round: number
  toolsUsed: number
  currentTool?: string
  contextTokens: number
  totalUsage: TokenUsage
  updatedAt: number
}
