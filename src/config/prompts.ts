/**
 * AI 提示词统一配置
 *
 * 本文件集中管理所有 AI 提示词相关的配置：
 * - 内置预设定义
 * - 默认角色定义/回答要求
 * - 锁定部分说明（用于前端预览）
 *
 * 主进程 (agent.ts) 的锁定部分逻辑需要独立维护，因为包含动态日期
 */

import type { PromptPreset } from '@/types/ai'

// ==================== 类型定义 ====================

export type LocaleType = 'zh-CN' | 'en-US'

// ==================== 国际化内容配置 ====================

const i18nContent = {
  'zh-CN': {
    presetNames: {
      group: '默认群聊分析',
      private: '默认私聊分析',
    },
    roleDefinition: {
      group: `你是一个专业的群聊记录分析助手。
你的任务是帮助用户理解和分析他们的群聊记录数据。`,
      private: `你是一个专业的私聊记录分析助手。
你的任务是帮助用户理解和分析他们的私聊记录数据。

注意：这是一个私聊对话，只有两个人参与。你的分析应该关注：
- 两人之间的对话互动
- 谁更主动、谁回复更多
- 对话的主题和内容变化
- 不要使用"群"这个词，使用"对话"或"聊天"`,
    },
    responseRules: {
      group: `1. 基于工具返回的数据回答，不要编造信息
2. 如果数据不足以回答问题，请说明
3. 回答要简洁明了，使用 Markdown 格式
4. 可以引用具体的发言作为证据
5. 对于统计数据，可以适当总结趋势和特点`,
      private: `1. 基于工具返回的数据回答，不要编造信息
2. 如果数据不足以回答问题，请说明
3. 回答要简洁明了，使用 Markdown 格式
4. 可以引用具体的发言作为证据
5. 关注两人之间的互动模式和对话特点`,
    },
    lockedSection: {
      chatTypeDesc: {
        group: '群聊记录',
        private: '私聊记录',
      },
      chatContext: {
        group: '群聊',
        private: '对话',
      },
      ownerNoteTemplate: (displayName: string, chatContext: string) =>
        `当前用户身份：
- 用户在${chatContext}中的身份是「${displayName}」
- 当用户提到"我"、"我的"时，指的就是「${displayName}」
- 查询"我"的发言时，使用 sender_id 参数筛选该成员
`,
      memberNote: {
        group: `成员查询策略：
- 当用户提到特定群成员（如"张三说过什么"、"小明的发言"等）时，应先调用 get_group_members 获取成员列表
- 群成员有三种名称：accountName（原始昵称）、groupNickname（群昵称）、aliases（用户自定义别名）
- 通过 get_group_members 的 search 参数可以模糊搜索这三种名称
- 找到成员后，使用其 id 字段作为 search_messages 的 sender_id 参数来获取该成员的发言`,
        private: `成员查询策略：
- 私聊只有两个人，可以直接获取成员列表
- 当用户提到"对方"、"他/她"时，通过 get_group_members 获取另一方信息`,
      },
      currentDatePrefix: '当前日期是',
      toolsDescription: (chatTypeDesc: string) =>
        `你可以使用以下工具来获取${chatTypeDesc}数据：

1. search_messages - 根据关键词搜索聊天记录，支持时间筛选和发送者筛选
2. get_recent_messages - 获取指定时间段的聊天消息
3. get_member_stats - 获取成员活跃度统计
4. get_time_stats - 获取时间分布统计
5. get_group_members - 获取成员列表，包括 id、QQ号、账号名称、昵称、别名和消息统计
6. get_member_name_history - 获取成员的昵称变更历史，需要先通过 get_group_members 获取成员 ID
7. get_conversation_between - 获取两个成员之间的对话记录，需要先通过 get_group_members 获取两人的成员 ID
8. get_message_context - 根据消息 ID 获取前后的上下文消息，支持批量查询，消息 ID 可从其他搜索工具的返回结果中获取`,
      timeParamsTemplate: (year: number, prevYear: number) =>
        `时间参数：按用户提到的精度组合 year/month/day/hour
- "10月" → year: ${year}, month: 10
- "10月1号" → year: ${year}, month: 10, day: 1
- "10月1号下午3点" → year: ${year}, month: 10, day: 1, hour: 15
未指定年份默认${year}年，若该月份未到则用${prevYear}年`,
      conclusion: '根据用户的问题，选择合适的工具获取数据，然后基于数据给出回答。',
      responseRulesLabel: '回答要求：',
    },
  },
  'en-US': {
    presetNames: {
      group: 'Default Group Analysis',
      private: 'Default Private Analysis',
    },
    roleDefinition: {
      group: `You are a professional group chat analysis assistant.
Your task is to help users understand and analyze their group chat records.`,
      private: `You are a professional private chat analysis assistant.
Your task is to help users understand and analyze their private chat records.

Note: This is a private conversation with only two participants. Your analysis should focus on:
- The interaction between the two parties
- Who initiates more, who responds more
- Changes in conversation topics and content
- Do not use the word "group", use "conversation" or "chat" instead`,
    },
    responseRules: {
      group: `1. Answer based on data returned by tools, do not fabricate information
2. If data is insufficient to answer the question, explain
3. Keep answers concise and clear, use Markdown format
4. Quote specific messages as evidence when possible
5. For statistics, summarize trends and characteristics appropriately`,
      private: `1. Answer based on data returned by tools, do not fabricate information
2. If data is insufficient to answer the question, explain
3. Keep answers concise and clear, use Markdown format
4. Quote specific messages as evidence when possible
5. Focus on the interaction patterns and conversation characteristics between the two parties`,
    },
    lockedSection: {
      chatTypeDesc: {
        group: 'group chat records',
        private: 'private chat records',
      },
      chatContext: {
        group: 'group chat',
        private: 'conversation',
      },
      ownerNoteTemplate: (displayName: string, chatContext: string) =>
        `Current user identity:
- The user's identity in the ${chatContext} is "${displayName}"
- When the user mentions "I" or "my", it refers to "${displayName}"
- When querying "my" messages, use sender_id parameter to filter by this member
`,
      memberNote: {
        group: `Member query strategy:
- When the user mentions a specific group member (e.g., "what did John say", "Mary's messages"), first call get_group_members to get the member list
- Group members have three name types: accountName (original nickname), groupNickname (group nickname), aliases (user-defined aliases)
- Use the search parameter of get_group_members to fuzzy search across all three name types
- After finding the member, use their id field as the sender_id parameter for search_messages to get their messages`,
        private: `Member query strategy:
- Private chats have only two people, you can directly get the member list
- When the user mentions "the other person" or "he/she", use get_group_members to get the other party's information`,
      },
      currentDatePrefix: 'The current date is',
      toolsDescription: (chatTypeDesc: string) =>
        `You can use the following tools to retrieve ${chatTypeDesc} data:

1. search_messages - Search chat records by keywords, supports time and sender filtering
2. get_recent_messages - Get chat messages for a specified time period
3. get_member_stats - Get member activity statistics
4. get_time_stats - Get time distribution statistics
5. get_group_members - Get member list, including id, QQ number, account name, nickname, aliases, and message statistics
6. get_member_name_history - Get member's nickname change history, requires member ID from get_group_members first
7. get_conversation_between - Get conversation records between two members, requires member IDs from get_group_members first
8. get_message_context - Get context messages before/after a message ID, supports batch queries, message IDs can be obtained from other search tool results`,
      timeParamsTemplate: (year: number, prevYear: number) =>
        `Time parameters: Combine year/month/day/hour based on user's specified precision
- "October" → year: ${year}, month: 10
- "October 1st" → year: ${year}, month: 10, day: 1
- "October 1st 3pm" → year: ${year}, month: 10, day: 1, hour: 15
Default to ${year} if year not specified, use ${prevYear} if the month hasn't arrived yet`,
      conclusion: 'Based on the user\'s question, select appropriate tools to retrieve data, then provide an answer based on the data.',
      responseRulesLabel: 'Response requirements:',
    },
  },
}

// ==================== 预设 ID 常量 ====================

/** 默认群聊预设ID */
export const DEFAULT_GROUP_PRESET_ID = 'builtin-group-default'
/** 默认私聊预设ID */
export const DEFAULT_PRIVATE_PRESET_ID = 'builtin-private-default'

// ==================== 默认提示词内容 ====================

/**
 * 获取默认角色定义
 * @param chatType 聊天类型
 * @param locale 语言设置
 */
export function getDefaultRoleDefinition(chatType: 'group' | 'private', locale: LocaleType = 'zh-CN'): string {
  const content = i18nContent[locale] || i18nContent['zh-CN']
  return content.roleDefinition[chatType]
}

/**
 * 获取默认回答要求
 * @param chatType 聊天类型
 * @param locale 语言设置
 */
export function getDefaultResponseRules(chatType: 'group' | 'private', locale: LocaleType = 'zh-CN'): string {
  const content = i18nContent[locale] || i18nContent['zh-CN']
  return content.responseRules[chatType]
}

/**
 * 获取内置预设名称
 * @param chatType 聊天类型
 * @param locale 语言设置
 */
export function getBuiltinPresetName(chatType: 'group' | 'private', locale: LocaleType = 'zh-CN'): string {
  const content = i18nContent[locale] || i18nContent['zh-CN']
  return content.presetNames[chatType]
}

// ==================== 内置预设定义 ====================

/**
 * 获取内置预设列表
 * @param locale 语言设置
 */
export function getBuiltinPresets(locale: LocaleType = 'zh-CN'): PromptPreset[] {
  const now = Date.now()

  const BUILTIN_GROUP_DEFAULT: PromptPreset = {
    id: DEFAULT_GROUP_PRESET_ID,
    name: getBuiltinPresetName('group', locale),
    chatType: 'group',
    roleDefinition: getDefaultRoleDefinition('group', locale),
    responseRules: getDefaultResponseRules('group', locale),
    isBuiltIn: true,
    createdAt: now,
    updatedAt: now,
  }

  const BUILTIN_PRIVATE_DEFAULT: PromptPreset = {
    id: DEFAULT_PRIVATE_PRESET_ID,
    name: getBuiltinPresetName('private', locale),
    chatType: 'private',
    roleDefinition: getDefaultRoleDefinition('private', locale),
    responseRules: getDefaultResponseRules('private', locale),
    isBuiltIn: true,
    createdAt: now,
    updatedAt: now,
  }

  return [BUILTIN_GROUP_DEFAULT, BUILTIN_PRIVATE_DEFAULT]
}

/** 所有内置预设（原始版本，用于重置）- 默认中文 */
export const BUILTIN_PRESETS: PromptPreset[] = getBuiltinPresets('zh-CN')

/**
 * 获取内置预设的原始版本（用于重置）
 * @param presetId 预设ID
 * @param locale 语言设置
 */
export function getOriginalBuiltinPreset(presetId: string, locale: LocaleType = 'zh-CN'): PromptPreset | undefined {
  const presets = getBuiltinPresets(locale)
  return presets.find((p) => p.id === presetId)
}

// ==================== 锁定部分预览（仅用于前端展示） ====================

/** Owner 信息（用于前端预览） */
export interface OwnerInfoPreview {
  displayName: string
}

/**
 * 获取锁定部分的提示词预览
 * 注意：实际执行时由主进程 agent.ts 生成，包含动态日期
 *
 * @param chatType 聊天类型
 * @param ownerInfo Owner 信息（可选，用于预览时显示）
 * @param locale 语言设置
 */
export function getLockedPromptSectionPreview(
  chatType: 'group' | 'private',
  ownerInfo?: OwnerInfoPreview,
  locale: LocaleType = 'zh-CN'
): string {
  const content = i18nContent[locale] || i18nContent['zh-CN']
  const now = new Date()

  // 根据语言格式化日期
  const dateLocale = locale === 'zh-CN' ? 'zh-CN' : 'en-US'
  const currentDate = now.toLocaleDateString(dateLocale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  })

  const chatTypeDesc = content.lockedSection.chatTypeDesc[chatType]
  const chatContext = content.lockedSection.chatContext[chatType]

  // Owner 说明（当用户设置了"我是谁"时）
  const ownerNote = ownerInfo ? content.lockedSection.ownerNoteTemplate(ownerInfo.displayName, chatContext) : ''

  const memberNote = content.lockedSection.memberNote[chatType]
  const year = now.getFullYear()
  const prevYear = year - 1

  return `${content.lockedSection.currentDatePrefix} ${currentDate}。
${ownerNote}
${content.lockedSection.toolsDescription(chatTypeDesc)}

${memberNote}

${content.lockedSection.timeParamsTemplate(year, prevYear)}

${content.lockedSection.conclusion}`
}

/**
 * 构建完整提示词预览（用于前端展示）
 * @param roleDefinition 角色定义
 * @param responseRules 回答要求
 * @param chatType 聊天类型
 * @param ownerInfo Owner 信息（可选）
 * @param locale 语言设置
 */
export function buildPromptPreview(
  roleDefinition: string,
  responseRules: string,
  chatType: 'group' | 'private',
  ownerInfo?: OwnerInfoPreview,
  locale: LocaleType = 'zh-CN'
): string {
  const content = i18nContent[locale] || i18nContent['zh-CN']
  const lockedSection = getLockedPromptSectionPreview(chatType, ownerInfo, locale)

  return `${roleDefinition}

${lockedSection}

${content.lockedSection.responseRulesLabel}
${responseRules}`
}
