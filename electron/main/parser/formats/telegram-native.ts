/**
 * Telegram 官方导出 JSON 格式解析器
 * 适配 Telegram Desktop 的「导出聊天记录」功能
 *
 * 格式特征：
 * - 单个 JSON 文件包含用户所有聊天（contacts, chats 等）
 * - 聊天数据在 chats.list[] 下，每个聊天有独立的 messages 数组
 * - 消息的 text 字段可以是纯字符串或 mixed 数组（含富文本实体）
 * - 支持 personal_chat / private_group / private_supergroup / saved_messages 等类型
 *
 * 导入流程（方案 A：聊天选择器）：
 * 1. 用户选择 telegram.json → 格式识别
 * 2. scanChats() 快速扫描提取聊天列表
 * 3. 用户选择要导入的聊天
 * 4. parser 使用 formatOptions.chatIndex 定位并流式解析选定聊天
 */

import * as fs from 'fs'
import { chain } from 'stream-chain'
import { parser } from 'stream-json'
import { pick } from 'stream-json/filters/Pick'
import { streamValues } from 'stream-json/streamers/StreamValues'

import { KNOWN_PLATFORMS, ChatType, MessageType } from '../../../../src/types/base'
import type {
  FormatFeature,
  FormatModule,
  Parser,
  ParseOptions,
  ParseEvent,
  ParsedMeta,
  ParsedMember,
  ParsedMessage,
} from '../types'
import { getFileSize, createProgress } from '../utils'

// ==================== 类型定义 ====================

/** Telegram 聊天信息（扫描结果） */
export interface TelegramChatInfo {
  /** 在 chats.list[] 中的索引 */
  index: number
  /** 聊天名称 */
  name: string
  /** Telegram 聊天类型 */
  type: string
  /** Telegram 聊天 ID */
  id: number
  /** 消息数量 */
  messageCount: number
}

/** Telegram 消息结构 */
interface TelegramMessage {
  id: number
  type: 'message' | 'service'
  date: string
  date_unixtime: string
  from?: string | null
  from_id?: string
  actor?: string | null
  actor_id?: string
  action?: string
  text: string | Array<string | { type: string; text: string }>
  text_entities?: Array<{ type: string; text: string }>
  reply_to_message_id?: number
  forwarded_from?: string | null
  forwarded_from_id?: string
  photo?: string
  file?: string
  file_name?: string
  media_type?: string
  sticker_emoji?: string
  mime_type?: string
  members?: string[]
}

/** Telegram 聊天结构 */
interface TelegramChat {
  name: string
  type: string
  id: number
  messages: TelegramMessage[]
}

// ==================== 特征定义 ====================

export const feature: FormatFeature = {
  id: 'telegram-native',
  name: 'Telegram 官方导出 (JSON)',
  platform: KNOWN_PLATFORMS.TELEGRAM,
  priority: 22,
  extensions: ['.json'],
  signatures: {
    // Telegram 导出 JSON 的特征
    head: [
      /unlike other apps, Telegram never uses your private data/i,
    ],
    requiredFields: ['chats'],
  },
  multiChat: true,
}

// ==================== 辅助函数 ====================

/**
 * 将 Telegram 聊天类型映射到 ChatLab 聊天类型
 */
function mapChatType(telegramType: string): ChatType {
  switch (telegramType) {
    case 'personal_chat':
    case 'bot_chat':
    case 'saved_messages':
      return ChatType.PRIVATE
    case 'private_group':
    case 'public_group':
    case 'private_supergroup':
    case 'public_supergroup':
    case 'private_channel':
    case 'public_channel':
      return ChatType.GROUP
    default:
      return ChatType.GROUP
  }
}

/**
 * 提取 Telegram text 字段为纯文本
 * text 可以是字符串或 mixed 数组
 */
function extractText(text: string | Array<string | { type: string; text: string }>): string {
  if (typeof text === 'string') return text
  if (!Array.isArray(text)) return ''

  return text
    .map((part) => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object' && 'text' in part) return part.text
      return ''
    })
    .join('')
}

/**
 * 从 from_id 提取平台 ID
 * 格式：user123456 → 123456
 */
function extractPlatformId(fromId: string | undefined): string {
  if (!fromId) return 'unknown'
  // 移除 "user" / "channel" 等前缀，保留数字部分
  return fromId.replace(/^(user|channel)/, '')
}

/**
 * 检测消息类型
 */
function detectMessageType(msg: TelegramMessage): MessageType {
  // Service 消息 → 系统消息
  if (msg.type === 'service') return MessageType.SYSTEM

  // 贴纸
  if (msg.media_type === 'sticker') return MessageType.IMAGE
  // 图片
  if (msg.photo) return MessageType.IMAGE
  // 动画 (GIF)
  if (msg.media_type === 'animation') return MessageType.IMAGE
  // 视频
  if (msg.media_type === 'video_file') return MessageType.VIDEO
  // 语音
  if (msg.media_type === 'voice_message') return MessageType.VOICE
  // 视频留言
  if (msg.media_type === 'video_message') return MessageType.VIDEO
  // 文件
  if (msg.file && !msg.media_type) return MessageType.FILE

  // 默认文本
  return MessageType.TEXT
}

/**
 * 构建消息内容
 */
function buildContent(msg: TelegramMessage): string | null {
  const text = extractText(msg.text)

  // Service 消息
  if (msg.type === 'service') {
    const action = msg.action || ''
    const members = msg.members?.join(', ') || ''
    if (members) return `[${action}] ${members}`
    return `[${action}]` || text || null
  }

  // 贴纸：使用 emoji 表示
  if (msg.media_type === 'sticker' && msg.sticker_emoji) {
    return text ? `[sticker ${msg.sticker_emoji}] ${text}` : `[sticker ${msg.sticker_emoji}]`
  }

  // 媒体消息带文字说明
  if (msg.photo || msg.file || msg.media_type) {
    const mediaLabel = msg.media_type || (msg.photo ? 'photo' : 'file')
    if (text) return `[${mediaLabel}] ${text}`
    return `[${mediaLabel}]`
  }

  return text || null
}

// ==================== 扫描函数 ====================

/**
 * 快速扫描 Telegram 导出 JSON，提取聊天列表
 * 使用 stream-json 流式处理，避免全量加载大文件到内存
 *
 * @param filePath 文件路径
 * @returns 聊天列表信息
 */
export async function scanChats(filePath: string): Promise<TelegramChatInfo[]> {
  const chats: TelegramChatInfo[] = []

  return new Promise<TelegramChatInfo[]>((resolve, reject) => {
    const readStream = fs.createReadStream(filePath, { encoding: 'utf-8' })

    // 使用 stream-json 解析 chats.list 数组中的每个聊天对象
    // ignore 过滤掉 messages 的实际内容以加速扫描
    const pipeline = chain([
      readStream,
      parser(),
      pick({ filter: /^chats\.list\.\d+$/ }),
      streamValues(),
    ])

    pipeline.on('data', ({ value }: { value: TelegramChat }) => {
      const chat = value
      chats.push({
        index: chats.length,
        name: chat.name || `Chat ${chat.id}`,
        type: chat.type,
        id: chat.id,
        messageCount: Array.isArray(chat.messages) ? chat.messages.length : 0,
      })
    })

    pipeline.on('end', () => {
      resolve(chats)
    })

    pipeline.on('error', (err: Error) => {
      reject(new Error(`扫描 Telegram 文件失败: ${err.message}`))
    })
  })
}

// ==================== 解析器实现 ====================

async function* parseTelegram(options: ParseOptions): AsyncGenerator<ParseEvent, void, unknown> {
  const { filePath, batchSize = 5000, formatOptions, onProgress, onLog } = options

  // 获取目标聊天索引
  const chatIndex = (formatOptions?.chatIndex as number) ?? 0

  const totalBytes = getFileSize(filePath)
  let bytesRead = 0
  let messagesProcessed = 0

  // 发送初始进度
  const initialProgress = createProgress('parsing', 0, totalBytes, 0, '')
  yield { type: 'progress', data: initialProgress }
  onProgress?.(initialProgress)

  onLog?.('info', `开始解析 Telegram JSON 文件，大小: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`)
  onLog?.('info', `目标聊天索引: ${chatIndex}`)

  // 使用 stream-json 流式解析目标聊天
  // 定位到 chats.list[chatIndex] 对象
  const chatPathFilter = `chats.list.${chatIndex}`

  const chatData = await new Promise<TelegramChat | null>((resolve, reject) => {
    const readStream = fs.createReadStream(filePath, { encoding: 'utf-8' })

    readStream.on('data', (chunk: string | Buffer) => {
      bytesRead += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
    })

    const pipeline = chain([
      readStream,
      parser(),
      pick({ filter: new RegExp(`^${chatPathFilter.replace('.', '\\.')}$`) }),
      streamValues(),
    ])

    let found = false

    pipeline.on('data', ({ value }: { value: TelegramChat }) => {
      found = true
      resolve(value)
    })

    pipeline.on('end', () => {
      if (!found) resolve(null)
    })

    pipeline.on('error', reject)
  })

  if (!chatData) {
    onLog?.('error', `未找到索引 ${chatIndex} 对应的聊天`)
    yield { type: 'error', data: new Error(`未找到索引 ${chatIndex} 对应的聊天`) }
    return
  }

  onLog?.('info', `找到聊天: "${chatData.name}", 类型: ${chatData.type}, 消息数: ${chatData.messages?.length || 0}`)

  // 确定聊天类型
  const chatType = mapChatType(chatData.type)

  // 发送 meta
  const meta: ParsedMeta = {
    name: chatData.name || `Telegram Chat ${chatData.id}`,
    platform: KNOWN_PLATFORMS.TELEGRAM,
    type: chatType,
    groupId: chatType === ChatType.GROUP ? String(chatData.id) : undefined,
  }
  yield { type: 'meta', data: meta }

  // 收集成员和消息
  const memberMap = new Map<string, ParsedMember>()
  const messageBatch: ParsedMessage[] = []
  const messages = chatData.messages || []

  for (const msg of messages) {
    // 提取发送者信息
    let senderPlatformId: string
    let senderName: string

    if (msg.type === 'service') {
      // Service 消息使用 actor 信息
      senderPlatformId = extractPlatformId(msg.actor_id)
      senderName = msg.actor || '系统'
    } else {
      senderPlatformId = extractPlatformId(msg.from_id)
      senderName = msg.from || senderPlatformId
    }

    // 更新成员
    if (!memberMap.has(senderPlatformId) && senderPlatformId !== 'unknown') {
      memberMap.set(senderPlatformId, {
        platformId: senderPlatformId,
        accountName: senderName,
      })
    }

    // 解析时间戳
    const timestamp = parseInt(msg.date_unixtime, 10)
    if (isNaN(timestamp)) continue

    // 构建消息
    const parsedMsg: ParsedMessage = {
      platformMessageId: String(msg.id),
      senderPlatformId,
      senderAccountName: senderName,
      timestamp,
      type: detectMessageType(msg),
      content: buildContent(msg),
      replyToMessageId: msg.reply_to_message_id ? String(msg.reply_to_message_id) : undefined,
    }

    messageBatch.push(parsedMsg)
    messagesProcessed++

    // 分批 yield 消息
    if (messageBatch.length >= batchSize) {
      yield { type: 'messages', data: [...messageBatch] }
      messageBatch.length = 0

      const progress = createProgress(
        'parsing',
        bytesRead,
        totalBytes,
        messagesProcessed,
        `已处理 ${messagesProcessed} 条消息...`
      )
      yield { type: 'progress', data: progress }
      onProgress?.(progress)
    }
  }

  // 发送成员
  yield { type: 'members', data: Array.from(memberMap.values()) }

  // 发送剩余消息
  if (messageBatch.length > 0) {
    yield { type: 'messages', data: messageBatch }
  }

  // 完成
  const doneProgress = createProgress('done', totalBytes, totalBytes, messagesProcessed, '')
  yield { type: 'progress', data: doneProgress }
  onProgress?.(doneProgress)

  onLog?.('info', `解析完成: ${messagesProcessed} 条消息, ${memberMap.size} 个成员, 类型: ${chatType}`)

  yield {
    type: 'done',
    data: { messageCount: messagesProcessed, memberCount: memberMap.size },
  }
}

// ==================== 导出 ====================

export const parser_: Parser = {
  feature,
  parse: parseTelegram,
}

const module_: FormatModule = {
  feature,
  parser: parser_,
  scanChats,
}

export default module_
