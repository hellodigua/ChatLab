import { Type } from '@mariozechner/pi-ai'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ToolContext } from '../types.js'
import { timeParamProperties } from '../utils/schemas.js'
import { getConversationBetween } from '../../../services/queries/messages.js'
import { parseExtendedTimeParams } from '../utils/time-params.js'
import { formatTimeRange, t } from '../utils/format.js'

const schema = Type.Object({
  member_id_1: Type.Number({ description: 'ai.tools.get_conversation_between.params.member_id_1' }),
  member_id_2: Type.Number({ description: 'ai.tools.get_conversation_between.params.member_id_2' }),
  limit: Type.Optional(Type.Number({ description: 'ai.tools.get_conversation_between.params.limit' })),
  ...timeParamProperties,
})

export function createTool(context: ToolContext): AgentTool<typeof schema> {
  return {
    name: 'get_conversation_between',
    label: 'get_conversation_between',
    description: 'ai.tools.get_conversation_between.desc',
    parameters: schema,
    execute: async (_toolCallId, params) => {
      const { sessionId, timeFilter: contextTimeFilter, maxMessagesLimit, locale } = context
      const limit = maxMessagesLimit || params.limit || 100
      const effectiveTimeFilter = parseExtendedTimeParams(params, contextTimeFilter)

      const result = getConversationBetween(
        sessionId,
        params.member_id_1,
        params.member_id_2,
        effectiveTimeFilter,
        limit,
      )

      if (result.messages.length === 0) {
        const data = {
          error: t('noConversation', locale) as string,
          member1Id: params.member_id_1,
          member2Id: params.member_id_2,
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(data) }],
          details: data,
        }
      }

      const data = {
        total: result.total,
        returned: result.messages.length,
        member1: result.member1Name,
        member2: result.member2Name,
        timeRange: formatTimeRange(effectiveTimeFilter, locale),
        rawMessages: result.messages,
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(data) }],
        details: data,
      }
    },
  }
}
