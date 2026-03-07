/**
 * Shared helpers for query modules.
 * Column migration and common constants.
 */

import Database from 'better-sqlite3'
import * as fs from 'fs'
import { closeDatabase, getDbPath } from '../db-pool'

// Track which sessions have been checked for schema compatibility
const aliasesCheckedSessions = new Set<string>()
const avatarCheckedSessions = new Set<string>()

/**
 * Ensure `member.aliases` column exists (compat with older databases).
 */
export function ensureAliasesColumn(sessionId: string): void {
  if (aliasesCheckedSessions.has(sessionId)) return
  const dbPath = getDbPath(sessionId)
  if (!fs.existsSync(dbPath)) return
  closeDatabase(sessionId)
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  try {
    const columns = db.prepare('PRAGMA table_info(member)').all() as Array<{ name: string }>
    if (!columns.some((c) => c.name === 'aliases')) {
      db.exec("ALTER TABLE member ADD COLUMN aliases TEXT DEFAULT '[]'")
    }
    aliasesCheckedSessions.add(sessionId)
  } finally {
    db.close()
  }
}

/**
 * Ensure `member.avatar` column exists (compat with older databases).
 */
export function ensureAvatarColumn(sessionId: string): void {
  if (avatarCheckedSessions.has(sessionId)) return
  const dbPath = getDbPath(sessionId)
  if (!fs.existsSync(dbPath)) return
  closeDatabase(sessionId)
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  try {
    const columns = db.prepare('PRAGMA table_info(member)').all() as Array<{ name: string }>
    if (!columns.some((c) => c.name === 'avatar')) {
      db.exec('ALTER TABLE member ADD COLUMN avatar TEXT')
    }
    avatarCheckedSessions.add(sessionId)
  } finally {
    db.close()
  }
}
