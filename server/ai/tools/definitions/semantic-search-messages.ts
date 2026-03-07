import { Type } from '@mariozechner/pi-ai'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ToolContext } from '../types.js'
import { isChineseLocale } from '../utils/format.js'
import { timeParamPropertiesNoHour } from '../utils/schemas.js'

const schema = Type.Object({
  query: Type.String({ description: 'ai.tools.semantic_search_messages.params.query' }),
  top_k: Type.Optional(Type.Number({ description: 'ai.tools.semantic_search_messages.params.top_k' })),
  candidate_limit: Type.Optional(
    Type.Number({ description: 'ai.tools.semantic_search_messages.params.candidate_limit' }),
  ),
  ...timeParamPropertiesNoHour,
})

/**
 * Semantic search tool (server-side stub).
 * RAG/Embedding is not yet ported to the server; this tool always reports "not enabled".
 * Will be wired to the real RAG pipeline in a future story.
 */
export function createTool(context: ToolContext): AgentTool<typeof schema> {
  return {
    name: 'semantic_search_messages',
    label: 'semantic_search_messages',
    description: 'ai.tools.semantic_search_messages.desc',
    parameters: schema,
    execute: async (_toolCallId, _params) => {
      const { locale } = context
      const data = {
        error: isChineseLocale(locale)
          ? '语义搜索未启用。请在设置中添加并启用 Embedding 配置。'
          : 'Semantic search is not enabled. Please add and enable an Embedding config in settings.',
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(data) }],
        details: data,
      }
    },
  }
}
