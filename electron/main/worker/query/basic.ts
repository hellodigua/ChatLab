/**
 * 基础查询模块
 * 提供活跃度、时段分布等基础统计查询
 */

import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import {
  openDatabase,
  closeDatabase,
  getDbDir,
  getDbPath,
  buildTimeFilter,
  buildSystemMessageFilter,
  type TimeFilter,
} from '../core'

// ==================== 基础查询 ====================

/**
 * 获取可用的年份列表
 */
export function getAvailableYears(sessionId: string): number[] {
  const db = openDatabase(sessionId)
  if (!db) return []

  const rows = db
    .prepare(
      `
      SELECT DISTINCT CAST(strftime('%Y', ts, 'unixepoch', 'localtime') AS INTEGER) as year
      FROM message
      ORDER BY year DESC
    `
    )
    .all() as Array<{ year: number }>

  return rows.map((r) => r.year)
}

/**
 * 获取成员活跃度排行
 */
export function getMemberActivity(sessionId: string, filter?: TimeFilter): any[] {
  // 先确保数据库有 avatar 字段（兼容旧数据库）
  ensureAvatarColumn(sessionId)

  const db = openDatabase(sessionId)
  if (!db) return []

  const { clause, params } = buildTimeFilter(filter)

  const msgFilterBase = clause ? clause.replace('WHERE', 'AND') : ''
  const msgFilterWithSystem = msgFilterBase + " AND COALESCE(m.account_name, '') != '系统消息'"

  const totalClauseWithSystem = buildSystemMessageFilter(clause)
  const totalMessages = (
    db
      .prepare(
        `SELECT COUNT(*) as count
         FROM message msg
         JOIN member m ON msg.sender_id = m.id
         ${totalClauseWithSystem}`
      )
      .get(...params) as { count: number }
  ).count

  const rows = db
    .prepare(
      `
      SELECT
        m.id as memberId,
        m.platform_id as platformId,
        COALESCE(m.group_nickname, m.account_name, m.platform_id) as name,
        m.avatar as avatar,
        COUNT(msg.id) as messageCount
      FROM member m
      LEFT JOIN message msg ON m.id = msg.sender_id ${msgFilterWithSystem}
      WHERE COALESCE(m.account_name, '') != '系统消息'
      GROUP BY m.id
      HAVING messageCount > 0
      ORDER BY messageCount DESC
    `
    )
    .all(...params) as Array<{
    memberId: number
    platformId: string
    name: string
    avatar: string | null
    messageCount: number
  }>

  return rows.map((row) => ({
    memberId: row.memberId,
    platformId: row.platformId,
    name: row.name,
    avatar: row.avatar,
    messageCount: row.messageCount,
    percentage: totalMessages > 0 ? Math.round((row.messageCount / totalMessages) * 10000) / 100 : 0,
  }))
}

/**
 * 获取每小时活跃度分布
 */
export function getHourlyActivity(sessionId: string, filter?: TimeFilter): any[] {
  const db = openDatabase(sessionId)
  if (!db) return []

  const { clause, params } = buildTimeFilter(filter)
  const clauseWithSystem = buildSystemMessageFilter(clause)

  const rows = db
    .prepare(
      `
      SELECT
        CAST(strftime('%H', msg.ts, 'unixepoch', 'localtime') AS INTEGER) as hour,
        COUNT(*) as messageCount
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
      ${clauseWithSystem}
      GROUP BY hour
      ORDER BY hour
    `
    )
    .all(...params) as Array<{ hour: number; messageCount: number }>

  const result: any[] = []
  for (let h = 0; h < 24; h++) {
    const found = rows.find((r) => r.hour === h)
    result.push({
      hour: h,
      messageCount: found ? found.messageCount : 0,
    })
  }

  return result
}

/**
 * 获取每日活跃度趋势
 */
export function getDailyActivity(sessionId: string, filter?: TimeFilter): any[] {
  const db = openDatabase(sessionId)
  if (!db) return []

  const { clause, params } = buildTimeFilter(filter)
  const clauseWithSystem = buildSystemMessageFilter(clause)

  const rows = db
    .prepare(
      `
      SELECT
        strftime('%Y-%m-%d', msg.ts, 'unixepoch', 'localtime') as date,
        COUNT(*) as messageCount
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
      ${clauseWithSystem}
      GROUP BY date
      ORDER BY date
    `
    )
    .all(...params) as Array<{ date: string; messageCount: number }>

  return rows
}

/**
 * 获取星期活跃度分布
 */
export function getWeekdayActivity(sessionId: string, filter?: TimeFilter): any[] {
  const db = openDatabase(sessionId)
  if (!db) return []

  const { clause, params } = buildTimeFilter(filter)
  const clauseWithSystem = buildSystemMessageFilter(clause)

  const rows = db
    .prepare(
      `
      SELECT
        CASE
          WHEN CAST(strftime('%w', msg.ts, 'unixepoch', 'localtime') AS INTEGER) = 0 THEN 7
          ELSE CAST(strftime('%w', msg.ts, 'unixepoch', 'localtime') AS INTEGER)
        END as weekday,
        COUNT(*) as messageCount
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
      ${clauseWithSystem}
      GROUP BY weekday
      ORDER BY weekday
    `
    )
    .all(...params) as Array<{ weekday: number; messageCount: number }>

  const result: any[] = []
  for (let w = 1; w <= 7; w++) {
    const found = rows.find((r) => r.weekday === w)
    result.push({
      weekday: w,
      messageCount: found ? found.messageCount : 0,
    })
  }

  return result
}

/**
 * 获取月份活跃度分布
 */
export function getMonthlyActivity(sessionId: string, filter?: TimeFilter): any[] {
  const db = openDatabase(sessionId)
  if (!db) return []

  const { clause, params } = buildTimeFilter(filter)
  const clauseWithSystem = buildSystemMessageFilter(clause)

  const rows = db
    .prepare(
      `
      SELECT
        CAST(strftime('%m', msg.ts, 'unixepoch', 'localtime') AS INTEGER) as month,
        COUNT(*) as messageCount
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
      ${clauseWithSystem}
      GROUP BY month
      ORDER BY month
    `
    )
    .all(...params) as Array<{ month: number; messageCount: number }>

  const result: any[] = []
  for (let m = 1; m <= 12; m++) {
    const found = rows.find((r) => r.month === m)
    result.push({
      month: m,
      messageCount: found ? found.messageCount : 0,
    })
  }

  return result
}

/**
 * 获取消息类型分布
 */
export function getMessageTypeDistribution(sessionId: string, filter?: TimeFilter): any[] {
  const db = openDatabase(sessionId)
  if (!db) return []

  const { clause, params } = buildTimeFilter(filter)
  const clauseWithSystem = buildSystemMessageFilter(clause)

  const rows = db
    .prepare(
      `
      SELECT msg.type, COUNT(*) as count
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
      ${clauseWithSystem}
      GROUP BY msg.type
      ORDER BY count DESC
    `
    )
    .all(...params) as Array<{ type: number; count: number }>

  return rows.map((r) => ({
    type: r.type,
    count: r.count,
  }))
}

/**
 * 获取时间范围
 */
export function getTimeRange(sessionId: string): { start: number; end: number } | null {
  const db = openDatabase(sessionId)
  if (!db) return null

  const row = db
    .prepare(
      `
      SELECT MIN(ts) as start, MAX(ts) as end FROM message
    `
    )
    .get() as { start: number | null; end: number | null }

  if (row.start === null || row.end === null) return null

  return { start: row.start, end: row.end }
}

/**
 * 获取成员的历史昵称记录
 */
export function getMemberNameHistory(sessionId: string, memberId: number): any[] {
  const db = openDatabase(sessionId)
  if (!db) return []

  const rows = db
    .prepare(
      `
      SELECT name_type as nameType, name, start_ts as startTs, end_ts as endTs
      FROM member_name_history
      WHERE member_id = ?
      ORDER BY start_ts DESC
    `
    )
    .all(memberId) as Array<{ nameType: string; name: string; startTs: number; endTs: number | null }>

  return rows
}

// ==================== 会话管理 ====================

interface DbMeta {
  name: string
  platform: string
  type: string
  imported_at: number
  group_id: string | null
  group_avatar: string | null
}

/**
 * 获取私聊对方成员的头像
 * 逻辑参考 private-chat/index.vue 的 otherMemberAvatar
 */
function getPrivateChatMemberAvatar(
  db: Database.Database,
  sessionName: string,
  ownerId: string | null
): string | null {
  // 获取所有非系统消息成员（按消息数排序）
  const members = db
    .prepare(
      `SELECT
        m.platform_id as platformId,
        COALESCE(m.group_nickname, m.account_name, m.platform_id) as name,
        m.avatar
      FROM member m
      WHERE COALESCE(m.account_name, '') != '系统消息'
      ORDER BY (SELECT COUNT(*) FROM message WHERE sender_id = m.id) DESC`
    )
    .all() as Array<{ platformId: string; name: string; avatar: string | null }>

  if (members.length === 0) return null

  // 1. 优先排除 ownerId，找到另一成员的头像
  if (ownerId) {
    const other = members.find((m) => m.platformId !== ownerId)
    if (other?.avatar) return other.avatar
  }

  // 2. 尝试匹配会话名称（私聊名称通常是对方昵称）
  const sameName = members.find((m) => m.name === sessionName)
  if (sameName?.avatar) return sameName.avatar

  // 3. 如果只有两个成员且有 ownerId，取另一个（即使没有头像也返回 null）
  // 如果没有 ownerId，返回第一个有头像的成员
  const firstWithAvatar = members.find((m) => m.avatar)
  return firstWithAvatar?.avatar || null
}

/**
 * 获取所有会话列表
 */
export function getAllSessions(): any[] {
  const dbDir = getDbDir()
  if (!fs.existsSync(dbDir)) {
    return []
  }

  const sessions: any[] = []
  const files = fs.readdirSync(dbDir).filter((f) => f.endsWith('.db'))

  for (const file of files) {
    const sessionId = file.replace('.db', '')
    const dbPath = path.join(dbDir, file)

    try {
      const db = new Database(dbPath)
      db.pragma('journal_mode = WAL')

      const meta = db.prepare('SELECT * FROM meta LIMIT 1').get() as DbMeta | undefined

      if (meta) {
        const messageCount = (
          db
            .prepare(
              `SELECT COUNT(*) as count
             FROM message msg
             JOIN member m ON msg.sender_id = m.id
             WHERE COALESCE(m.account_name, '') != '系统消息'`
            )
            .get() as { count: number }
        ).count
        const memberCount = (
          db
            .prepare(
              `SELECT COUNT(*) as count
             FROM member
             WHERE COALESCE(account_name, '') != '系统消息'`
            )
            .get() as { count: number }
        ).count

        // 私聊：获取对方成员头像
        let memberAvatar: string | null = null
        if (meta.type === 'private') {
          memberAvatar = getPrivateChatMemberAvatar(db, meta.name, meta.owner_id)
        }

        sessions.push({
          id: sessionId,
          name: meta.name,
          platform: meta.platform,
          type: meta.type,
          importedAt: meta.imported_at,
          messageCount,
          memberCount,
          dbPath,
          groupId: meta.group_id || null,
          groupAvatar: meta.group_avatar || null,
          ownerId: meta.owner_id || null,
          memberAvatar, // 私聊对方头像
        })
      }

      db.close()
    } catch (error) {
      console.error(`[Worker] Failed to read database ${file}:`, error)
    }
  }

  return sessions.sort((a, b) => b.importedAt - a.importedAt)
}

/**
 * 获取单个会话信息
 */
export function getSession(sessionId: string): any | null {
  const db = openDatabase(sessionId)
  if (!db) return null

  const meta = db.prepare('SELECT * FROM meta LIMIT 1').get() as DbMeta | undefined
  if (!meta) return null

  const messageCount = (
    db
      .prepare(
        `SELECT COUNT(*) as count
         FROM message msg
         JOIN member m ON msg.sender_id = m.id
         WHERE COALESCE(m.account_name, '') != '系统消息'`
      )
      .get() as { count: number }
  ).count

  const memberCount = (
    db
      .prepare(
        `SELECT COUNT(*) as count
         FROM member
         WHERE COALESCE(account_name, '') != '系统消息'`
      )
      .get() as { count: number }
  ).count

  return {
    id: sessionId,
    name: meta.name,
    platform: meta.platform,
    type: meta.type,
    importedAt: meta.imported_at,
    messageCount,
    memberCount,
    dbPath: getDbPath(sessionId),
    groupId: meta.group_id || null,
    groupAvatar: meta.group_avatar || null,
    ownerId: meta.owner_id || null,
  }
}

// ==================== 成员管理 ====================

/**
 * 成员信息（含统计数据）
 */
interface MemberWithStats {
  id: number
  platformId: string
  accountName: string | null
  groupNickname: string | null
  aliases: string[]
  messageCount: number
  avatar: string | null
}

// 用于标记已检查过 aliases 字段的会话
const aliasesCheckedSessions = new Set<string>()
// 用于标记已检查过 avatar 字段的会话
const avatarCheckedSessions = new Set<string>()

/**
 * 确保 member 表有 aliases 字段（数据库迁移）
 * 用于兼容旧数据库
 */
function ensureAliasesColumn(sessionId: string): void {
  // 每个会话只检查一次
  if (aliasesCheckedSessions.has(sessionId)) return

  const dbPath = getDbPath(sessionId)
  if (!fs.existsSync(dbPath)) return

  // 先关闭可能缓存的只读连接
  closeDatabase(sessionId)

  // 使用写入模式打开数据库检查并添加字段
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')

  try {
    // 检查 aliases 字段是否存在
    const columns = db.prepare('PRAGMA table_info(member)').all() as Array<{ name: string }>
    const hasAliases = columns.some((col) => col.name === 'aliases')

    if (!hasAliases) {
      // 添加 aliases 字段
      db.exec("ALTER TABLE member ADD COLUMN aliases TEXT DEFAULT '[]'")
      console.log(`[Worker] Added aliases column to member table in session ${sessionId}`)
    }

    // 标记为已检查
    aliasesCheckedSessions.add(sessionId)
  } finally {
    db.close()
  }
}

/**
 * 确保 member 表有 avatar 字段（数据库迁移）
 * 用于兼容旧数据库
 */
export function ensureAvatarColumn(sessionId: string): void {
  // 每个会话只检查一次
  if (avatarCheckedSessions.has(sessionId)) return

  const dbPath = getDbPath(sessionId)
  if (!fs.existsSync(dbPath)) return

  // 先关闭可能缓存的只读连接
  closeDatabase(sessionId)

  // 使用写入模式打开数据库检查并添加字段
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')

  try {
    // 检查 avatar 字段是否存在
    const columns = db.prepare('PRAGMA table_info(member)').all() as Array<{ name: string }>
    const hasAvatar = columns.some((col) => col.name === 'avatar')

    if (!hasAvatar) {
      // 添加 avatar 字段
      db.exec('ALTER TABLE member ADD COLUMN avatar TEXT')
      console.log(`[Worker] Added avatar column to member table in session ${sessionId}`)
    }

    // 标记为已检查
    avatarCheckedSessions.add(sessionId)
  } finally {
    db.close()
  }
}

/**
 * 获取所有成员列表（含消息数、别名和头像）
 */
export function getMembers(sessionId: string): MemberWithStats[] {
  // 先确保数据库有 aliases 和 avatar 字段（兼容旧数据库）
  ensureAliasesColumn(sessionId)
  ensureAvatarColumn(sessionId)

  const db = openDatabase(sessionId)
  if (!db) return []

  const rows = db
    .prepare(
      `
      SELECT
        m.id,
        m.platform_id as platformId,
        m.account_name as accountName,
        m.group_nickname as groupNickname,
        m.aliases,
        m.avatar,
        COUNT(msg.id) as messageCount
      FROM member m
      LEFT JOIN message msg ON m.id = msg.sender_id
      WHERE COALESCE(m.group_nickname, m.account_name, m.platform_id) != '系统消息'
      GROUP BY m.id
      ORDER BY messageCount DESC
    `
    )
    .all() as Array<{
    id: number
    platformId: string
    accountName: string | null
    groupNickname: string | null
    aliases: string | null
    avatar: string | null
    messageCount: number
  }>

  return rows.map((row) => ({
    id: row.id,
    platformId: row.platformId,
    accountName: row.accountName,
    groupNickname: row.groupNickname,
    aliases: row.aliases ? JSON.parse(row.aliases) : [],
    messageCount: row.messageCount,
    avatar: row.avatar,
  }))
}

/**
 * 更新成员别名
 */
export function updateMemberAliases(sessionId: string, memberId: number, aliases: string[]): boolean {
  const dbPath = getDbPath(sessionId)
  if (!fs.existsSync(dbPath)) {
    return false
  }

  try {
    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')

    const stmt = db.prepare('UPDATE member SET aliases = ? WHERE id = ?')
    stmt.run(JSON.stringify(aliases), memberId)

    db.close()
    return true
  } catch (error) {
    console.error('[Worker] Failed to update member aliases:', error)
    return false
  }
}

/**
 * 删除成员及其所有消息
 */
export function deleteMember(sessionId: string, memberId: number): boolean {
  const dbPath = getDbPath(sessionId)
  if (!fs.existsSync(dbPath)) {
    return false
  }

  try {
    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')

    // 使用事务删除成员及其相关数据
    const deleteTransaction = db.transaction(() => {
      // 1. 删除该成员的消息
      db.prepare('DELETE FROM message WHERE sender_id = ?').run(memberId)

      // 2. 删除该成员的昵称历史
      db.prepare('DELETE FROM member_name_history WHERE member_id = ?').run(memberId)

      // 3. 删除成员记录
      db.prepare('DELETE FROM member WHERE id = ?').run(memberId)
    })

    deleteTransaction()
    db.close()
    return true
  } catch (error) {
    console.error('[Worker] Failed to delete member:', error)
    return false
  }
}
