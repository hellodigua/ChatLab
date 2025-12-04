/**
 * 工具注册
 * 在这里注册所有可用的 AI 工具
 */

import { registerTool } from './index'
import type { ToolDefinition } from '../llm/types'
import type { ToolContext } from './types'
import * as workerManager from '../../worker/workerManager'

// ==================== 工具定义 ====================

/**
 * 搜索消息工具
 * 根据关键词搜索群聊记录
 */
const searchMessagesTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'search_messages',
    description: '根据关键词搜索群聊记录。适用于用户想要查找特定话题、关键词相关的聊天内容。可以指定时间范围和发送者来筛选消息。',
    parameters: {
      type: 'object',
      properties: {
        keywords: {
          type: 'array',
          description: '搜索关键词列表，会用 OR 逻辑匹配包含任一关键词的消息。如果只需要按发送者筛选，可以传空数组 []',
          items: { type: 'string' },
        },
        sender_id: {
          type: 'number',
          description: '发送者的成员 ID，用于筛选特定成员发送的消息。可以通过 get_group_members 工具获取成员 ID',
        },
        limit: {
          type: 'number',
          description: '返回消息数量限制，默认 200，最大 5000',
        },
        year: {
          type: 'number',
          description: '筛选指定年份的消息，如 2024',
        },
        month: {
          type: 'number',
          description: '筛选指定月份的消息（1-12），需要配合 year 使用',
        },
      },
      required: ['keywords'],
    },
  },
}

async function searchMessagesExecutor(
  params: { keywords: string[]; sender_id?: number; limit?: number; year?: number; month?: number },
  context: ToolContext
): Promise<unknown> {
  const { sessionId, timeFilter: contextTimeFilter } = context
  // 默认 200，上限 5000
  const limit = Math.min(params.limit || 200, 5000)

  // 构建时间过滤器：优先使用 LLM 指定的年/月，否则使用 context 中的
  let effectiveTimeFilter = contextTimeFilter
  if (params.year) {
    const year = params.year
    const month = params.month // 可能为 undefined

    let startDate: Date
    let endDate: Date

    if (month) {
      // 指定了年月
      startDate = new Date(year, month - 1, 1) // 月份从 0 开始
      endDate = new Date(year, month, 0, 23, 59, 59) // 下个月的第 0 天 = 当月最后一天
    } else {
      // 只指定了年
      startDate = new Date(year, 0, 1)
      endDate = new Date(year, 11, 31, 23, 59, 59)
    }

    effectiveTimeFilter = {
      startTs: Math.floor(startDate.getTime() / 1000),
      endTs: Math.floor(endDate.getTime() / 1000),
    }
  }

  const result = await workerManager.searchMessages(
    sessionId,
    params.keywords,
    effectiveTimeFilter,
    limit,
    0,
    params.sender_id
  )

  // 格式化为 LLM 易于理解的格式
  return {
    total: result.total,
    returned: result.messages.length,
    senderId: params.sender_id || null,
    timeRange: effectiveTimeFilter
      ? {
          start: new Date(effectiveTimeFilter.startTs * 1000).toLocaleDateString('zh-CN'),
          end: new Date(effectiveTimeFilter.endTs * 1000).toLocaleDateString('zh-CN'),
        }
      : '全部时间',
    messages: result.messages.map((m) => ({
      sender: m.senderName,
      content: m.content,
      time: new Date(m.timestamp * 1000).toLocaleString('zh-CN'),
    })),
  }
}

/**
 * 获取最近消息工具
 * 获取最近的群聊消息，用于回答概览性问题
 */
const getRecentMessagesTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'get_recent_messages',
    description: '获取指定时间段内的群聊消息。适用于回答"最近大家聊了什么"、"X月群里聊了什么"等概览性问题。可以指定年/月来筛选特定时间段。',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: '返回消息数量限制，默认 100',
        },
        year: {
          type: 'number',
          description: '筛选指定年份的消息，如 2024',
        },
        month: {
          type: 'number',
          description: '筛选指定月份的消息（1-12），需要配合 year 使用',
        },
      },
    },
  },
}

async function getRecentMessagesExecutor(
  params: { limit?: number; year?: number; month?: number },
  context: ToolContext
): Promise<unknown> {
  const { sessionId, timeFilter: contextTimeFilter } = context
  const limit = params.limit || 100

  // 构建时间过滤器：优先使用 LLM 指定的年/月
  let effectiveTimeFilter = contextTimeFilter
  if (params.year) {
    const year = params.year
    const month = params.month

    let startDate: Date
    let endDate: Date

    if (month) {
      startDate = new Date(year, month - 1, 1)
      endDate = new Date(year, month, 0, 23, 59, 59)
    } else {
      startDate = new Date(year, 0, 1)
      endDate = new Date(year, 11, 31, 23, 59, 59)
    }

    effectiveTimeFilter = {
      startTs: Math.floor(startDate.getTime() / 1000),
      endTs: Math.floor(endDate.getTime() / 1000),
    }
  }

  const result = await workerManager.getRecentMessages(sessionId, effectiveTimeFilter, limit)

  return {
    total: result.total,
    returned: result.messages.length,
    timeRange: effectiveTimeFilter
      ? {
          start: new Date(effectiveTimeFilter.startTs * 1000).toLocaleDateString('zh-CN'),
          end: new Date(effectiveTimeFilter.endTs * 1000).toLocaleDateString('zh-CN'),
        }
      : '全部时间',
    messages: result.messages.map((m) => ({
      sender: m.senderName,
      content: m.content,
      time: new Date(m.timestamp * 1000).toLocaleString('zh-CN'),
    })),
  }
}

/**
 * 获取成员活跃度统计工具
 */
const getMemberStatsTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'get_member_stats',
    description: '获取群成员的活跃度统计数据。适用于回答"谁最活跃"、"发言最多的是谁"等问题。',
    parameters: {
      type: 'object',
      properties: {
        top_n: {
          type: 'number',
          description: '返回前 N 名成员，默认 10',
        },
      },
    },
  },
}

async function getMemberStatsExecutor(
  params: { top_n?: number },
  context: ToolContext
): Promise<unknown> {
  const { sessionId, timeFilter } = context
  const topN = params.top_n || 10

  const result = await workerManager.getMemberActivity(sessionId, timeFilter)

  // 只返回前 N 名
  const topMembers = result.slice(0, topN)

  return {
    totalMembers: result.length,
    topMembers: topMembers.map((m, index) => ({
      rank: index + 1,
      name: m.name,
      messageCount: m.messageCount,
      percentage: `${m.percentage}%`,
    })),
  }
}

/**
 * 获取时间分布统计工具
 */
const getTimeStatsTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'get_time_stats',
    description: '获取群聊的时间分布统计。适用于回答"什么时候最活跃"、"大家一般几点聊天"等问题。',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: '统计类型：hourly（按小时）、weekday（按星期）、daily（按日期）',
          enum: ['hourly', 'weekday', 'daily'],
        },
      },
      required: ['type'],
    },
  },
}

async function getTimeStatsExecutor(
  params: { type: 'hourly' | 'weekday' | 'daily' },
  context: ToolContext
): Promise<unknown> {
  const { sessionId, timeFilter } = context

  switch (params.type) {
    case 'hourly': {
      const result = await workerManager.getHourlyActivity(sessionId, timeFilter)
      const peak = result.reduce((max, curr) =>
        curr.messageCount > max.messageCount ? curr : max
      )
      return {
        distribution: result.map((h) => ({
          hour: `${h.hour}:00`,
          count: h.messageCount,
        })),
        peakHour: `${peak.hour}:00`,
        peakCount: peak.messageCount,
      }
    }
    case 'weekday': {
      const weekdayNames = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日']
      const result = await workerManager.getWeekdayActivity(sessionId, timeFilter)
      const peak = result.reduce((max, curr) =>
        curr.messageCount > max.messageCount ? curr : max
      )
      return {
        distribution: result.map((w) => ({
          weekday: weekdayNames[w.weekday],
          count: w.messageCount,
        })),
        peakDay: weekdayNames[peak.weekday],
        peakCount: peak.messageCount,
      }
    }
    case 'daily': {
      const result = await workerManager.getDailyActivity(sessionId, timeFilter)
      // 只返回最近 30 天
      const recent = result.slice(-30)
      const total = recent.reduce((sum, d) => sum + d.messageCount, 0)
      const avg = Math.round(total / recent.length)
      return {
        recentDays: recent.length,
        totalMessages: total,
        averagePerDay: avg,
        trend: recent.map((d) => ({
          date: d.date,
          count: d.messageCount,
        })),
      }
    }
  }
}

/**
 * 获取群成员列表工具
 * 返回所有群成员的详细信息，包括别名
 */
const getGroupMembersTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'get_group_members',
    description: '获取群成员列表，包括成员的基本信息、别名和消息统计。适用于查询"群里有哪些人"、"某人的别名是什么"、"谁的QQ号是xxx"等问题。',
    parameters: {
      type: 'object',
      properties: {
        search: {
          type: 'string',
          description: '可选的搜索关键词，用于筛选成员昵称、别名或QQ号',
        },
        limit: {
          type: 'number',
          description: '返回成员数量限制，默认返回全部',
        },
      },
    },
  },
}

async function getGroupMembersExecutor(
  params: { search?: string; limit?: number },
  context: ToolContext
): Promise<unknown> {
  const { sessionId } = context

  const members = await workerManager.getMembers(sessionId)

  // 如果有搜索关键词，进行筛选
  let filteredMembers = members
  if (params.search) {
    const keyword = params.search.toLowerCase()
    filteredMembers = members.filter((m) => {
      // 搜索群昵称
      if (m.groupNickname && m.groupNickname.toLowerCase().includes(keyword)) return true
      // 搜索账号名称
      if (m.accountName && m.accountName.toLowerCase().includes(keyword)) return true
      // 搜索 QQ 号
      if (m.platformId.includes(keyword)) return true
      // 搜索别名
      if (m.aliases.some((alias) => alias.toLowerCase().includes(keyword))) return true
      return false
    })
  }

  // 如果有数量限制
  if (params.limit && params.limit > 0) {
    filteredMembers = filteredMembers.slice(0, params.limit)
  }

  return {
    totalMembers: members.length,
    returnedMembers: filteredMembers.length,
    searchKeyword: params.search || null,
    members: filteredMembers.map((m) => ({
      id: m.id,
      qqNumber: m.platformId,
      displayName: m.groupNickname || m.accountName || m.platformId,
      accountName: m.accountName,
      groupNickname: m.groupNickname,
      aliases: m.aliases,
      messageCount: m.messageCount,
    })),
  }
}

/**
 * 获取成员昵称变更历史工具
 * 查看成员的历史昵称变化记录
 */
const getMemberNameHistoryTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'get_member_name_history',
    description: '获取成员的昵称变更历史记录。适用于回答"某人以前叫什么名字"、"某人的昵称变化"、"某人曾用名"等问题。需要先通过 get_group_members 工具获取成员 ID。',
    parameters: {
      type: 'object',
      properties: {
        member_id: {
          type: 'number',
          description: '成员的数据库 ID，可以通过 get_group_members 工具获取',
        },
      },
      required: ['member_id'],
    },
  },
}

async function getMemberNameHistoryExecutor(
  params: { member_id: number },
  context: ToolContext
): Promise<unknown> {
  const { sessionId } = context

  // 先获取成员基本信息
  const members = await workerManager.getMembers(sessionId)
  const member = members.find((m) => m.id === params.member_id)

  if (!member) {
    return {
      error: '未找到该成员',
      member_id: params.member_id,
    }
  }

  // 获取昵称历史
  const history = await workerManager.getMemberNameHistory(sessionId, params.member_id)

  // 分离账号名称和群昵称的历史
  const accountNameHistory = history
    .filter((h: { nameType: string; name: string; startTs: number; endTs: number | null }) => h.nameType === 'account_name')
    .map((h: { nameType: string; name: string; startTs: number; endTs: number | null }) => ({
      name: h.name,
      startTime: new Date(h.startTs * 1000).toLocaleString('zh-CN'),
      endTime: h.endTs ? new Date(h.endTs * 1000).toLocaleString('zh-CN') : '至今',
    }))

  const groupNicknameHistory = history
    .filter((h: { nameType: string; name: string; startTs: number; endTs: number | null }) => h.nameType === 'group_nickname')
    .map((h: { nameType: string; name: string; startTs: number; endTs: number | null }) => ({
      name: h.name,
      startTime: new Date(h.startTs * 1000).toLocaleString('zh-CN'),
      endTime: h.endTs ? new Date(h.endTs * 1000).toLocaleString('zh-CN') : '至今',
    }))

  return {
    member: {
      id: member.id,
      qqNumber: member.platformId,
      currentAccountName: member.accountName,
      currentGroupNickname: member.groupNickname,
      aliases: member.aliases,
    },
    accountNameHistory: accountNameHistory.length > 0 ? accountNameHistory : '无变更记录',
    groupNicknameHistory: groupNicknameHistory.length > 0 ? groupNicknameHistory : '无变更记录',
    totalChanges: history.length,
  }
}

/**
 * 获取两个成员之间的对话工具
 */
const getConversationBetweenTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'get_conversation_between',
    description: '获取两个群成员之间的对话记录。适用于回答"A和B之间聊了什么"、"查看两人的对话"等问题。需要先通过 get_group_members 获取成员 ID。',
    parameters: {
      type: 'object',
      properties: {
        member_id_1: {
          type: 'number',
          description: '第一个成员的数据库 ID',
        },
        member_id_2: {
          type: 'number',
          description: '第二个成员的数据库 ID',
        },
        limit: {
          type: 'number',
          description: '返回消息数量限制，默认 100',
        },
        year: {
          type: 'number',
          description: '筛选指定年份的消息',
        },
        month: {
          type: 'number',
          description: '筛选指定月份的消息（1-12），需要配合 year 使用',
        },
      },
      required: ['member_id_1', 'member_id_2'],
    },
  },
}

async function getConversationBetweenExecutor(
  params: { member_id_1: number; member_id_2: number; limit?: number; year?: number; month?: number },
  context: ToolContext
): Promise<unknown> {
  const { sessionId, timeFilter: contextTimeFilter } = context
  const limit = params.limit || 100

  // 构建时间过滤器
  let effectiveTimeFilter = contextTimeFilter
  if (params.year) {
    const year = params.year
    const month = params.month

    let startDate: Date
    let endDate: Date

    if (month) {
      startDate = new Date(year, month - 1, 1)
      endDate = new Date(year, month, 0, 23, 59, 59)
    } else {
      startDate = new Date(year, 0, 1)
      endDate = new Date(year, 11, 31, 23, 59, 59)
    }

    effectiveTimeFilter = {
      startTs: Math.floor(startDate.getTime() / 1000),
      endTs: Math.floor(endDate.getTime() / 1000),
    }
  }

  const result = await workerManager.getConversationBetween(
    sessionId,
    params.member_id_1,
    params.member_id_2,
    effectiveTimeFilter,
    limit
  )

  if (result.messages.length === 0) {
    return {
      error: '未找到这两人之间的对话',
      member1Id: params.member_id_1,
      member2Id: params.member_id_2,
    }
  }

  return {
    total: result.total,
    returned: result.messages.length,
    member1: result.member1Name,
    member2: result.member2Name,
    timeRange: effectiveTimeFilter
      ? {
          start: new Date(effectiveTimeFilter.startTs * 1000).toLocaleDateString('zh-CN'),
          end: new Date(effectiveTimeFilter.endTs * 1000).toLocaleDateString('zh-CN'),
        }
      : '全部时间',
    conversation: result.messages.map((m) => ({
      sender: m.senderName,
      content: m.content,
      time: new Date(m.timestamp * 1000).toLocaleString('zh-CN'),
    })),
  }
}

// ==================== 注册工具 ====================

registerTool(searchMessagesTool, searchMessagesExecutor)
registerTool(getRecentMessagesTool, getRecentMessagesExecutor)
registerTool(getMemberStatsTool, getMemberStatsExecutor)
registerTool(getTimeStatsTool, getTimeStatsExecutor)
registerTool(getGroupMembersTool, getGroupMembersExecutor)
registerTool(getMemberNameHistoryTool, getMemberNameHistoryExecutor)
registerTool(getConversationBetweenTool, getConversationBetweenExecutor)

