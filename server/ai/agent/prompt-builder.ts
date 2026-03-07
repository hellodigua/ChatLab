/**
 * Agent system prompt builder (server-side)
 * Ported from electron/main/ai/agent/prompt-builder.ts — no Electron/i18n imports.
 * Inline bilingual strings replace i18nT calls.
 */

import type { OwnerInfo } from '../tools/types.js'
import type { PromptConfig } from './types.js'

// ==================== i18n inline helpers ====================

const texts = {
  answerWithoutTools: {
    'zh-CN': '请根据已获取的信息给出回答，不要再调用工具。',
    en: 'Please answer based on the information already retrieved, do not call any more tools.',
  },
  currentDateIs: { 'zh-CN': '当前日期是', en: 'Current date is' },
  chatContext: {
    private: { 'zh-CN': '对话', en: 'conversation' },
    group: { 'zh-CN': '群聊', en: 'group chat' },
  },
  ownerNote: {
    'zh-CN': (displayName: string, platformId: string, chatContext: string) =>
      `当前用户身份：\n- 用户在${chatContext}中的身份是「${displayName}」（platformId: ${platformId}）\n- 当用户提到"我"、"我的"时，指的就是「${displayName}」\n- 查询"我"的发言时，使用 sender_id 参数筛选该成员\n`,
    en: (displayName: string, platformId: string, chatContext: string) =>
      `Current user identity:\n- The user's identity in this ${chatContext} is "${displayName}" (platformId: ${platformId})\n- When the user refers to "I" or "my", it refers to "${displayName}"\n- When querying "my" messages, use the sender_id parameter to filter for this member\n`,
  },
  memberNotePrivate: {
    'zh-CN': `成员查询策略：\n- 私聊只有两个人，可以直接获取成员列表\n- 当用户提到"对方"、"他/她"时，通过 get_group_members 获取另一方信息\n`,
    en: `Member query strategy:\n- Private chats only have two participants, so the member list can be directly obtained\n- When the user refers to "the other party" or "he/she", get the other participant's information via get_group_members\n`,
  },
  memberNoteGroup: {
    'zh-CN': `成员查询策略：\n- 当用户提到特定群成员（如"张三说过什么"、"小明的发言"等）时，应先调用 get_group_members 获取成员列表\n- 群成员有三种名称：accountName（原始昵称）、groupNickname（群昵称）、aliases（用户自定义别名）\n- 通过 get_group_members 的 search 参数可以模糊搜索这三种名称\n- 找到成员后，使用其 id 字段作为 search_messages 的 sender_id 参数来获取该成员的发言\n`,
    en: `Member query strategy:\n- When the user refers to specific group members (e.g., "what did John say", "Mary's messages"), first call get_group_members to get the member list\n- Group members have three names: accountName (original nickname), groupNickname (group nickname), aliases (user-defined aliases)\n- The search parameter of get_group_members can be used for fuzzy searching these three names\n- Once a member is found, use their id field as the sender_id parameter for search_messages to retrieve their messages\n`,
  },
  timeParamsIntro: {
    'zh-CN': '时间参数：按用户提到的精度组合 year/month/day/hour',
    en: 'Time parameters: combine year/month/day/hour based on user mention',
  },
  timeParamExample1: {
    'zh-CN': (year: number) => `"10月" → year: ${year}, month: 10`,
    en: (year: number) => `"October" → year: ${year}, month: 10`,
  },
  timeParamExample2: {
    'zh-CN': (year: number) => `"10月1号" → year: ${year}, month: 10, day: 1`,
    en: (year: number) => `"October 1st" → year: ${year}, month: 10, day: 1`,
  },
  timeParamExample3: {
    'zh-CN': (year: number) => `"10月1号下午3点" → year: ${year}, month: 10, day: 1, hour: 15`,
    en: (year: number) => `"October 1st 3 PM" → year: ${year}, month: 10, day: 1, hour: 15`,
  },
  defaultYearNote: {
    'zh-CN': (year: number, prevYear: number) => `未指定年份默认${year}年，若该月份未到则用${prevYear}年`,
    en: (year: number, prevYear: number) =>
      `If year is not specified, defaults to ${year}. If the month has not yet occurred, ${prevYear} is used.`,
  },
  responseInstruction: {
    'zh-CN': '根据用户的问题，选择合适的工具获取数据，然后基于数据给出回答。',
    en: "Based on the user's question, select appropriate tools to retrieve data, then provide an answer based on the data.",
  },
  responseRulesTitle: { 'zh-CN': '回答要求：', en: 'Response requirements:' },
  fallbackRoleDefinition: {
    group: {
      'zh-CN': `你是一个专业但风格轻松的群聊记录分析助手。\n你的任务是帮助用户理解和分析他们的群聊记录数据，同时可以适度使用 B 站/网络热梗和表情/颜文字活跃气氛，但不影响结论的准确性。`,
      en: `You are a professional group chat analysis assistant.\nYour task is to help users understand and analyze their group chat data.`,
    },
    private: {
      'zh-CN': `你是一个专业但风格轻松的私聊记录分析助手。\n你的任务是帮助用户理解和分析他们的私聊记录数据，同时可以适度使用 B 站/网络热梗和表情/颜文字活跃气氛，但不影响结论的准确性。`,
      en: `You are a professional private chat analysis assistant.\nYour task is to help users understand and analyze their private chat data.`,
    },
  },
  fallbackResponseRules: {
    'zh-CN': `1. 基于工具返回的数据回答，不要编造信息\n2. 如果数据不足以回答问题，请说明\n3. 回答要简洁明了，使用 Markdown 格式\n4. 可以适度加入 B 站/网络热梗、表情/颜文字（强度适中）\n5. 玩梗不得影响事实准确与结论清晰，避免低俗或冒犯性表达`,
    en: `1. Answer based on data returned by tools, do not fabricate information\n2. If data is insufficient to answer, please state so\n3. Keep answers concise and clear, use Markdown format`,
  },
}

type Locale = 'zh-CN' | string

function isZhCN(locale: Locale): boolean {
  return locale.startsWith('zh')
}

function pick(obj: { 'zh-CN': string; en: string }, locale: Locale): string {
  return isZhCN(locale) ? obj['zh-CN'] : obj.en
}

// ==================== Prompt construction ====================

function getLockedPromptSection(
  chatType: 'group' | 'private',
  ownerInfo?: OwnerInfo,
  locale: Locale = 'zh-CN',
): string {
  const now = new Date()
  const dateLocale = isZhCN(locale) ? 'zh-CN' : 'en-US'
  const currentDate = now.toLocaleDateString(dateLocale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  })

  const chatContext = pick(texts.chatContext[chatType], locale)

  const ownerNote = ownerInfo
    ? (isZhCN(locale) ? texts.ownerNote['zh-CN'] : texts.ownerNote.en)(
        ownerInfo.displayName,
        ownerInfo.platformId,
        chatContext,
      )
    : ''

  const memberNote = chatType === 'private' ? pick(texts.memberNotePrivate, locale) : pick(texts.memberNoteGroup, locale)

  const year = now.getFullYear()
  const prevYear = year - 1

  const ex1 = isZhCN(locale) ? texts.timeParamExample1['zh-CN'](year) : texts.timeParamExample1.en(year)
  const ex2 = isZhCN(locale) ? texts.timeParamExample2['zh-CN'](year) : texts.timeParamExample2.en(year)
  const ex3 = isZhCN(locale) ? texts.timeParamExample3['zh-CN'](year) : texts.timeParamExample3.en(year)
  const defaultYear = isZhCN(locale)
    ? texts.defaultYearNote['zh-CN'](year, prevYear)
    : texts.defaultYearNote.en(year, prevYear)

  return `${pick(texts.currentDateIs, locale)} ${currentDate}。
${ownerNote}
${memberNote}
${pick(texts.timeParamsIntro, locale)}
- ${ex1}
- ${ex2}
- ${ex3}
${defaultYear}

${pick(texts.responseInstruction, locale)}`
}

function getFallbackRoleDefinition(chatType: 'group' | 'private', locale: Locale = 'zh-CN'): string {
  return pick(texts.fallbackRoleDefinition[chatType], locale)
}

function getFallbackResponseRules(locale: Locale = 'zh-CN'): string {
  return pick(texts.fallbackResponseRules, locale)
}

/**
 * Build the complete system prompt.
 */
export function buildSystemPrompt(
  chatType: 'group' | 'private' = 'group',
  promptConfig?: PromptConfig,
  ownerInfo?: OwnerInfo,
  locale: Locale = 'zh-CN',
): string {
  const roleDefinition = promptConfig?.roleDefinition || getFallbackRoleDefinition(chatType, locale)
  const responseRules = promptConfig?.responseRules || getFallbackResponseRules(locale)
  const lockedSection = getLockedPromptSection(chatType, ownerInfo, locale)

  return `${roleDefinition}

${lockedSection}

${pick(texts.responseRulesTitle, locale)}
${responseRules}`
}

/**
 * Get the "answer without tools" prompt text.
 */
export function getAnswerWithoutToolsPrompt(locale: Locale = 'zh-CN'): string {
  return pick(texts.answerWithoutTools, locale)
}
