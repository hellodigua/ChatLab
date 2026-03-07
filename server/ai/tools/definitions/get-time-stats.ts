import { Type } from '@mariozechner/pi-ai'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ToolContext } from '../types.js'
import { getHourlyActivity, getWeekdayActivity, getDailyActivity } from '../../../services/queries/basic.js'
import { isChineseLocale, i18nTexts, t } from '../utils/format.js'

const schema = Type.Object({
  type: Type.Union([Type.Literal('hourly'), Type.Literal('weekday'), Type.Literal('daily')], {
    description: 'ai.tools.get_time_stats.params.type',
  }),
})

export function createTool(context: ToolContext): AgentTool<typeof schema> {
  return {
    name: 'get_time_stats',
    label: 'get_time_stats',
    description: 'ai.tools.get_time_stats.desc',
    parameters: schema,
    execute: async (_toolCallId, params) => {
      const { sessionId, timeFilter, locale } = context
      const msgSuffix = isChineseLocale(locale) ? '条' : ''

      let data: Record<string, unknown>
      switch (params.type) {
        case 'hourly': {
          const result = getHourlyActivity(sessionId, timeFilter)
          const peak = result.reduce((max: any, curr: any) => (curr.messageCount > max.messageCount ? curr : max))
          data = {
            peakHour: `${peak.hour}:00 (${peak.messageCount}${msgSuffix})`,
            distribution: result.map((h: any) => `${h.hour}:00 ${h.messageCount}${msgSuffix}`),
          }
          break
        }
        case 'weekday': {
          const weekdayNames = t('weekdays', locale) as string[]
          const result = getWeekdayActivity(sessionId, timeFilter)
          const peak = result.reduce((max: any, curr: any) => (curr.messageCount > max.messageCount ? curr : max))
          data = {
            peakDay: `${weekdayNames[peak.weekday]} (${peak.messageCount}${msgSuffix})`,
            distribution: result.map((w: any) => `${weekdayNames[w.weekday]} ${w.messageCount}${msgSuffix}`),
          }
          break
        }
        case 'daily': {
          const result = getDailyActivity(sessionId, timeFilter)
          const recent = result.slice(-30)
          const total = recent.reduce((sum: number, d: any) => sum + d.messageCount, 0)
          const avg = Math.round(total / recent.length)
          const summaryFn = i18nTexts.dailySummary[isChineseLocale(locale) ? 'zh' : 'en']
          data = {
            summary: summaryFn(recent.length, total, avg),
            trend: recent.map((d: any) => `${d.date} ${d.messageCount}${msgSuffix}`),
          }
          break
        }
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(data) }],
        details: data,
      }
    },
  }
}
