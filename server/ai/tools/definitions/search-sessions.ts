import { Type } from '@mariozechner/pi-ai'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ToolContext } from '../types.js'
import { timeParamPropertiesNoHour } from '../utils/schemas.js'
import { searchSessions } from '../../../services/queries/ai-tools.js'
import { parseExtendedTimeParams } from '../utils/time-params.js'
import { formatTimeRange, formatMessageCompact, isChineseLocale } from '../utils/format.js'

const schema = Type.Object({
  keywords: Type.Optional(Type.Array(Type.String(), { description: 'ai.tools.search_sessions.params.keywords' })),
  limit: Type.Optional(Type.Number({ description: 'ai.tools.search_sessions.params.limit' })),
  ...timeParamPropertiesNoHour,
})

export function createTool(context: ToolContext): AgentTool<typeof schema> {
  return {
    name: 'search_sessions',
    label: 'search_sessions',
    description: 'ai.tools.search_sessions.desc',
    parameters: schema,
    execute: async (_toolCallId, params) => {
      const { sessionId, timeFilter: contextTimeFilter, locale } = context
      const limit = params.limit || 20
      const effectiveTimeFilter = parseExtendedTimeParams(params, contextTimeFilter)

      const sessions = searchSessions(sessionId, params.keywords, effectiveTimeFilter, limit, 5)

      if (sessions.length === 0) {
        const data = {
          total: 0,
          message: isChineseLocale(locale) ? '未找到匹配的会话' : 'No matching sessions found',
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(data) }],
          details: data,
        }
      }

      const localeStr = isChineseLocale(locale) ? 'zh-CN' : 'en-US'
      const msgSuffix = isChineseLocale(locale) ? '条消息' : ' messages'
      const completeLabel = isChineseLocale(locale) ? '完整会话' : 'complete'

      const data = {
        total: sessions.length,
        timeRange: formatTimeRange(effectiveTimeFilter, locale),
        sessions: sessions.map((s) => {
          const startTime = new Date(s.startTs * 1000).toLocaleString(localeStr)
          const endTime = new Date(s.endTs * 1000).toLocaleString(localeStr)
          const completeTag = s.isComplete ? ` [${completeLabel}]` : ''

          return {
            sessionId: s.id,
            time: `${startTime} ~ ${endTime}`,
            messageCount: `${s.messageCount}${msgSuffix}${completeTag}`,
            preview: s.previewMessages.map((m) => formatMessageCompact(m, locale)),
          }
        }),
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(data) }],
        details: data,
      }
    },
  }
}
