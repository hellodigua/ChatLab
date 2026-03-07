/**
 * Database connection pool management (server-side)
 *
 * Provides cached read-only connections, on-demand writable connections,
 * and shared time-filter / system-message-filter utilities.
 *
 * Ported from electron/main/worker/core/dbCore.ts + session/core.ts
 * — no worker_threads, no Electron dependencies.
 */

import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import { getDatabaseDir, ensureDir } from '../paths'

// ---------------------------------------------------------------------------
// Database directory helpers
// ---------------------------------------------------------------------------

function getDbDir(): string {
  return getDatabaseDir()
}

/**
 * Get the database file path for a given session ID.
 */
export function getDbPath(sessionId: string): string {
  return path.join(getDbDir(), `${sessionId}.db`)
}

// ---------------------------------------------------------------------------
// Cached read-only pool
// ---------------------------------------------------------------------------

const readonlyCache = new Map<string, Database.Database>()

/**
 * Open (or return a cached) **read-only** database connection.
 * Returns `null` if the database file does not exist.
 */
export function openDatabase(sessionId: string): Database.Database | null {
  if (readonlyCache.has(sessionId)) {
    return readonlyCache.get(sessionId)!
  }

  const dbPath = getDbPath(sessionId)
  if (!fs.existsSync(dbPath)) {
    return null
  }

  const db = new Database(dbPath, { readonly: true })
  db.pragma('journal_mode = WAL')

  readonlyCache.set(sessionId, db)
  return db
}

/**
 * Close (and evict from cache) a read-only connection for the given session.
 */
export function closeDatabase(sessionId: string): void {
  const db = readonlyCache.get(sessionId)
  if (db) {
    db.close()
    readonlyCache.delete(sessionId)
  }
}

/**
 * Close all cached read-only connections.
 */
export function closeAllDatabases(): void {
  for (const [sessionId, db] of readonlyCache.entries()) {
    db.close()
    readonlyCache.delete(sessionId)
  }
}

// ---------------------------------------------------------------------------
// On-demand writable / read-only (non-cached) connections
// ---------------------------------------------------------------------------

/**
 * Open a **writable** database connection (not cached).
 * The caller is responsible for closing it.
 */
export function openWritableDatabase(sessionId: string): Database.Database | null {
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
 * Open a **read-only** database connection (not cached).
 * The caller is responsible for closing it.
 */
export function openReadonlyDatabase(sessionId: string): Database.Database | null {
  const dbPath = getDbPath(sessionId)
  try {
    const db = new Database(dbPath, { readonly: true })
    db.pragma('journal_mode = WAL')
    return db
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Time-filter & system-message-filter utilities
// ---------------------------------------------------------------------------

export interface TimeFilter {
  startTs?: number
  endTs?: number
  memberId?: number | null
}

/**
 * Build a WHERE clause for time (and optional member) filtering.
 *
 * @param filter  Filter parameters
 * @param tableAlias  Optional table alias (e.g. `'msg'`) to prefix column names
 */
export function buildTimeFilter(
  filter?: TimeFilter,
  tableAlias?: string,
): { clause: string; params: (number | string)[] } {
  const conditions: string[] = []
  const params: (number | string)[] = []

  const tsCol = tableAlias ? `${tableAlias}.ts` : 'ts'
  const senderCol = tableAlias ? `${tableAlias}.sender_id` : 'sender_id'

  if (filter?.startTs !== undefined) {
    conditions.push(`${tsCol} >= ?`)
    params.push(filter.startTs)
  }
  if (filter?.endTs !== undefined) {
    conditions.push(`${tsCol} <= ?`)
    params.push(filter.endTs)
  }
  if (filter?.memberId !== undefined && filter?.memberId !== null) {
    conditions.push(`${senderCol} = ?`)
    params.push(filter.memberId)
  }

  return {
    clause: conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '',
    params,
  }
}

/**
 * Append a system-message exclusion condition to an existing WHERE clause.
 */
export function buildSystemMessageFilter(existingClause: string): string {
  const systemFilter = "COALESCE(m.account_name, '') != '系统消息'"

  if (existingClause.includes('WHERE')) {
    return existingClause + ' AND ' + systemFilter
  }
  return ' WHERE ' + systemFilter
}

// ---------------------------------------------------------------------------
// Database directory accessor (ensures it exists)
// ---------------------------------------------------------------------------

/**
 * Return the database directory (creates it if missing).
 */
export function getDbDirectory(): string {
  const dir = getDbDir()
  ensureDir(dir)
  return dir
}
