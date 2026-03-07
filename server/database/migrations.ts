/**
 * Database migration system (server-side)
 *
 * Manages schema version upgrades.
 * Each new field or table change gets a new migration entry with an incremented version.
 *
 * Ported from electron/main/database/migrations.ts — no Electron dependencies.
 */

import type Database from 'better-sqlite3'

/** Migration script interface */
interface Migration {
  /** Version number (must be monotonically increasing) */
  version: number
  /** Technical description */
  description: string
  /** User-readable upgrade reason */
  userMessage: string
  /** Migration execution function */
  up: (db: Database.Database) => void
}

/** Migration info exposed to callers */
export interface MigrationInfo {
  version: number
  description: string
  userMessage: string
}

/** Current schema version (latest migration version) */
export const CURRENT_SCHEMA_VERSION = 3

/**
 * Migration scripts.
 * Versions must be monotonically increasing; each migration runs at most once.
 */
const migrations: Migration[] = [
  {
    version: 1,
    description: 'Add owner_id column to meta table',
    userMessage: 'Database upgraded to support chat owner identification',
    up: (db) => {
      const tableInfo = db.prepare('PRAGMA table_info(meta)').all() as Array<{ name: string }>
      const hasOwnerIdColumn = tableInfo.some((col) => col.name === 'owner_id')
      if (!hasOwnerIdColumn) {
        db.exec('ALTER TABLE meta ADD COLUMN owner_id TEXT')
      }
    },
  },
  {
    version: 2,
    description: 'Add roles, reply_to_message_id, platform_message_id columns',
    userMessage: 'Database upgraded to support member roles and message replies',
    up: (db) => {
      const memberTableInfo = db.prepare('PRAGMA table_info(member)').all() as Array<{ name: string }>
      const hasRolesColumn = memberTableInfo.some((col) => col.name === 'roles')
      if (!hasRolesColumn) {
        db.exec("ALTER TABLE member ADD COLUMN roles TEXT DEFAULT '[]'")
      }

      const messageTableInfo = db.prepare('PRAGMA table_info(message)').all() as Array<{ name: string }>

      const hasReplyColumn = messageTableInfo.some((col) => col.name === 'reply_to_message_id')
      if (!hasReplyColumn) {
        db.exec('ALTER TABLE message ADD COLUMN reply_to_message_id TEXT DEFAULT NULL')
      }

      const hasPlatformMsgIdColumn = messageTableInfo.some((col) => col.name === 'platform_message_id')
      if (!hasPlatformMsgIdColumn) {
        db.exec('ALTER TABLE message ADD COLUMN platform_message_id TEXT DEFAULT NULL')
      }

      try {
        db.exec('CREATE INDEX IF NOT EXISTS idx_message_platform_id ON message(platform_message_id)')
      } catch {
        // Index may already exist
      }
    },
  },
  {
    version: 3,
    description: 'Add chat_session, message_context tables and session_gap_threshold column',
    userMessage: 'Database upgraded to support chat sessions and message context',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS chat_session (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          start_ts INTEGER NOT NULL,
          end_ts INTEGER NOT NULL,
          message_count INTEGER DEFAULT 0,
          is_manual INTEGER DEFAULT 0,
          summary TEXT
        )
      `)

      try {
        db.exec('CREATE INDEX IF NOT EXISTS idx_session_time ON chat_session(start_ts, end_ts)')
      } catch {
        // Index may already exist
      }

      db.exec(`
        CREATE TABLE IF NOT EXISTS message_context (
          message_id INTEGER PRIMARY KEY,
          session_id INTEGER NOT NULL,
          topic_id INTEGER
        )
      `)

      try {
        db.exec('CREATE INDEX IF NOT EXISTS idx_context_session ON message_context(session_id)')
      } catch {
        // Index may already exist
      }

      const tableInfo = db.prepare('PRAGMA table_info(meta)').all() as Array<{ name: string }>
      const hasGapThresholdColumn = tableInfo.some((col) => col.name === 'session_gap_threshold')
      if (!hasGapThresholdColumn) {
        db.exec('ALTER TABLE meta ADD COLUMN session_gap_threshold INTEGER')
      }
    },
  },
]

/**
 * Get the current schema version stored in the database.
 * Returns 0 if no version info exists.
 */
function getSchemaVersion(db: Database.Database): number {
  try {
    const tableInfo = db.prepare('PRAGMA table_info(meta)').all() as Array<{ name: string }>
    const hasVersionColumn = tableInfo.some((col) => col.name === 'schema_version')

    if (!hasVersionColumn) {
      return 0
    }

    const result = db.prepare('SELECT schema_version FROM meta LIMIT 1').get() as
      | { schema_version: number | null }
      | undefined
    return result?.schema_version ?? 0
  } catch {
    return 0
  }
}

/**
 * Set the schema version in the database.
 */
function setSchemaVersion(db: Database.Database, version: number): void {
  const tableInfo = db.prepare('PRAGMA table_info(meta)').all() as Array<{ name: string }>
  const hasVersionColumn = tableInfo.some((col) => col.name === 'schema_version')

  if (!hasVersionColumn) {
    db.exec('ALTER TABLE meta ADD COLUMN schema_version INTEGER DEFAULT 0')
  }

  db.prepare('UPDATE meta SET schema_version = ?').run(version)
}

/**
 * Check database integrity (meta table must exist).
 */
function checkDatabaseIntegrity(db: Database.Database): { valid: boolean; error?: string } {
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='meta'").all() as Array<{
      name: string
    }>

    if (tables.length === 0) {
      return {
        valid: false,
        error: 'Database integrity check failed: meta table does not exist',
      }
    }
    return { valid: true }
  } catch (error) {
    return {
      valid: false,
      error: `Database integrity check failed: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

/**
 * Run database migrations.
 * Detects current version and runs all pending migrations.
 *
 * @param db Database connection
 * @param forceRepair Re-run all migrations even if version is current
 * @returns Whether any migrations were executed
 * @throws If database structure is incomplete
 */
export function migrateDatabase(db: Database.Database, forceRepair = false): boolean {
  const integrity = checkDatabaseIntegrity(db)
  if (!integrity.valid) {
    throw new Error(integrity.error)
  }

  const currentVersion = getSchemaVersion(db)

  if (!forceRepair && currentVersion >= CURRENT_SCHEMA_VERSION) {
    return false
  }

  const pendingMigrations = forceRepair ? migrations : migrations.filter((m) => m.version > currentVersion)

  if (pendingMigrations.length === 0) {
    return false
  }

  const migrate = db.transaction(() => {
    for (const migration of pendingMigrations) {
      migration.up(db)
      setSchemaVersion(db, migration.version)
    }
  })

  migrate()
  return true
}

/**
 * Check whether the database needs migration.
 */
export function needsMigration(db: Database.Database): boolean {
  const currentVersion = getSchemaVersion(db)
  return currentVersion < CURRENT_SCHEMA_VERSION
}

/**
 * Get pending migration info (user-readable).
 * @param fromVersion Starting version (exclusive)
 */
export function getPendingMigrationInfos(fromVersion = 0): MigrationInfo[] {
  return migrations
    .filter((m) => m.version > fromVersion)
    .map((m) => ({
      version: m.version,
      description: m.description,
      userMessage: m.userMessage,
    }))
}
