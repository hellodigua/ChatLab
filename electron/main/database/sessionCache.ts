/**
 * 会话级通用 JSON 缓存模块
 *
 * 每个 session 对应一个 {sessionId}.cache.json，内部按 key 分区存储。
 * 与数据库 schema 完全解耦，读取失败自动重建，无需版本管理。
 *
 * 文件路径: {cacheDir}/{sessionId}.cache.json
 */

import * as fs from 'fs'
import * as path from 'path'
import type Database from 'better-sqlite3'

// ==================== 通用缓存基础设施 ====================

interface CacheEntry<T = unknown> {
  data: T
  ts: number
}

type CacheFile = Record<string, CacheEntry>

export function getCachePath(sessionId: string, cacheDir: string): string {
  return path.join(cacheDir, `${sessionId}.cache.json`)
}

function readCacheFile(cachePath: string): CacheFile | null {
  try {
    if (!fs.existsSync(cachePath)) return null
    return JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as CacheFile
  } catch {
    return null
  }
}

function writeCacheFile(cachePath: string, content: CacheFile): void {
  try {
    const dir = path.dirname(cachePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(cachePath, JSON.stringify(content), 'utf-8')
  } catch {
    // 写入失败不影响主流程
  }
}

/**
 * 读取缓存分区
 */
export function getCache<T>(sessionId: string, key: string, cacheDir: string): T | null {
  const cachePath = getCachePath(sessionId, cacheDir)
  const file = readCacheFile(cachePath)
  if (!file || !file[key]) return null
  return file[key].data as T
}

/**
 * 写入缓存分区
 */
export function setCache<T>(sessionId: string, key: string, data: T, cacheDir: string): void {
  const cachePath = getCachePath(sessionId, cacheDir)
  const file = readCacheFile(cachePath) ?? {}
  file[key] = { data, ts: Math.floor(Date.now() / 1000) }
  writeCacheFile(cachePath, file)
}

/**
 * 使缓存失效（不传 key 则清空整个文件）
 */
export function invalidateCache(sessionId: string, cacheDir: string, key?: string): void {
  const cachePath = getCachePath(sessionId, cacheDir)
  try {
    if (!key) {
      if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath)
    } else {
      const file = readCacheFile(cachePath)
      if (file && file[key]) {
        delete file[key]
        writeCacheFile(cachePath, file)
      }
    }
  } catch {
    // 忽略失败
  }
}

/**
 * 删除 session 的所有缓存
 */
export function deleteSessionCache(sessionId: string, cacheDir: string): void {
  const cachePath = getCachePath(sessionId, cacheDir)
  try {
    if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath)
  } catch {
    // 忽略删除失败
  }
}

// ==================== Overview 缓存（聚合统计） ====================

export const CACHE_KEY_OVERVIEW = 'overview'

export interface OverviewCache {
  totalMessages: number
  totalMembers: number
  firstMessageTs: number | null
  lastMessageTs: number | null
}

/**
 * 从数据库计算概览统计并写入缓存
 */
export function computeAndSetOverviewCache(db: Database.Database, sessionId: string, cacheDir: string): OverviewCache {
  const msgStats = db.prepare('SELECT MIN(ts) as first_ts, MAX(ts) as last_ts FROM message').get() as {
    first_ts: number | null
    last_ts: number | null
  }

  const totalMessages = (
    db
      .prepare(
        `SELECT COUNT(*) as count FROM message msg
         JOIN member m ON msg.sender_id = m.id
         WHERE COALESCE(m.account_name, '') != '系统消息'`
      )
      .get() as { count: number }
  ).count

  const totalMembers = (
    db.prepare(`SELECT COUNT(*) as count FROM member WHERE COALESCE(account_name, '') != '系统消息'`).get() as {
      count: number
    }
  ).count

  const data: OverviewCache = {
    totalMessages,
    totalMembers,
    firstMessageTs: msgStats.first_ts,
    lastMessageTs: msgStats.last_ts,
  }

  setCache(sessionId, CACHE_KEY_OVERVIEW, data, cacheDir)

  // 同步生成成员缓存
  computeAndSetMembersCache(db, sessionId, cacheDir)

  return data
}

// ==================== Members 缓存（成员维度） ====================

export const CACHE_KEY_MEMBERS = 'members'

export interface MemberStat {
  name: string
  count: number
}

export interface MembersCache {
  /** member.id -> { name, count } */
  members: Record<number, MemberStat>
}

/**
 * 从数据库计算成员统计并写入缓存
 */
export function computeAndSetMembersCache(db: Database.Database, sessionId: string, cacheDir: string): MembersCache {
  const rows = db
    .prepare(
      `SELECT msg.sender_id, COUNT(*) as count,
              COALESCE(m.group_nickname, m.account_name, m.platform_id) as name
       FROM message msg
       JOIN member m ON msg.sender_id = m.id
       GROUP BY msg.sender_id`
    )
    .all() as Array<{ sender_id: number; count: number; name: string }>

  const members: Record<number, MemberStat> = {}
  for (const row of rows) {
    members[row.sender_id] = { name: row.name, count: row.count }
  }

  const data: MembersCache = { members }
  setCache(sessionId, CACHE_KEY_MEMBERS, data, cacheDir)
  return data
}
