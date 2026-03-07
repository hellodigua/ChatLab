import { Type } from '@mariozechner/pi-ai'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ToolContext } from '../types.js'
import { getMembers } from '../../../services/queries/basic.js'
import { isChineseLocale, t } from '../utils/format.js'

const schema = Type.Object({
  search: Type.Optional(Type.String({ description: 'ai.tools.get_group_members.params.search' })),
  limit: Type.Optional(Type.Number({ description: 'ai.tools.get_group_members.params.limit' })),
})

export function createTool(context: ToolContext): AgentTool<typeof schema> {
  return {
    name: 'get_group_members',
    label: 'get_group_members',
    description: 'ai.tools.get_group_members.desc',
    parameters: schema,
    execute: async (_toolCallId, params) => {
      const { sessionId, locale } = context
      const members = getMembers(sessionId)

      let filteredMembers = members
      if (params.search) {
        const keyword = params.search.toLowerCase()
        filteredMembers = members.filter((m) => {
          if (m.groupNickname && m.groupNickname.toLowerCase().includes(keyword)) return true
          if (m.accountName && m.accountName.toLowerCase().includes(keyword)) return true
          if (m.platformId.includes(keyword)) return true
          if (m.aliases.some((alias) => alias.toLowerCase().includes(keyword))) return true
          return false
        })
      }

      if (params.limit && params.limit > 0) {
        filteredMembers = filteredMembers.slice(0, params.limit)
      }

      const msgSuffix = isChineseLocale(locale) ? '条' : ''
      const aliasLabel = t('alias', locale) as string
      const data = {
        totalMembers: members.length,
        returnedMembers: filteredMembers.length,
        members: filteredMembers.map((m) => {
          const displayName = m.groupNickname || m.accountName || m.platformId
          const aliasStr = m.aliases.length > 0 ? `|${aliasLabel}:${m.aliases.join(',')}` : ''
          return `${m.id}|${m.platformId}|${displayName}|${m.messageCount}${msgSuffix}${aliasStr}`
        }),
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(data) }],
        details: data,
      }
    },
  }
}
