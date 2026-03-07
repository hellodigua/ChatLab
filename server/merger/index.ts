/**
 * Chat record merge module (server-side)
 *
 * Ported from electron/main/merger/index.ts — no Electron dependencies.
 * Supports merging multiple chat record files into ChatLab format.
 */

import * as fs from 'fs'
import * as path from 'path'
import { TempDbReader } from './tempCache'
import { getAppDataDir, ensureDir } from '../paths'
import { importData } from '../database/core'
import Database from 'better-sqlite3'
import { getDbPath } from '../services/import'
import type { ParsedMember, ParsedMessage } from '../parser/types'
import type { ChatPlatform, ChatType } from '../../src/types/base'
import type {
  ChatLabFormat,
  ChatLabMember,
  ChatLabMessage,
} from '../../src/types/format'
import type {
  ConflictCheckResult,
  MergeConflict,
  MergeParams,
  MergeResult,
  MergeSource,
} from '../../src/types/format'

// ==================== Helpers ====================

/**
 * Get the default output directory for merged files.
 */
function getDefaultOutputDir(): string {
  return path.join(getAppDataDir(), 'downloads')
}

/**
 * Ensure an output directory exists.
 */
function ensureOutputDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/**
 * Generate a filename for the merged output.
 */
function generateOutputFilename(name: string, format: 'json' | 'jsonl' = 'json'): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const safeName = name.replace(/[/\\?%*:|"<>]/g, '_')
  return `${safeName}_merged_${date}.${format}`
}

/**
 * Generate a unique message key for deduplication and conflict detection.
 */
function getMessageKey(msg: ParsedMessage): string {
  return `${msg.timestamp}_${msg.senderPlatformId}_${(msg.content || '').length}`
}

/**
 * Check if a message is an image-only message.
 */
function isImageOnlyMessage(content: string | undefined): boolean {
  if (!content) return false
  return /^\[图片:\s*.+\]$/.test(content.trim())
}

// ==================== Conflict Detection ====================

/**
 * Detect conflicts among a set of messages from multiple sources.
 */
function detectConflictsInMessages(
  allMessages: Array<{ msg: ParsedMessage; source: string }>,
  conflicts: MergeConflict[],
): ConflictCheckResult {
  // Group by timestamp
  const timeGroups = new Map<number, Array<{ msg: ParsedMessage; source: string }>>()
  for (const item of allMessages) {
    const ts = item.msg.timestamp
    if (!timeGroups.has(ts)) {
      timeGroups.set(ts, [])
    }
    timeGroups.get(ts)!.push(item)
  }

  let autoDeduplicatedCount = 0

  for (const [ts, items] of timeGroups) {
    if (items.length < 2) continue

    // Group by sender
    const senderGroups = new Map<string, Array<{ msg: ParsedMessage; source: string }>>()
    for (const item of items) {
      const sender = item.msg.senderPlatformId
      if (!senderGroups.has(sender)) {
        senderGroups.set(sender, [])
      }
      senderGroups.get(sender)!.push(item)
    }

    for (const [sender, senderItems] of senderGroups) {
      if (senderItems.length < 2) continue

      // Check if messages come from different files
      const sources = new Set(senderItems.map((it) => it.source))
      if (sources.size < 2) continue

      // Group by content
      const contentGroups = new Map<string, Array<{ msg: ParsedMessage; source: string }>>()
      for (const item of senderItems) {
        const content = item.msg.content || ''
        if (!contentGroups.has(content)) {
          contentGroups.set(content, [])
        }
        contentGroups.get(content)!.push(item)
      }

      // Count auto-deduplicated messages
      for (const [, contentItems] of contentGroups) {
        if (contentItems.length > 1) {
          const contentSources = new Set(contentItems.map((it) => it.source))
          if (contentSources.size > 1) {
            autoDeduplicatedCount += contentItems.length - 1
          }
        }
      }

      // Only real conflicts when different content exists
      if (contentGroups.size > 1) {
        const contentEntries = Array.from(contentGroups.entries())

        for (let i = 0; i < contentEntries.length - 1; i++) {
          for (let j = i + 1; j < contentEntries.length; j++) {
            const [content1, items1] = contentEntries[i]
            const [content2, items2] = contentEntries[j]

            const item1 = items1[0]
            const item2 = items2.find((it) => it.source !== item1.source)
            if (!item2) continue

            // Skip image-only conflicts
            if (isImageOnlyMessage(content1) && isImageOnlyMessage(content2)) {
              autoDeduplicatedCount++
              continue
            }

            conflicts.push({
              id: `conflict_${ts}_${sender}_${conflicts.length}`,
              timestamp: ts,
              sender: item1.msg.senderAccountName || sender,
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

  // Calculate deduplicated message count
  const uniqueKeys = new Set<string>()
  for (const item of allMessages) {
    uniqueKeys.add(getMessageKey(item.msg))
  }

  return {
    conflicts,
    totalMessages: uniqueKeys.size,
  }
}

// ==================== Temp Database Merge Operations ====================

/**
 * Check merge conflicts using temporary databases (memory-friendly).
 */
export async function checkConflictsWithTempDb(
  filePaths: string[],
  tempDbCache: Map<string, string>,
): Promise<ConflictCheckResult> {
  const allMessages: Array<{ msg: ParsedMessage; source: string }> = []
  const conflicts: MergeConflict[] = []

  const readers: TempDbReader[] = []
  try {
    for (const filePath of filePaths) {
      const tempDbPath = tempDbCache.get(filePath)
      if (!tempDbPath) {
        throw new Error(`Temp database not found for file: ${path.basename(filePath)}`)
      }

      const reader = new TempDbReader(tempDbPath)
      readers.push(reader)

      const sourceName = path.basename(filePath)

      reader.streamMessages(10000, (messages) => {
        for (const msg of messages) {
          allMessages.push({ msg, source: sourceName })
        }
      })
    }

    // Check format consistency
    const platforms = readers.map((r) => r.getMeta()?.platform || 'unknown')
    const uniquePlatforms = [...new Set(platforms)]
    if (uniquePlatforms.length > 1) {
      throw new Error(
        `Cannot merge files with different formats. Detected: ${uniquePlatforms.join(', ')}`,
      )
    }

    return detectConflictsInMessages(allMessages, conflicts)
  } finally {
    for (const reader of readers) {
      reader.close()
    }
  }
}

/**
 * Merge multiple chat files using temporary databases (memory-friendly).
 */
export async function mergeFilesWithTempDb(
  params: MergeParams,
  tempDbCache: Map<string, string>,
): Promise<MergeResult> {
  const { filePaths, outputName, outputDir, outputFormat = 'json', andAnalyze } = params

  const readers: TempDbReader[] = []

  try {
    const parseResults: Array<{
      meta: NonNullable<ReturnType<TempDbReader['getMeta']>>
      members: ParsedMember[]
      source: string
      reader: TempDbReader
    }> = []

    for (const filePath of filePaths) {
      const tempDbPath = tempDbCache.get(filePath)
      if (!tempDbPath) {
        throw new Error(`Temp database not found for file: ${path.basename(filePath)}`)
      }

      const reader = new TempDbReader(tempDbPath)
      readers.push(reader)

      const meta = reader.getMeta()
      if (!meta) {
        throw new Error(`Cannot read meta info: ${path.basename(filePath)}`)
      }

      const members = reader.getMembers()
      const sourceName = path.basename(filePath)

      parseResults.push({ meta, members, source: sourceName, reader })
    }

    // Merge members
    const memberMap = new Map<string, ChatLabMember>()
    for (const { members } of parseResults) {
      for (const member of members) {
        const existing = memberMap.get(member.platformId)
        if (existing) {
          if (member.accountName) existing.accountName = member.accountName
          if (member.groupNickname) existing.groupNickname = member.groupNickname
          if (member.avatar) existing.avatar = member.avatar
        } else {
          memberMap.set(member.platformId, {
            platformId: member.platformId,
            accountName: member.accountName,
            groupNickname: member.groupNickname,
            avatar: member.avatar,
          })
        }
      }
    }

    // Stream merge messages with deduplication
    const seenKeys = new Set<string>()
    const mergedMessages: ChatLabMessage[] = []

    for (const { reader, source } of parseResults) {
      reader.streamMessages(10000, (messages) => {
        for (const msg of messages) {
          const key = getMessageKey(msg)
          if (seenKeys.has(key)) continue
          seenKeys.add(key)

          mergedMessages.push({
            sender: msg.senderPlatformId,
            accountName: msg.senderAccountName,
            groupNickname: msg.senderGroupNickname,
            timestamp: msg.timestamp,
            type: msg.type,
            content: msg.content,
          })
        }
      })
    }

    // Sort by timestamp
    mergedMessages.sort((a, b) => a.timestamp - b.timestamp)

    // Determine platform
    const platform = parseResults[0].meta.platform

    // Determine group ID and avatar
    const groupIds = new Set(parseResults.map((r) => r.meta.groupId).filter(Boolean))
    const groupId = groupIds.size === 1 ? parseResults.find((r) => r.meta.groupId)?.meta.groupId : undefined
    const groupAvatar = groupId
      ? parseResults.filter((r) => r.meta.groupId === groupId).pop()?.meta.groupAvatar
      : undefined

    // Build source info
    const sources: MergeSource[] = parseResults.map(({ reader, source, meta }) => ({
      filename: source,
      platform: meta.platform,
      messageCount: reader.getMessageCount(),
    }))

    // Build ChatLab format data
    const chatLabHeader = {
      version: '0.0.1',
      exportedAt: Math.floor(Date.now() / 1000),
      generator: 'ChatLab Merge Tool',
      description: `Merged from ${parseResults.length} files`,
    }

    const chatLabMeta = {
      name: outputName,
      platform: platform as ChatPlatform,
      type: parseResults[0].meta.type as ChatType,
      sources,
      groupId,
      groupAvatar,
    }

    const chatLabMembers = Array.from(memberMap.values())

    // Write output file
    const targetDir = outputDir || getDefaultOutputDir()
    ensureOutputDir(targetDir)
    const filename = generateOutputFilename(outputName, outputFormat)
    const outputPath = path.join(targetDir, filename)

    if (outputFormat === 'jsonl') {
      const writeStream = fs.createWriteStream(outputPath, { encoding: 'utf-8' })

      writeStream.write(
        JSON.stringify({
          _type: 'header',
          chatlab: chatLabHeader,
          meta: chatLabMeta,
        }) + '\n',
      )

      for (const member of chatLabMembers) {
        writeStream.write(
          JSON.stringify({
            _type: 'member',
            ...member,
          }) + '\n',
        )
      }

      for (const msg of mergedMessages) {
        writeStream.write(
          JSON.stringify({
            _type: 'message',
            ...msg,
          }) + '\n',
        )
      }

      writeStream.end()
      await new Promise<void>((resolve, reject) => {
        writeStream.on('finish', resolve)
        writeStream.on('error', reject)
      })
    } else {
      const chatLabData: ChatLabFormat = {
        chatlab: chatLabHeader,
        meta: chatLabMeta,
        members: chatLabMembers,
        messages: mergedMessages,
      }
      fs.writeFileSync(outputPath, JSON.stringify(chatLabData, null, 2), 'utf-8')
    }

    // If analyze requested, import into database
    let sessionId: string | undefined
    if (andAnalyze) {
      const parseResult = {
        meta: {
          name: chatLabMeta.name,
          platform: chatLabMeta.platform,
          type: chatLabMeta.type,
          groupId: chatLabMeta.groupId,
          groupAvatar: chatLabMeta.groupAvatar,
        },
        members: chatLabMembers.map((m) => ({
          platformId: m.platformId,
          accountName: m.accountName,
          groupNickname: m.groupNickname,
          avatar: m.avatar,
        })),
        messages: mergedMessages.map((msg) => ({
          senderPlatformId: msg.sender,
          senderAccountName: msg.accountName,
          senderGroupNickname: msg.groupNickname,
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
      error: err instanceof Error ? err.message : 'Merge failed',
    }
  } finally {
    for (const reader of readers) {
      reader.close()
    }
  }
}

// ==================== Session Export ====================

/**
 * Export a session database to a temporary JSON file.
 * Used for batch management merge operations.
 */
export async function exportSessionToTempFile(sessionId: string): Promise<string> {
  const dbPath = getDbPath(sessionId)
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Session database not found: ${sessionId}`)
  }

  const db = new Database(dbPath, { readonly: true })

  try {
    const meta = db.prepare('SELECT * FROM meta').get() as {
      name: string
      platform: string
      type: string
      group_id?: string
      group_avatar?: string
    }

    if (!meta) {
      throw new Error('Cannot read session meta info')
    }

    const members = db
      .prepare('SELECT platform_id, account_name, group_nickname, avatar FROM member')
      .all() as Array<{
      platform_id: string
      account_name?: string
      group_nickname?: string
      avatar?: string
    }>

    const messages = db
      .prepare(
        `SELECT
          m.platform_id as sender,
          msg.sender_account_name as accountName,
          msg.sender_group_nickname as groupNickname,
          msg.ts as timestamp,
          msg.type,
          msg.content
        FROM message msg
        JOIN member m ON msg.sender_id = m.id
        ORDER BY msg.ts`,
      )
      .all() as Array<{
      sender: string
      accountName?: string
      groupNickname?: string
      timestamp: number
      type: number
      content?: string
    }>

    const chatLabData: ChatLabFormat = {
      chatlab: {
        version: '0.0.1',
        exportedAt: Math.floor(Date.now() / 1000),
        generator: 'ChatLab Export',
        description: `Exported from session: ${meta.name}`,
      },
      meta: {
        name: meta.name,
        platform: meta.platform as ChatPlatform,
        type: meta.type as ChatType,
        groupId: meta.group_id,
        groupAvatar: meta.group_avatar,
      },
      members: members.map((m) => ({
        platformId: m.platform_id,
        accountName: m.account_name || m.platform_id,
        groupNickname: m.group_nickname,
        avatar: m.avatar,
      })),
      messages: messages.map((msg) => ({
        sender: msg.sender,
        accountName: msg.accountName || msg.sender,
        groupNickname: msg.groupNickname,
        timestamp: msg.timestamp,
        type: msg.type,
        content: msg.content ?? null,
      })),
    }

    const tempDir = path.join(getDefaultOutputDir(), '.chatlab_temp')
    ensureOutputDir(tempDir)
    const tempFilePath = path.join(tempDir, `export_${sessionId}_${Date.now()}.json`)
    fs.writeFileSync(tempFilePath, JSON.stringify(chatLabData, null, 2), 'utf-8')

    return tempFilePath
  } finally {
    db.close()
  }
}

/**
 * Clean up temporary export files.
 */
export function cleanupTempExportFiles(filePaths: string[]): void {
  for (const filePath of filePaths) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
    } catch (err) {
      console.error(`[Merger] Failed to clean up temp file: ${filePath}`, err)
    }
  }
}
