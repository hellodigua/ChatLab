import { Type } from '@mariozechner/pi-ai'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ToolContext } from '../types.js'
import { getMessageContext } from '../../../services/queries/messages.js'
import { t } from '../utils/format.js'

const schema = Type.Object({
  message_ids: Type.Array(Type.Number(), { description: 'ai.tools.get_message_context.params.message_ids' }),
  context_size: Type.Optional(Type.Number({ description: 'ai.tools.get_message_context.params.context_size' })),
})

export function createTool(context: ToolContext): AgentTool<typeof schema> {
  return {
    name: 'get_message_context',
    label: 'get_message_context',
    description: 'ai.tools.get_message_context.desc',
    parameters: schema,
    execute: async (_toolCallId, params) => {
      const { sessionId, locale } = context
      const contextSize = params.context_size || 20

      const messages = getMessageContext(sessionId, params.message_ids, contextSize)

      if (messages.length === 0) {
        const data = {
          error: t('noMessageContext', locale) as string,
          messageIds: params.message_ids,
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(data) }],
          details: data,
        }
      }

      const data = {
        totalMessages: messages.length,
        contextSize: contextSize,
        requestedMessageIds: params.message_ids,
        rawMessages: messages,
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(data) }],
        details: data,
      }
    },
  }
}
