/**
 * LINE 官方导出 TXT 格式解析器
 * 支持私聊和群聊，支持英文/中文/日文等多语言导出
 *
 * 特征：
 * - 私聊：有头部（标题+保存时间），消息用 Tab 分隔
 * - 群聊：无头部，直接日期行开始，消息用空格分隔
 * - 时间格式：HH:MM（无秒数）
 * - 日期行独立，包含年月日
 */

import * as fs from 'fs'
import * as path from 'path'
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

// ==================== 特征定义 ====================

export const feature: FormatFeature = {
  id: 'line-native-txt',
  name: 'LINE 官方导出 TXT',
  platform: KNOWN_PLATFORMS.LINE,
  priority: 35, // 在 QQ 官方导出之后
  extensions: ['.txt'],
  signatures: {
    head: [
      // 私聊：Tab 分隔的消息格式
      /^\d{1,2}:\d{2}\t[^\t\n]+\t/m,
      // 群聊：日期行格式 (YYYY.MM.DD)
      /^\d{4}\.\d{2}\.\d{2} (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/m,
      // 私聊头部关键词（多语言）
      /^(Chat history with |\[LINE\] )/m,
    ],
  },
}

// ==================== 辅助函数 ====================

/**
 * 从文件名提取聊天名称
 */
function extractNameFromFilePath(filePath: string): string {
  const basename = path.basename(filePath, '.txt')
  // 移除 [LINE] 前缀
  const name = basename.replace(/^\[LINE\]\s*/i, '').trim()
  return name || '未知聊天'
}

/**
 * 从私聊头部提取对方名称
 */
function extractNameFromHeader(header: string): string | null {
  // 英文：Chat history with {name}
  const enMatch = header.match(/^Chat history with (.+)$/m)
  if (enMatch) return enMatch[1].trim()

  // 中文：[LINE] 与{name}的对话
  const zhMatch = header.match(/^\[LINE\] 与(.+)的对话$/m)
  if (zhMatch) return zhMatch[1].trim()

  // 日文：[LINE] {name}とのトーク履歴
  const jaMatch = header.match(/^\[LINE\] (.+)とのトーク/)
  if (jaMatch) return jaMatch[1].trim()

  return null
}

/**
 * 日期行正则模式
 */
const DATE_PATTERNS = [
  // 2025.12.10 Wednesday
  /^(\d{4})\.(\d{2})\.(\d{2})\s+(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)?/,
  // 2026/1/30周五 or 2026/1/30(金)
  /^(\d{4})\/(\d{1,2})\/(\d{1,2})/,
  // Fri, 1/30/2026
  /^[A-Za-z]+,\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/,
]

/**
 * 尝试解析日期行
 */
function parseDateLine(line: string): Date | null {
  for (const pattern of DATE_PATTERNS) {
    const match = line.match(pattern)
    if (match) {
      // 根据不同格式提取年月日
      if (pattern === DATE_PATTERNS[0] || pattern === DATE_PATTERNS[1]) {
        // YYYY.MM.DD or YYYY/M/D
        const year = parseInt(match[1])
        const month = parseInt(match[2]) - 1
        const day = parseInt(match[3])
        return new Date(year, month, day)
      } else if (pattern === DATE_PATTERNS[2]) {
        // M/D/YYYY
        const month = parseInt(match[1]) - 1
        const day = parseInt(match[2])
        const year = parseInt(match[3])
        return new Date(year, month, day)
      }
    }
  }
  return null
}

/**
 * 消息行正则模式
 */
// 私聊：HH:MM\t{name}\t{content}
const PRIVATE_MSG_PATTERN = /^(\d{1,2}:\d{2})\t([^\t]+)\t(.*)$/
// 群聊：HH:MM {name} {content}
const GROUP_MSG_PATTERN = /^(\d{1,2}:\d{2}) ([^\s]+) (.*)$/

/**
 * 特殊消息类型映射（多语言）
 */
const SPECIAL_MESSAGE_TYPES: Record<string, MessageType> = {
  // 图片
  '[Photo]': MessageType.IMAGE,
  '[照片]': MessageType.IMAGE,
  '[写真]': MessageType.IMAGE,
  Photos: MessageType.IMAGE,

  // 语音
  '[Voice message]': MessageType.VOICE,
  '[语音信息]': MessageType.VOICE,
  '[ボイスメッセージ]': MessageType.VOICE,
  Audio: MessageType.VOICE,

  // 视频
  Videos: MessageType.VIDEO,
  '[Video]': MessageType.VIDEO,
  '[视频]': MessageType.VIDEO,
  '[動画]': MessageType.VIDEO,

  // 文件
  '[File]': MessageType.FILE,
  '[文件]': MessageType.FILE,
  '[ファイル]': MessageType.FILE,

  // 贴纸/表情
  Stickers: MessageType.EMOJI,
  '[Sticker]': MessageType.EMOJI,
  '[贴图]': MessageType.EMOJI,
  '[スタンプ]': MessageType.EMOJI,

  // 位置
  '[Location]': MessageType.LOCATION,
  '[位置]': MessageType.LOCATION,
  '[位置情報]': MessageType.LOCATION,
}

/**
 * 检测消息类型
 */
function detectMessageType(content: string): MessageType {
  // 检查特殊消息类型
  for (const [pattern, type] of Object.entries(SPECIAL_MESSAGE_TYPES)) {
    if (content === pattern || content.startsWith(pattern)) {
      return type
    }
  }

  // 检查 [null] 开头的位置消息
  if (content.startsWith('[null]') && content.includes('maps.google.com')) {
    return MessageType.LOCATION
  }

  // 检查系统消息
  if (
    content.includes(' added ') ||
    content.includes(' to the group') ||
    content.includes('unsent a message') ||
    content === 'Message unsent.' ||
    content.startsWith('Auto-reply')
  ) {
    return MessageType.SYSTEM
  }

  // 检查链接
  if (content.match(/^https?:\/\//)) {
    return MessageType.LINK
  }

  return MessageType.TEXT
}

// ==================== 解析器实现 ====================

async function* parseLINE(options: ParseOptions): AsyncGenerator<ParseEvent, void, unknown> {
  const { filePath, batchSize = 5000, onProgress, onLog } = options

  const totalBytes = getFileSize(filePath)
  let messagesProcessed = 0

  // 发送初始进度
  const initialProgress = createProgress('parsing', 0, totalBytes, 0, '')
  yield { type: 'progress', data: initialProgress }
  onProgress?.(initialProgress)

  onLog?.('info', `开始解析 LINE 导出文件，大小: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`)

  // 读取整个文件（LINE 导出通常不大）
  const content = fs.readFileSync(filePath, 'utf-8')
  // 处理 Windows 换行符 (\r\n)
  const lines = content.split('\n').map((line) => line.replace(/\r$/, ''))

  // 解析状态
  let currentDate: Date | null = null
  let chatName = extractNameFromFilePath(filePath)
  let isPrivateChat = false
  let useTabSeparator = false
  const memberMap = new Map<string, ParsedMember>()
  const messages: ParsedMessage[] = []
  let lastMessage: ParsedMessage | null = null
  let lineIndex = 0

  // 检测是否有私聊头部
  if (lines.length > 0) {
    const firstLine = lines[0].trim()
    onLog?.('debug', `LINE 第一行: "${firstLine}"`)
    const headerName = extractNameFromHeader(firstLine)
    if (headerName) {
      chatName = headerName
      isPrivateChat = true
      useTabSeparator = true
      lineIndex = 3 // 跳过头部（标题、保存时间、空行）
      onLog?.('debug', `LINE 检测到私聊头部，对方: ${headerName}`)
    }
  }

  // 如果没有检测到头部，检查第一条消息的格式
  if (!isPrivateChat && lines.length > 0) {
    for (const line of lines) {
      if (PRIVATE_MSG_PATTERN.test(line)) {
        useTabSeparator = true
        onLog?.('debug', `LINE 检测到 Tab 分隔格式`)
        break
      }
      if (GROUP_MSG_PATTERN.test(line)) {
        useTabSeparator = false
        onLog?.('debug', `LINE 检测到空格分隔格式`)
        break
      }
    }
  }

  onLog?.('debug', `LINE 解析配置: useTabSeparator=${useTabSeparator}, lineIndex=${lineIndex}`)

  // 解析消息
  let debugLogCount = 0
  for (let i = lineIndex; i < lines.length; i++) {
    const line = lines[i]

    // 尝试解析日期行
    const dateResult = parseDateLine(line)
    if (dateResult) {
      currentDate = dateResult
      if (debugLogCount < 5) {
        onLog?.('debug', `LINE 日期行[${i}]: ${line} -> ${dateResult.toISOString()}`)
      }
      continue
    }

    // 尝试解析消息行
    const msgPattern = useTabSeparator ? PRIVATE_MSG_PATTERN : GROUP_MSG_PATTERN
    const msgMatch = line.match(msgPattern)

    // 调试前几行
    if (debugLogCount < 5 && line.trim()) {
      onLog?.('debug', `LINE 行[${i}]: "${line.substring(0, 50)}..." match=${!!msgMatch}`)
      debugLogCount++
    }

    if (msgMatch) {
      const [, timeStr, sender, contentRaw] = msgMatch
      const content = contentRaw.trim()

      // 解析时间
      const [hours, minutes] = timeStr.split(':').map(Number)
      let timestamp: number

      if (currentDate) {
        const msgDate = new Date(currentDate)
        msgDate.setHours(hours, minutes, 0, 0)
        timestamp = Math.floor(msgDate.getTime() / 1000)
      } else {
        // 如果没有日期，使用当前日期
        const now = new Date()
        now.setHours(hours, minutes, 0, 0)
        timestamp = Math.floor(now.getTime() / 1000)
      }

      // 检测消息类型
      const msgType = detectMessageType(content)

      // 更新成员信息
      if (!memberMap.has(sender)) {
        memberMap.set(sender, {
          platformId: sender,
          accountName: sender,
        })
      }

      // 创建消息
      lastMessage = {
        senderPlatformId: sender,
        senderAccountName: sender,
        timestamp,
        type: msgType,
        content: content || null,
      }
      messages.push(lastMessage)
      messagesProcessed++

      // 更新进度
      if (messagesProcessed % 1000 === 0) {
        const progress = createProgress(
          'parsing',
          i,
          lines.length,
          messagesProcessed,
          `已处理 ${messagesProcessed} 条消息...`
        )
        onProgress?.(progress)
      }
    } else if (line.trim() && lastMessage) {
      // 非消息行，追加到上一条消息（多行内容）
      if (lastMessage.content) {
        lastMessage.content += '\n' + line
      } else {
        lastMessage.content = line
      }
    }
  }

  // 根据成员数判断聊天类型
  const memberCount = memberMap.size
  const chatType = memberCount <= 2 ? ChatType.PRIVATE : ChatType.GROUP

  // 发送 meta
  const meta: ParsedMeta = {
    name: chatName,
    platform: KNOWN_PLATFORMS.LINE,
    type: chatType,
  }
  yield { type: 'meta', data: meta }

  // 发送成员
  const members = Array.from(memberMap.values())
  yield { type: 'members', data: members }

  // 分批发送消息
  for (let i = 0; i < messages.length; i += batchSize) {
    const batch = messages.slice(i, i + batchSize)
    yield { type: 'messages', data: batch }
  }

  // 完成
  const doneProgress = createProgress('done', totalBytes, totalBytes, messagesProcessed, '')
  yield { type: 'progress', data: doneProgress }
  onProgress?.(doneProgress)

  onLog?.('info', `解析完成: ${messagesProcessed} 条消息, ${memberCount} 个成员`)

  yield {
    type: 'done',
    data: { messageCount: messagesProcessed, memberCount },
  }
}

// ==================== 导出 ====================

export const parser_: Parser = {
  feature,
  parse: parseLINE,
}

const module_: FormatModule = {
  feature,
  parser: parser_,
}

export default module_
