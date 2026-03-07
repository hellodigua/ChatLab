/**
 * Database core module (server-side)
 * Handles database creation, opening, closing, and data import.
 *
 * Ported from electron/main/database/core.ts — no Electron dependencies.
 */

import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import type { ParseResult } from '../../src/types/base'
import { migrateDatabase, needsMigration, CURRENT_SCHEMA_VERSION } from './migrations'
import { getDatabaseDir, ensureDir } from '../paths'

/**
 * Get the database directory.
 */
function getDbDir(): string {
  return getDatabaseDir()
}

/**
 * Ensure the database directory exists.
 */
function ensureDbDir(): void {
  ensureDir(getDbDir())
}

/**
 * Generate a unique session ID.
 */
function generateSessionId(): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  return `chat_${timestamp}_${random}`
}

/**
 * Get the database file path for a given session ID.
 */
export function getDbPath(sessionId: string): string {
  return path.join(getDbDir(), `${sessionId}.db`)
}

/**
 * Create a new database and initialise the schema.
 */
export function createDatabase(sessionId: string): Database.Database {
  ensureDbDir()
  const dbPath = getDbPath(sessionId)
  const db = new Database(dbPath)

  db.pragma('journal_mode = WAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      type TEXT NOT NULL,
      imported_at INTEGER NOT NULL,
      group_id TEXT,
      group_avatar TEXT,
      owner_id TEXT,
      schema_version INTEGER DEFAULT ${CURRENT_SCHEMA_VERSION},
      session_gap_threshold INTEGER
    );

    CREATE TABLE IF NOT EXISTS member (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform_id TEXT NOT NULL UNIQUE,
      account_name TEXT,
      group_nickname TEXT,
      aliases TEXT DEFAULT '[]',
      avatar TEXT,
      roles TEXT DEFAULT '[]'
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
      reply_to_message_id TEXT DEFAULT NULL,
      platform_message_id TEXT DEFAULT NULL,
      FOREIGN KEY(sender_id) REFERENCES member(id)
    );

    CREATE TABLE IF NOT EXISTS chat_session (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      start_ts INTEGER NOT NULL,
      end_ts INTEGER NOT NULL,
      message_count INTEGER DEFAULT 0,
      is_manual INTEGER DEFAULT 0,
      summary TEXT
    );

    CREATE TABLE IF NOT EXISTS message_context (
      message_id INTEGER PRIMARY KEY,
      session_id INTEGER NOT NULL,
      topic_id INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_message_ts ON message(ts);
    CREATE INDEX IF NOT EXISTS idx_message_sender ON message(sender_id);
    CREATE INDEX IF NOT EXISTS idx_message_platform_id ON message(platform_message_id);
    CREATE INDEX IF NOT EXISTS idx_member_name_history_member_id ON member_name_history(member_id);
    CREATE INDEX IF NOT EXISTS idx_session_time ON chat_session(start_ts, end_ts);
    CREATE INDEX IF NOT EXISTS idx_context_session ON message_context(session_id);
  `)

  return db
}

/**
 * Open an existing database.
 * @param readonly Whether to open in read-only mode (default true)
 */
export function openDatabase(sessionId: string, readonly = true): Database.Database | null {
  const dbPath = getDbPath(sessionId)
  if (!fs.existsSync(dbPath)) {
    return null
  }
  const db = new Database(dbPath, { readonly })
  db.pragma('journal_mode = WAL')
  return db
}

/**
 * Open a database and run migrations if needed.
 * Used for write scenarios.
 * @param sessionId Session ID
 * @param forceRepair Re-run all migration scripts even if version is current
 */
export function openDatabaseWithMigration(sessionId: string, forceRepair = false): Database.Database | null {
  const dbPath = getDbPath(sessionId)
  if (!fs.existsSync(dbPath)) {
    return null
  }

  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')

  migrateDatabase(db, forceRepair)

  return db
}

/**
 * Import parsed data into a new database.
 */
export function importData(parseResult: ParseResult): string {
  const sessionId = generateSessionId()
  const db = createDatabase(sessionId)

  try {
    const importTransaction = db.transaction(() => {
      const insertMeta = db.prepare(`
        INSERT INTO meta (name, platform, type, imported_at, group_id, group_avatar, owner_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      insertMeta.run(
        parseResult.meta.name,
        parseResult.meta.platform,
        parseResult.meta.type,
        Math.floor(Date.now() / 1000),
        parseResult.meta.groupId || null,
        parseResult.meta.groupAvatar || null,
        parseResult.meta.ownerId || null,
      )

      const insertMember = db.prepare(`
        INSERT OR IGNORE INTO member (platform_id, account_name, group_nickname, avatar, roles) VALUES (?, ?, ?, ?, ?)
      `)
      const getMemberId = db.prepare(`
        SELECT id FROM member WHERE platform_id = ?
      `)

      const memberIdMap = new Map<string, number>()

      for (const member of parseResult.members) {
        insertMember.run(
          member.platformId,
          member.accountName || null,
          member.groupNickname || null,
          member.avatar || null,
          member.roles ? JSON.stringify(member.roles) : '[]',
        )
        const row = getMemberId.get(member.platformId) as { id: number }
        memberIdMap.set(member.platformId, row.id)
      }

      const sortedMessages = [...parseResult.messages].sort((a, b) => a.timestamp - b.timestamp)
      const accountNameTracker = new Map<string, { currentName: string; lastSeenTs: number }>()
      const groupNicknameTracker = new Map<string, { currentName: string; lastSeenTs: number }>()

      const insertMessage = db.prepare(`
        INSERT INTO message (sender_id, sender_account_name, sender_group_nickname, ts, type, content, reply_to_message_id, platform_message_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
          msg.content,
          msg.replyToMessageId || null,
          msg.platformMessageId || null,
        )

        // Track account_name changes
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

        // Track group_nickname changes
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

      // Update members with their latest names
      for (const [platformId, tracker] of accountNameTracker.entries()) {
        updateMemberAccountName.run(tracker.currentName, platformId)
      }
      for (const [platformId, tracker] of groupNicknameTracker.entries()) {
        updateMemberGroupNickname.run(tracker.currentName, platformId)
      }
    })

    importTransaction()

    return sessionId
  } catch (error) {
    console.error('[Database] Error in importData:', error)
    throw error
  } finally {
    db.close()
  }
}

/**
 * Update the ownerId of a session.
 */
export function updateSessionOwnerId(sessionId: string, ownerId: string | null): boolean {
  const db = openDatabaseWithMigration(sessionId)
  if (!db) {
    return false
  }

  try {
    const stmt = db.prepare('UPDATE meta SET owner_id = ?')
    stmt.run(ownerId)
    return true
  } catch (error) {
    console.error('[Database] Failed to update session ownerId:', error)
    return false
  } finally {
    db.close()
  }
}

/**
 * Delete a session and its associated files.
 */
export function deleteSession(sessionId: string): boolean {
  const dbPath = getDbPath(sessionId)
  const walPath = dbPath + '-wal'
  const shmPath = dbPath + '-shm'

  try {
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath)
    }
    if (fs.existsSync(walPath)) {
      fs.unlinkSync(walPath)
    }
    if (fs.existsSync(shmPath)) {
      fs.unlinkSync(shmPath)
    }
    return true
  } catch (error) {
    console.error('[Database] Failed to delete session:', error)
    return false
  }
}

/**
 * Rename a session.
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
 * Get the database storage directory (ensures it exists).
 */
export function getDbDirectory(): string {
  ensureDbDir()
  return getDbDir()
}

/**
 * Check which databases need migration.
 */
export function checkMigrationNeeded(): {
  count: number
  sessionIds: string[]
  lowestVersion: number
  forceRepairIds: string[]
} {
  ensureDbDir()
  const dbDir = getDbDir()
  const files = fs.readdirSync(dbDir).filter((f) => f.endsWith('.db'))
  const needsMigrationList: string[] = []
  const forceRepairList: string[] = []
  let lowestVersion = CURRENT_SCHEMA_VERSION

  for (const file of files) {
    const sessionId = file.replace('.db', '')
    const dbPath = getDbPath(sessionId)

    try {
      const db = new Database(dbPath, { readonly: true })
      db.pragma('journal_mode = WAL')

      // Only migrate chat session databases (must have meta + message tables)
      const requiredTableCount = db
        .prepare("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name IN ('meta', 'message')")
        .get() as { cnt: number }
      const isChatSessionDb = requiredTableCount.cnt === 2
      if (!isChatSessionDb) {
        db.close()
        continue
      }

      // Get current schema_version
      const metaTableInfo = db.prepare('PRAGMA table_info(meta)').all() as Array<{ name: string }>
      const hasVersionColumn = metaTableInfo.some((col) => col.name === 'schema_version')
      let dbVersion = 0
      if (hasVersionColumn) {
        const result = db.prepare('SELECT schema_version FROM meta LIMIT 1').get() as
          | { schema_version: number | null }
          | undefined
        dbVersion = result?.schema_version ?? 0
      }

      // Check if message table has reply_to_message_id column
      const messageTableInfo = db.prepare('PRAGMA table_info(message)').all() as Array<{ name: string }>
      const hasReplyColumn = messageTableInfo.some((col) => col.name === 'reply_to_message_id')

      if (needsMigration(db)) {
        needsMigrationList.push(sessionId)
        lowestVersion = Math.min(lowestVersion, dbVersion)
      } else if (!hasReplyColumn) {
        // Version is up to date but column is missing — needs force repair
        needsMigrationList.push(sessionId)
        forceRepairList.push(sessionId)
        lowestVersion = Math.min(lowestVersion, dbVersion)
      }

      db.close()
    } catch (error) {
      console.error(`[Database] Failed to check migration for ${file}:`, error)
    }
  }

  return {
    count: needsMigrationList.length,
    sessionIds: needsMigrationList,
    lowestVersion,
    forceRepairIds: forceRepairList,
  }
}

/** Migration failure info */
interface MigrationFailure {
  sessionId: string
  error: string
}

/**
 * Run migrations on all databases that need them.
 * Continues processing even if some databases fail.
 */
export function migrateAllDatabases(): {
  success: boolean
  migratedCount: number
  failures: MigrationFailure[]
  error?: string
} {
  const { sessionIds, forceRepairIds } = checkMigrationNeeded()
  const forceRepairSet = new Set(forceRepairIds)

  if (sessionIds.length === 0) {
    return { success: true, migratedCount: 0, failures: [] }
  }

  let migratedCount = 0
  const failures: MigrationFailure[] = []

  for (const sessionId of sessionIds) {
    try {
      const needsForceRepair = forceRepairSet.has(sessionId)
      const db = openDatabaseWithMigration(sessionId, needsForceRepair)
      if (db) {
        db.close()
        migratedCount++
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`[Database] Failed to migrate ${sessionId}:`, errorMessage)
      failures.push({ sessionId, error: errorMessage })
    }
  }

  if (failures.length > 0) {
    const failedIds = failures.map((f) => f.sessionId.split('_').slice(-1)[0]).join(', ')
    return {
      success: false,
      migratedCount,
      failures,
      error: `${failures.length} database(s) failed migration (ID: ${failedIds}).`,
    }
  }

  return { success: true, migratedCount, failures: [] }
}
