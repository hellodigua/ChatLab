/**
 * AI tool queries (server-side)
 * Ported from electron/main/worker/query/session/aiTools.ts — no worker_threads.
 */

import { openReadonlyDatabase } from '../db-pool'
import type { SessionSearchResultItem, SessionMessagesResult } from './types'

export function searchSessions(
  sessionId: string,
  keywords?: string[],
  timeFilter?: { startTs: number; endTs: number },
  limit = 20,
  previewCount = 5,
): SessionSearchResultItem[] {
  const db = openReadonlyDatabase(sessionId)
  if (!db) return []
  try {
    let sessionSql = `SELECT cs.id, cs.start_ts as startTs, cs.end_ts as endTs, cs.message_count as messageCount FROM chat_session cs WHERE 1=1`
    const params: unknown[] = []

    if (timeFilter) {
      sessionSql += ' AND cs.start_ts >= ? AND cs.end_ts <= ?'
      params.push(timeFilter.startTs, timeFilter.endTs)
    }

    if (keywords && keywords.length > 0) {
      const keywordConditions = keywords.map(() => 'm.content LIKE ?').join(' OR ')
      sessionSql += ` AND cs.id IN (SELECT DISTINCT mc.session_id FROM message_context mc JOIN message m ON m.id = mc.message_id WHERE (${keywordConditions}))`
      for (const kw of keywords) params.push(`%${kw}%`)
    }

    sessionSql += ' ORDER BY cs.start_ts DESC LIMIT ?'
    params.push(limit)

    const sessions = db.prepare(sessionSql).all(...params) as Array<{ id: number; startTs: number; endTs: number; messageCount: number }>

    const previewSql = `
      SELECT m.id, COALESCE(mb.group_nickname, mb.account_name, mb.platform_id) as senderName,
             m.content, m.ts as timestamp
      FROM message_context mc JOIN message m ON m.id = mc.message_id
      JOIN member mb ON mb.id = m.sender_id WHERE mc.session_id = ? ORDER BY m.ts ASC LIMIT ?`

    return sessions.map((session) => {
      const previewMessages = db.prepare(previewSql).all(session.id, previewCount) as Array<{ id: number; senderName: string; content: string | null; timestamp: number }>
      return { id: session.id, startTs: session.startTs, endTs: session.endTs, messageCount: session.messageCount, isComplete: session.messageCount <= previewCount, previewMessages }
    })
  } catch (error) {
    console.error('searchSessions error:', error)
    return []
  } finally {
    db.close()
  }
}

export function getSessionMessages(sessionId: string, chatSessionId: number, limit = 500): SessionMessagesResult | null {
  const db = openReadonlyDatabase(sessionId)
  if (!db) return null
  try {
    const session = db.prepare('SELECT id, start_ts as startTs, end_ts as endTs, message_count as messageCount FROM chat_session WHERE id = ?').get(chatSessionId) as { id: number; startTs: number; endTs: number; messageCount: number } | undefined
    if (!session) { db.close(); return null }

    const messages = db.prepare(`
      SELECT m.id, COALESCE(mb.group_nickname, mb.account_name, mb.platform_id) as senderName,
             m.content, m.ts as timestamp
      FROM message_context mc JOIN message m ON m.id = mc.message_id
      JOIN member mb ON mb.id = m.sender_id WHERE mc.session_id = ? ORDER BY m.ts ASC LIMIT ?
    `).all(chatSessionId, limit) as Array<{ id: number; senderName: string; content: string | null; timestamp: number }>

    const participantsSet = new Set<string>()
    for (const msg of messages) participantsSet.add(msg.senderName)

    return { sessionId: session.id, startTs: session.startTs, endTs: session.endTs, messageCount: session.messageCount, returnedCount: messages.length, participants: Array.from(participantsSet), messages }
  } catch (error) {
    console.error('getSessionMessages error:', error)
    return null
  } finally {
    db.close()
  }
}
