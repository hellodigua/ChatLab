/**
 * Message filter queries (server-side)
 * Ported from electron/main/worker/query/session/filter.ts — no worker_threads.
 */

import { openReadonlyDatabase } from '../db-pool'
import type { FilterMessage, ContextBlock, FilterResultWithPagination } from './types'

export function filterMessagesWithContext(
  sessionId: string,
  keywords?: string[],
  timeFilter?: { startTs: number; endTs: number },
  senderIds?: number[],
  contextSize = 10,
  page = 1,
  pageSize = 50,
): FilterResultWithPagination {
  const db = openReadonlyDatabase(sessionId)
  const emptyResult: FilterResultWithPagination = {
    blocks: [], stats: { totalMessages: 0, hitMessages: 0, totalChars: 0 },
    pagination: { page, pageSize, totalBlocks: 0, totalHits: 0, hasMore: false },
  }
  if (!db) return emptyResult

  try {
    const lightweightSql = `SELECT id, ts, sender_id as senderId, content FROM message ${timeFilter ? 'WHERE ts >= ? AND ts <= ?' : ''} ORDER BY ts ASC, id ASC`
    const params: unknown[] = []
    if (timeFilter) { params.push(timeFilter.startTs, timeFilter.endTs) }

    const stmt = db.prepare(lightweightSql)
    const hitIndexes: number[] = []
    let totalMessageCount = 0

    for (const row of stmt.iterate(...params) as Iterable<{ id: number; ts: number; senderId: number; content: string | null }>) {
      let isHit = true
      if (keywords && keywords.length > 0) {
        const content = (row.content || '').toLowerCase()
        isHit = keywords.some((kw) => content.includes(kw.toLowerCase()))
      }
      if (isHit && senderIds && senderIds.length > 0) isHit = senderIds.includes(row.senderId)
      if (isHit) hitIndexes.push(totalMessageCount)
      totalMessageCount++
    }

    if (hitIndexes.length === 0) return emptyResult

    const ranges: Array<{ start: number; end: number; hitIndexes: number[] }> = []
    for (const hitIndex of hitIndexes) {
      const start = Math.max(0, hitIndex - contextSize)
      const end = Math.min(totalMessageCount - 1, hitIndex + contextSize)
      if (ranges.length > 0) {
        const lastRange = ranges[ranges.length - 1]
        if (start <= lastRange.end + 1) { lastRange.end = Math.max(lastRange.end, end); lastRange.hitIndexes.push(hitIndex); continue }
      }
      ranges.push({ start, end, hitIndexes: [hitIndex] })
    }

    const totalBlocks = ranges.length
    const totalHits = hitIndexes.length
    const startIndex = (page - 1) * pageSize
    const endIndex = Math.min(startIndex + pageSize, totalBlocks)
    const pageRanges = ranges.slice(startIndex, endIndex)
    const hasMore = endIndex < totalBlocks

    if (pageRanges.length === 0) {
      return { blocks: [], stats: { totalMessages: 0, hitMessages: totalHits, totalChars: 0 }, pagination: { page, pageSize, totalBlocks, totalHits, hasMore: false } }
    }

    const blocks: ContextBlock[] = []
    let totalMessages = 0
    let totalChars = 0

    for (const range of pageRanges) {
      const blockSql = `
        SELECT msg.id, msg.ts, COALESCE(m.group_nickname, m.account_name, m.platform_id) as senderName,
               m.platform_id as senderPlatformId, COALESCE(m.aliases, '[]') as senderAliasesJson,
               m.avatar as senderAvatar, msg.content, msg.type,
               msg.reply_to_message_id as replyToMessageId, reply_msg.content as replyToContent,
               COALESCE(reply_m.group_nickname, reply_m.account_name, reply_m.platform_id) as replyToSenderName
        FROM message msg JOIN member m ON msg.sender_id = m.id
        LEFT JOIN message reply_msg ON msg.reply_to_message_id = reply_msg.platform_message_id
        LEFT JOIN member reply_m ON reply_msg.sender_id = reply_m.id
        ${timeFilter ? 'WHERE msg.ts >= ? AND msg.ts <= ?' : ''}
        ORDER BY msg.ts ASC, msg.id ASC LIMIT ? OFFSET ?`

      const blockParams: unknown[] = []
      if (timeFilter) { blockParams.push(timeFilter.startTs, timeFilter.endTs) }
      blockParams.push(range.end - range.start + 1, range.start)

      const messages = db.prepare(blockSql).all(...blockParams) as Array<{
        id: number; ts: number; senderName: string; senderPlatformId: string; senderAliasesJson: string
        senderAvatar: string | null; content: string | null; type: number; replyToMessageId: string | null
        replyToContent: string | null; replyToSenderName: string | null
      }>

      const hitIndexSet = new Set(range.hitIndexes.map((idx) => idx - range.start))
      const blockMessages: FilterMessage[] = []
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i]
        let senderAliases: string[] = []
        try { senderAliases = JSON.parse(msg.senderAliasesJson || '[]') } catch { /* */ }
        blockMessages.push({
          id: msg.id, senderName: msg.senderName, senderPlatformId: msg.senderPlatformId,
          senderAliases, senderAvatar: msg.senderAvatar, content: msg.content || '',
          timestamp: msg.ts, type: msg.type, replyToMessageId: msg.replyToMessageId,
          replyToContent: msg.replyToContent, replyToSenderName: msg.replyToSenderName,
          isHit: hitIndexSet.has(i),
        })
        totalChars += (msg.content || '').length
      }

      if (blockMessages.length > 0) {
        blocks.push({ startTs: blockMessages[0].timestamp, endTs: blockMessages[blockMessages.length - 1].timestamp, messages: blockMessages, hitCount: range.hitIndexes.length })
        totalMessages += blockMessages.length
      }
    }

    return {
      blocks,
      stats: { totalMessages: page === 1 ? totalMessages : 0, hitMessages: totalHits, totalChars: page === 1 ? totalChars : 0 },
      pagination: { page, pageSize, totalBlocks, totalHits, hasMore },
    }
  } catch (error) {
    console.error('filterMessagesWithContext error:', error)
    return emptyResult
  } finally {
    db.close()
  }
}

export function getMultipleSessionsMessages(
  sessionId: string,
  chatSessionIds: number[],
  page = 1,
  pageSize = 50,
): FilterResultWithPagination {
  const db = openReadonlyDatabase(sessionId)
  const emptyResult: FilterResultWithPagination = {
    blocks: [], stats: { totalMessages: 0, hitMessages: 0, totalChars: 0 },
    pagination: { page, pageSize, totalBlocks: 0, totalHits: 0, hasMore: false },
  }
  if (!db || chatSessionIds.length === 0) return emptyResult

  try {
    const sessionsSql = `SELECT id, start_ts as startTs, end_ts as endTs, message_count as messageCount FROM chat_session WHERE id IN (${chatSessionIds.map(() => '?').join(',')}) ORDER BY start_ts ASC`
    const allSessions = db.prepare(sessionsSql).all(...chatSessionIds) as Array<{ id: number; startTs: number; endTs: number; messageCount: number }>
    const totalBlocks = allSessions.length
    const startIndex = (page - 1) * pageSize
    const endIndex = Math.min(startIndex + pageSize, totalBlocks)
    const pageSessions = allSessions.slice(startIndex, endIndex)
    const hasMore = endIndex < totalBlocks

    if (pageSessions.length === 0) return { blocks: [], stats: { totalMessages: 0, hitMessages: 0, totalChars: 0 }, pagination: { page, pageSize, totalBlocks, totalHits: 0, hasMore: false } }

    const blocks: ContextBlock[] = []
    let totalMessages = 0
    let totalChars = 0

    const messagesSql = `
      SELECT msg.id, COALESCE(m.group_nickname, m.account_name, m.platform_id) as senderName,
             m.platform_id as senderPlatformId, COALESCE(m.aliases, '[]') as senderAliasesJson,
             m.avatar as senderAvatar, msg.content, msg.type,
             msg.reply_to_message_id as replyToMessageId, reply_msg.content as replyToContent,
             COALESCE(reply_m.group_nickname, reply_m.account_name, reply_m.platform_id) as replyToSenderName,
             msg.ts as timestamp
      FROM message_context mc JOIN message msg ON msg.id = mc.message_id
      JOIN member m ON msg.sender_id = m.id
      LEFT JOIN message reply_msg ON msg.reply_to_message_id = reply_msg.platform_message_id
      LEFT JOIN member reply_m ON reply_msg.sender_id = reply_m.id
      WHERE mc.session_id = ? ORDER BY msg.ts ASC`

    for (const session of pageSessions) {
      const messages = db.prepare(messagesSql).all(session.id) as Array<{
        id: number; senderName: string; senderPlatformId: string; senderAliasesJson: string
        senderAvatar: string | null; content: string | null; type: number; replyToMessageId: string | null
        replyToContent: string | null; replyToSenderName: string | null; timestamp: number
      }>
      const blockMessages: FilterMessage[] = messages.map((msg) => {
        let senderAliases: string[] = []
        try { senderAliases = JSON.parse(msg.senderAliasesJson || '[]') } catch { /* */ }
        return {
          id: msg.id, senderName: msg.senderName, senderPlatformId: msg.senderPlatformId,
          senderAliases, senderAvatar: msg.senderAvatar, content: msg.content || '',
          timestamp: msg.timestamp, type: msg.type, replyToMessageId: msg.replyToMessageId,
          replyToContent: msg.replyToContent, replyToSenderName: msg.replyToSenderName, isHit: false,
        }
      })
      for (const msg of messages) totalChars += (msg.content || '').length
      blocks.push({ startTs: session.startTs, endTs: session.endTs, messages: blockMessages, hitCount: 0 })
      totalMessages += messages.length
    }

    return {
      blocks,
      stats: { totalMessages: page === 1 ? totalMessages : 0, hitMessages: 0, totalChars: page === 1 ? totalChars : 0 },
      pagination: { page, pageSize, totalBlocks, totalHits: 0, hasMore },
    }
  } catch (error) {
    console.error('getMultipleSessionsMessages error:', error)
    return emptyResult
  } finally {
    db.close()
  }
}
