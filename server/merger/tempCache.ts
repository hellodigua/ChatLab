/**
 * Temporary database cache manager (server-side)
 *
 * Ported from electron/main/merger/tempCache.ts — no Electron dependencies.
 * Uses better-sqlite3 for temporary SQLite databases to avoid memory overflow
 * when merging large chat files.
 */

import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import { getTempDir, ensureDir } from '../paths'
import type { ParsedMember, ParsedMessage } from '../parser/types'

/**
 * Get the temporary database directory.
 */
function getMergeTempDir(): string {
  const dir = path.join(getTempDir(), 'merge')
  ensureDir(dir)
  return dir
}

/**
 * Generate a unique temporary database file path.
 */
export function generateTempDbPath(sourceFilePath: string): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  const baseName = path.basename(sourceFilePath, path.extname(sourceFilePath))
  const safeName = baseName.replace(/[/\\?%*:|"<>]/g, '_').substring(0, 50)
  return path.join(getMergeTempDir(), `merge_${safeName}_${timestamp}_${random}.db`)
}

/**
 * Create a temporary database and initialize its schema.
 */
export function createTempDatabase(dbPath: string): Database.Database {
  ensureDir(path.dirname(dbPath))
  const db = new Database(dbPath)

  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      type TEXT NOT NULL,
      group_id TEXT,
      group_avatar TEXT
    );

    CREATE TABLE IF NOT EXISTS member (
      platform_id TEXT PRIMARY KEY,
      account_name TEXT,
      group_nickname TEXT,
      avatar TEXT
    );

    CREATE TABLE IF NOT EXISTS message (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_platform_id TEXT NOT NULL,
      sender_account_name TEXT,
      sender_group_nickname TEXT,
      timestamp INTEGER NOT NULL,
      type INTEGER NOT NULL,
      content TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_message_ts ON message(timestamp);
    CREATE INDEX IF NOT EXISTS idx_message_sender ON message(sender_platform_id);
  `)

  return db
}

/** Parsed meta info stored in temp database */
export interface TempDbMeta {
  name: string
  platform: string
  type: 'group' | 'private'
  groupId?: string
  groupAvatar?: string
}

/**
 * Temporary database writer.
 * Streams parsed results into a temp SQLite database.
 */
export class TempDbWriter {
  private db: Database.Database
  private insertMeta: Database.Statement
  private insertMember: Database.Statement
  private insertMessage: Database.Statement
  private memberSet: Set<string> = new Set()
  private messageCount: number = 0

  constructor(dbPath: string) {
    this.db = createTempDatabase(dbPath)

    this.insertMeta = this.db.prepare(`
      INSERT INTO meta (name, platform, type, group_id, group_avatar) VALUES (?, ?, ?, ?, ?)
    `)
    this.insertMember = this.db.prepare(`
      INSERT OR IGNORE INTO member (platform_id, account_name, group_nickname, avatar) VALUES (?, ?, ?, ?)
    `)
    this.insertMessage = this.db.prepare(`
      INSERT INTO message (sender_platform_id, sender_account_name, sender_group_nickname, timestamp, type, content)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    this.db.exec('BEGIN TRANSACTION')
  }

  /** Write meta information. */
  writeMeta(meta: TempDbMeta): void {
    this.insertMeta.run(
      meta.name,
      meta.platform,
      meta.type,
      meta.groupId || null,
      meta.groupAvatar || null,
    )
  }

  /** Write members (batch). */
  writeMembers(members: ParsedMember[]): void {
    for (const m of members) {
      if (!this.memberSet.has(m.platformId)) {
        this.memberSet.add(m.platformId)
        this.insertMember.run(
          m.platformId,
          m.accountName || null,
          m.groupNickname || null,
          m.avatar || null,
        )
      }
    }
  }

  /** Write messages (batch). */
  writeMessages(messages: ParsedMessage[]): void {
    for (const msg of messages) {
      // Ensure member exists
      if (!this.memberSet.has(msg.senderPlatformId)) {
        this.memberSet.add(msg.senderPlatformId)
        this.insertMember.run(
          msg.senderPlatformId,
          msg.senderAccountName || null,
          msg.senderGroupNickname || null,
          null,
        )
      }

      this.insertMessage.run(
        msg.senderPlatformId,
        msg.senderAccountName || null,
        msg.senderGroupNickname || null,
        msg.timestamp,
        msg.type,
        msg.content || null,
      )
      this.messageCount++
    }
  }

  /** Commit and close. Returns counts. */
  finish(): { messageCount: number; memberCount: number } {
    this.db.exec('COMMIT')
    const result = {
      messageCount: this.messageCount,
      memberCount: this.memberSet.size,
    }
    this.db.close()
    return result
  }

  /** Rollback and close. */
  abort(): void {
    try {
      this.db.exec('ROLLBACK')
    } catch {
      // Ignore rollback errors
    }
    this.db.close()
  }
}

/**
 * Temporary database reader.
 * Reads data from temp databases for conflict checking and merging.
 */
export class TempDbReader {
  private db: Database.Database
  private dbPath: string

  constructor(dbPath: string) {
    this.dbPath = dbPath
    this.db = new Database(dbPath, { readonly: true })
    this.db.pragma('journal_mode = WAL')
  }

  /** Read meta information. */
  getMeta(): TempDbMeta | null {
    const row = this.db.prepare('SELECT * FROM meta LIMIT 1').get() as
      | { name: string; platform: string; type: string; group_id: string | null; group_avatar: string | null }
      | undefined
    if (!row) return null
    return {
      name: row.name,
      platform: row.platform,
      type: row.type as 'group' | 'private',
      groupId: row.group_id || undefined,
      groupAvatar: row.group_avatar || undefined,
    }
  }

  /** Read all members. */
  getMembers(): ParsedMember[] {
    const rows = this.db.prepare('SELECT * FROM member').all() as Array<{
      platform_id: string
      account_name: string | null
      group_nickname: string | null
      avatar: string | null
    }>
    return rows.map((r) => ({
      platformId: r.platform_id,
      accountName: r.account_name || r.platform_id,
      groupNickname: r.group_nickname || undefined,
      avatar: r.avatar || undefined,
    }))
  }

  /** Get message count. */
  getMessageCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM message').get() as { count: number }
    return row.count
  }

  /**
   * Stream-read messages in batches.
   * @param batchSize Number of messages per batch
   * @param callback Handler for each batch
   */
  streamMessages(batchSize: number, callback: (messages: ParsedMessage[]) => void): void {
    const stmt = this.db.prepare(`
      SELECT sender_platform_id, sender_account_name, sender_group_nickname, timestamp, type, content
      FROM message
      ORDER BY timestamp ASC
      LIMIT ? OFFSET ?
    `)

    let offset = 0
    while (true) {
      const rows = stmt.all(batchSize, offset) as Array<{
        sender_platform_id: string
        sender_account_name: string | null
        sender_group_nickname: string | null
        timestamp: number
        type: number
        content: string | null
      }>

      if (rows.length === 0) break

      const messages: ParsedMessage[] = rows.map((r) => ({
        senderPlatformId: r.sender_platform_id,
        senderAccountName: r.sender_account_name || r.sender_platform_id,
        senderGroupNickname: r.sender_group_nickname || undefined,
        timestamp: r.timestamp,
        type: r.type,
        content: r.content ?? null,
      }))

      callback(messages)
      offset += batchSize
    }
  }

  /** Get all messages (for small datasets or conflict detection). */
  getAllMessages(): ParsedMessage[] {
    const rows = this.db
      .prepare(`
        SELECT sender_platform_id, sender_account_name, sender_group_nickname, timestamp, type, content
        FROM message
        ORDER BY timestamp ASC
      `)
      .all() as Array<{
      sender_platform_id: string
      sender_account_name: string | null
      sender_group_nickname: string | null
      timestamp: number
      type: number
      content: string | null
    }>

    return rows.map((r) => ({
      senderPlatformId: r.sender_platform_id,
      senderAccountName: r.sender_account_name || r.sender_platform_id,
      senderGroupNickname: r.sender_group_nickname || undefined,
      timestamp: r.timestamp,
      type: r.type,
      content: r.content ?? null,
    }))
  }

  /** Close database connection. */
  close(): void {
    this.db.close()
  }

  /** Get database path. */
  getPath(): string {
    return this.dbPath
  }
}

/**
 * Delete a temporary database and its WAL/SHM files.
 */
export function deleteTempDatabase(dbPath: string): void {
  try {
    const walPath = dbPath + '-wal'
    const shmPath = dbPath + '-shm'

    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath)
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath)

    console.log(`[TempCache] Deleted temp database: ${dbPath}`)
  } catch (error) {
    console.error(`[TempCache] Failed to delete temp database: ${dbPath}`, error)
  }
}

/**
 * Clean up all temporary merge databases (e.g. on startup).
 */
export function cleanupAllTempDatabases(): void {
  try {
    const dir = getMergeTempDir()
    if (!fs.existsSync(dir)) return

    const files = fs.readdirSync(dir)
    for (const file of files) {
      if (file.startsWith('merge_') && file.endsWith('.db')) {
        const filePath = path.join(dir, file)
        deleteTempDatabase(filePath)
      }
    }
    console.log('[TempCache] Cleaned up all temp databases')
  } catch (error) {
    console.error('[TempCache] Failed to clean up temp databases:', error)
  }
}
