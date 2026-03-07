/**
 * Session index management (server-side)
 * Ported from electron/main/worker/query/session/sessionIndex.ts — no worker_threads.
 */

import { openWritableDatabase, openReadonlyDatabase, closeDatabase } from '../db-pool'
import { DEFAULT_SESSION_GAP_THRESHOLD, type ChatSessionItem } from './types'
import type Database from 'better-sqlite3'

function clearSessionsInternal(db: Database.Database): void {
  db.exec('DELETE FROM message_context')
  db.exec('DELETE FROM chat_session')
}

export function generateSessions(
  sessionId: string,
  gapThreshold: number = DEFAULT_SESSION_GAP_THRESHOLD,
  onProgress?: (current: number, total: number) => void,
): number {
  closeDatabase(sessionId)
  const db = openWritableDatabase(sessionId)
  if (!db) throw new Error(`Cannot open database: ${sessionId}`)

  try {
    const countResult = db.prepare('SELECT COUNT(*) as count FROM message').get() as { count: number }
    if (countResult.count === 0) return 0

    clearSessionsInternal(db)

    const messages = db.prepare(`
      WITH message_ordered AS (
        SELECT id, ts, LAG(ts) OVER (ORDER BY ts, id) AS prev_ts FROM message
      ),
      session_marks AS (
        SELECT id, ts, CASE WHEN prev_ts IS NULL OR (ts - prev_ts) > ? THEN 1 ELSE 0 END AS is_new_session
        FROM message_ordered
      ),
      session_ids AS (
        SELECT id, ts, SUM(is_new_session) OVER (ORDER BY ts, id) AS session_num FROM session_marks
      )
      SELECT id, ts, session_num FROM session_ids
    `).all(gapThreshold) as Array<{ id: number; ts: number; session_num: number }>

    if (messages.length === 0) return 0

    const sessionMap = new Map<number, { startTs: number; endTs: number; messageIds: number[] }>()
    for (const msg of messages) {
      const session = sessionMap.get(msg.session_num)
      if (!session) {
        sessionMap.set(msg.session_num, { startTs: msg.ts, endTs: msg.ts, messageIds: [msg.id] })
      } else {
        session.endTs = msg.ts
        session.messageIds.push(msg.id)
      }
    }

    const insertSession = db.prepare('INSERT INTO chat_session (start_ts, end_ts, message_count, is_manual, summary) VALUES (?, ?, ?, 0, NULL)')
    const insertContext = db.prepare('INSERT INTO message_context (message_id, session_id, topic_id) VALUES (?, ?, NULL)')

    const transaction = db.transaction(() => {
      let processedCount = 0
      const totalSessions = sessionMap.size
      for (const [, sessionData] of sessionMap) {
        const result = insertSession.run(sessionData.startTs, sessionData.endTs, sessionData.messageIds.length)
        const newSessionId = result.lastInsertRowid as number
        for (const messageId of sessionData.messageIds) insertContext.run(messageId, newSessionId)
        processedCount++
        if (onProgress && processedCount % 100 === 0) onProgress(processedCount, totalSessions)
      }
      return totalSessions
    })

    const sessionCount = transaction()
    if (onProgress) onProgress(sessionCount, sessionCount)
    return sessionCount
  } finally {
    db.close()
  }
}

export function generateIncrementalSessions(
  sessionId: string,
  gapThreshold: number = DEFAULT_SESSION_GAP_THRESHOLD,
): number {
  closeDatabase(sessionId)
  const db = openWritableDatabase(sessionId)
  if (!db) throw new Error(`Cannot open database: ${sessionId}`)

  try {
    const indexedIds = new Set<number>()
    const existingContextRows = db.prepare('SELECT message_id FROM message_context').all() as Array<{ message_id: number }>
    for (const row of existingContextRows) indexedIds.add(row.message_id)

    const allMessages = db.prepare('SELECT id, ts FROM message ORDER BY ts, id').all() as Array<{ id: number; ts: number }>
    const newMessages = allMessages.filter((m) => !indexedIds.has(m.id))
    if (newMessages.length === 0) return 0

    const lastSession = db.prepare('SELECT id, end_ts FROM chat_session ORDER BY end_ts DESC LIMIT 1').get() as { id: number; end_ts: number } | undefined
    newMessages.sort((a, b) => a.ts - b.ts || a.id - b.id)

    const insertSession = db.prepare('INSERT INTO chat_session (start_ts, end_ts, message_count, is_manual, summary) VALUES (?, ?, ?, 0, NULL)')
    const insertContext = db.prepare('INSERT INTO message_context (message_id, session_id, topic_id) VALUES (?, ?, NULL)')
    const updateSessionEndAndCount = db.prepare('UPDATE chat_session SET end_ts = ?, message_count = message_count + ? WHERE id = ?')

    const transaction = db.transaction(() => {
      let newSessionCount = 0
      let currentSessionId: number | null = null
      let currentEndTs = 0
      let appendCount = 0

      for (let i = 0; i < newMessages.length; i++) {
        const msg = newMessages[i]
        let needNewSession = false

        if (i === 0) {
          if (lastSession && msg.ts - lastSession.end_ts <= gapThreshold) {
            currentSessionId = lastSession.id
            currentEndTs = lastSession.end_ts
            appendCount = 0
          } else {
            needNewSession = true
          }
        } else {
          const prevMsg = newMessages[i - 1]
          if (msg.ts - prevMsg.ts > gapThreshold) {
            if (currentSessionId && appendCount > 0) {
              updateSessionEndAndCount.run(currentEndTs, appendCount, currentSessionId)
              appendCount = 0
            }
            needNewSession = true
          }
        }

        if (needNewSession) {
          const result = insertSession.run(msg.ts, msg.ts, 1)
          currentSessionId = result.lastInsertRowid as number
          currentEndTs = msg.ts
          newSessionCount++
          appendCount = 0
        } else {
          currentEndTs = msg.ts
          appendCount++
        }

        insertContext.run(msg.id, currentSessionId)
      }

      if (currentSessionId && appendCount > 0) {
        updateSessionEndAndCount.run(currentEndTs, appendCount, currentSessionId)
      }
      return newSessionCount
    })

    return transaction()
  } finally {
    db.close()
  }
}

export function clearSessions(sessionId: string): void {
  closeDatabase(sessionId)
  const db = openWritableDatabase(sessionId)
  if (!db) throw new Error(`Cannot open database: ${sessionId}`)
  try { clearSessionsInternal(db) } finally { db.close() }
}

export function hasSessionIndex(sessionId: string): boolean {
  const db = openReadonlyDatabase(sessionId)
  if (!db) return false
  try {
    const result = db.prepare('SELECT COUNT(*) as count FROM chat_session').get() as { count: number }
    return result.count > 0
  } catch { return false } finally { db.close() }
}

export function getSessionStats(sessionId: string): { sessionCount: number; hasIndex: boolean; gapThreshold: number } {
  const db = openReadonlyDatabase(sessionId)
  if (!db) return { sessionCount: 0, hasIndex: false, gapThreshold: DEFAULT_SESSION_GAP_THRESHOLD }
  try {
    let sessionCount = 0
    try { sessionCount = (db.prepare('SELECT COUNT(*) as count FROM chat_session').get() as { count: number }).count } catch { /* */ }
    let gapThreshold = DEFAULT_SESSION_GAP_THRESHOLD
    try { const r = db.prepare('SELECT session_gap_threshold FROM meta LIMIT 1').get() as { session_gap_threshold: number | null } | undefined; if (r?.session_gap_threshold) gapThreshold = r.session_gap_threshold } catch { /* */ }
    return { sessionCount, hasIndex: sessionCount > 0, gapThreshold }
  } finally { db.close() }
}

export function updateSessionGapThreshold(sessionId: string, gapThreshold: number | null): void {
  closeDatabase(sessionId)
  const db = openWritableDatabase(sessionId)
  if (!db) throw new Error(`Cannot open database: ${sessionId}`)
  try { db.prepare('UPDATE meta SET session_gap_threshold = ?').run(gapThreshold) } finally { db.close() }
}

export function getSessions(sessionId: string): ChatSessionItem[] {
  const db = openReadonlyDatabase(sessionId)
  if (!db) return []
  try {
    return db.prepare(`
      SELECT cs.id, cs.start_ts as startTs, cs.end_ts as endTs, cs.message_count as messageCount,
             cs.summary,
             (SELECT mc.message_id FROM message_context mc WHERE mc.session_id = cs.id ORDER BY mc.message_id LIMIT 1) as firstMessageId
      FROM chat_session cs ORDER BY cs.start_ts ASC
    `).all() as ChatSessionItem[]
  } catch { return [] } finally { db.close() }
}

export function saveSessionSummary(sessionId: string, chatSessionId: number, summary: string): void {
  closeDatabase(sessionId)
  const db = openWritableDatabase(sessionId)
  if (!db) throw new Error(`Cannot open database: ${sessionId}`)
  try { db.prepare('UPDATE chat_session SET summary = ? WHERE id = ?').run(summary, chatSessionId) } finally { db.close() }
}

export function getSessionSummary(sessionId: string, chatSessionId: number): string | null {
  const db = openReadonlyDatabase(sessionId)
  if (!db) return null
  try {
    const result = db.prepare('SELECT summary FROM chat_session WHERE id = ?').get(chatSessionId) as { summary: string | null } | undefined
    return result?.summary || null
  } catch { return null } finally { db.close() }
}
