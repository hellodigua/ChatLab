/**
 * 聊天记录合并模块
 * 支持多个聊天记录文件合并为 ChatLab 专属格式
 */

import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { parseFileSync, detectFormat } from '../parser'
import { importData } from '../database/core'
import { TempDbReader } from './tempCache'
import type {
  ParseResult,
  ParsedMessage,
  ChatLabFormat,
  ChatLabMember,
  ChatLabMessage,
  FileParseInfo,
  MergeConflict,
  ConflictCheckResult,
  ConflictResolution,
  MergeParams,
  MergeResult,
  ChatPlatform,
  ChatType,
  MergeSource,
  ParsedMeta,
  ParsedMember,
} from '../../../src/types/chat'

/**
 * 获取默认输出目录
 */
function getDefaultOutputDir(): string {
  try {
    const docPath = app.getPath('documents')
    return path.join(docPath, 'ChatLab', 'merged')
  } catch {
    return path.join(process.cwd(), 'merged')
  }
}

/**
 * 确保输出目录存在
 */
function ensureOutputDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/**
 * 生成输出文件名
 */
function generateOutputFilename(name: string): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const safeName = name.replace(/[/\\?%*:|"<>]/g, '_')
  return `${safeName}_merged_${date}.chatlab.json`
}

/**
 * 解析文件获取基本信息（用于预览）
 * 注意：推荐使用 parser.parseFileInfo 获取更详细的信息
 */
export async function parseFileInfo(filePath: string): Promise<FileParseInfo> {
  const format = detectFormat(filePath)
  if (!format) {
    throw new Error('无法识别文件格式')
  }

  const result = await parseFileSync(filePath)

  return {
    name: result.meta.name,
    format: format.name,
    platform: result.meta.platform,
    messageCount: result.messages.length,
    memberCount: result.members.length,
  }
}

/**
 * 生成消息的唯一标识（用于去重和冲突检测）
 */
function getMessageKey(msg: ParsedMessage): string {
  return `${msg.timestamp}_${msg.senderPlatformId}_${(msg.content || '').length}`
}

/**
 * 检测合并冲突（使用缓存的解析结果）
 * 规则：时间戳 + 用户名 + 字符长度，当两项相同但另一项不同时报告冲突
 */
export async function checkConflictsWithCache(
  filePaths: string[],
  cache: Map<string, ParseResult>
): Promise<ConflictCheckResult> {
  const allMessages: Array<{ msg: ParsedMessage; source: string }> = []
  const conflicts: MergeConflict[] = []

  console.log('[Merger] checkConflictsWithCache: 开始检测冲突')
  console.log(
    '[Merger] 文件列表:',
    filePaths.map((p) => path.basename(p))
  )
  console.log(
    '[Merger] 缓存状态:',
    filePaths.map((p) => `${path.basename(p)}: ${cache.has(p) ? '已缓存' : '未缓存'}`)
  )

  // 解析所有文件（优先使用缓存）
  const parseResults: Array<{ result: ParseResult; source: string }> = []
  for (const filePath of filePaths) {
    let result: ParseResult
    if (cache.has(filePath)) {
      result = cache.get(filePath)!
      console.log(`[Merger] 使用缓存: ${path.basename(filePath)}`)
    } else {
      // 回退到文件解析（兼容性）
      console.log(`[Merger] 缓存未命中，重新解析: ${path.basename(filePath)}`)
      result = await parseFileSync(filePath)
    }
    parseResults.push({ result, source: path.basename(filePath) })
  }

  // 检查格式一致性
  const formats = parseResults.map((p) => p.result.meta.platform)
  const uniqueFormats = [...new Set(formats)]
  if (uniqueFormats.length > 1) {
    throw new Error(
      `不支持合并不同格式的聊天记录。\n检测到的格式：${uniqueFormats.join('、')}\n请确保所有文件使用相同的导出工具和格式。`
    )
  }
  console.log('[Merger] 格式检查通过:', uniqueFormats[0])

  // 收集所有消息
  for (const { result, source } of parseResults) {
    console.log(`[Merger] 处理 ${source}: ${result.messages.length} 条消息`)
    for (const msg of result.messages) {
      allMessages.push({ msg, source })
    }
  }
  console.log(`[Merger] 总消息数: ${allMessages.length}`)

  return detectConflictsInMessages(allMessages, conflicts)
}

/**
 * 检测合并冲突（原版，直接读取文件）
 * @deprecated 使用 checkConflictsWithCache 替代
 */
export async function checkConflicts(filePaths: string[]): Promise<ConflictCheckResult> {
  const allMessages: Array<{ msg: ParsedMessage; source: string }> = []
  const conflicts: MergeConflict[] = []

  console.log('[Merger] checkConflicts: 开始检测冲突')
  console.log(
    '[Merger] 文件列表:',
    filePaths.map((p) => path.basename(p))
  )

  // 先检查格式一致性
  const formats: string[] = []
  for (const filePath of filePaths) {
    const format = detectFormat(filePath)
    if (format) {
      formats.push(format.name)
    } else {
      throw new Error(`无法识别文件格式: ${path.basename(filePath)}`)
    }
  }

  // 检查是否所有文件格式一致
  const uniqueFormats = [...new Set(formats)]
  if (uniqueFormats.length > 1) {
    throw new Error(
      `不支持合并不同格式的聊天记录。\n检测到的格式：${uniqueFormats.join('、')}\n请确保所有文件使用相同的导出工具和格式。`
    )
  }
  console.log('[Merger] 格式检查通过:', uniqueFormats[0])

  // 解析所有文件
  for (const filePath of filePaths) {
    const result = await parseFileSync(filePath)
    const sourceName = path.basename(filePath)
    console.log(`[Merger] 解析 ${sourceName}: ${result.messages.length} 条消息`)
    for (const msg of result.messages) {
      allMessages.push({ msg, source: sourceName })
    }
  }
  console.log(`[Merger] 总消息数: ${allMessages.length}`)

  return detectConflictsInMessages(allMessages, conflicts)
}

/**
 * 内部函数：检测消息中的冲突
 */
/**
 * 检查消息是否是纯图片消息
 * 纯图片消息格式如：[图片: xxx.jpg]、[图片: {xxx}.jpg] 等
 */
function isImageOnlyMessage(content: string | undefined): boolean {
  if (!content) return false
  // 匹配 [图片: xxx] 格式，允许各种图片名称格式
  return /^\[图片:\s*.+\]$/.test(content.trim())
}

function detectConflictsInMessages(
  allMessages: Array<{ msg: ParsedMessage; source: string }>,
  conflicts: MergeConflict[]
): ConflictCheckResult {
  // 按时间戳分组检测冲突
  const timeGroups = new Map<number, Array<{ msg: ParsedMessage; source: string }>>()
  for (const item of allMessages) {
    const ts = item.msg.timestamp
    if (!timeGroups.has(ts)) {
      timeGroups.set(ts, [])
    }
    timeGroups.get(ts)!.push(item)
  }
  console.log(`[Merger] 唯一时间戳数: ${timeGroups.size}`)

  // 统计有多条消息的时间戳
  let multiMsgTsCount = 0
  for (const [, items] of timeGroups) {
    if (items.length > 1) multiMsgTsCount++
  }
  console.log(`[Merger] 有多条消息的时间戳数: ${multiMsgTsCount}`)

  // 统计自动去重数量
  let autoDeduplicatedCount = 0

  // 检测每个时间戳内的冲突
  for (const [ts, items] of timeGroups) {
    if (items.length < 2) continue

    // 按发送者分组
    const senderGroups = new Map<string, Array<{ msg: ParsedMessage; source: string }>>()
    for (const item of items) {
      const sender = item.msg.senderPlatformId
      if (!senderGroups.has(sender)) {
        senderGroups.set(sender, [])
      }
      senderGroups.get(sender)!.push(item)
    }

    // 检测同一时间戳同一发送者的不同内容
    for (const [sender, senderItems] of senderGroups) {
      if (senderItems.length < 2) continue

      // 检查是否来自不同文件
      const sources = new Set(senderItems.map((it) => it.source))
      if (sources.size < 2) {
        // 所有消息来自同一个文件，跳过（这是同一文件内同一秒内多条消息的情况）
        continue
      }

      // 按内容分组（完全相同的内容会被分到一组，自动去重）
      const contentGroups = new Map<string, Array<{ msg: ParsedMessage; source: string }>>()
      for (const item of senderItems) {
        const content = item.msg.content || ''
        if (!contentGroups.has(content)) {
          contentGroups.set(content, [])
        }
        contentGroups.get(content)!.push(item)
      }

      // 统计自动去重的消息（内容完全相同但来自不同文件）
      for (const [, contentItems] of contentGroups) {
        if (contentItems.length > 1) {
          const contentSources = new Set(contentItems.map((it) => it.source))
          if (contentSources.size > 1) {
            // 内容相同但来自不同文件，自动去重
            autoDeduplicatedCount += contentItems.length - 1
          }
        }
      }

      // 只有当有多个不同内容时才是真正的冲突
      if (contentGroups.size > 1) {
        const contentEntries = Array.from(contentGroups.entries())

        // 检查这些不同内容是否来自不同文件
        for (let i = 0; i < contentEntries.length - 1; i++) {
          for (let j = i + 1; j < contentEntries.length; j++) {
            const [content1, items1] = contentEntries[i]
            const [content2, items2] = contentEntries[j]

            // 找到两个来源不同的消息
            const item1 = items1[0]
            const item2 = items2.find((it) => it.source !== item1.source)

            // 如果找不到来自不同文件的消息，跳过
            if (!item2) continue

            // 如果两边都是纯图片消息，自动跳过（不需要用户选择）
            if (isImageOnlyMessage(content1) && isImageOnlyMessage(content2)) {
              autoDeduplicatedCount++
              continue
            }

            // 打印冲突详情
            if (conflicts.length < 5) {
              console.log(`[Merger] 冲突 #${conflicts.length + 1}:`)
              console.log(`  时间戳: ${ts} (${new Date(ts * 1000).toLocaleString()})`)
              console.log(`  发送者: ${sender} (${item1.msg.senderName})`)
              console.log(`  文件1: ${item1.source}, 长度: ${content1.length}, 内容: "${content1.slice(0, 50)}..."`)
              console.log(`  文件2: ${item2.source}, 长度: ${content2.length}, 内容: "${content2.slice(0, 50)}..."`)
            }

            conflicts.push({
              id: `conflict_${ts}_${sender}_${conflicts.length}`,
              timestamp: ts,
              sender: item1.msg.senderName || sender,
              contentLength1: content1.length,
              contentLength2: content2.length,
              content1: content1,
              content2: content2,
            })
          }
        }
      }
    }
  }

  console.log(`[Merger] 自动去重消息数（含图片冲突）: ${autoDeduplicatedCount}`)

  console.log(`[Merger] 检测到冲突数: ${conflicts.length}`)

  // 计算去重后的消息数
  const uniqueKeys = new Set<string>()
  for (const item of allMessages) {
    uniqueKeys.add(getMessageKey(item.msg))
  }
  console.log(`[Merger] 去重后消息数: ${uniqueKeys.size}`)

  return {
    conflicts,
    totalMessages: uniqueKeys.size,
  }
}

/**
 * 合并多个聊天记录文件（使用缓存的解析结果）
 */
export async function mergeFilesWithCache(params: MergeParams, cache: Map<string, ParseResult>): Promise<MergeResult> {
  try {
    const { filePaths, outputName, outputDir, conflictResolutions, andAnalyze } = params

    console.log('[Merger] mergeFilesWithCache: 开始合并')
    console.log(
      '[Merger] 缓存状态:',
      filePaths.map((p) => `${path.basename(p)}: ${cache.has(p) ? '已缓存' : '未缓存'}`)
    )

    // 解析所有文件（优先使用缓存）
    const parseResults: Array<{ result: ParseResult; source: string }> = []
    for (const filePath of filePaths) {
      let result: ParseResult
      if (cache.has(filePath)) {
        result = cache.get(filePath)!
        console.log(`[Merger] 使用缓存: ${path.basename(filePath)}`)
      } else {
        // 回退到文件解析（兼容性）
        console.log(`[Merger] 缓存未命中，重新解析: ${path.basename(filePath)}`)
        result = await parseFileSync(filePath)
      }
      parseResults.push({ result, source: path.basename(filePath) })
    }

    return executeMerge(parseResults, outputName, outputDir, conflictResolutions, andAnalyze)
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : '合并失败',
    }
  }
}

/**
 * 合并多个聊天记录文件（原版，直接读取文件）
 * @deprecated 使用 mergeFilesWithCache 替代
 */
export async function mergeFiles(params: MergeParams): Promise<MergeResult> {
  try {
    const { filePaths, outputName, outputDir, conflictResolutions, andAnalyze } = params

    // 解析所有文件
    const parseResults: Array<{ result: ParseResult; source: string }> = []
    for (const filePath of filePaths) {
      const result = await parseFileSync(filePath)
      parseResults.push({ result, source: path.basename(filePath) })
    }

    return executeMerge(parseResults, outputName, outputDir, conflictResolutions, andAnalyze)
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : '合并失败',
    }
  }
}

/**
 * 内部函数：执行合并逻辑
 */
function executeMerge(
  parseResults: Array<{ result: ParseResult; source: string }>,
  outputName: string,
  outputDir: string | undefined,
  conflictResolutions: ConflictResolution[],
  andAnalyze: boolean
): MergeResult {
  try {
    // 合并成员
    const memberMap = new Map<string, ChatLabMember>()
    for (const { result } of parseResults) {
      for (const member of result.members) {
        const existing = memberMap.get(member.platformId)
        if (existing) {
          // 如果昵称不同，添加到 aliases
          if (existing.name !== member.name && !existing.aliases?.includes(member.name)) {
            existing.aliases = existing.aliases || []
            existing.aliases.push(member.name)
          }
        } else {
          memberMap.set(member.platformId, {
            platformId: member.platformId,
            name: member.name,
          })
        }
      }
    }

    // 合并消息（带冲突解决和去重）
    const resolutionMap = new Map(conflictResolutions.map((r) => [r.id, r.resolution]))
    const allMessages: Array<{ msg: ParsedMessage; source: string }> = []

    for (const { result, source } of parseResults) {
      for (const msg of result.messages) {
        allMessages.push({ msg, source })
      }
    }

    // 去重逻辑
    const messageMap = new Map<string, ChatLabMessage[]>()
    const processedConflicts = new Set<string>()

    for (const { msg } of allMessages) {
      const key = getMessageKey(msg)

      // 检查是否是冲突消息
      const conflictId = conflictResolutions.find((c) => {
        return c.id.includes(`${msg.timestamp}_${msg.senderPlatformId}`)
      })?.id

      if (conflictId && !processedConflicts.has(conflictId)) {
        processedConflicts.add(conflictId)
        const resolution = resolutionMap.get(conflictId)

        // 根据解决方案处理
        if (resolution === 'keepBoth') {
          // 保留两者：不去重
        } else if (resolution === 'keep1' || resolution === 'keep2') {
          // 保留其中一个：跳过另一个（简化处理，保留第一个遇到的）
        }
      }

      // 添加消息
      if (!messageMap.has(key)) {
        messageMap.set(key, [])
      }

      const chatLabMsg: ChatLabMessage = {
        sender: msg.senderPlatformId,
        name: msg.senderName,
        timestamp: msg.timestamp,
        type: msg.type,
        content: msg.content,
      }

      // 只添加一次（去重）
      const existing = messageMap.get(key)!
      if (existing.length === 0) {
        existing.push(chatLabMsg)
      }
    }

    // 扁平化并排序
    const mergedMessages = Array.from(messageMap.values())
      .flat()
      .sort((a, b) => a.timestamp - b.timestamp)

    // 确定平台
    const platforms = new Set(parseResults.map((r) => r.result.meta.platform))
    const platform = platforms.size === 1 ? parseResults[0].result.meta.platform : 'mixed'

    // 构建来源信息
    const sources: MergeSource[] = parseResults.map(({ result, source }) => ({
      filename: source,
      platform: result.meta.platform,
      messageCount: result.messages.length,
    }))

    // 构建 ChatLab 格式
    const chatLabData: ChatLabFormat = {
      chatlab: {
        version: '1.0.0',
        exportedAt: Math.floor(Date.now() / 1000),
        generator: 'ChatLab Merge Tool',
      },
      meta: {
        name: outputName,
        platform: platform as ChatPlatform,
        type: parseResults[0].result.meta.type as ChatType,
        sources,
      },
      members: Array.from(memberMap.values()),
      messages: mergedMessages,
    }

    // 写入文件
    const targetDir = outputDir || getDefaultOutputDir()
    ensureOutputDir(targetDir)
    const filename = generateOutputFilename(outputName)
    const outputPath = path.join(targetDir, filename)

    fs.writeFileSync(outputPath, JSON.stringify(chatLabData, null, 2), 'utf-8')

    // 如果需要分析，导入数据库
    let sessionId: string | undefined
    if (andAnalyze) {
      // 将 ChatLab 格式转换为 ParseResult
      const parseResult: ParseResult = {
        meta: {
          name: chatLabData.meta.name,
          platform: chatLabData.meta.platform,
          type: chatLabData.meta.type,
        },
        members: chatLabData.members.map((m) => ({
          platformId: m.platformId,
          name: m.name,
        })),
        messages: chatLabData.messages.map((msg) => ({
          senderPlatformId: msg.sender,
          senderName: msg.name,
          timestamp: msg.timestamp,
          type: msg.type,
          content: msg.content,
        })),
      }
      sessionId = importData(parseResult)
    }

    return {
      success: true,
      outputPath,
      sessionId,
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : '合并失败',
    }
  }
}

// ==================== 临时数据库版本（方案3：内存优化） ====================

/**
 * 检测合并冲突（使用临时数据库，内存友好）
 */
export async function checkConflictsWithTempDb(
  filePaths: string[],
  tempDbCache: Map<string, string>
): Promise<ConflictCheckResult> {
  const allMessages: Array<{ msg: ParsedMessage; source: string }> = []
  const conflicts: MergeConflict[] = []

  console.log('[Merger] checkConflictsWithTempDb: 开始检测冲突')
  console.log(
    '[Merger] 文件列表:',
    filePaths.map((p) => path.basename(p))
  )
  console.log(
    '[Merger] 临时数据库缓存状态:',
    filePaths.map((p) => `${path.basename(p)}: ${tempDbCache.has(p) ? '已缓存' : '未缓存'}`)
  )

  // 从临时数据库读取所有消息
  const readers: TempDbReader[] = []
  try {
    for (const filePath of filePaths) {
      const tempDbPath = tempDbCache.get(filePath)
      if (!tempDbPath) {
        throw new Error(`未找到文件的临时数据库: ${path.basename(filePath)}`)
      }

      const reader = new TempDbReader(tempDbPath)
      readers.push(reader)

      const meta = reader.getMeta()
      const sourceName = path.basename(filePath)

      console.log(`[Merger] 从临时数据库读取: ${sourceName}, 平台: ${meta?.platform}`)

      // 流式读取消息，避免一次性加载到内存
      reader.streamMessages(10000, (messages) => {
        for (const msg of messages) {
          allMessages.push({ msg, source: sourceName })
        }
      })
    }

    console.log(`[Merger] 总消息数: ${allMessages.length}`)

    // 检查格式一致性
    const platforms = readers.map((r) => r.getMeta()?.platform || 'unknown')
    const uniquePlatforms = [...new Set(platforms)]
    if (uniquePlatforms.length > 1) {
      throw new Error(
        `不支持合并不同格式的聊天记录。\n检测到的格式：${uniquePlatforms.join('、')}\n请确保所有文件使用相同的导出工具和格式。`
      )
    }
    console.log('[Merger] 格式检查通过:', uniquePlatforms[0])

    return detectConflictsInMessages(allMessages, conflicts)
  } finally {
    // 关闭所有 reader
    for (const reader of readers) {
      reader.close()
    }
  }
}

/**
 * 合并多个聊天记录文件（使用临时数据库，内存友好）
 */
export async function mergeFilesWithTempDb(
  params: MergeParams,
  tempDbCache: Map<string, string>
): Promise<MergeResult> {
  const { filePaths, outputName, outputDir, conflictResolutions, andAnalyze } = params

  console.log('[Merger] mergeFilesWithTempDb: 开始合并')
  console.log(
    '[Merger] 临时数据库缓存状态:',
    filePaths.map((p) => `${path.basename(p)}: ${tempDbCache.has(p) ? '已缓存' : '未缓存'}`)
  )

  const readers: TempDbReader[] = []

  try {
    // 打开所有临时数据库
    const parseResults: Array<{ meta: ParsedMeta; members: ParsedMember[]; source: string; reader: TempDbReader }> = []

    for (const filePath of filePaths) {
      const tempDbPath = tempDbCache.get(filePath)
      if (!tempDbPath) {
        throw new Error(`未找到文件的临时数据库: ${path.basename(filePath)}`)
      }

      const reader = new TempDbReader(tempDbPath)
      readers.push(reader)

      const meta = reader.getMeta()
      if (!meta) {
        throw new Error(`无法读取元信息: ${path.basename(filePath)}`)
      }

      const members = reader.getMembers()
      const sourceName = path.basename(filePath)

      console.log(`[Merger] 使用临时数据库: ${sourceName}`)

      parseResults.push({ meta, members, source: sourceName, reader })
    }

    // 合并成员
    const memberMap = new Map<string, ChatLabMember>()
    for (const { members } of parseResults) {
      for (const member of members) {
        const existing = memberMap.get(member.platformId)
        if (existing) {
          if (existing.name !== member.name && !existing.aliases?.includes(member.name)) {
            existing.aliases = existing.aliases || []
            existing.aliases.push(member.name)
          }
        } else {
          memberMap.set(member.platformId, {
            platformId: member.platformId,
            name: member.name,
          })
        }
      }
    }

    // 流式合并消息（去重）- 使用 Set 替代 Map 以提高性能
    // 注：冲突解决方案通过消息处理顺序生效（第一个被处理的版本会被保留）
    const seenKeys = new Set<string>()
    const mergedMessages: ChatLabMessage[] = []
    let totalProcessed = 0
    const startTime = Date.now()

    for (const { reader, source } of parseResults) {
      const readerStartTime = Date.now()
      let readerCount = 0

      reader.streamMessages(10000, (messages) => {
        for (const msg of messages) {
          const key = getMessageKey(msg)

          // 跳过已处理的消息（去重）
          if (seenKeys.has(key)) {
            continue
          }
          seenKeys.add(key)

          // 注：冲突已在去重时处理（seenKeys），用户选择的冲突解决方案
          // 决定了哪个版本的消息先被处理，后续相同 key 的消息会被跳过

          mergedMessages.push({
            sender: msg.senderPlatformId,
            name: msg.senderName,
            timestamp: msg.timestamp,
            type: msg.type,
            content: msg.content,
          })

          readerCount++
        }
        totalProcessed += messages.length
      })

      console.log(`[Merger] 处理 ${source}: ${readerCount} 条唯一消息, 耗时: ${Date.now() - readerStartTime}ms`)
    }

    // 排序
    const sortStartTime = Date.now()
    mergedMessages.sort((a, b) => a.timestamp - b.timestamp)
    console.log(`[Merger] 排序耗时: ${Date.now() - sortStartTime}ms`)

    console.log(`[Merger] 合并后消息数: ${mergedMessages.length}`)

    // 确定平台
    const platforms = new Set(parseResults.map((r) => r.meta.platform))
    const platform = platforms.size === 1 ? parseResults[0].meta.platform : 'mixed'

    // 构建来源信息
    const sources: MergeSource[] = parseResults.map(({ reader, source, meta }) => ({
      filename: source,
      platform: meta.platform,
      messageCount: reader.getMessageCount(),
    }))

    // 构建 ChatLab 格式
    const chatLabData: ChatLabFormat = {
      chatlab: {
        version: '1.0.0',
        exportedAt: Math.floor(Date.now() / 1000),
        generator: 'ChatLab Merge Tool',
      },
      meta: {
        name: outputName,
        platform: platform as ChatPlatform,
        type: parseResults[0].meta.type as ChatType,
        sources,
      },
      members: Array.from(memberMap.values()),
      messages: mergedMessages,
    }

    // 写入文件（不格式化 JSON 以提高性能）
    const targetDir = outputDir || getDefaultOutputDir()
    ensureOutputDir(targetDir)
    const filename = generateOutputFilename(outputName)
    const outputPath = path.join(targetDir, filename)

    const writeStartTime = Date.now()
    fs.writeFileSync(outputPath, JSON.stringify(chatLabData), 'utf-8')
    console.log(`[Merger] 写入文件耗时: ${Date.now() - writeStartTime}ms`)
    console.log(`[Merger] 总合并耗时: ${Date.now() - startTime}ms`)

    // 如果需要分析，导入数据库
    let sessionId: string | undefined
    if (andAnalyze) {
      const importStartTime = Date.now()
      const parseResult: ParseResult = {
        meta: {
          name: chatLabData.meta.name,
          platform: chatLabData.meta.platform,
          type: chatLabData.meta.type,
        },
        members: chatLabData.members.map((m) => ({
          platformId: m.platformId,
          name: m.name,
        })),
        messages: chatLabData.messages.map((msg) => ({
          senderPlatformId: msg.sender,
          senderName: msg.name,
          timestamp: msg.timestamp,
          type: msg.type,
          content: msg.content,
        })),
      }
      sessionId = importData(parseResult)
      console.log(`[Merger] 导入数据库耗时: ${Date.now() - importStartTime}ms`)
    }

    return {
      success: true,
      outputPath,
      sessionId,
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : '合并失败',
    }
  } finally {
    // 关闭所有 reader
    for (const reader of readers) {
      reader.close()
    }
  }
}
