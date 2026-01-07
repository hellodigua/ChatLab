/**
 * 工具注册
 * 在这里注册所有可用的 AI 工具
 */

import { registerTool } from './index'
import type { ToolDefinition } from '../llm/types'
import type { ToolContext } from './types'
import * as workerManager from '../../worker/workerManager'

// ==================== 国际化辅助函数 ====================

/**
 * 判断是否使用中文
 * 中文环境返回 true，其他语言（包括英文）返回 false
 */
function isChineseLocale(locale?: string): boolean {
  return locale === 'zh-CN'
}

/**
 * 工具返回结果的国际化文本
 */
const i18nTexts = {
  allTime: { zh: '全部时间', en: 'All time' },
  noContent: { zh: '[无内容]', en: '[No content]' },
  memberNotFound: { zh: '未找到该成员', en: 'Member not found' },
  untilNow: { zh: '至今', en: 'Present' },
  noChangeRecord: { zh: '无变更记录', en: 'No change record' },
  noConversation: { zh: '未找到这两人之间的对话', en: 'No conversation found between these two members' },
  noMessageContext: { zh: '未找到指定的消息或上下文', en: 'Message or context not found' },
  messages: { zh: '条', en: '' },
  alias: { zh: '别名', en: 'Alias' },
  weekdays: {
    zh: ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'],
    en: ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  },
  dailySummary: {
    zh: (days: number, total: number, avg: number) => `最近${days}天共${total}条，日均${avg}条`,
    en: (days: number, total: number, avg: number) => `Last ${days} days: ${total} messages, avg ${avg}/day`,
  },
}

/**
 * 获取国际化文本
 */
function t(key: keyof typeof i18nTexts, locale?: string): string | string[] {
  const text = i18nTexts[key]
  if (typeof text === 'object' && 'zh' in text && 'en' in text) {
    return isChineseLocale(locale) ? text.zh : text.en
  }
  return ''
}

// ==================== 时间参数辅助函数 ====================

/**
 * 扩展的时间参数类型
 */
interface ExtendedTimeParams {
  year?: number
  month?: number
  day?: number
  hour?: number
  start_time?: string // 格式: "YYYY-MM-DD HH:mm"
  end_time?: string // 格式: "YYYY-MM-DD HH:mm"
}

/**
 * 解析扩展的时间参数，返回时间过滤器
 * 优先级: start_time/end_time > year/month/day/hour 组合 > context.timeFilter
 */
function parseExtendedTimeParams(
  params: ExtendedTimeParams,
  contextTimeFilter?: { startTs: number; endTs: number }
): { startTs: number; endTs: number } | undefined {
  // 1. 如果指定了 start_time 和/或 end_time，使用精确范围
  if (params.start_time || params.end_time) {
    let startTs: number | undefined
    let endTs: number | undefined

    if (params.start_time) {
      const startDate = new Date(params.start_time.replace(' ', 'T'))
      if (!isNaN(startDate.getTime())) {
        startTs = Math.floor(startDate.getTime() / 1000)
      }
    }

    if (params.end_time) {
      const endDate = new Date(params.end_time.replace(' ', 'T'))
      if (!isNaN(endDate.getTime())) {
        endTs = Math.floor(endDate.getTime() / 1000)
      }
    }

    // 至少有一个有效时间
    if (startTs !== undefined || endTs !== undefined) {
      return {
        startTs: startTs ?? 0,
        endTs: endTs ?? Math.floor(Date.now() / 1000),
      }
    }
  }

  // 2. 如果指定了 year/month/day/hour 组合
  if (params.year) {
    const year = params.year
    const month = params.month
    const day = params.day
    const hour = params.hour

    let startDate: Date
    let endDate: Date

    if (month && day && hour !== undefined) {
      // 精确到小时
      startDate = new Date(year, month - 1, day, hour, 0, 0)
      endDate = new Date(year, month - 1, day, hour, 59, 59)
    } else if (month && day) {
      // 精确到天
      startDate = new Date(year, month - 1, day, 0, 0, 0)
      endDate = new Date(year, month - 1, day, 23, 59, 59)
    } else if (month) {
      // 精确到月
      startDate = new Date(year, month - 1, 1)
      endDate = new Date(year, month, 0, 23, 59, 59) // 下个月的第 0 天 = 当月最后一天
    } else {
      // 只指定了年
      startDate = new Date(year, 0, 1)
      endDate = new Date(year, 11, 31, 23, 59, 59)
    }

    return {
      startTs: Math.floor(startDate.getTime() / 1000),
      endTs: Math.floor(endDate.getTime() / 1000),
    }
  }

  // 3. 使用 context 中的时间过滤器
  return contextTimeFilter
}

/**
 * 格式化时间范围用于返回结果
 */
function formatTimeRange(
  timeFilter?: { startTs: number; endTs: number },
  locale?: string
): string | { start: string; end: string } {
  if (!timeFilter) return t('allTime', locale) as string
  const localeStr = isChineseLocale(locale) ? 'zh-CN' : 'en-US'
  return {
    start: new Date(timeFilter.startTs * 1000).toLocaleString(localeStr),
    end: new Date(timeFilter.endTs * 1000).toLocaleString(localeStr),
  }
}

// 消息内容最大长度（超过则截断）
const MAX_MESSAGE_CONTENT_LENGTH = 200

/**
 * 格式化消息为简洁文本格式
 * 输出格式: "2025/3/3 07:25:04 张三: 消息内容"
 * 超长内容会被截断
 */
function formatMessageCompact(
  msg: {
    id?: number
    senderName: string
    content: string | null
    timestamp: number
  },
  locale?: string
): string {
  const localeStr = isChineseLocale(locale) ? 'zh-CN' : 'en-US'
  const time = new Date(msg.timestamp * 1000).toLocaleString(localeStr)
  let content = msg.content || (t('noContent', locale) as string)

  // 截断超长消息内容
  if (content.length > MAX_MESSAGE_CONTENT_LENGTH) {
    content = content.slice(0, MAX_MESSAGE_CONTENT_LENGTH) + '...'
  }

  return `${time} ${msg.senderName}: ${content}`
}

// ==================== 工具定义 ====================

/**
 * 搜索消息工具
 * 根据关键词搜索群聊记录
 */
const searchMessagesTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'search_messages',
    description:
      '根据关键词搜索群聊记录。适用于用户想要查找特定话题、关键词相关的聊天内容。可以指定时间范围和发送者来筛选消息。支持精确到分钟级别的时间查询。',
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
          description: '返回消息数量限制，默认 100，最大 5000',
        },
        year: {
          type: 'number',
          description: '筛选指定年份的消息，如 2024',
        },
        month: {
          type: 'number',
          description: '筛选指定月份的消息（1-12），需要配合 year 使用',
        },
        day: {
          type: 'number',
          description: '筛选指定日期的消息（1-31），需要配合 year 和 month 使用',
        },
        hour: {
          type: 'number',
          description: '筛选指定小时的消息（0-23），需要配合 year、month 和 day 使用',
        },
        start_time: {
          type: 'string',
          description:
            '开始时间，格式 "YYYY-MM-DD HH:mm"，如 "2024-03-15 14:00"。指定后会覆盖 year/month/day/hour 参数',
        },
        end_time: {
          type: 'string',
          description:
            '结束时间，格式 "YYYY-MM-DD HH:mm"，如 "2024-03-15 18:30"。指定后会覆盖 year/month/day/hour 参数',
        },
      },
      required: ['keywords'],
    },
  },
}

async function searchMessagesExecutor(
  params: {
    keywords: string[]
    sender_id?: number
    limit?: number
    year?: number
    month?: number
    day?: number
    hour?: number
    start_time?: string
    end_time?: string
  },
  context: ToolContext
): Promise<unknown> {
  const { sessionId, timeFilter: contextTimeFilter, maxMessagesLimit, locale } = context
  // 用户配置优先：如果用户设置了 maxMessagesLimit，使用它；否则使用 LLM 指定的值或默认值 100，上限 5000
  const limit = Math.min(maxMessagesLimit || params.limit || 100, 5000)

  // 使用扩展的时间参数解析
  const effectiveTimeFilter = parseExtendedTimeParams(params, contextTimeFilter)

  const result = await workerManager.searchMessages(
    sessionId,
    params.keywords,
    effectiveTimeFilter,
    limit,
    0,
    params.sender_id
  )

  // 格式化为简洁的文本格式
  return {
    total: result.total,
    returned: result.messages.length,
    timeRange: formatTimeRange(effectiveTimeFilter, locale),
    messages: result.messages.map((m) => formatMessageCompact(m, locale)),
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
    description:
      '获取指定时间段内的群聊消息。适用于回答"最近大家聊了什么"、"X月群里聊了什么"等概览性问题。支持精确到分钟级别的时间查询。',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: '返回消息数量限制，默认 100（节省 token，可根据需要增加）',
        },
        year: {
          type: 'number',
          description: '筛选指定年份的消息，如 2024',
        },
        month: {
          type: 'number',
          description: '筛选指定月份的消息（1-12），需要配合 year 使用',
        },
        day: {
          type: 'number',
          description: '筛选指定日期的消息（1-31），需要配合 year 和 month 使用',
        },
        hour: {
          type: 'number',
          description: '筛选指定小时的消息（0-23），需要配合 year、month 和 day 使用',
        },
        start_time: {
          type: 'string',
          description:
            '开始时间，格式 "YYYY-MM-DD HH:mm"，如 "2024-03-15 14:00"。指定后会覆盖 year/month/day/hour 参数',
        },
        end_time: {
          type: 'string',
          description:
            '结束时间，格式 "YYYY-MM-DD HH:mm"，如 "2024-03-15 18:30"。指定后会覆盖 year/month/day/hour 参数',
        },
      },
    },
  },
}

async function getRecentMessagesExecutor(
  params: {
    limit?: number
    year?: number
    month?: number
    day?: number
    hour?: number
    start_time?: string
    end_time?: string
  },
  context: ToolContext
): Promise<unknown> {
  const { sessionId, timeFilter: contextTimeFilter, maxMessagesLimit, locale } = context
  // 用户配置优先：如果用户设置了 maxMessagesLimit，使用它；否则使用 LLM 指定的值或默认值 100（节省 token）
  const limit = maxMessagesLimit || params.limit || 100

  // 使用扩展的时间参数解析
  const effectiveTimeFilter = parseExtendedTimeParams(params, contextTimeFilter)

  const result = await workerManager.getRecentMessages(sessionId, effectiveTimeFilter, limit)

  return {
    total: result.total,
    returned: result.messages.length,
    timeRange: formatTimeRange(effectiveTimeFilter, locale),
    messages: result.messages.map((m) => formatMessageCompact(m, locale)),
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

async function getMemberStatsExecutor(params: { top_n?: number }, context: ToolContext): Promise<unknown> {
  const { sessionId, timeFilter, locale } = context
  const topN = params.top_n || 10

  const result = await workerManager.getMemberActivity(sessionId, timeFilter)

  // 只返回前 N 名
  const topMembers = result.slice(0, topN)

  // 格式化为简洁文本：排名. 名字 消息数(百分比)
  const msgSuffix = isChineseLocale(locale) ? '条' : ''
  return {
    totalMembers: result.length,
    topMembers: topMembers.map((m, index) => `${index + 1}. ${m.name} ${m.messageCount}${msgSuffix}(${m.percentage}%)`),
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
  const { sessionId, timeFilter, locale } = context
  const msgSuffix = isChineseLocale(locale) ? '条' : ''

  switch (params.type) {
    case 'hourly': {
      const result = await workerManager.getHourlyActivity(sessionId, timeFilter)
      const peak = result.reduce((max, curr) => (curr.messageCount > max.messageCount ? curr : max))
      // 格式化为简洁文本：时间 消息数
      return {
        peakHour: `${peak.hour}:00 (${peak.messageCount}${msgSuffix})`,
        distribution: result.map((h) => `${h.hour}:00 ${h.messageCount}${msgSuffix}`),
      }
    }
    case 'weekday': {
      const weekdayNames = t('weekdays', locale) as string[]
      const result = await workerManager.getWeekdayActivity(sessionId, timeFilter)
      const peak = result.reduce((max, curr) => (curr.messageCount > max.messageCount ? curr : max))
      return {
        peakDay: `${weekdayNames[peak.weekday]} (${peak.messageCount}${msgSuffix})`,
        distribution: result.map((w) => `${weekdayNames[w.weekday]} ${w.messageCount}${msgSuffix}`),
      }
    }
    case 'daily': {
      const result = await workerManager.getDailyActivity(sessionId, timeFilter)
      // 只返回最近 30 天
      const recent = result.slice(-30)
      const total = recent.reduce((sum, d) => sum + d.messageCount, 0)
      const avg = Math.round(total / recent.length)
      const summaryFn = i18nTexts.dailySummary[isChineseLocale(locale) ? 'zh' : 'en']
      return {
        summary: summaryFn(recent.length, total, avg),
        trend: recent.map((d) => `${d.date} ${d.messageCount}${msgSuffix}`),
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
    description:
      '获取群成员列表，包括成员的基本信息、别名和消息统计。适用于查询"群里有哪些人"、"某人的别名是什么"、"谁的QQ号是xxx"等问题。',
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
  const { sessionId, locale } = context

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

  // 格式化为简洁文本：id|QQ号|显示名(群昵称)|消息数
  const msgSuffix = isChineseLocale(locale) ? '条' : ''
  const aliasLabel = t('alias', locale) as string
  return {
    totalMembers: members.length,
    returnedMembers: filteredMembers.length,
    members: filteredMembers.map((m) => {
      const displayName = m.groupNickname || m.accountName || m.platformId
      const aliasStr = m.aliases.length > 0 ? `|${aliasLabel}:${m.aliases.join(',')}` : ''
      return `${m.id}|${m.platformId}|${displayName}|${m.messageCount}${msgSuffix}${aliasStr}`
    }),
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
    description:
      '获取成员的昵称变更历史记录。适用于回答"某人以前叫什么名字"、"某人的昵称变化"、"某人曾用名"等问题。需要先通过 get_group_members 工具获取成员 ID。',
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

async function getMemberNameHistoryExecutor(params: { member_id: number }, context: ToolContext): Promise<unknown> {
  const { sessionId, locale } = context

  // 先获取成员基本信息
  const members = await workerManager.getMembers(sessionId)
  const member = members.find((m) => m.id === params.member_id)

  if (!member) {
    return {
      error: t('memberNotFound', locale) as string,
      member_id: params.member_id,
    }
  }

  // 获取昵称历史
  const history = await workerManager.getMemberNameHistory(sessionId, params.member_id)

  // 格式化历史记录为简洁文本
  const localeStr = isChineseLocale(locale) ? 'zh-CN' : 'en-US'
  const untilNow = t('untilNow', locale) as string
  const formatHistory = (h: { name: string; startTs: number; endTs: number | null }) => {
    const start = new Date(h.startTs * 1000).toLocaleDateString(localeStr)
    const end = h.endTs ? new Date(h.endTs * 1000).toLocaleDateString(localeStr) : untilNow
    return `${h.name} (${start} ~ ${end})`
  }

  const accountNames = history.filter((h: { nameType: string }) => h.nameType === 'account_name').map(formatHistory)

  const groupNicknames = history.filter((h: { nameType: string }) => h.nameType === 'group_nickname').map(formatHistory)

  const displayName = member.groupNickname || member.accountName || member.platformId
  const aliasLabel = t('alias', locale) as string
  const aliasStr = member.aliases.length > 0 ? `|${aliasLabel}:${member.aliases.join(',')}` : ''
  const noChangeRecord = t('noChangeRecord', locale) as string

  return {
    member: `${member.id}|${member.platformId}|${displayName}${aliasStr}`,
    accountNameHistory: accountNames.length > 0 ? accountNames : noChangeRecord,
    groupNicknameHistory: groupNicknames.length > 0 ? groupNicknames : noChangeRecord,
  }
}

/**
 * 获取两个成员之间的对话工具
 */
const getConversationBetweenTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'get_conversation_between',
    description:
      '获取两个群成员之间的对话记录。适用于回答"A和B之间聊了什么"、"查看两人的对话"等问题。需要先通过 get_group_members 获取成员 ID。支持精确到分钟级别的时间查询。',
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
        day: {
          type: 'number',
          description: '筛选指定日期的消息（1-31），需要配合 year 和 month 使用',
        },
        hour: {
          type: 'number',
          description: '筛选指定小时的消息（0-23），需要配合 year、month 和 day 使用',
        },
        start_time: {
          type: 'string',
          description:
            '开始时间，格式 "YYYY-MM-DD HH:mm"，如 "2024-03-15 14:00"。指定后会覆盖 year/month/day/hour 参数',
        },
        end_time: {
          type: 'string',
          description:
            '结束时间，格式 "YYYY-MM-DD HH:mm"，如 "2024-03-15 18:30"。指定后会覆盖 year/month/day/hour 参数',
        },
      },
      required: ['member_id_1', 'member_id_2'],
    },
  },
}

async function getConversationBetweenExecutor(
  params: {
    member_id_1: number
    member_id_2: number
    limit?: number
    year?: number
    month?: number
    day?: number
    hour?: number
    start_time?: string
    end_time?: string
  },
  context: ToolContext
): Promise<unknown> {
  const { sessionId, timeFilter: contextTimeFilter, maxMessagesLimit, locale } = context
  // 用户配置优先：如果用户设置了 maxMessagesLimit，使用它；否则使用 LLM 指定的值或默认值 100（节省 token）
  const limit = maxMessagesLimit || params.limit || 100

  // 使用扩展的时间参数解析
  const effectiveTimeFilter = parseExtendedTimeParams(params, contextTimeFilter)

  const result = await workerManager.getConversationBetween(
    sessionId,
    params.member_id_1,
    params.member_id_2,
    effectiveTimeFilter,
    limit
  )

  if (result.messages.length === 0) {
    return {
      error: t('noConversation', locale) as string,
      member1Id: params.member_id_1,
      member2Id: params.member_id_2,
    }
  }

  return {
    total: result.total,
    returned: result.messages.length,
    member1: result.member1Name,
    member2: result.member2Name,
    timeRange: formatTimeRange(effectiveTimeFilter, locale),
    conversation: result.messages.map((m) => formatMessageCompact(m, locale)),
  }
}

/**
 * 获取消息上下文工具
 * 根据消息 ID 获取前后的上下文消息
 */
const getMessageContextTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'get_message_context',
    description:
      '根据消息 ID 获取前后的上下文消息。适用于需要查看某条消息前后聊天内容的场景，比如"这条消息的前后在聊什么"、"查看某条消息的上下文"等。支持单个或批量消息 ID。',
    parameters: {
      type: 'object',
      properties: {
        message_ids: {
          type: 'array',
          description:
            '要查询上下文的消息 ID 列表，可以是单个 ID 或多个 ID。消息 ID 可以从 search_messages 等工具的返回结果中获取',
          items: { type: 'number' },
        },
        context_size: {
          type: 'number',
          description: '上下文大小，即获取前后各多少条消息，默认 20',
        },
      },
      required: ['message_ids'],
    },
  },
}

async function getMessageContextExecutor(
  params: { message_ids: number[]; context_size?: number },
  context: ToolContext
): Promise<unknown> {
  const { sessionId, locale } = context
  const contextSize = params.context_size || 20

  const messages = await workerManager.getMessageContext(sessionId, params.message_ids, contextSize)

  if (messages.length === 0) {
    return {
      error: t('noMessageContext', locale) as string,
      messageIds: params.message_ids,
    }
  }

  return {
    totalMessages: messages.length,
    contextSize: contextSize,
    requestedMessageIds: params.message_ids,
    messages: messages.map((m) => formatMessageCompact(m, locale)),
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
registerTool(getMessageContextTool, getMessageContextExecutor)
