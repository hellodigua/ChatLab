import { Type } from '@mariozechner/pi-ai'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ToolContext } from '../types.js'
import { getRecentMessages } from '../../../services/queries/messages.js'
import { parseExtendedTimeParams } from '../utils/time-params.js'
import { formatTimeRange } from '../utils/format.js'
import { timeParamProperties } from '../utils/schemas.js'

const schema = Type.Object({
  limit: Type.Optional(Type.Number({ description: 'ai.tools.get_recent_messages.params.limit' })),
  ...timeParamProperties,
})

export function createTool(context: ToolContext): AgentTool<typeof schema> {
  return {
    name: 'get_recent_messages',
    label: 'get_recent_messages',
    description: 'ai.tools.get_recent_messages.desc',
    parameters: schema,
    execute: async (_toolCallId, params) => {
      const { sessionId, timeFilter: contextTimeFilter, maxMessagesLimit, locale } = context
      const limit = maxMessagesLimit || params.limit || 100
      const effectiveTimeFilter = parseExtendedTimeParams(params, contextTimeFilter)

      const result = getRecentMessages(sessionId, effectiveTimeFilter, limit)

      const data = {
        total: result.total,
        returned: result.messages.length,
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
