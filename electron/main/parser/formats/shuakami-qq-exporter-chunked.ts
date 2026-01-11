/**
 * shuakami/qq-chat-exporter chunked-jsonl 格式解析器
 * 适配项目: https://github.com/shuakami/qq-chat-exporter
 * 版本: 5.x（chunked-jsonl 分块格式）
 *
 * 文件结构：
 * - manifest.json: 元数据和分块信息
 *   - metadata: 导出元数据
 *   - chatInfo: 聊天信息
 *   - chunked.chunks[]: 分块文件列表
 *   - avatars?: 头像文件信息（V5.5+）
 * - chunks/: 分块目录
 *   - chunk_0001.jsonl: 每行一条消息
 *   - chunk_0002.jsonl: ...
 * - avatars.json: 头像数据（V5.5+，可选）
 *
 * 消息格式（sender 字段）：
 * - uid: 用户 UID
 * - uin: QQ 号
 * - name: 展示名（优先群昵称，否则QQ昵称）
 * - nickname: QQ 昵称
 * - groupCard: 群昵称（群聊时存在）
 * - remark: 好友备注
 */

import * as fs from 'fs'
import * as path from 'path'
import * as readline from 'readline'
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
import { createProgress, parseTimestamp, isValidYear } from '../utils'

// ==================== 特征定义 ====================

export const feature: FormatFeature = {
  id: 'shuakami-qq-exporter-chunked',
  name: 'shuakami/qq-chat-exporter (chunked)',
  platform: KNOWN_PLATFORMS.QQ,
  priority: 5, // 比单文件版本优先级更高
  extensions: ['.json'],
  signatures: {
    head: [/"format"\s*:\s*"chunked-jsonl"/, /"chunked"\s*:/],
    requiredFields: ['metadata', 'chatInfo', 'chunked'],
  },
}

// ==================== 类型定义 ====================

interface ChunkInfo {
  // V5.0 格式
  file?: string
  messages?: number
  bytes?: number
  // V5.5+ 格式
  index?: number
  fileName?: string
  relativePath?: string
  count?: number
  start?: string
  end?: string
}

interface Manifest {
  metadata: {
    name?: string
    copyright?: string
    exportTime: string
    version: string
    format: string
  }
  chatInfo: {
    name: string
    type: string
    selfUid?: string
    selfUin?: string
    selfName?: string
  }
  statistics: {
    totalMessages: number
    chunkCount?: number
    timeRange?: {
      start: string
      end: string
      durationDays: number
    }
    messageTypes?: Record<string, number>
    senders?: Array<{
      uid: string
      name: string
      messageCount: number
      percentage: number
    }>
  }
  chunked: {
    format: string
    chunksDir: string
    chunkFileExt: string
    maxMessagesPerChunk: number
    maxBytesPerChunk: number
    chunks: ChunkInfo[]
  }
  avatars?: {
    file: string
    count: number
  }
}

interface ChunkedMessage {
  id?: string
  seq?: string
  timestamp: number
  time?: string
  sender: {
    uid?: string
    uin?: string
    name: string
    nickname?: string // QQ 昵称
    groupCard?: string // 群昵称
    remark?: string // 好友备注
  }
  type: string
  content: {
    text: string
    html?: string
    elements?: Array<{ type: string; data?: Record<string, unknown> }>
    resources?: Array<{ type: string }>
    mentions?: Array<{ uid: string; name: string }>
  }
  recalled?: boolean
  system?: boolean
}

interface MemberInfo {
  platformId: string
  accountName: string
  groupNickname: string | undefined
  avatar: string | undefined
}

// ==================== 消息类型转换 ====================

function convertMessageType(
  msgType: string,
  content: ChunkedMessage['content'],
  isRecalled?: boolean
): MessageType {
  if (isRecalled) return MessageType.RECALL

  // 系统消息
  if (msgType === 'system') return MessageType.SYSTEM

  // 检查资源类型
  if (content.resources?.length) {
    const resourceType = content.resources[0].type
    switch (resourceType) {
      case 'image':
        return MessageType.IMAGE
      case 'video':
        return MessageType.VIDEO
      case 'voice':
      case 'audio':
        return MessageType.VOICE
      case 'file':
        return MessageType.FILE
      case 'location':
        return MessageType.LOCATION
    }
  }

  // 检查表情
  if (content.elements?.some((e) => e.type === 'face' || e.type === 'market_face' || e.type === 'marketFace')) {
    return MessageType.EMOJI
  }

  // 根据文本内容判断
  const text = content.text?.trim() || ''
  if (text.includes('QQ红包') || text.includes('发出了红包') || text === '[红包]') return MessageType.RED_PACKET
  if (text.includes('转账') || text === '[转账]') return MessageType.TRANSFER
  if (text.includes('拍了拍') || text.includes('戳了戳') || text === '[拍一拍]') return MessageType.POKE
  if (text.includes('语音通话') || text.includes('视频通话') || text.includes('通话时长')) return MessageType.CALL
  if (text === '[分享]' || text === '[音乐]' || text === '[小程序]') return MessageType.SHARE
  if (text === '[链接]' || text === '[卡片消息]') return MessageType.LINK
  if (text === '[位置]' || text === '[地理位置]') return MessageType.LOCATION
  if (text === '[转发]' || text === '[聊天记录]') return MessageType.FORWARD

  return MessageType.TEXT
}

// ==================== 辅助函数 ====================

/**
 * 读取并解析 manifest.json
 */
function readManifest(manifestPath: string): Manifest {
  const content = fs.readFileSync(manifestPath, 'utf-8')
  return JSON.parse(content) as Manifest
}

/**
 * 获取 chunk 文件的相对路径（兼容新旧格式）
 */
function getChunkRelativePath(chunk: ChunkInfo): string {
  // V5.5+ 使用 relativePath
  if (chunk.relativePath) return chunk.relativePath
  // V5.0 使用 file
  if (chunk.file) return chunk.file
  // 后备：使用 fileName 拼接
  if (chunk.fileName) return `chunks/${chunk.fileName}`
  throw new Error('无法获取 chunk 文件路径')
}

/**
 * 获取 chunk 的消息数量（兼容新旧格式）
 */
function getChunkMessageCount(chunk: ChunkInfo): number {
  // V5.5+ 使用 count
  if (chunk.count !== undefined) return chunk.count
  // V5.0 使用 messages
  if (chunk.messages !== undefined) return chunk.messages
  return 0
}

/**
 * 计算所有 chunk 文件的总字节数
 */
function calculateTotalBytes(manifest: Manifest, baseDir: string): number {
  let total = 0
  for (const chunk of manifest.chunked.chunks) {
    const relativePath = getChunkRelativePath(chunk)
    const chunkPath = path.join(baseDir, relativePath)
    if (fs.existsSync(chunkPath)) {
      total += fs.statSync(chunkPath).size
    }
  }
  return total
}

/**
 * 读取 avatars.json 文件
 */
function readAvatars(baseDir: string, avatarsInfo?: { file: string; count: number }): Map<string, string> {
  const avatarsMap = new Map<string, string>()
  if (!avatarsInfo?.file) return avatarsMap

  const avatarsPath = path.join(baseDir, avatarsInfo.file)
  if (!fs.existsSync(avatarsPath)) return avatarsMap

  try {
    const content = fs.readFileSync(avatarsPath, 'utf-8')
    const avatars = JSON.parse(content) as Record<string, string>
    for (const [uin, avatar] of Object.entries(avatars)) {
      if (avatar && typeof avatar === 'string' && avatar.startsWith('data:image/')) {
        avatarsMap.set(uin, avatar)
      }
    }
  } catch {
    // 头像读取失败，继续不带头像
  }

  return avatarsMap
}

/**
 * 流式读取 JSONL 文件
 */
async function* readJsonlFile(filePath: string): AsyncGenerator<ChunkedMessage> {
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' })
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      yield JSON.parse(trimmed) as ChunkedMessage
    } catch {
      // 跳过无效的 JSON 行
    }
  }
}

// ==================== 解析器实现 ====================

async function* parseChunkedJsonl(options: ParseOptions): AsyncGenerator<ParseEvent, void, unknown> {
  const { filePath, batchSize = 5000, onProgress, onLog } = options

  // 确定 manifest.json 路径和基础目录
  const manifestPath = filePath
  const baseDir = path.dirname(manifestPath)

  // 读取 manifest
  let manifest: Manifest
  try {
    manifest = readManifest(manifestPath)
  } catch (error) {
    yield { type: 'error', data: new Error(`无法读取 manifest.json: ${error}`) }
    return
  }

  // 验证格式
  if (manifest.metadata.format !== 'chunked-jsonl') {
    yield { type: 'error', data: new Error(`不支持的格式: ${manifest.metadata.format}`) }
    return
  }

  const totalBytes = calculateTotalBytes(manifest, baseDir)
  let bytesRead = 0
  let messagesProcessed = 0
  let skippedMessages = 0

  // 发送初始进度
  const initialProgress = createProgress('parsing', 0, totalBytes, 0, '')
  yield { type: 'progress', data: initialProgress }
  onProgress?.(initialProgress)

  onLog?.(
    'info',
    `开始解析 chunked-jsonl 格式 (V${manifest.metadata.version})，共 ${manifest.chunked.chunks.length} 个分块，预计 ${manifest.statistics.totalMessages} 条消息`
  )

  // 读取头像文件（如果存在）
  const avatarsMap = readAvatars(baseDir, manifest.avatars)
  if (avatarsMap.size > 0) {
    onLog?.('info', `已加载 ${avatarsMap.size} 个用户头像`)
  }

  // 发送 meta
  const chatType = manifest.chatInfo.type === 'group' ? ChatType.GROUP : ChatType.PRIVATE
  const meta: ParsedMeta = {
    name: manifest.chatInfo.name || '未知群聊',
    platform: KNOWN_PLATFORMS.QQ,
    type: chatType,
    ownerId: manifest.chatInfo.selfUin || manifest.chatInfo.selfUid,
  }
  yield { type: 'meta', data: meta }

  // 收集成员和消息
  const memberMap = new Map<string, MemberInfo>()
  const messageBatch: ParsedMessage[] = []

  // 遍历所有 chunk 文件
  for (const chunkInfo of manifest.chunked.chunks) {
    const relativePath = getChunkRelativePath(chunkInfo)
    const chunkPath = path.join(baseDir, relativePath)
    const chunkMessageCount = getChunkMessageCount(chunkInfo)

    if (!fs.existsSync(chunkPath)) {
      onLog?.('error', `分块文件不存在: ${chunkPath}`)
      continue
    }

    const chunkSize = fs.statSync(chunkPath).size
    let chunkMessagesRead = 0

    onLog?.('info', `正在解析分块: ${relativePath} (${chunkMessageCount} 条消息)`)

    // 流式读取 JSONL 文件
    for await (const msg of readJsonlFile(chunkPath)) {
      chunkMessagesRead++

      // 获取 platformId
      const platformId = msg.sender.uin || msg.sender.uid
      if (!platformId || platformId === '0' || platformId === '未知') {
        skippedMessages++
        continue
      }

      // 获取名字信息
      // nickname: QQ 昵称（原始昵称）
      // groupCard: 群昵称
      // name: 展示名（一般是 groupCard || nickname）
      const accountName = msg.sender.nickname || msg.sender.name || platformId
      const groupNickname = msg.sender.groupCard || undefined

      // 更新成员信息
      const existingMember = memberMap.get(platformId)
      if (!existingMember) {
        memberMap.set(platformId, {
          platformId,
          accountName,
          groupNickname,
          avatar: avatarsMap.get(platformId),
        })
      } else {
        existingMember.accountName = accountName
        if (groupNickname) existingMember.groupNickname = groupNickname
        if (!existingMember.avatar) existingMember.avatar = avatarsMap.get(platformId)
      }

      // 解析时间戳（chunked 格式的时间戳是毫秒）
      const timestamp =
        typeof msg.timestamp === 'number' ? Math.floor(msg.timestamp / 1000) : parseTimestamp(msg.timestamp)

      if (timestamp === null || !isValidYear(timestamp)) {
        skippedMessages++
        continue
      }

      // 消息类型
      const type = msg.system ? MessageType.SYSTEM : convertMessageType(msg.type, msg.content, msg.recalled)

      // 文本内容
      let textContent = msg.content?.text || ''
      if (msg.recalled) textContent = '[已撤回] ' + textContent

      messageBatch.push({
        platformMessageId: msg.id,
        senderPlatformId: platformId,
        senderAccountName: accountName,
        senderGroupNickname: groupNickname,
        timestamp,
        type,
        content: textContent || null,
      })

      messagesProcessed++

      // 定期发送进度
      if (messagesProcessed % batchSize === 0) {
        // 估算字节读取进度
        const chunkProgress = chunkMessageCount > 0 ? chunkMessagesRead / chunkMessageCount : 0
        const chunkBytesRead = Math.floor(chunkProgress * chunkSize)
        const currentBytesRead = bytesRead + chunkBytesRead
        const progress = createProgress(
          'parsing',
          currentBytesRead,
          totalBytes,
          messagesProcessed,
          `已处理 ${messagesProcessed} 条消息...`
        )
        yield { type: 'progress', data: progress }
        onProgress?.(progress)
      }
    }

    // 更新总字节读取
    bytesRead += chunkSize
  }

  // 发送成员（包含头像）
  const members: ParsedMember[] = Array.from(memberMap.values()).map((m) => ({
    platformId: m.platformId,
    accountName: m.accountName,
    groupNickname: m.groupNickname,
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

  onLog?.('info', `解析完成: ${messagesProcessed} 条消息, ${memberMap.size} 个成员`)
  if (skippedMessages > 0) {
    onLog?.('info', `跳过 ${skippedMessages} 条无效消息（缺少发送者ID或时间戳无效）`)
  }

  yield {
    type: 'done',
    data: { messageCount: messagesProcessed, memberCount: memberMap.size },
  }
}

// ==================== 导出 ====================

export const parser_: Parser = {
  feature,
  parse: parseChunkedJsonl,
}

const module_: FormatModule = {
  feature,
  parser: parser_,
}

export default module_
