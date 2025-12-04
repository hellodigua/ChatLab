/**
 * AI 查询模块
 * 提供关键词搜索和最近消息获取功能（在 Worker 线程中执行）
 */

import { openDatabase, buildTimeFilter, type TimeFilter } from '../core'

// ==================== 消息搜索 ====================

/**
 * 搜索消息结果类型
 */
export interface SearchMessageResult {
  id: number
  senderName: string
  senderPlatformId: string
  content: string
  timestamp: number
  type: number
}

/**
 * 获取最近的消息（用于概览性问题）
 * @param sessionId 会话 ID
 * @param filter 时间过滤器
 * @param limit 返回数量限制
 */
export function getRecentMessages(
  sessionId: string,
  filter?: TimeFilter,
  limit: number = 100
): { messages: SearchMessageResult[]; total: number } {
  const db = openDatabase(sessionId)
  if (!db) return { messages: [], total: 0 }

  // 构建时间过滤条件
  const { clause: timeClause, params: timeParams } = buildTimeFilter(filter)
  const timeCondition = timeClause ? timeClause.replace('WHERE', 'AND') : ''

  // 排除系统消息，只获取文本消息（type=0）
  const systemFilter = "AND COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL AND msg.content != ''"

  // 查询总数
  const countSql = `
    SELECT COUNT(*) as total
    FROM message msg
    JOIN member m ON msg.sender_id = m.id
    WHERE 1=1
    ${timeCondition}
    ${systemFilter}
  `
  const totalRow = db.prepare(countSql).get(...timeParams) as { total: number }
  const total = totalRow?.total || 0

  // 查询最近消息（按时间降序）
  const sql = `
    SELECT
      msg.id,
      COALESCE(m.group_nickname, m.account_name, m.platform_id) as senderName,
      m.platform_id as senderPlatformId,
      msg.content,
      msg.ts as timestamp,
      msg.type
    FROM message msg
    JOIN member m ON msg.sender_id = m.id
    WHERE 1=1
    ${timeCondition}
    ${systemFilter}
    ORDER BY msg.ts DESC
    LIMIT ?
  `

  const rows = db.prepare(sql).all(...timeParams, limit) as SearchMessageResult[]

  // 返回时按时间正序排列（便于阅读）
  return { messages: rows.reverse(), total }
}

/**
 * 关键词搜索消息
 * @param sessionId 会话 ID
 * @param keywords 关键词数组（OR 逻辑），可以为空数组
 * @param filter 时间过滤器
 * @param limit 返回数量限制
 * @param offset 偏移量（分页）
 * @param senderId 可选的发送者成员 ID，用于筛选特定成员的消息
 */
export function searchMessages(
  sessionId: string,
  keywords: string[],
  filter?: TimeFilter,
  limit: number = 20,
  offset: number = 0,
  senderId?: number
): { messages: SearchMessageResult[]; total: number } {
  const db = openDatabase(sessionId)
  if (!db) return { messages: [], total: 0 }

  // 构建关键词条件（OR 逻辑）
  let keywordCondition = '1=1' // 默认条件（始终为真）
  const keywordParams: string[] = []
  if (keywords.length > 0) {
    keywordCondition = `(${keywords.map(() => `msg.content LIKE ?`).join(' OR ')})`
    keywordParams.push(...keywords.map((k) => `%${k}%`))
  }

  // 构建时间过滤条件
  const { clause: timeClause, params: timeParams } = buildTimeFilter(filter)
  const timeCondition = timeClause ? timeClause.replace('WHERE', 'AND') : ''

  // 排除系统消息
  const systemFilter = "AND COALESCE(m.account_name, '') != '系统消息'"

  // 构建发送者筛选条件
  let senderCondition = ''
  const senderParams: number[] = []
  if (senderId !== undefined) {
    senderCondition = 'AND msg.sender_id = ?'
    senderParams.push(senderId)
  }

  // 查询总数
  const countSql = `
    SELECT COUNT(*) as total
    FROM message msg
    JOIN member m ON msg.sender_id = m.id
    WHERE ${keywordCondition}
    ${timeCondition}
    ${systemFilter}
    ${senderCondition}
  `
  const totalRow = db.prepare(countSql).get(...keywordParams, ...timeParams, ...senderParams) as { total: number }
  const total = totalRow?.total || 0

  // 查询消息
  const sql = `
    SELECT
      msg.id,
      COALESCE(m.group_nickname, m.account_name, m.platform_id) as senderName,
      m.platform_id as senderPlatformId,
      msg.content,
      msg.ts as timestamp,
      msg.type
    FROM message msg
    JOIN member m ON msg.sender_id = m.id
    WHERE ${keywordCondition}
    ${timeCondition}
    ${systemFilter}
    ${senderCondition}
    ORDER BY msg.ts DESC
    LIMIT ? OFFSET ?
  `

  const rows = db.prepare(sql).all(...keywordParams, ...timeParams, ...senderParams, limit, offset) as SearchMessageResult[]

  return { messages: rows, total }
}

/**
 * 获取消息上下文（指定消息前后的消息）
 */
export function getMessageContext(
  sessionId: string,
  messageId: number,
  contextSize: number = 5
): SearchMessageResult[] {
  const db = openDatabase(sessionId)
  if (!db) return []

  // 获取目标消息的时间戳
  const targetMsg = db.prepare('SELECT ts FROM message WHERE id = ?').get(messageId) as { ts: number } | undefined
  if (!targetMsg) return []

  // 获取前后消息
  const sql = `
    SELECT
      msg.id,
      COALESCE(m.group_nickname, m.account_name, m.platform_id) as senderName,
      m.platform_id as senderPlatformId,
      msg.content,
      msg.ts as timestamp,
      msg.type
    FROM message msg
    JOIN member m ON msg.sender_id = m.id
    WHERE COALESCE(m.account_name, '') != '系统消息'
      AND msg.ts BETWEEN ? AND ?
    ORDER BY msg.ts ASC
    LIMIT ?
  `

  // 获取前后 contextSize 秒的消息（假设平均每秒 1 条消息）
  const timeWindow = contextSize * 60 // 前后各 contextSize 分钟
  const rows = db.prepare(sql).all(
    targetMsg.ts - timeWindow,
    targetMsg.ts + timeWindow,
    contextSize * 2 + 1
  ) as SearchMessageResult[]

  return rows
}

/**
 * 获取两个成员之间的对话
 * 提取两人相邻发言形成的对话片段
 * @param sessionId 会话 ID
 * @param memberId1 成员1的 ID
 * @param memberId2 成员2的 ID
 * @param filter 时间过滤器
 * @param limit 返回消息数量限制
 */
export function getConversationBetween(
  sessionId: string,
  memberId1: number,
  memberId2: number,
  filter?: TimeFilter,
  limit: number = 100
): { messages: SearchMessageResult[]; total: number; member1Name: string; member2Name: string } {
  const db = openDatabase(sessionId)
  if (!db) return { messages: [], total: 0, member1Name: '', member2Name: '' }

  // 获取成员名称
  const member1 = db.prepare(`
    SELECT COALESCE(group_nickname, account_name, platform_id) as name
    FROM member WHERE id = ?
  `).get(memberId1) as { name: string } | undefined

  const member2 = db.prepare(`
    SELECT COALESCE(group_nickname, account_name, platform_id) as name
    FROM member WHERE id = ?
  `).get(memberId2) as { name: string } | undefined

  if (!member1 || !member2) {
    return { messages: [], total: 0, member1Name: '', member2Name: '' }
  }

  // 构建时间过滤条件
  const { clause: timeClause, params: timeParams } = buildTimeFilter(filter)
  const timeCondition = timeClause ? timeClause.replace('WHERE', 'AND') : ''

  // 查询两人之间的所有消息
  const countSql = `
    SELECT COUNT(*) as total
    FROM message msg
    JOIN member m ON msg.sender_id = m.id
    WHERE msg.sender_id IN (?, ?)
    ${timeCondition}
    AND msg.content IS NOT NULL AND msg.content != ''
  `
  const totalRow = db.prepare(countSql).get(memberId1, memberId2, ...timeParams) as { total: number }
  const total = totalRow?.total || 0

  // 查询消息
  const sql = `
    SELECT
      msg.id,
      COALESCE(m.group_nickname, m.account_name, m.platform_id) as senderName,
      m.platform_id as senderPlatformId,
      msg.content,
      msg.ts as timestamp,
      msg.type
    FROM message msg
    JOIN member m ON msg.sender_id = m.id
    WHERE msg.sender_id IN (?, ?)
    ${timeCondition}
    AND msg.content IS NOT NULL AND msg.content != ''
    ORDER BY msg.ts DESC
    LIMIT ?
  `

  const rows = db.prepare(sql).all(memberId1, memberId2, ...timeParams, limit) as SearchMessageResult[]

  // 返回时按时间正序排列（便于阅读对话）
  return {
    messages: rows.reverse(),
    total,
    member1Name: member1.name,
    member2Name: member2.name,
  }
}

