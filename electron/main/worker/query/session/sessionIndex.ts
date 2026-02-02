/**
 * 会话索引管理模块
 * 提供会话生成、查询、管理等功能
 */

import type Database from 'better-sqlite3'
import { openWritableDatabase, openReadonlyDatabase, closeDatabase } from './core'
import { DEFAULT_SESSION_GAP_THRESHOLD, type ChatSessionItem } from './types'

/**
 * 内部清空会话数据函数
 */
function clearSessionsInternal(db: Database.Database): void {
  db.exec('DELETE FROM message_context')
  db.exec('DELETE FROM chat_session')
}

/**
 * 生成会话索引
 * 使用 Gap-based 算法，根据消息时间间隔自动切分会话
 *
 * @param sessionId 数据库会话ID
 * @param gapThreshold 时间间隔阈值（秒），默认 1800（30分钟）
 * @param onProgress 进度回调
 * @returns 生成的会话数量
 */
export function generateSessions(
  sessionId: string,
  gapThreshold: number = DEFAULT_SESSION_GAP_THRESHOLD,
  onProgress?: (current: number, total: number) => void
): number {
  // 先关闭缓存的只读连接
  closeDatabase(sessionId)

  const db = openWritableDatabase(sessionId)
  if (!db) {
    throw new Error(`无法打开数据库: ${sessionId}`)
  }

  try {
    // 获取消息总数
    const countResult = db.prepare('SELECT COUNT(*) as count FROM message').get() as { count: number }
    const totalMessages = countResult.count

    if (totalMessages === 0) {
      return 0
    }

    // 清空已有的会话数据
    clearSessionsInternal(db)

    // 使用窗口函数计算会话边界
    // 步骤1：为每条消息计算与前一条的时间差，标记新会话起点
    const sessionMarkSQL = `
      WITH message_ordered AS (
        SELECT
          id,
          ts,
          LAG(ts) OVER (ORDER BY ts, id) AS prev_ts
        FROM message
      ),
      session_marks AS (
        SELECT
          id,
          ts,
          CASE
            WHEN prev_ts IS NULL OR (ts - prev_ts) > ? THEN 1
            ELSE 0
          END AS is_new_session
        FROM message_ordered
      ),
      session_ids AS (
        SELECT
          id,
          ts,
          SUM(is_new_session) OVER (ORDER BY ts, id) AS session_num
        FROM session_marks
      )
      SELECT id, ts, session_num FROM session_ids
    `

    const messages = db.prepare(sessionMarkSQL).all(gapThreshold) as Array<{
      id: number
      ts: number
      session_num: number
    }>

    if (messages.length === 0) {
      return 0
    }

    // 步骤2：计算每个会话的统计信息
    const sessionMap = new Map<number, { startTs: number; endTs: number; messageIds: number[] }>()

    for (const msg of messages) {
      const session = sessionMap.get(msg.session_num)
      if (!session) {
        sessionMap.set(msg.session_num, {
          startTs: msg.ts,
          endTs: msg.ts,
          messageIds: [msg.id],
        })
      } else {
        session.endTs = msg.ts
        session.messageIds.push(msg.id)
      }
    }

    // 步骤3：批量写入 chat_session 和 message_context 表
    const insertSession = db.prepare(`
      INSERT INTO chat_session (start_ts, end_ts, message_count, is_manual, summary)
      VALUES (?, ?, ?, 0, NULL)
    `)

    const insertContext = db.prepare(`
      INSERT INTO message_context (message_id, session_id, topic_id)
      VALUES (?, ?, NULL)
    `)

    // 开始事务
    const transaction = db.transaction(() => {
      let processedCount = 0
      const totalSessions = sessionMap.size

      for (const [, sessionData] of sessionMap) {
        // 插入会话记录
        const result = insertSession.run(sessionData.startTs, sessionData.endTs, sessionData.messageIds.length)
        const newSessionId = result.lastInsertRowid as number

        // 批量插入消息上下文
        for (const messageId of sessionData.messageIds) {
          insertContext.run(messageId, newSessionId)
        }

        processedCount++
        if (onProgress && processedCount % 100 === 0) {
          onProgress(processedCount, totalSessions)
        }
      }

      return totalSessions
    })

    const sessionCount = transaction()

    // 最终进度回调
    if (onProgress) {
      onProgress(sessionCount, sessionCount)
    }

    return sessionCount
  } finally {
    db.close()
  }
}

/**
 * 清空会话索引数据
 * @param sessionId 数据库会话ID
 */
export function clearSessions(sessionId: string): void {
  // 先关闭缓存的只读连接
  closeDatabase(sessionId)

  const db = openWritableDatabase(sessionId)
  if (!db) {
    throw new Error(`无法打开数据库: ${sessionId}`)
  }

  try {
    clearSessionsInternal(db)
  } finally {
    db.close()
  }
}

/**
 * 检查是否已生成会话索引
 * @param sessionId 数据库会话ID
 * @returns 是否有会话索引
 */
export function hasSessionIndex(sessionId: string): boolean {
  const db = openReadonlyDatabase(sessionId)
  if (!db) {
    return false
  }

  try {
    // 检查 chat_session 表是否存在且有数据
    const result = db.prepare('SELECT COUNT(*) as count FROM chat_session').get() as { count: number }
    return result.count > 0
  } catch {
    // 表可能不存在
    return false
  } finally {
    db.close()
  }
}

/**
 * 获取会话索引统计信息
 * @param sessionId 数据库会话ID
 */
export function getSessionStats(sessionId: string): {
  sessionCount: number
  hasIndex: boolean
  gapThreshold: number
} {
  const db = openReadonlyDatabase(sessionId)
  if (!db) {
    return { sessionCount: 0, hasIndex: false, gapThreshold: DEFAULT_SESSION_GAP_THRESHOLD }
  }

  try {
    // 获取会话数量
    let sessionCount = 0
    try {
      const countResult = db.prepare('SELECT COUNT(*) as count FROM chat_session').get() as { count: number }
      sessionCount = countResult.count
    } catch {
      // 表可能不存在
    }

    // 获取配置的阈值
    let gapThreshold = DEFAULT_SESSION_GAP_THRESHOLD
    try {
      const metaResult = db.prepare('SELECT session_gap_threshold FROM meta LIMIT 1').get() as
        | {
            session_gap_threshold: number | null
          }
        | undefined
      if (metaResult?.session_gap_threshold) {
        gapThreshold = metaResult.session_gap_threshold
      }
    } catch {
      // 字段可能不存在
    }

    return {
      sessionCount,
      hasIndex: sessionCount > 0,
      gapThreshold,
    }
  } finally {
    db.close()
  }
}

/**
 * 更新单个聊天的会话切分阈值
 * @param sessionId 数据库会话ID
 * @param gapThreshold 阈值（秒），null 表示使用全局配置
 */
export function updateSessionGapThreshold(sessionId: string, gapThreshold: number | null): void {
  // 先关闭缓存的只读连接
  closeDatabase(sessionId)

  const db = openWritableDatabase(sessionId)
  if (!db) {
    throw new Error(`无法打开数据库: ${sessionId}`)
  }

  try {
    db.prepare('UPDATE meta SET session_gap_threshold = ?').run(gapThreshold)
  } finally {
    db.close()
  }
}

/**
 * 获取会话列表（用于时间线导航）
 * @param sessionId 数据库会话ID
 * @returns 会话列表，按时间排序
 */
export function getSessions(sessionId: string): ChatSessionItem[] {
  const db = openReadonlyDatabase(sessionId)
  if (!db) {
    return []
  }

  try {
    // 查询会话列表，同时获取每个会话的首条消息 ID 和摘要
    const sql = `
      SELECT
        cs.id,
        cs.start_ts as startTs,
        cs.end_ts as endTs,
        cs.message_count as messageCount,
        cs.summary,
        (SELECT mc.message_id FROM message_context mc WHERE mc.session_id = cs.id ORDER BY mc.message_id LIMIT 1) as firstMessageId
      FROM chat_session cs
      ORDER BY cs.start_ts ASC
    `
    const sessions = db.prepare(sql).all() as ChatSessionItem[]
    return sessions
  } catch {
    return []
  } finally {
    db.close()
  }
}

// ==================== 会话摘要相关函数 ====================

/**
 * 保存会话摘要
 * @param sessionId 数据库会话ID
 * @param chatSessionId 会话索引中的会话ID
 * @param summary 摘要内容
 */
export function saveSessionSummary(sessionId: string, chatSessionId: number, summary: string): void {
  // 先关闭缓存的只读连接
  closeDatabase(sessionId)

  const db = openWritableDatabase(sessionId)
  if (!db) {
    throw new Error(`无法打开数据库: ${sessionId}`)
  }

  try {
    db.prepare('UPDATE chat_session SET summary = ? WHERE id = ?').run(summary, chatSessionId)
  } finally {
    db.close()
  }
}

/**
 * 获取会话摘要
 * @param sessionId 数据库会话ID
 * @param chatSessionId 会话索引中的会话ID
 * @returns 摘要内容
 */
export function getSessionSummary(sessionId: string, chatSessionId: number): string | null {
  const db = openReadonlyDatabase(sessionId)
  if (!db) {
    return null
  }

  try {
    const result = db.prepare('SELECT summary FROM chat_session WHERE id = ?').get(chatSessionId) as
      | { summary: string | null }
      | undefined
    return result?.summary || null
  } catch {
    return null
  } finally {
    db.close()
  }
}
