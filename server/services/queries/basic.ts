/**
 * Basic query module (server-side)
 * Activity stats, time ranges, member management.
 *
 * Ported from electron/main/worker/query/basic.ts — no worker_threads.
 */

import Database from 'better-sqlite3'
import * as fs from 'fs'
import {
  openDatabase,
  closeDatabase,
  getDbPath,
  buildTimeFilter,
  buildSystemMessageFilter,
  type TimeFilter,
} from '../db-pool'
import { ensureAliasesColumn, ensureAvatarColumn } from './helpers'
import type { MemberWithStats, MembersPaginationParams, MembersPaginatedResult } from './types'

// Re-export helpers so consumers can access them via queries
export { ensureAvatarColumn }

export function getAvailableYears(sessionId: string): number[] {
  const db = openDatabase(sessionId)
  if (!db) return []
  const rows = db
    .prepare(
      `SELECT DISTINCT CAST(strftime('%Y', ts, 'unixepoch', 'localtime') AS INTEGER) as year
       FROM message ORDER BY year DESC`,
    )
    .all() as Array<{ year: number }>
  return rows.map((r) => r.year)
}

export function getMemberActivity(sessionId: string, filter?: TimeFilter): any[] {
  ensureAvatarColumn(sessionId)
  const db = openDatabase(sessionId)
  if (!db) return []

  const { clause, params } = buildTimeFilter(filter)
  const msgFilterBase = clause ? clause.replace('WHERE', 'AND') : ''
  const msgFilterWithSystem =
    msgFilterBase + " AND COALESCE(m.account_name, '') != '系统消息'"
  const totalClauseWithSystem = buildSystemMessageFilter(clause)

  const totalMessages = (
    db
      .prepare(
        `SELECT COUNT(*) as count FROM message msg
         JOIN member m ON msg.sender_id = m.id ${totalClauseWithSystem}`,
      )
      .get(...params) as { count: number }
  ).count

  const rows = db
    .prepare(
      `SELECT m.id as memberId, m.platform_id as platformId,
              COALESCE(m.group_nickname, m.account_name, m.platform_id) as name,
              m.avatar as avatar, COUNT(msg.id) as messageCount
       FROM member m
       LEFT JOIN message msg ON m.id = msg.sender_id ${msgFilterWithSystem}
       WHERE COALESCE(m.account_name, '') != '系统消息'
       GROUP BY m.id HAVING messageCount > 0
       ORDER BY messageCount DESC`,
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
    percentage:
      totalMessages > 0
        ? Math.round((row.messageCount / totalMessages) * 10000) / 100
        : 0,
  }))
}

export function getHourlyActivity(sessionId: string, filter?: TimeFilter): any[] {
  const db = openDatabase(sessionId)
  if (!db) return []
  const { clause, params } = buildTimeFilter(filter)
  const clauseWithSystem = buildSystemMessageFilter(clause)
  const rows = db
    .prepare(
      `SELECT CAST(strftime('%H', msg.ts, 'unixepoch', 'localtime') AS INTEGER) as hour,
              COUNT(*) as messageCount
       FROM message msg JOIN member m ON msg.sender_id = m.id ${clauseWithSystem}
       GROUP BY hour ORDER BY hour`,
    )
    .all(...params) as Array<{ hour: number; messageCount: number }>
  const result: any[] = []
  for (let h = 0; h < 24; h++) {
    const found = rows.find((r) => r.hour === h)
    result.push({ hour: h, messageCount: found ? found.messageCount : 0 })
  }
  return result
}

export function getDailyActivity(sessionId: string, filter?: TimeFilter): any[] {
  const db = openDatabase(sessionId)
  if (!db) return []
  const { clause, params } = buildTimeFilter(filter)
  const clauseWithSystem = buildSystemMessageFilter(clause)
  return db
    .prepare(
      `SELECT strftime('%Y-%m-%d', msg.ts, 'unixepoch', 'localtime') as date,
              COUNT(*) as messageCount
       FROM message msg JOIN member m ON msg.sender_id = m.id ${clauseWithSystem}
       GROUP BY date ORDER BY date`,
    )
    .all(...params) as any[]
}

export function getWeekdayActivity(sessionId: string, filter?: TimeFilter): any[] {
  const db = openDatabase(sessionId)
  if (!db) return []
  const { clause, params } = buildTimeFilter(filter)
  const clauseWithSystem = buildSystemMessageFilter(clause)
  const rows = db
    .prepare(
      `SELECT
         CASE WHEN CAST(strftime('%w', msg.ts, 'unixepoch', 'localtime') AS INTEGER) = 0 THEN 7
              ELSE CAST(strftime('%w', msg.ts, 'unixepoch', 'localtime') AS INTEGER)
         END as weekday,
         COUNT(*) as messageCount
       FROM message msg JOIN member m ON msg.sender_id = m.id ${clauseWithSystem}
       GROUP BY weekday ORDER BY weekday`,
    )
    .all(...params) as Array<{ weekday: number; messageCount: number }>
  const result: any[] = []
  for (let w = 1; w <= 7; w++) {
    const found = rows.find((r) => r.weekday === w)
    result.push({ weekday: w, messageCount: found ? found.messageCount : 0 })
  }
  return result
}

export function getMonthlyActivity(sessionId: string, filter?: TimeFilter): any[] {
  const db = openDatabase(sessionId)
  if (!db) return []
  const { clause, params } = buildTimeFilter(filter)
  const clauseWithSystem = buildSystemMessageFilter(clause)
  const rows = db
    .prepare(
      `SELECT CAST(strftime('%m', msg.ts, 'unixepoch', 'localtime') AS INTEGER) as month,
              COUNT(*) as messageCount
       FROM message msg JOIN member m ON msg.sender_id = m.id ${clauseWithSystem}
       GROUP BY month ORDER BY month`,
    )
    .all(...params) as Array<{ month: number; messageCount: number }>
  const result: any[] = []
  for (let m = 1; m <= 12; m++) {
    const found = rows.find((r) => r.month === m)
    result.push({ month: m, messageCount: found ? found.messageCount : 0 })
  }
  return result
}

export function getYearlyActivity(sessionId: string, filter?: TimeFilter): any[] {
  const db = openDatabase(sessionId)
  if (!db) return []
  const { clause, params } = buildTimeFilter(filter)
  const clauseWithSystem = buildSystemMessageFilter(clause)
  return db
    .prepare(
      `SELECT CAST(strftime('%Y', msg.ts, 'unixepoch', 'localtime') AS INTEGER) as year,
              COUNT(*) as messageCount
       FROM message msg JOIN member m ON msg.sender_id = m.id ${clauseWithSystem}
       GROUP BY year ORDER BY year`,
    )
    .all(...params)
    .map((r: any) => ({ year: r.year, messageCount: r.messageCount }))
}

export function getMessageTypeDistribution(sessionId: string, filter?: TimeFilter): any[] {
  const db = openDatabase(sessionId)
  if (!db) return []
  const { clause, params } = buildTimeFilter(filter)
  const clauseWithSystem = buildSystemMessageFilter(clause)
  return db
    .prepare(
      `SELECT msg.type, COUNT(*) as count
       FROM message msg JOIN member m ON msg.sender_id = m.id ${clauseWithSystem}
       GROUP BY msg.type ORDER BY count DESC`,
    )
    .all(...params)
    .map((r: any) => ({ type: r.type, count: r.count }))
}

export function getMessageLengthDistribution(
  sessionId: string,
  filter?: TimeFilter,
): {
  detail: Array<{ len: number; count: number }>
  grouped: Array<{ range: string; count: number }>
} {
  const db = openDatabase(sessionId)
  if (!db) return { detail: [], grouped: [] }
  const { clause, params } = buildTimeFilter(filter)
  const clauseWithSystem = buildSystemMessageFilter(clause)
  const typeCondition = clauseWithSystem
    ? clauseWithSystem +
      ' AND msg.type = 0 AND msg.content IS NOT NULL AND LENGTH(msg.content) > 0'
    : 'WHERE msg.type = 0 AND msg.content IS NOT NULL AND LENGTH(msg.content) > 0'

  const rows = db
    .prepare(
      `SELECT LENGTH(msg.content) as len, COUNT(*) as count
       FROM message msg JOIN member m ON msg.sender_id = m.id ${typeCondition}
       GROUP BY len ORDER BY len`,
    )
    .all(...params) as Array<{ len: number; count: number }>

  const detail: Array<{ len: number; count: number }> = []
  for (let i = 1; i <= 25; i++) {
    const found = rows.find((r) => r.len === i)
    detail.push({ len: i, count: found ? found.count : 0 })
  }

  const ranges = [
    { min: 1, max: 5, label: '1-5' },
    { min: 6, max: 10, label: '6-10' },
    { min: 11, max: 15, label: '11-15' },
    { min: 16, max: 20, label: '16-20' },
    { min: 21, max: 25, label: '21-25' },
    { min: 26, max: 30, label: '26-30' },
    { min: 31, max: 35, label: '31-35' },
    { min: 36, max: 40, label: '36-40' },
    { min: 41, max: 45, label: '41-45' },
    { min: 46, max: 50, label: '46-50' },
    { min: 51, max: 60, label: '51-60' },
    { min: 61, max: 70, label: '61-70' },
    { min: 71, max: 80, label: '71-80' },
    { min: 81, max: 100, label: '81-100' },
    { min: 101, max: Infinity, label: '100+' },
  ]

  const grouped = ranges.map((r) => ({
    range: r.label,
    count: rows
      .filter((row) => row.len >= r.min && row.len <= r.max)
      .reduce((sum, row) => sum + row.count, 0),
  }))

  return { detail, grouped }
}

export function getTimeRange(
  sessionId: string,
): { start: number; end: number } | null {
  const db = openDatabase(sessionId)
  if (!db) return null
  const row = db
    .prepare('SELECT MIN(ts) as start, MAX(ts) as end FROM message')
    .get() as { start: number | null; end: number | null }
  if (row.start === null || row.end === null) return null
  return { start: row.start, end: row.end }
}

export function getMemberNameHistory(
  sessionId: string,
  memberId: number,
): any[] {
  const db = openDatabase(sessionId)
  if (!db) return []
  return db
    .prepare(
      `SELECT name_type as nameType, name, start_ts as startTs, end_ts as endTs
       FROM member_name_history WHERE member_id = ? ORDER BY start_ts DESC`,
    )
    .all(memberId) as any[]
}

// ============================================================================
// Member management
// ============================================================================

export function getMembers(sessionId: string): MemberWithStats[] {
  ensureAliasesColumn(sessionId)
  ensureAvatarColumn(sessionId)
  const db = openDatabase(sessionId)
  if (!db) return []
  const rows = db
    .prepare(
      `SELECT m.id, m.platform_id as platformId, m.account_name as accountName,
              m.group_nickname as groupNickname, m.aliases, m.avatar,
              COUNT(msg.id) as messageCount
       FROM member m LEFT JOIN message msg ON m.id = msg.sender_id
       WHERE COALESCE(m.group_nickname, m.account_name, m.platform_id) != '系统消息'
       GROUP BY m.id ORDER BY messageCount DESC`,
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

export function getMembersPaginated(
  sessionId: string,
  params: MembersPaginationParams,
): MembersPaginatedResult {
  const { page = 1, pageSize = 20, search = '', sortOrder = 'desc' } = params
  ensureAliasesColumn(sessionId)
  ensureAvatarColumn(sessionId)
  const db = openDatabase(sessionId)
  if (!db) return { members: [], total: 0, page, pageSize, totalPages: 0 }

  const searchCondition = search
    ? `AND (m.group_nickname LIKE '%' || @search || '%' COLLATE NOCASE
        OR m.account_name LIKE '%' || @search || '%' COLLATE NOCASE
        OR m.platform_id LIKE '%' || @search || '%' COLLATE NOCASE
        OR m.aliases LIKE '%' || @search || '%' COLLATE NOCASE)`
    : ''
  const orderDirection = sortOrder === 'asc' ? 'ASC' : 'DESC'

  const countResult = db
    .prepare(
      `SELECT COUNT(*) as total FROM (
         SELECT m.id FROM member m LEFT JOIN message msg ON m.id = msg.sender_id
         WHERE COALESCE(m.group_nickname, m.account_name, m.platform_id) != '系统消息'
         ${searchCondition} GROUP BY m.id)`,
    )
    .get({ search }) as { total: number }
  const total = countResult?.total || 0
  const totalPages = Math.ceil(total / pageSize)
  const offset = (page - 1) * pageSize

  const rows = db
    .prepare(
      `SELECT m.id, m.platform_id as platformId, m.account_name as accountName,
              m.group_nickname as groupNickname, m.aliases, m.avatar,
              COUNT(msg.id) as messageCount
       FROM member m LEFT JOIN message msg ON m.id = msg.sender_id
       WHERE COALESCE(m.group_nickname, m.account_name, m.platform_id) != '系统消息'
       ${searchCondition} GROUP BY m.id ORDER BY messageCount ${orderDirection}
       LIMIT @pageSize OFFSET @offset`,
    )
    .all({ search, pageSize, offset }) as Array<{
    id: number
    platformId: string
    accountName: string | null
    groupNickname: string | null
    aliases: string | null
    avatar: string | null
    messageCount: number
  }>
  const members = rows.map((row) => ({
    id: row.id,
    platformId: row.platformId,
    accountName: row.accountName,
    groupNickname: row.groupNickname,
    aliases: row.aliases ? JSON.parse(row.aliases) : [],
    messageCount: row.messageCount,
    avatar: row.avatar,
  }))
  return { members, total, page, pageSize, totalPages }
}

export function updateMemberAliases(
  sessionId: string,
  memberId: number,
  aliases: string[],
): boolean {
  const dbPath = getDbPath(sessionId)
  if (!fs.existsSync(dbPath)) return false
  try {
    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.prepare('UPDATE member SET aliases = ? WHERE id = ?').run(
      JSON.stringify(aliases),
      memberId,
    )
    db.close()
    return true
  } catch {
    return false
  }
}

export function deleteMember(sessionId: string, memberId: number): boolean {
  const dbPath = getDbPath(sessionId)
  if (!fs.existsSync(dbPath)) return false
  try {
    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.transaction(() => {
      db.prepare('DELETE FROM message WHERE sender_id = ?').run(memberId)
      db.prepare('DELETE FROM member_name_history WHERE member_id = ?').run(memberId)
      db.prepare('DELETE FROM member WHERE id = ?').run(memberId)
    })()
    db.close()
    return true
  } catch {
    return false
  }
}
