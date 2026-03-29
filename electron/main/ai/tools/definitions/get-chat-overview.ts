import { Type } from '@mariozechner/pi-ai'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ToolContext } from '../types'
import * as workerManager from '../../../worker/workerManager'
import { isChineseLocale } from '../utils/format'

const schema = Type.Object({
  top_n: Type.Optional(Type.Number({ description: 'ai.tools.get_chat_overview.params.top_n' })),
})

export function createTool(context: ToolContext): AgentTool<typeof schema> {
  return {
    name: 'get_chat_overview',
    label: 'get_chat_overview',
    description: 'ai.tools.get_chat_overview.desc',
    parameters: schema,
    execute: async (_toolCallId, params) => {
      const { sessionId, locale } = context
      const topN = params.top_n || 10

      const result = await workerManager.getChatOverview(sessionId, topN)
      if (!result) {
        const msg = isChineseLocale(locale) ? '无法获取聊天概览' : 'Unable to get chat overview'
        return {
          content: [{ type: 'text', text: msg }],
          details: { error: msg },
        }
      }

      const msgSuffix = isChineseLocale(locale) ? '条' : ''
      const lines: string[] = [
        `name: ${result.name}`,
        `platform: ${result.platform}`,
        `type: ${result.type}`,
        `totalMessages: ${result.totalMessages}`,
        `totalMembers: ${result.totalMembers}`,
      ]

      if (result.firstMessageTs != null && result.lastMessageTs != null) {
        const start = new Date(result.firstMessageTs * 1000).toLocaleDateString()
        const end = new Date(result.lastMessageTs * 1000).toLocaleDateString()
        lines.push(`timeRange: ${start} ~ ${end}`)
      }

      if (result.topMembers.length > 0) {
        lines.push(`topMembers:`)
        for (let i = 0; i < result.topMembers.length; i++) {
          const m = result.topMembers[i]
          const pct = result.totalMessages > 0 ? ((m.count / result.totalMessages) * 100).toFixed(1) : '0'
          lines.push(`${i + 1}. ${m.name} ${m.count}${msgSuffix}(${pct}%)`)
        }
      }

      const text = lines.join('\n')
      return {
        content: [{ type: 'text', text }],
        details: result,
      }
    },
  }
}
