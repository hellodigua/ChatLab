/**
 * Session summary generation service (server-side)
 * Ported from electron/main/ai/summary/index.ts — no Electron/i18n imports.
 *
 * Uses LLM to generate summaries for chat sessions.
 * - Smart preprocessing: filters meaningless content
 * - Adjusts summary length based on message count
 * - Map-Reduce strategy for long sessions
 */

import Database from 'better-sqlite3'
import { completeSimple, type TextContent as PiTextContent } from '@mariozechner/pi-ai'
import { getActiveConfig, buildPiModel } from '../llm/index.js'
import { getDbPath } from '../../services/db-pool.js'
import { openReadonlyDatabase } from '../../services/db-pool.js'
import { aiLogger } from '../logger.js'

// ==================== i18n inline strings ====================

const i18n = {
  'zh-CN': {
    notConfigured: 'LLM 服务未配置',
    sessionNotFound: '未找到指定的会话',
    tooFewMessages: (count: number) => `消息数少于${count}条，无法生成摘要`,
    tooFewValidMessages: (count: number) => `有效消息少于${count}条，无法生成摘要`,
    sessionNotExist: '会话不存在',
    messagesTooFew: '消息太少',
    validMessagesTooFew: '有效消息太少',
    systemPromptDirect: '你是一个简洁高效的文本摘要助手。',
    systemPromptMerge: '你是一个文本合并摘要助手。',
  },
  en: {
    notConfigured: 'LLM service not configured',
    sessionNotFound: 'Session not found',
    tooFewMessages: (count: number) => `Less than ${count} messages, cannot generate summary`,
    tooFewValidMessages: (count: number) => `Less than ${count} valid messages, cannot generate summary`,
    sessionNotExist: 'Session does not exist',
    messagesTooFew: 'Too few messages',
    validMessagesTooFew: 'Too few valid messages',
    systemPromptDirect: 'You are a concise and efficient text summarization assistant.',
    systemPromptMerge: 'You are a text merge summarization assistant.',
  },
}

function t(key: keyof (typeof i18n)['en'], locale = 'zh-CN'): string | ((count: number) => string) {
  const lang = locale.startsWith('zh') ? 'zh-CN' : 'en'
  return i18n[lang][key]
}

// ==================== LLM helper ====================

async function llmComplete(
  systemPrompt: string,
  userPrompt: string,
  options?: { temperature?: number; maxTokens?: number },
): Promise<string> {
  const activeConfig = getActiveConfig()
  if (!activeConfig) {
    throw new Error(t('notConfigured') as string)
  }

  const piModel = buildPiModel(activeConfig)
  const now = Date.now()

  const result = await completeSimple(
    piModel,
    {
      systemPrompt,
      messages: [{ role: 'user', content: userPrompt, timestamp: now }],
    },
    {
      apiKey: activeConfig.apiKey,
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
    },
  )

  return result.content
    .filter((item): item is PiTextContent => item.type === 'text')
    .map((item) => item.text)
    .join('')
}

const MIN_MESSAGE_COUNT = 3
const MAX_CONTENT_PER_CALL = 8000
const SEGMENT_THRESHOLD = 8000

// ==================== DB operations ====================

interface SessionMessagesResult {
  messageCount: number
  messages: Array<{ senderName: string; content: string | null }>
}

function getSessionMessagesForSummary(
  dbSessionId: string,
  chatSessionId: number,
  limit: number = 500,
): SessionMessagesResult | null {
  const db = openReadonlyDatabase(dbSessionId)
  if (!db) {
    aiLogger.error('Summary', `Failed to open database: ${dbSessionId}`)
    return null
  }

  try {
    const messagesSql = `
      SELECT
        COALESCE(mb.group_nickname, mb.account_name, mb.platform_id) as senderName,
        m.content
      FROM message_context mc
      JOIN message m ON m.id = mc.message_id
      JOIN member mb ON mb.id = m.sender_id
      WHERE mc.session_id = ?
      ORDER BY m.ts ASC
      LIMIT ?
    `
    const messages = db.prepare(messagesSql).all(chatSessionId, limit) as Array<{
      senderName: string
      content: string | null
    }>

    return { messageCount: messages.length, messages }
  } catch (error) {
    aiLogger.error('Summary', `Failed to get session messages: ${error}`)
    return null
  } finally {
    db.close()
  }
}

function saveSessionSummaryToDb(dbSessionId: string, chatSessionId: number, summary: string): void {
  const dbPath = getDbPath(dbSessionId)
  const db = new Database(dbPath)
  try {
    db.prepare('UPDATE chat_session SET summary = ? WHERE id = ?').run(summary, chatSessionId)
  } finally {
    db.close()
  }
}

function getSessionSummaryFromDb(dbSessionId: string, chatSessionId: number): string | null {
  const db = openReadonlyDatabase(dbSessionId)
  if (!db) return null
  try {
    const result = db.prepare('SELECT summary FROM chat_session WHERE id = ?').get(chatSessionId) as
      | { summary: string | null }
      | undefined
    return result?.summary || null
  } catch {
    return null
  } finally {
    db.close()
  }
}

// ==================== Helpers ====================

function getSummaryLengthLimit(messageCount: number): number {
  if (messageCount <= 10) return 50
  if (messageCount <= 30) return 80
  if (messageCount <= 100) return 120
  return 200
}

function isValidMessage(content: string): boolean {
  const trimmed = content.trim()
  if (!trimmed) return false

  if (trimmed.length <= 2) {
    const meaningfulShortZh = ['好的', '不是', '是的', '可以', '不行', '好吧', '明白', '知道', '同意']
    if (!meaningfulShortZh.includes(trimmed)) return false
  }

  const lowerTrimmed = trimmed.toLowerCase()
  const meaninglessShortEn = [
    'ok', 'k', 'yes', 'no', 'ya', 'yep', 'nope', 'lol', 'haha', 'hehe', 'hmm',
    'ah', 'oh', 'wow', 'thx', 'ty', 'np', 'gg', 'brb', 'idk',
  ]
  if (meaninglessShortEn.includes(lowerTrimmed)) return false

  const emojiOnlyPattern = /^[\p{Emoji}\s[\]（）()]+$/u
  if (emojiOnlyPattern.test(trimmed)) return false

  const placeholders = [
    '[图片]', '[语音]', '[视频]', '[文件]', '[表情]', '[动画表情]', '[位置]', '[名片]',
    '[红包]', '[转账]', '[撤回消息]',
    '[image]', '[voice]', '[video]', '[file]', '[sticker]', '[animated sticker]',
    '[location]', '[contact]', '[red packet]', '[transfer]', '[recalled message]',
    '[photo]', '[audio]', '[gif]',
  ]
  if (placeholders.some((p) => lowerTrimmed === p.toLowerCase())) return false

  const systemPatternsZh = [/^.*邀请.*加入了群聊$/, /^.*退出了群聊$/, /^.*撤回了一条消息$/, /^你撤回了一条消息$/]
  if (systemPatternsZh.some((p) => p.test(trimmed))) return false

  const systemPatternsEn = [
    /^.*invited.*to the group$/i, /^.*left the group$/i,
    /^.*recalled a message$/i, /^you recalled a message$/i,
    /^.*joined the group$/i, /^.*has been removed$/i,
  ]
  if (systemPatternsEn.some((p) => p.test(trimmed))) return false

  return true
}

function preprocessSummaryMessages(
  messages: Array<{ senderName: string; content: string | null }>,
): Array<{ senderName: string; content: string }> {
  return messages
    .filter((m) => m.content && isValidMessage(m.content))
    .map((m) => ({ senderName: m.senderName, content: m.content!.trim() }))
}

function formatMessages(messages: Array<{ senderName: string; content: string }>): string {
  return messages.map((m) => `${m.senderName}: ${m.content}`).join('\n')
}

function splitIntoSegments(
  messages: Array<{ senderName: string; content: string }>,
  maxCharsPerSegment: number,
): Array<Array<{ senderName: string; content: string }>> {
  const segments: Array<Array<{ senderName: string; content: string }>> = []
  let currentSegment: Array<{ senderName: string; content: string }> = []
  let currentLength = 0

  for (const msg of messages) {
    const msgLength = msg.senderName.length + msg.content.length + 3
    if (currentLength + msgLength > maxCharsPerSegment && currentSegment.length > 0) {
      segments.push(currentSegment)
      currentSegment = []
      currentLength = 0
    }
    currentSegment.push(msg)
    currentLength += msgLength
  }

  if (currentSegment.length > 0) {
    segments.push(currentSegment)
  }

  return segments
}

function buildSummaryPrompt(content: string, lengthLimit: number, locale: string): string {
  if (locale.startsWith('zh')) {
    return `请用简洁的语言（${lengthLimit}字以内）总结以下对话的主要内容或话题。只输出摘要内容，不要添加任何前缀、解释或引号。\n\n${content}`
  }
  return `Summarize the following conversation concisely (max ${lengthLimit} characters). Output only the summary, no prefix, explanation, or quotes.\n\n${content}`
}

function buildSubSummaryPrompt(content: string, locale: string): string {
  if (locale.startsWith('zh')) {
    return `请用一句话（不超过50字）概括以下对话片段的主要内容。只输出摘要内容，不要添加任何前缀、解释或引号。\n\n${content}`
  }
  return `Summarize this conversation segment in one sentence (max 50 characters). Output only the summary, no prefix or quotes.\n\n${content}`
}

function buildMergePrompt(subSummaries: string[], lengthLimit: number, locale: string): string {
  const summaryList = subSummaries.map((s, i) => `${i + 1}. ${s}`).join('\n')
  if (locale.startsWith('zh')) {
    return `以下是一段对话的多个片段摘要，请将它们合并成一个完整的总结（${lengthLimit}字以内）。只输出摘要内容，不要添加任何前缀、解释或引号。\n\n${summaryList}`
  }
  return `Below are summaries of different parts of a conversation. Merge them into one cohesive summary (max ${lengthLimit} characters). Output only the summary, no prefix or quotes.\n\n${summaryList}`
}

// ==================== Main functions ====================

export async function generateSessionSummary(
  dbSessionId: string,
  chatSessionId: number,
  locale: string = 'zh-CN',
  forceRegenerate: boolean = false,
): Promise<{ success: boolean; summary?: string; error?: string }> {
  try {
    if (!forceRegenerate) {
      const existing = getSessionSummaryFromDb(dbSessionId, chatSessionId)
      if (existing) {
        return { success: true, summary: existing }
      }
    }

    const sessionData = getSessionMessagesForSummary(dbSessionId, chatSessionId)
    if (!sessionData) {
      return { success: false, error: t('sessionNotFound', locale) as string }
    }

    if (sessionData.messageCount < MIN_MESSAGE_COUNT) {
      const fn = t('tooFewMessages', locale) as (n: number) => string
      return { success: false, error: fn(MIN_MESSAGE_COUNT) }
    }

    const validMessages = preprocessSummaryMessages(sessionData.messages)
    if (validMessages.length < MIN_MESSAGE_COUNT) {
      const fn = t('tooFewValidMessages', locale) as (n: number) => string
      return { success: false, error: fn(MIN_MESSAGE_COUNT) }
    }

    const lengthLimit = getSummaryLengthLimit(validMessages.length)
    const content = formatMessages(validMessages)

    aiLogger.info(
      'Summary',
      `Generating session summary: sessionId=${chatSessionId}, raw=${sessionData.messageCount}, valid=${validMessages.length}, len=${content.length}`,
    )

    let summary: string

    if (content.length <= SEGMENT_THRESHOLD) {
      summary = await generateDirectSummary(content, lengthLimit, locale)
    } else {
      summary = await generateMapReduceSummary(validMessages, lengthLimit, locale)
    }

    if ((summary.startsWith('"') && summary.endsWith('"')) || (summary.startsWith('「') && summary.endsWith('」'))) {
      summary = summary.slice(1, -1)
    }

    const hardLimit = Math.floor(lengthLimit * 1.5)
    if (summary.length > hardLimit) {
      summary = summary.slice(0, hardLimit - 3) + '...'
    }

    saveSessionSummaryToDb(dbSessionId, chatSessionId, summary)
    aiLogger.info('Summary', `Summary generated: "${summary.slice(0, 50)}..."`)

    return { success: true, summary }
  } catch (error) {
    aiLogger.error('Summary', 'Summary generation failed', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function generateDirectSummary(content: string, lengthLimit: number, locale: string): Promise<string> {
  const systemPrompt = t('systemPromptDirect', locale) as string
  const result = await llmComplete(systemPrompt, buildSummaryPrompt(content, lengthLimit, locale), {
    temperature: 0.3,
    maxTokens: 300,
  })
  return result.trim()
}

async function generateMapReduceSummary(
  messages: Array<{ senderName: string; content: string }>,
  lengthLimit: number,
  locale: string,
): Promise<string> {
  const segments = splitIntoSegments(messages, MAX_CONTENT_PER_CALL)
  aiLogger.info('Summary', `Long session segmented: ${segments.length} segments`)

  const systemPrompt = t('systemPromptDirect', locale) as string
  const subSummaries: string[] = []

  for (const segment of segments) {
    const segmentContent = formatMessages(segment)
    const result = await llmComplete(systemPrompt, buildSubSummaryPrompt(segmentContent, locale), {
      temperature: 0.3,
      maxTokens: 100,
    })
    subSummaries.push(result.trim())
  }

  if (subSummaries.length === 1) {
    return subSummaries[0]
  }

  const mergeSystemPrompt = t('systemPromptMerge', locale) as string
  const mergeResult = await llmComplete(
    mergeSystemPrompt,
    buildMergePrompt(subSummaries, lengthLimit, locale),
    { temperature: 0.3, maxTokens: 300 },
  )

  return mergeResult.trim()
}

export async function generateSessionSummaries(
  dbSessionId: string,
  chatSessionIds: number[],
  locale: string = 'zh-CN',
  onProgress?: (current: number, total: number) => void,
): Promise<{ success: number; failed: number; skipped: number }> {
  let success = 0
  let failed = 0
  let skipped = 0

  for (let i = 0; i < chatSessionIds.length; i++) {
    const chatSessionId = chatSessionIds[i]
    const result = await generateSessionSummary(dbSessionId, chatSessionId, locale, false)

    if (result.success) {
      success++
    } else if (result.error?.includes('少于') || result.error?.includes('less than') || result.error?.includes('few')) {
      skipped++
    } else {
      failed++
    }

    if (onProgress) {
      onProgress(i + 1, chatSessionIds.length)
    }
  }

  return { success, failed, skipped }
}

export function checkSessionsCanGenerateSummary(
  dbSessionId: string,
  chatSessionIds: number[],
): Map<number, { canGenerate: boolean; reason?: string }> {
  const results = new Map<number, { canGenerate: boolean; reason?: string }>()

  for (const chatSessionId of chatSessionIds) {
    const sessionData = getSessionMessagesForSummary(dbSessionId, chatSessionId)

    if (!sessionData) {
      results.set(chatSessionId, { canGenerate: false, reason: t('sessionNotExist') as string })
      continue
    }

    if (sessionData.messageCount < MIN_MESSAGE_COUNT) {
      results.set(chatSessionId, { canGenerate: false, reason: t('messagesTooFew') as string })
      continue
    }

    const validMessages = preprocessSummaryMessages(sessionData.messages)
    if (validMessages.length < MIN_MESSAGE_COUNT) {
      results.set(chatSessionId, { canGenerate: false, reason: t('validMessagesTooFew') as string })
      continue
    }

    results.set(chatSessionId, { canGenerate: true })
  }

  return results
}
