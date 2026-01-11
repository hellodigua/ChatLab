/**
 * 会话索引模块
 * 提供基于时间间隔的会话切分算法
 */

import Database from 'better-sqlite3'
import { getDbPath, closeDatabase } from '../core'

/** 默认会话切分阈值：30分钟（秒） */
export const DEFAULT_SESSION_GAP_THRESHOLD = 1800

/**
 * 打开数据库（可写模式，不使用缓存）
 * 会话索引需要写入数据
 */
function openWritableDatabase(sessionId: string): Database.Database | null {
  const dbPath = getDbPath(sessionId)
  try {
    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    return db
  } catch {
    return null
  }
}

/**
 * 打开数据库（只读模式，不使用缓存）
 */
function openReadonlyDatabase(sessionId: string): Database.Database | null {
  const dbPath = getDbPath(sessionId)
  try {
    const db = new Database(dbPath, { readonly: true })
    db.pragma('journal_mode = WAL')
    return db
  } catch {
    return null
  }
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
 * 内部清空会话数据函数
 */
function clearSessionsInternal(db: Database.Database): void {
  db.exec('DELETE FROM message_context')
  db.exec('DELETE FROM chat_session')
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
 * 会话列表项类型
 */
export interface ChatSessionItem {
  id: number
  startTs: number
  endTs: number
  messageCount: number
  firstMessageId: number
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
    // 查询会话列表，同时获取每个会话的首条消息 ID
    const sql = `
      SELECT
        cs.id,
        cs.start_ts as startTs,
        cs.end_ts as endTs,
        cs.message_count as messageCount,
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

// ==================== AI 工具专用查询函数 ====================

/**
 * 会话搜索结果项类型（用于 AI 工具）
 */
export interface SessionSearchResultItem {
  id: number
  startTs: number
  endTs: number
  messageCount: number
  /** 是否为完整会话（消息数 <= 预览条数） */
  isComplete: boolean
  /** 预览消息列表 */
  previewMessages: Array<{
    id: number
    senderName: string
    content: string | null
    timestamp: number
  }>
}

/**
 * 搜索会话（用于 AI 工具）
 * 支持按关键词和时间范围筛选会话
 *
 * @param sessionId 数据库会话ID
 * @param keywords 关键词列表（可选，OR 逻辑匹配）
 * @param timeFilter 时间过滤器（可选）
 * @param limit 返回数量限制，默认 20
 * @param previewCount 预览消息数量，默认 5
 * @returns 匹配的会话列表
 */
export function searchSessions(
  sessionId: string,
  keywords?: string[],
  timeFilter?: { startTs: number; endTs: number },
  limit: number = 20,
  previewCount: number = 5
): SessionSearchResultItem[] {
  const db = openReadonlyDatabase(sessionId)
  if (!db) {
    return []
  }

  try {
    // 1. 构建会话查询 SQL
    let sessionSql = `
      SELECT
        cs.id,
        cs.start_ts as startTs,
        cs.end_ts as endTs,
        cs.message_count as messageCount
      FROM chat_session cs
      WHERE 1=1
    `
    const params: unknown[] = []

    // 时间范围过滤
    if (timeFilter) {
      sessionSql += ` AND cs.start_ts >= ? AND cs.end_ts <= ?`
      params.push(timeFilter.startTs, timeFilter.endTs)
    }

    // 关键词过滤：只返回包含关键词的会话
    if (keywords && keywords.length > 0) {
      const keywordConditions = keywords.map(() => `m.content LIKE ?`).join(' OR ')
      sessionSql += `
        AND cs.id IN (
          SELECT DISTINCT mc.session_id
          FROM message_context mc
          JOIN message m ON m.id = mc.message_id
          WHERE (${keywordConditions})
        )
      `
      for (const kw of keywords) {
        params.push(`%${kw}%`)
      }
    }

    sessionSql += ` ORDER BY cs.start_ts DESC LIMIT ?`
    params.push(limit)

    const sessions = db.prepare(sessionSql).all(...params) as Array<{
      id: number
      startTs: number
      endTs: number
      messageCount: number
    }>

    // 2. 为每个会话获取预览消息
    const previewSql = `
      SELECT
        m.id,
        COALESCE(mb.group_nickname, mb.account_name, mb.platform_id) as senderName,
        m.content,
        m.ts as timestamp
      FROM message_context mc
      JOIN message m ON m.id = mc.message_id
      JOIN member mb ON mb.id = m.sender_id
      WHERE mc.session_id = ?
      ORDER BY m.ts ASC
      LIMIT ?
    `

    const results: SessionSearchResultItem[] = []
    for (const session of sessions) {
      const previewMessages = db.prepare(previewSql).all(session.id, previewCount) as Array<{
        id: number
        senderName: string
        content: string | null
        timestamp: number
      }>

      results.push({
        id: session.id,
        startTs: session.startTs,
        endTs: session.endTs,
        messageCount: session.messageCount,
        isComplete: session.messageCount <= previewCount,
        previewMessages,
      })
    }

    return results
  } catch (error) {
    console.error('searchSessions error:', error)
    return []
  } finally {
    db.close()
  }
}

/**
 * 会话消息结果类型（用于 AI 工具）
 */
export interface SessionMessagesResult {
  sessionId: number
  startTs: number
  endTs: number
  messageCount: number
  returnedCount: number
  /** 参与者列表 */
  participants: string[]
  /** 消息列表 */
  messages: Array<{
    id: number
    senderName: string
    content: string | null
    timestamp: number
  }>
}

/**
 * 获取会话的完整消息（用于 AI 工具）
 *
 * @param sessionId 数据库会话ID
 * @param chatSessionId 会话索引中的会话ID
 * @param limit 返回数量限制，默认 500
 * @returns 会话的完整消息
 */
export function getSessionMessages(
  sessionId: string,
  chatSessionId: number,
  limit: number = 500
): SessionMessagesResult | null {
  const db = openReadonlyDatabase(sessionId)
  if (!db) {
    return null
  }

  try {
    // 1. 获取会话基本信息
    const sessionSql = `
      SELECT
        id,
        start_ts as startTs,
        end_ts as endTs,
        message_count as messageCount
      FROM chat_session
      WHERE id = ?
    `
    const session = db.prepare(sessionSql).get(chatSessionId) as
      | {
          id: number
          startTs: number
          endTs: number
          messageCount: number
        }
      | undefined

    if (!session) {
      return null
    }

    // 2. 获取会话消息
    const messagesSql = `
      SELECT
        m.id,
        COALESCE(mb.group_nickname, mb.account_name, mb.platform_id) as senderName,
        m.content,
        m.ts as timestamp
      FROM message_context mc
      JOIN message m ON m.id = mc.message_id
      JOIN member mb ON mb.id = m.sender_id
      WHERE mc.session_id = ?
      ORDER BY m.ts ASC
      LIMIT ?
    `
    const messages = db.prepare(messagesSql).all(chatSessionId, limit) as Array<{
      id: number
      senderName: string
      content: string | null
      timestamp: number
    }>

    // 3. 统计参与者
    const participantsSet = new Set<string>()
    for (const msg of messages) {
      participantsSet.add(msg.senderName)
    }

    return {
      sessionId: session.id,
      startTs: session.startTs,
      endTs: session.endTs,
      messageCount: session.messageCount,
      returnedCount: messages.length,
      participants: Array.from(participantsSet),
      messages,
    }
  } catch (error) {
    console.error('getSessionMessages error:', error)
    return null
  } finally {
    db.close()
  }
}
