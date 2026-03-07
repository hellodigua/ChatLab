/**
 * Message queries (server-side)
 * Ported from electron/main/worker/query/messages.ts — no worker_threads.
 */

import { openDatabase, buildTimeFilter, type TimeFilter } from '../db-pool'
import { ensureAvatarColumn } from './helpers'
import type { MessageResult, PaginatedMessages, MessagesWithTotal } from './types'

interface DbMessageRow {
  id: number
  senderId: number
  senderName: string
  senderPlatformId: string
  aliases: string | null
  avatar: string | null
  content: string
  timestamp: number
  type: number
  reply_to_message_id: string | null
  replyToContent: string | null
  replyToSenderName: string | null
}

function sanitizeMessageRow(row: DbMessageRow): MessageResult {
  let aliases: string[] = []
  if (row.aliases) {
    try { aliases = JSON.parse(row.aliases) } catch { /* */ }
  }
  return {
    id: Number(row.id),
    senderId: Number(row.senderId),
    senderName: String(row.senderName || ''),
    senderPlatformId: String(row.senderPlatformId || ''),
    senderAliases: aliases,
    senderAvatar: row.avatar || null,
    content: row.content != null ? String(row.content) : '',
    timestamp: Number(row.timestamp),
    type: Number(row.type),
    replyToMessageId: row.reply_to_message_id || null,
    replyToContent: row.replyToContent || null,
    replyToSenderName: row.replyToSenderName || null,
  }
}

function buildSenderCondition(senderId?: number): { condition: string; params: number[] } {
  if (senderId === undefined) return { condition: '', params: [] }
  return { condition: 'AND msg.sender_id = ?', params: [senderId] }
}

function buildKeywordCondition(keywords?: string[]): { condition: string; params: string[] } {
  if (!keywords || keywords.length === 0) return { condition: '', params: [] }
  const condition = `AND (${keywords.map(() => 'msg.content LIKE ?').join(' OR ')})`
  const params = keywords.map((k) => `%${k}%`)
  return { condition, params }
}

const SYSTEM_FILTER = "AND COALESCE(m.account_name, '') != '系统消息'"
const TEXT_ONLY_FILTER = "AND msg.type = 0 AND msg.content IS NOT NULL AND msg.content != ''"

const MSG_SELECT = `
  SELECT msg.id, m.id as senderId,
    COALESCE(m.group_nickname, m.account_name, m.platform_id) as senderName,
    m.platform_id as senderPlatformId, m.aliases, m.avatar, msg.content,
    msg.ts as timestamp, msg.type, msg.reply_to_message_id,
    reply_msg.content as replyToContent,
    COALESCE(reply_m.group_nickname, reply_m.account_name, reply_m.platform_id) as replyToSenderName
  FROM message msg
  JOIN member m ON msg.sender_id = m.id
  LEFT JOIN message reply_msg ON msg.reply_to_message_id = reply_msg.platform_message_id
  LEFT JOIN member reply_m ON reply_msg.sender_id = reply_m.id`

export function getRecentMessages(sessionId: string, filter?: TimeFilter, limit = 100): MessagesWithTotal {
  ensureAvatarColumn(sessionId)
  const db = openDatabase(sessionId)
  if (!db) return { messages: [], total: 0 }
  const { clause: tc, params: tp } = buildTimeFilter(filter, 'msg')
  const timeCond = tc ? tc.replace('WHERE', 'AND') : ''
  const total = (db.prepare(
    `SELECT COUNT(*) as total FROM message msg JOIN member m ON msg.sender_id = m.id
     WHERE 1=1 ${timeCond} ${SYSTEM_FILTER} ${TEXT_ONLY_FILTER}`,
  ).get(...tp) as { total: number }).total
  const rows = db.prepare(
    `${MSG_SELECT} WHERE 1=1 ${timeCond} ${SYSTEM_FILTER} ${TEXT_ONLY_FILTER} ORDER BY msg.ts DESC LIMIT ?`,
  ).all(...tp, limit) as DbMessageRow[]
  return { messages: rows.map(sanitizeMessageRow).reverse(), total }
}

export function getAllRecentMessages(sessionId: string, filter?: TimeFilter, limit = 100): MessagesWithTotal {
  ensureAvatarColumn(sessionId)
  const db = openDatabase(sessionId)
  if (!db) return { messages: [], total: 0 }
  const { clause: tc, params: tp } = buildTimeFilter(filter, 'msg')
  const timeCond = tc ? tc.replace('WHERE', 'AND') : ''
  const total = (db.prepare(
    `SELECT COUNT(*) as total FROM message msg JOIN member m ON msg.sender_id = m.id WHERE 1=1 ${timeCond}`,
  ).get(...tp) as { total: number }).total
  const rows = db.prepare(
    `${MSG_SELECT} WHERE 1=1 ${timeCond} ORDER BY msg.ts DESC LIMIT ?`,
  ).all(...tp, limit) as DbMessageRow[]
  return { messages: rows.map(sanitizeMessageRow).reverse(), total }
}

export function searchMessages(
  sessionId: string, keywords: string[], filter?: TimeFilter,
  limit = 20, offset = 0, senderId?: number,
): MessagesWithTotal {
  ensureAvatarColumn(sessionId)
  const db = openDatabase(sessionId)
  if (!db) return { messages: [], total: 0 }

  let keywordCondition = '1=1'
  const keywordParams: string[] = []
  if (keywords.length > 0) {
    keywordCondition = `(${keywords.map(() => 'msg.content LIKE ?').join(' OR ')})`
    keywordParams.push(...keywords.map((k) => `%${k}%`))
  }
  const { clause: tc, params: tp } = buildTimeFilter(filter, 'msg')
  const timeCond = tc ? tc.replace('WHERE', 'AND') : ''
  const { condition: senderCond, params: sp } = buildSenderCondition(senderId)

  const total = (db.prepare(
    `SELECT COUNT(*) as total FROM message msg JOIN member m ON msg.sender_id = m.id
     WHERE ${keywordCondition} ${timeCond} ${senderCond}`,
  ).get(...keywordParams, ...tp, ...sp) as { total: number }).total

  const rows = db.prepare(
    `${MSG_SELECT} WHERE ${keywordCondition} ${timeCond} ${senderCond} ORDER BY msg.ts DESC LIMIT ? OFFSET ?`,
  ).all(...keywordParams, ...tp, ...sp, limit, offset) as DbMessageRow[]
  return { messages: rows.map(sanitizeMessageRow), total }
}

export function getMessageContext(
  sessionId: string, messageIds: number | number[], contextSize = 20,
): MessageResult[] {
  ensureAvatarColumn(sessionId)
  const db = openDatabase(sessionId)
  if (!db) return []
  const ids = Array.isArray(messageIds) ? messageIds : [messageIds]
  if (ids.length === 0) return []
  const contextIds = new Set<number>()
  for (const messageId of ids) {
    contextIds.add(messageId)
    const beforeRows = db.prepare('SELECT id FROM message WHERE id < ? ORDER BY id DESC LIMIT ?').all(messageId, contextSize) as { id: number }[]
    beforeRows.forEach((row) => contextIds.add(row.id))
    const afterRows = db.prepare('SELECT id FROM message WHERE id > ? ORDER BY id ASC LIMIT ?').all(messageId, contextSize) as { id: number }[]
    afterRows.forEach((row) => contextIds.add(row.id))
  }
  if (contextIds.size === 0) return []
  const idList = Array.from(contextIds)
  const placeholders = idList.map(() => '?').join(', ')
  const rows = db.prepare(
    `${MSG_SELECT} WHERE msg.id IN (${placeholders}) ORDER BY msg.id ASC`,
  ).all(...idList) as DbMessageRow[]
  return rows.map(sanitizeMessageRow)
}

export function getMessagesBefore(
  sessionId: string, beforeId: number, limit = 50,
  filter?: TimeFilter, senderId?: number, keywords?: string[],
): PaginatedMessages {
  ensureAvatarColumn(sessionId)
  const db = openDatabase(sessionId)
  if (!db) return { messages: [], hasMore: false }
  const { clause: tc, params: tp } = buildTimeFilter(filter, 'msg')
  const timeCond = tc ? tc.replace('WHERE', 'AND') : ''
  const { condition: kwCond, params: kwp } = buildKeywordCondition(keywords)
  const { condition: sCond, params: sp } = buildSenderCondition(senderId)
  const rows = db.prepare(
    `${MSG_SELECT} WHERE msg.id < ? ${timeCond} ${kwCond} ${sCond} ORDER BY msg.id DESC LIMIT ?`,
  ).all(beforeId, ...tp, ...kwp, ...sp, limit + 1) as DbMessageRow[]
  const hasMore = rows.length > limit
  const resultRows = hasMore ? rows.slice(0, limit) : rows
  return { messages: resultRows.map(sanitizeMessageRow).reverse(), hasMore }
}

export function getMessagesAfter(
  sessionId: string, afterId: number, limit = 50,
  filter?: TimeFilter, senderId?: number, keywords?: string[],
): PaginatedMessages {
  ensureAvatarColumn(sessionId)
  const db = openDatabase(sessionId)
  if (!db) return { messages: [], hasMore: false }
  const { clause: tc, params: tp } = buildTimeFilter(filter, 'msg')
  const timeCond = tc ? tc.replace('WHERE', 'AND') : ''
  const { condition: kwCond, params: kwp } = buildKeywordCondition(keywords)
  const { condition: sCond, params: sp } = buildSenderCondition(senderId)
  const rows = db.prepare(
    `${MSG_SELECT} WHERE msg.id > ? ${timeCond} ${kwCond} ${sCond} ORDER BY msg.id ASC LIMIT ?`,
  ).all(afterId, ...tp, ...kwp, ...sp, limit + 1) as DbMessageRow[]
  const hasMore = rows.length > limit
  const resultRows = hasMore ? rows.slice(0, limit) : rows
  return { messages: resultRows.map(sanitizeMessageRow), hasMore }
}

export function getConversationBetween(
  sessionId: string, memberId1: number, memberId2: number,
  filter?: TimeFilter, limit = 100,
): MessagesWithTotal & { member1Name: string; member2Name: string } {
  ensureAvatarColumn(sessionId)
  const db = openDatabase(sessionId)
  if (!db) return { messages: [], total: 0, member1Name: '', member2Name: '' }
  const m1 = db.prepare(`SELECT COALESCE(group_nickname, account_name, platform_id) as name FROM member WHERE id = ?`).get(memberId1) as { name: string } | undefined
  const m2 = db.prepare(`SELECT COALESCE(group_nickname, account_name, platform_id) as name FROM member WHERE id = ?`).get(memberId2) as { name: string } | undefined
  if (!m1 || !m2) return { messages: [], total: 0, member1Name: '', member2Name: '' }
  const { clause: tc, params: tp } = buildTimeFilter(filter, 'msg')
  const timeCond = tc ? tc.replace('WHERE', 'AND') : ''
  const total = (db.prepare(
    `SELECT COUNT(*) as total FROM message msg JOIN member m ON msg.sender_id = m.id
     WHERE msg.sender_id IN (?, ?) ${timeCond} AND msg.content IS NOT NULL AND msg.content != ''`,
  ).get(memberId1, memberId2, ...tp) as { total: number }).total
  const rows = db.prepare(
    `${MSG_SELECT} WHERE msg.sender_id IN (?, ?) ${timeCond}
     AND msg.content IS NOT NULL AND msg.content != '' ORDER BY msg.ts DESC LIMIT ?`,
  ).all(memberId1, memberId2, ...tp, limit) as DbMessageRow[]
  return { messages: rows.map(sanitizeMessageRow).reverse(), total, member1Name: m1.name, member2Name: m2.name }
}
