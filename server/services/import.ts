/**
 * Import service module (server-side)
 *
 * Ported from electron/main/worker/import/ — no worker_threads, no parentPort.
 * Progress is reported via optional callbacks.
 *
 * Contains:
 *   - generateSessionId / getDbPath / createDatabaseWithoutIndexes / createIndexes
 *   - generateMessageKey / createTempDatabase / cleanupTempDatabase
 *
 * Note: The actual streamImport and incrementalImport functions depend on
 * ../../electron/main/parser which is still in the Electron directory and will
 * be moved in a later story. This file provides the database-layer utilities
 * and a thin wrapper that later stories can plug the parser into.
 */

import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import { getDatabaseDir, getTempDir, ensureDir } from '../paths'

// ============================================================================
// Utility functions
// ============================================================================

function getDbDir(): string {
  return getDatabaseDir()
}

/**
 * Generate a unique session ID.
 */
export function generateSessionId(): string {
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
 * Create a database with table schema but without indexes (for fast bulk import).
 */
export function createDatabaseWithoutIndexes(sessionId: string): Database.Database {
  const dbDir = getDbDir()
  ensureDir(dbDir)

  const dbPath = getDbPath(sessionId)
  const db = new Database(dbPath)

  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('cache_size = -64000')

  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      type TEXT NOT NULL,
      imported_at INTEGER NOT NULL,
      group_id TEXT,
      group_avatar TEXT,
      owner_id TEXT,
      schema_version INTEGER DEFAULT 3,
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
  `)

  return db
}

/**
 * Create indexes after bulk import completes.
 */
export function createIndexes(db: Database.Database): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_message_ts ON message(ts);
    CREATE INDEX IF NOT EXISTS idx_message_sender ON message(sender_id);
    CREATE INDEX IF NOT EXISTS idx_message_platform_id ON message(platform_message_id);
    CREATE INDEX IF NOT EXISTS idx_member_name_history_member_id ON member_name_history(member_id);
    CREATE INDEX IF NOT EXISTS idx_session_time ON chat_session(start_ts, end_ts);
    CREATE INDEX IF NOT EXISTS idx_context_session ON message_context(session_id);
  `)
}

// ============================================================================
// Message dedup key
// ============================================================================

/**
 * Generate a dedup key for a message.
 * Uses timestamp + senderPlatformId + contentLength.
 */
export function generateMessageKey(
  timestamp: number,
  senderPlatformId: string,
  content: string | null,
): string {
  const contentLength = content ? content.length : 0
  return `${timestamp}_${senderPlatformId}_${contentLength}`
}

// ============================================================================
// Temp database (for merge import)
// ============================================================================

function getImportTempDir(): string {
  const tempDir = getTempDir()
  ensureDir(tempDir)
  return tempDir
}

/**
 * Create a temporary database for merge operations.
 */
export function createTempDatabase(): { db: Database.Database; path: string } {
  const tempDir = getImportTempDir()
  const tempPath = path.join(
    tempDir,
    `merge_${Date.now()}_${Math.random().toString(36).slice(2)}.db`,
  )
  const db = new Database(tempPath)

  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('cache_size = -64000')

  db.exec(`
    CREATE TABLE IF NOT EXISTS member (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform_id TEXT NOT NULL UNIQUE,
      account_name TEXT,
      group_nickname TEXT,
      aliases TEXT DEFAULT '[]',
      avatar TEXT,
      roles TEXT DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS message (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_platform_id TEXT NOT NULL,
      sender_account_name TEXT,
      sender_group_nickname TEXT,
      ts INTEGER NOT NULL,
      type INTEGER NOT NULL,
      content TEXT,
      reply_to_message_id TEXT DEFAULT NULL,
      platform_message_id TEXT DEFAULT NULL
    );
  `)

  return { db, path: tempPath }
}

/**
 * Clean up a temporary database and its WAL/SHM files.
 */
export function cleanupTempDatabase(dbPath: string): void {
  try {
    const walPath = `${dbPath}-wal`
    const shmPath = `${dbPath}-shm`
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath)
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath)
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
  } catch (err) {
    console.error('Failed to clean up temp database:', err)
  }
}
