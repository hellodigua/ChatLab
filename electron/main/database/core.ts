/**
 * 数据库核心模块
 * 负责数据库的创建、打开、关闭和数据导入
 */

import Database from 'better-sqlite3'
import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import type { DbMeta, ParseResult, AnalysisSession } from '../../../src/types/chat'

// 数据库存储目录
let DB_DIR: string | null = null

/**
 * 获取数据库目录（懒加载）
 */
function getDbDir(): string {
  if (DB_DIR) return DB_DIR

  try {
    const docPath = app.getPath('documents')
    console.log('[Database] app.getPath("documents"):', docPath)
    DB_DIR = path.join(docPath, 'ChatLab', 'databases')
  } catch (error) {
    console.error('[Database] Error getting userData path:', error)
    DB_DIR = path.join(process.cwd(), 'databases')
    console.log('[Database] Using fallback DB_DIR:', DB_DIR)
  }

  return DB_DIR
}

/**
 * 确保数据库目录存在
 */
function ensureDbDir(): void {
  const dir = getDbDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/**
 * 生成唯一的会话ID
 */
function generateSessionId(): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  return `chat_${timestamp}_${random}`
}

/**
 * 获取数据库文件路径
 */
export function getDbPath(sessionId: string): string {
  return path.join(getDbDir(), `${sessionId}.db`)
}

/**
 * 创建新数据库并初始化表结构
 */
function createDatabase(sessionId: string): Database.Database {
  ensureDbDir()
  const dbPath = getDbPath(sessionId)
  const db = new Database(dbPath)

  db.pragma('journal_mode = WAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      type TEXT NOT NULL,
      imported_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS member (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform_id TEXT NOT NULL UNIQUE,
      account_name TEXT,
      group_nickname TEXT,
      aliases TEXT DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS member_name_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      name_type TEXT NOT NULL,
      name TEXT NOT NULL,
      start_ts INTEGER NOT NULL,
      end_ts INTEGER,
      FOREIGN KEY(member_id) REFERENCES member(id)
    );

    CREATE TABLE IF NOT EXISTS message (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      sender_account_name TEXT,
      sender_group_nickname TEXT,
      ts INTEGER NOT NULL,
      type INTEGER NOT NULL,
      content TEXT,
      FOREIGN KEY(sender_id) REFERENCES member(id)
    );

    CREATE INDEX IF NOT EXISTS idx_message_ts ON message(ts);
    CREATE INDEX IF NOT EXISTS idx_message_sender ON message(sender_id);
    CREATE INDEX IF NOT EXISTS idx_member_name_history_member_id ON member_name_history(member_id);
  `)

  return db
}

/**
 * 打开已存在的数据库
 */
export function openDatabase(sessionId: string): Database.Database | null {
  const dbPath = getDbPath(sessionId)
  if (!fs.existsSync(dbPath)) {
    return null
  }
  const db = new Database(dbPath, { readonly: true })
  db.pragma('journal_mode = WAL')
  return db
}

/**
 * 导入解析后的数据到数据库
 */
export function importData(parseResult: ParseResult): string {
  console.log('[Database] importData called')
  const sessionId = generateSessionId()
  console.log('[Database] Generated sessionId:', sessionId)

  const dbPath = getDbPath(sessionId)
  console.log('[Database] Creating database at:', dbPath)

  const db = createDatabase(sessionId)
  console.log('[Database] Database created successfully')

  try {
    const importTransaction = db.transaction(() => {
      const insertMeta = db.prepare(`
        INSERT INTO meta (name, platform, type, imported_at)
        VALUES (?, ?, ?, ?)
      `)
      insertMeta.run(
        parseResult.meta.name,
        parseResult.meta.platform,
        parseResult.meta.type,
        Math.floor(Date.now() / 1000)
      )

      const insertMember = db.prepare(`
        INSERT OR IGNORE INTO member (platform_id, account_name, group_nickname) VALUES (?, ?, ?)
      `)
      const getMemberId = db.prepare(`
        SELECT id FROM member WHERE platform_id = ?
      `)

      const memberIdMap = new Map<string, number>()

      for (const member of parseResult.members) {
        insertMember.run(member.platformId, member.accountName || null, member.groupNickname || null)
        const row = getMemberId.get(member.platformId) as { id: number }
        memberIdMap.set(member.platformId, row.id)
      }

      const sortedMessages = [...parseResult.messages].sort((a, b) => a.timestamp - b.timestamp)
      // 分别追踪 account_name 和 group_nickname 的变化
      const accountNameTracker = new Map<string, { currentName: string; lastSeenTs: number }>()
      const groupNicknameTracker = new Map<string, { currentName: string; lastSeenTs: number }>()

      const insertMessage = db.prepare(`
        INSERT INTO message (sender_id, sender_account_name, sender_group_nickname, ts, type, content)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      const insertNameHistory = db.prepare(`
        INSERT INTO member_name_history (member_id, name_type, name, start_ts, end_ts)
        VALUES (?, ?, ?, ?, ?)
      `)
      const updateMemberAccountName = db.prepare(`
        UPDATE member SET account_name = ? WHERE platform_id = ?
      `)
      const updateMemberGroupNickname = db.prepare(`
        UPDATE member SET group_nickname = ? WHERE platform_id = ?
      `)
      const updateNameHistoryEndTs = db.prepare(`
        UPDATE member_name_history
        SET end_ts = ?
        WHERE member_id = ? AND name_type = ? AND end_ts IS NULL
      `)

      for (const msg of sortedMessages) {
        const senderId = memberIdMap.get(msg.senderPlatformId)
        if (senderId === undefined) continue

        insertMessage.run(
          senderId,
          msg.senderAccountName || null,
          msg.senderGroupNickname || null,
          msg.timestamp,
          msg.type,
          msg.content
        )

        // 追踪 account_name 变化
        const accountName = msg.senderAccountName
        if (accountName) {
          const tracker = accountNameTracker.get(msg.senderPlatformId)
          if (!tracker) {
            accountNameTracker.set(msg.senderPlatformId, {
              currentName: accountName,
              lastSeenTs: msg.timestamp,
            })
            insertNameHistory.run(senderId, 'account_name', accountName, msg.timestamp, null)
          } else if (tracker.currentName !== accountName) {
            updateNameHistoryEndTs.run(msg.timestamp, senderId, 'account_name')
            insertNameHistory.run(senderId, 'account_name', accountName, msg.timestamp, null)
            tracker.currentName = accountName
            tracker.lastSeenTs = msg.timestamp
          } else {
            tracker.lastSeenTs = msg.timestamp
          }
        }

        // 追踪 group_nickname 变化
        const groupNickname = msg.senderGroupNickname
        if (groupNickname) {
          const tracker = groupNicknameTracker.get(msg.senderPlatformId)
          if (!tracker) {
            groupNicknameTracker.set(msg.senderPlatformId, {
              currentName: groupNickname,
              lastSeenTs: msg.timestamp,
            })
            insertNameHistory.run(senderId, 'group_nickname', groupNickname, msg.timestamp, null)
          } else if (tracker.currentName !== groupNickname) {
            updateNameHistoryEndTs.run(msg.timestamp, senderId, 'group_nickname')
            insertNameHistory.run(senderId, 'group_nickname', groupNickname, msg.timestamp, null)
            tracker.currentName = groupNickname
            tracker.lastSeenTs = msg.timestamp
          } else {
            tracker.lastSeenTs = msg.timestamp
          }
        }
      }

      // 更新成员最新的 account_name 和 group_nickname
      for (const [platformId, tracker] of accountNameTracker.entries()) {
        updateMemberAccountName.run(tracker.currentName, platformId)
      }
      for (const [platformId, tracker] of groupNicknameTracker.entries()) {
        updateMemberGroupNickname.run(tracker.currentName, platformId)
      }
    })

    console.log('[Database] Executing transaction...')
    importTransaction()
    console.log('[Database] Transaction completed')

    const fileExists = fs.existsSync(dbPath)
    console.log('[Database] File exists after transaction:', fileExists, dbPath)

    return sessionId
  } catch (error) {
    console.error('[Database] Error in importData:', error)
    throw error
  } finally {
    console.log('[Database] Closing database...')
    db.close()
    console.log('[Database] Database closed')

    const fileExists = fs.existsSync(dbPath)
    console.log('[Database] File exists after close:', fileExists)
  }
}

/**
 * 获取所有分析会话列表
 */
export function getAllSessions(): AnalysisSession[] {
  ensureDbDir()
  const sessions: AnalysisSession[] = []

  const dbDir = getDbDir()
  console.log('[Database] getAllSessions: DB_DIR =', dbDir)
  console.log('[Database] getAllSessions: DB_DIR exists =', fs.existsSync(dbDir))

  const allFiles = fs.readdirSync(dbDir)
  console.log('[Database] getAllSessions: all files in dir:', allFiles)

  const files = allFiles.filter((f) => f.endsWith('.db'))
  console.log('[Database] getAllSessions: filtered .db files:', files)

  for (const file of files) {
    const sessionId = file.replace('.db', '')
    const dbPath = getDbPath(sessionId)
    console.log('[Database] Opening database:', dbPath)

    try {
      const db = new Database(dbPath)
      db.pragma('journal_mode = WAL')

      const meta = db.prepare('SELECT * FROM meta LIMIT 1').get() as DbMeta | undefined
      console.log('[Database] Meta:', meta)

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
        console.log('[Database] Counts:', { messageCount, memberCount })

        sessions.push({
          id: sessionId,
          name: meta.name,
          platform: meta.platform as AnalysisSession['platform'],
          type: meta.type as AnalysisSession['type'],
          importedAt: meta.imported_at,
          messageCount,
          memberCount,
          dbPath,
        })
      }

      db.close()
    } catch (error) {
      console.error(`[Database] Failed to read database \${file}:`, error)
    }
  }

  console.log('[Database] getAllSessions: returning', sessions.length, 'sessions')
  return sessions.sort((a, b) => b.importedAt - a.importedAt)
}

/**
 * 获取单个会话信息
 */
export function getSession(sessionId: string): AnalysisSession | null {
  const db = openDatabase(sessionId)
  if (!db) return null

  try {
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
      platform: meta.platform as AnalysisSession['platform'],
      type: meta.type as AnalysisSession['type'],
      importedAt: meta.imported_at,
      messageCount,
      memberCount,
      dbPath: getDbPath(sessionId),
    }
  } finally {
    db.close()
  }
}

/**
 * 删除会话
 */
export function deleteSession(sessionId: string): boolean {
  const dbPath = getDbPath(sessionId)
  const walPath = dbPath + '-wal'
  const shmPath = dbPath + '-shm'

  try {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath)
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath)
    return true
  } catch {
    return false
  }
}

/**
 * 重命名会话
 */
export function renameSession(sessionId: string, newName: string): boolean {
  const dbPath = getDbPath(sessionId)
  if (!fs.existsSync(dbPath)) {
    return false
  }

  try {
    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')

    const stmt = db.prepare('UPDATE meta SET name = ?')
    stmt.run(newName)

    db.close()
    return true
  } catch (error) {
    console.error('[Database] Failed to rename session:', error)
    return false
  }
}

/**
 * 获取数据库存储目录
 */
export function getDbDirectory(): string {
  ensureDbDir()
  return getDbDir()
}
