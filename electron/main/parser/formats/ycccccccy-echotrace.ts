/**
 * ycccccccy/echotrace 导出格式解析器
 * 适配项目: https://github.com/ycccccccy/echotrace
 *
 * 特征：
 * - 顶层包含 session 和 messages 字段
 * - session.wxid: ID（群聊以 @chatroom 结尾）
 * - session.type: "群聊" 或 "私聊"
 * - messages[].type: 中文消息类型字符串
 * - messages[].senderUsername: 发送者ID
 * - messages[].senderDisplayName: 发送者显示名
 *
 * 注意：localType 字段不可信，不使用
 */

import * as fs from 'fs'
import * as path from 'path'
import { parser } from 'stream-json'
import { pick } from 'stream-json/filters/Pick'
import { streamValues } from 'stream-json/streamers/StreamValues'
import { chain } from 'stream-chain'
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
import { getFileSize, createProgress, readFileHeadBytes } from '../utils'

// ==================== 辅助函数 ====================

/**
 * 从文件名提取聊天名称
 */
function extractNameFromFilePath(filePath: string): string {
  const basename = path.basename(filePath)
  const name = basename.replace(/\.json$/i, '')
  return name || '未知聊天'
}

// ==================== 特征定义 ====================

export const feature: FormatFeature = {
  id: 'ycccccccy-echotrace',
  name: 'ycccccccy/echotrace 导出',
  platform: KNOWN_PLATFORMS.WECHAT,
  priority: 15,
  extensions: ['.json'],
  signatures: {
    // 检测顶层字段和特征
    head: [/"session"\s*:/, /"senderUsername"\s*:/, /"senderDisplayName"\s*:/],
    requiredFields: ['session', 'messages'],
  },
}

// ==================== 消息结构 ====================

interface EchotraceSession {
  wxid: string
  nickname: string
  remark: string
  displayName: string
  type: '群聊' | '私聊'
  lastTimestamp: number
  messageCount: number
}

interface EchotraceMessage {
  localId: number
  createTime: number // Unix 时间戳（秒）
  formattedTime: string
  type: string // 中文消息类型
  localType: number // 不可信，不使用
  content: string
  isSend: number | null // 0=接收, 1=发送, null=系统
  senderUsername: string // 发送者ID
  senderDisplayName: string // 发送者显示名
  senderAvatarKey: string // 头像查找 key（通常与 senderUsername 相同）
  source: string
}

// ==================== 头像信息结构 ====================

interface EchotraceAvatarInfo {
  displayName: string
  base64: string // 原始 base64，不包含 Data URL 前缀
}

// ==================== 消息类型映射 ====================

/**
 * 将 echotrace 中文消息类型转换为标准 MessageType
 */
function convertMessageType(typeStr: string): MessageType {
  switch (typeStr) {
    case '文本消息':
      return MessageType.TEXT
    case '图片消息':
      return MessageType.IMAGE
    case '语音消息':
      return MessageType.VOICE
    case '视频消息':
      return MessageType.VIDEO
    case '文件消息':
      return MessageType.FILE
    case '动画表情':
      return MessageType.EMOJI
    case '名片消息':
      return MessageType.CONTACT
    case '卡片式链接':
    case '图文消息':
      return MessageType.LINK
    case '位置消息':
      return MessageType.LOCATION
    case '红包卡片':
      return MessageType.RED_PACKET
    case '转账卡片':
      return MessageType.TRANSFER
    case '小程序分享':
    case '视频号直播卡片':
      return MessageType.SHARE
    case '引用消息':
      return MessageType.REPLY
    case '聊天记录合并转发':
      return MessageType.FORWARD
    case '系统消息':
      return MessageType.SYSTEM
    default:
      // 未知类型(xxxxx) 或其他
      return MessageType.OTHER
  }
}

// ==================== 成员信息追踪 ====================

interface MemberInfo {
  platformId: string
  accountName: string
  avatar: string | undefined // 头像（base64 Data URL）
}

// ==================== 解析器实现 ====================

async function* parseEchotrace(options: ParseOptions): AsyncGenerator<ParseEvent, void, unknown> {
  const { filePath, batchSize = 5000, onProgress, onLog } = options

  const totalBytes = getFileSize(filePath)
  let bytesRead = 0
  let messagesProcessed = 0

  // 发送初始进度
  const initialProgress = createProgress('parsing', 0, totalBytes, 0, '')
  yield { type: 'progress', data: initialProgress }
  onProgress?.(initialProgress)

  // 记录解析开始
  onLog?.('info', `开始解析 Echotrace 导出文件，大小: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`)

  // 读取文件头获取 session 信息
  const headContent = readFileHeadBytes(filePath, 2000)

  // 解析 session
  let session: EchotraceSession | null = null
  try {
    const sessionMatch = headContent.match(/"session"\s*:\s*(\{[^}]+\})/)
    if (sessionMatch) {
      session = JSON.parse(sessionMatch[1])
    }
  } catch {
    // 使用默认值
  }

  // 确定聊天类型
  // 1. 优先使用 session.type
  // 2. 或者通过 wxid 是否以 @chatroom 结尾判断
  let chatType = ChatType.GROUP
  if (session) {
    if (session.type === '私聊') {
      chatType = ChatType.PRIVATE
    } else if (session.type === '群聊') {
      chatType = ChatType.GROUP
    } else if (session.wxid && !session.wxid.endsWith('@chatroom')) {
      chatType = ChatType.PRIVATE
    }
  }

  // 确定聊天名称
  const chatName = session?.displayName || session?.nickname || extractNameFromFilePath(filePath)

  // 提取群ID（群聊类型时有值）
  // 群ID 格式：以 @chatroom 结尾
  const groupId = chatType === ChatType.GROUP && session?.wxid ? session.wxid : undefined

  // 解析 avatars 对象（头像）
  // avatars 格式：{ "wxid": { "displayName": "...", "base64": "..." } }
  // 注意：base64 不包含 Data URL 前缀，需要添加
  const avatarsMap = new Map<string, string>()

  /**
   * 从字符串中提取 avatars 对象内容
   * 正确处理 JSON 字符串中的花括号匹配（考虑字符串内的转义字符）
   */
  function extractAvatarsObject(content: string): string | null {
    const searchStr = '"avatars":'
    const startIdx = content.indexOf(searchStr)
    if (startIdx === -1) return null

    let i = startIdx + searchStr.length
    // 跳过空白字符
    while (i < content.length && /\s/.test(content[i])) i++

    if (content[i] !== '{') return null

    // 从 { 开始匹配
    let braceDepth = 0
    let inString = false
    let escape = false
    const objStart = i

    for (; i < content.length; i++) {
      const char = content[i]

      if (escape) {
        escape = false
        continue
      }

      if (char === '\\' && inString) {
        escape = true
        continue
      }

      if (char === '"') {
        inString = !inString
        continue
      }

      if (!inString) {
        if (char === '{') braceDepth++
        if (char === '}') {
          braceDepth--
          if (braceDepth === 0) {
            return content.slice(objStart, i + 1)
          }
        }
      }
    }

    return null
  }

  try {
    // 先尝试从文件头解析（适用于成员较少的聊天）
    const avatarsContent = extractAvatarsObject(headContent)
    if (avatarsContent) {
      const avatarsObj = JSON.parse(avatarsContent) as Record<string, EchotraceAvatarInfo>
      for (const [wxid, avatarInfo] of Object.entries(avatarsObj)) {
        if (avatarInfo && typeof avatarInfo === 'object' && avatarInfo.base64) {
          // 添加 Data URL 前缀
          avatarsMap.set(wxid, `data:image/jpeg;base64,${avatarInfo.base64}`)
        }
      }
    }
  } catch {
    // avatars 解析失败，继续不带头像
  }

  // 如果文件头没有完整的 avatars（可能超出 2000 字节），尝试流式读取
  if (avatarsMap.size === 0) {
    try {
      await new Promise<void>((resolve) => {
        const avatarStream = fs.createReadStream(filePath, { encoding: 'utf-8' })

        let avatarsContent = ''
        let inAvatars = false
        let braceDepth = 0
        let inString = false
        let escape = false

        avatarStream.on('data', (chunk: string | Buffer) => {
          const str = typeof chunk === 'string' ? chunk : chunk.toString()

          for (let i = 0; i < str.length; i++) {
            const char = str[i]

            if (!inAvatars) {
              // 查找 "avatars": 的位置
              const searchStr = '"avatars":'
              if (str.slice(i, i + searchStr.length) === searchStr) {
                inAvatars = true
                // 跳过 "avatars": 和可能的空白
                i += searchStr.length - 1
                continue
              }
            } else {
              // 开始收集 avatars 对象内容
              avatarsContent += char

              if (escape) {
                escape = false
                continue
              }

              if (char === '\\' && inString) {
                escape = true
                continue
              }

              if (char === '"') {
                inString = !inString
                continue
              }

              if (!inString) {
                if (char === '{') braceDepth++
                if (char === '}') {
                  braceDepth--
                  if (braceDepth === 0) {
                    // avatars 对象结束
                    avatarStream.destroy()
                    return
                  }
                }
              }
            }
          }
        })

        avatarStream.on('close', () => {
          if (avatarsContent) {
            try {
              const avatarsObj = JSON.parse(avatarsContent) as Record<string, EchotraceAvatarInfo>
              for (const [wxid, avatarInfo] of Object.entries(avatarsObj)) {
                if (avatarInfo && typeof avatarInfo === 'object' && avatarInfo.base64) {
                  avatarsMap.set(wxid, `data:image/jpeg;base64,${avatarInfo.base64}`)
                }
              }
            } catch {
              // 解析失败
            }
          }
          resolve()
        })

        avatarStream.on('error', () => resolve())
      })
    } catch {
      // 流式解析失败，继续不带头像
    }
  }

  // 提取群头像（从 avatars 中获取群ID对应的头像）
  const groupAvatar = groupId ? avatarsMap.get(groupId) : undefined

  // 快速扫描获取 ownerId（通过 isSend === 1 推断）
  let ownerId: string | undefined
  try {
    await new Promise<void>((resolve) => {
      const scanStream = fs.createReadStream(filePath, { encoding: 'utf-8' })
      const scanPipeline = chain([scanStream, parser(), pick({ filter: /^messages\.\d+$/ }), streamValues()])

      scanPipeline.on('data', ({ value }: { value: EchotraceMessage }) => {
        if (value.isSend === 1 && value.senderUsername && !value.senderUsername.endsWith('@chatroom')) {
          ownerId = value.senderUsername
          scanStream.destroy() // 找到后立即停止扫描
        }
      })

      scanStream.on('close', () => resolve())
      scanPipeline.on('end', () => resolve())
      scanPipeline.on('error', () => resolve())
    })
  } catch {
    // 扫描失败，ownerId 保持 undefined
  }

  // 发送 meta（包含推断的 ownerId）
  const meta: ParsedMeta = {
    name: chatName,
    platform: KNOWN_PLATFORMS.WECHAT,
    type: chatType,
    groupId,
    groupAvatar,
    ownerId,
  }
  yield { type: 'meta', data: meta }

  // 收集成员和消息
  const memberMap = new Map<string, MemberInfo>()
  const messageBatch: ParsedMessage[] = []

  // 流式解析
  await new Promise<void>((resolve, reject) => {
    const readStream = fs.createReadStream(filePath, { encoding: 'utf-8' })

    readStream.on('data', (chunk: string | Buffer) => {
      bytesRead += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
    })

    const pipeline = chain([readStream, parser(), pick({ filter: /^messages\.\d+$/ }), streamValues()])

    const processMessage = (msg: EchotraceMessage): ParsedMessage | null => {
      // 验证必要字段
      if (!msg.senderUsername || msg.createTime === undefined) {
        return null
      }

      const platformId = msg.senderUsername

      // 跳过群"成员"（群ID以 @chatroom 结尾的消息）
      // 这些通常是系统消息，发送者是群本身，不是真正的成员
      if (platformId.endsWith('@chatroom')) {
        return null
      }

      const accountName = msg.senderDisplayName || platformId

      // 获取头像（优先使用 senderAvatarKey，fallback 到 senderUsername）
      const avatarKey = msg.senderAvatarKey || msg.senderUsername
      const avatar = avatarsMap.get(avatarKey)

      // 更新成员信息
      if (!memberMap.has(platformId)) {
        memberMap.set(platformId, {
          platformId,
          accountName,
          avatar,
        })
      } else {
        // 更新为最新的显示名
        const existing = memberMap.get(platformId)!
        existing.accountName = accountName
        // 头像使用最新的（覆盖更新）
        if (avatar) {
          existing.avatar = avatar
        }
      }

      // 转换消息类型
      const type = convertMessageType(msg.type)

      // 确保 content 是字符串类型（防止某些消息类型的 content 是对象）
      let content: string | null = null
      if (msg.content != null) {
        content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
      }

      return {
        senderPlatformId: platformId,
        senderAccountName: accountName,
        // echotrace 格式没有单独的群昵称字段，使用 null 而非 undefined（SQLite 兼容）
        senderGroupNickname: null,
        timestamp: msg.createTime,
        type,
        content,
      }
    }

    // 用于收集批次的临时数组
    const batchCollector: ParsedMessage[] = []

    pipeline.on('data', ({ value }: { value: EchotraceMessage }) => {
      const parsed = processMessage(value)
      if (parsed) {
        batchCollector.push(parsed)
        messagesProcessed++

        // 达到批次大小
        if (batchCollector.length >= batchSize) {
          messageBatch.push(...batchCollector)
          batchCollector.length = 0

          const progress = createProgress(
            'parsing',
            bytesRead,
            totalBytes,
            messagesProcessed,
            `已处理 ${messagesProcessed} 条消息...`
          )
          onProgress?.(progress)
        }
      }
    })

    pipeline.on('end', () => {
      // 收集剩余消息
      if (batchCollector.length > 0) {
        messageBatch.push(...batchCollector)
      }
      resolve()
    })

    pipeline.on('error', reject)
  })

  // 发送成员
  const members: ParsedMember[] = Array.from(memberMap.values()).map((m) => ({
    platformId: m.platformId,
    accountName: m.accountName,
    avatar: m.avatar,
  }))
  yield { type: 'members', data: members }

  // 分批发送消息
  for (let i = 0; i < messageBatch.length; i += batchSize) {
    const batch = messageBatch.slice(i, i + batchSize)
    yield { type: 'messages', data: batch }
  }

  // 完成
  const doneProgress = createProgress('done', totalBytes, totalBytes, messagesProcessed, '')
  yield { type: 'progress', data: doneProgress }
  onProgress?.(doneProgress)

  // 记录解析摘要
  onLog?.('info', `解析完成: ${messagesProcessed} 条消息, ${memberMap.size} 个成员`)

  yield {
    type: 'done',
    data: { messageCount: messagesProcessed, memberCount: memberMap.size },
  }
}

// ==================== 导出解析器 ====================

export const parser_: Parser = {
  feature,
  parse: parseEchotrace,
}

// ==================== 预处理器（预留） ====================

import { echotracePreprocessor } from './ycccccccy-echotrace-preprocessor'
export const preprocessor = echotracePreprocessor

// ==================== 导出格式模块 ====================

const module_: FormatModule = {
  feature,
  parser: parser_,
  preprocessor: echotracePreprocessor,
}

export default module_
