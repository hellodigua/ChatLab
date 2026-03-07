/**
 * AI Tools module entry (server-side)
 * Tool creation, preprocessing pipeline & management.
 * Ported from electron/main/ai/tools/index.ts — no Electron/i18n/RAG imports.
 *
 * Architecture: tools return structured data (rawMessages) → processing layer
 * executes preprocessing + formatting → generates LLM content
 */

import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ToolContext } from './types.js'
import {
  createSearchMessages,
  createGetRecentMessages,
  createGetMemberStats,
  createGetTimeStats,
  createGetGroupMembers,
  createGetMemberNameHistory,
  createGetConversationBetween,
  createGetMessageContext,
  createSearchSessions,
  createGetSessionMessages,
  createGetSessionSummaries,
  // semantic search is a stub until RAG is ported
  // createSemanticSearchMessages,
} from './definitions/index.js'
import { preprocessMessages, type PreprocessableMessage } from '../preprocessor/index.js'
import { formatMessageCompact } from './utils/format.js'

// Export types
export * from './types.js'

type ToolFactory = (context: ToolContext) => AgentTool<any>

const coreFactories: ToolFactory[] = [
  createSearchMessages,
  createGetRecentMessages,
  createGetMemberStats,
  createGetTimeStats,
  createGetGroupMembers,
  createGetMemberNameHistory,
  createGetConversationBetween,
  createGetMessageContext,
  createSearchSessions,
  createGetSessionMessages,
  createGetSessionSummaries,
]

/**
 * Format structured tool result data as LLM-friendly plain text.
 */
function formatToolResultAsText(details: Record<string, unknown>): string {
  const lines: string[] = []
  const messages = details.messages as string[] | undefined

  for (const [key, value] of Object.entries(details)) {
    if (key === 'messages') continue
    if (value === undefined || value === null) continue

    if (typeof value === 'object') {
      if ('start' in (value as Record<string, unknown>) && 'end' in (value as Record<string, unknown>)) {
        const range = value as { start: string; end: string }
        lines.push(`${key}: ${range.start} ~ ${range.end}`)
      } else if (Array.isArray(value)) {
        lines.push(`${key}: ${value.join(', ')}`)
      } else {
        lines.push(`${key}: ${JSON.stringify(value)}`)
      }
    } else {
      lines.push(`${key}: ${value}`)
    }
  }

  if (messages && messages.length > 0) {
    lines.push('')
    let lastDate = ''
    for (const msg of messages) {
      const spaceIdx = msg.indexOf(' ')
      const secondSpaceIdx = msg.indexOf(' ', spaceIdx + 1)
      if (spaceIdx > 0 && secondSpaceIdx > 0) {
        const date = msg.slice(0, spaceIdx)
        const rest = msg.slice(spaceIdx + 1)
        if (date !== lastDate) {
          lines.push(`--- ${date} ---`)
          lastDate = date
        }
        lines.push(rest)
      } else {
        lines.push(msg)
      }
    }
  }

  return lines.join('\n')
}

/**
 * Preprocessing wrapper.
 * Intercepts tool execute results: if details contains rawMessages,
 * runs the preprocessing pipeline + formatting, replacing with final LLM content.
 */
function wrapWithPreprocessing(tool: AgentTool<any>, context: ToolContext): AgentTool<any> {
  const originalExecute = tool.execute
  return {
    ...tool,
    execute: async (toolCallId: string, params: any) => {
      const result = await originalExecute(toolCallId, params)

      const details = result.details as Record<string, unknown> | undefined
      if (!details?.rawMessages || !Array.isArray(details.rawMessages)) {
        return result
      }

      const raw = details.rawMessages as PreprocessableMessage[]
      const processed = preprocessMessages(raw, context.preprocessConfig)

      let nameMapLine = ''
      if (context.preprocessConfig?.anonymizeNames) {
        nameMapLine = anonymizeMessageNames(processed, context.ownerInfo?.platformId)
      }

      const formatted = processed.map((m) => formatMessageCompact(m, context.locale))

      const { rawMessages: _removed, ...restDetails } = details
      const finalDetails = { ...restDetails, messages: formatted, returned: processed.length }

      let textContent = formatToolResultAsText(finalDetails)
      if (nameMapLine) {
        textContent = nameMapLine + '\n' + textContent
      }

      return {
        content: [{ type: 'text' as const, text: textContent }],
        details: finalDetails,
      }
    },
  }
}

/**
 * Name anonymization: replace real names with U{senderId}.
 * Modifies messages in-place, returns mapping text line.
 */
function anonymizeMessageNames(messages: PreprocessableMessage[], ownerPlatformId?: string): string {
  const nameMap = new Map<number, { name: string; platformId?: string }>()
  for (const msg of messages) {
    if (msg.senderId != null && !nameMap.has(msg.senderId)) {
      nameMap.set(msg.senderId, { name: msg.senderName, platformId: msg.senderPlatformId })
    }
  }

  if (nameMap.size === 0) return ''

  for (const msg of messages) {
    if (msg.senderId != null) {
      msg.senderName = `U${msg.senderId}`
    }
  }

  const entries: string[] = []
  for (const [id, { name, platformId }] of nameMap) {
    const isOwner = ownerPlatformId && platformId === ownerPlatformId
    entries.push(`U${id}=${name}${isOwner ? '(owner)' : ''}`)
  }

  return `[Name Map] ${entries.join(' | ')}`
}

/**
 * Get all available AgentTools.
 * Filters tools dynamically based on config, wraps with preprocessing.
 * Note: i18n translation of tool descriptions is skipped server-side
 * (tool descriptions are used as-is by the LLM).
 */
export function getAllTools(context: ToolContext): AgentTool<any>[] {
  const tools: AgentTool<any>[] = coreFactories.map((f) => f(context))

  // Semantic search stub is excluded until RAG is ported
  // When RAG is ported, uncomment:
  // if (isEmbeddingEnabled()) {
  //   tools.push(createSemanticSearchMessages(context))
  // }

  return tools.map((t) => wrapWithPreprocessing(t, context))
}
