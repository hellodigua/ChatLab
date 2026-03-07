import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import Database from 'better-sqlite3'
import { createDatabase, getDbPath, openDatabase, openDatabaseWithMigration } from './core'
import { CURRENT_SCHEMA_VERSION } from './migrations'

const testDir = path.join(os.tmpdir(), 'chatlab-test-core-' + Date.now())

describe('database/core', () => {
  beforeEach(() => {
    process.env.CHATLAB_DATA_DIR = testDir
  })

  afterEach(() => {
    delete process.env.CHATLAB_DATA_DIR
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true })
    }
  })

  describe('getDbPath', () => {
    it('returns the correct path for a session ID', () => {
      const sessionId = 'chat_123_abc'
      const expected = path.join(testDir, 'databases', 'chat_123_abc.db')
      assert.equal(getDbPath(sessionId), expected)
    })
  })

  describe('createDatabase', () => {
    it('creates a .db file on disk', () => {
      const sessionId = 'test_create_1'
      const db = createDatabase(sessionId)
      db.close()

      const dbPath = getDbPath(sessionId)
      assert.equal(fs.existsSync(dbPath), true)
    })

    it('creates all required tables', () => {
      const sessionId = 'test_create_tables'
      const db = createDatabase(sessionId)

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as Array<{ name: string }>
      const tableNames = tables.map((t) => t.name)
      db.close()

      assert.ok(tableNames.includes('meta'), 'meta table exists')
      assert.ok(tableNames.includes('member'), 'member table exists')
      assert.ok(tableNames.includes('member_name_history'), 'member_name_history table exists')
      assert.ok(tableNames.includes('message'), 'message table exists')
      assert.ok(tableNames.includes('chat_session'), 'chat_session table exists')
      assert.ok(tableNames.includes('message_context'), 'message_context table exists')
    })

    it('creates all required indexes', () => {
      const sessionId = 'test_create_indexes'
      const db = createDatabase(sessionId)

      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all() as Array<{ name: string }>
      const indexNames = indexes.map((i) => i.name)
      db.close()

      assert.ok(indexNames.includes('idx_message_ts'), 'idx_message_ts exists')
      assert.ok(indexNames.includes('idx_message_sender'), 'idx_message_sender exists')
      assert.ok(indexNames.includes('idx_message_platform_id'), 'idx_message_platform_id exists')
      assert.ok(indexNames.includes('idx_member_name_history_member_id'), 'idx_member_name_history_member_id exists')
      assert.ok(indexNames.includes('idx_session_time'), 'idx_session_time exists')
      assert.ok(indexNames.includes('idx_context_session'), 'idx_context_session exists')
    })

    it('sets WAL journal mode', () => {
      const sessionId = 'test_wal'
      const db = createDatabase(sessionId)
      const result = db.pragma('journal_mode') as Array<{ journal_mode: string }>
      db.close()

      assert.equal(result[0].journal_mode, 'wal')
    })

    it('schema_version default matches CURRENT_SCHEMA_VERSION', () => {
      const sessionId = 'test_schema_version'
      const db = createDatabase(sessionId)

      // Insert a row to check the default
      db.prepare(
        "INSERT INTO meta (name, platform, type, imported_at) VALUES ('test', 'test', 'group', 1000)",
      ).run()

      const row = db.prepare('SELECT schema_version FROM meta LIMIT 1').get() as { schema_version: number }
      db.close()

      assert.equal(row.schema_version, CURRENT_SCHEMA_VERSION)
    })

    it('meta table has all required columns', () => {
      const sessionId = 'test_meta_cols'
      const db = createDatabase(sessionId)
      const cols = db.prepare('PRAGMA table_info(meta)').all() as Array<{ name: string }>
      const colNames = cols.map((c) => c.name)
      db.close()

      const expected = [
        'name',
        'platform',
        'type',
        'imported_at',
        'group_id',
        'group_avatar',
        'owner_id',
        'schema_version',
        'session_gap_threshold',
      ]
      for (const col of expected) {
        assert.ok(colNames.includes(col), `meta.${col} exists`)
      }
    })

    it('message table has reply_to_message_id and platform_message_id columns', () => {
      const sessionId = 'test_message_cols'
      const db = createDatabase(sessionId)
      const cols = db.prepare('PRAGMA table_info(message)').all() as Array<{ name: string }>
      const colNames = cols.map((c) => c.name)
      db.close()

      assert.ok(colNames.includes('reply_to_message_id'), 'reply_to_message_id exists')
      assert.ok(colNames.includes('platform_message_id'), 'platform_message_id exists')
    })
  })

  describe('openDatabase', () => {
    it('returns null when session does not exist', () => {
      const db = openDatabase('nonexistent_session')
      assert.equal(db, null)
    })

    it('opens an existing database in readonly mode by default', () => {
      const sessionId = 'test_open_readonly'
      const created = createDatabase(sessionId)
      created.prepare(
        "INSERT INTO meta (name, platform, type, imported_at) VALUES ('test', 'test', 'group', 1000)",
      ).run()
      created.close()

      const db = openDatabase(sessionId)
      assert.notEqual(db, null)

      // Verify it's readonly — write should throw
      assert.throws(() => {
        db!.prepare("INSERT INTO meta (name, platform, type, imported_at) VALUES ('x', 'x', 'x', 1)").run()
      })

      db!.close()
    })

    it('opens an existing database in write mode when readonly=false', () => {
      const sessionId = 'test_open_write'
      const created = createDatabase(sessionId)
      created.close()

      const db = openDatabase(sessionId, false)
      assert.notEqual(db, null)

      // Should be able to write
      assert.doesNotThrow(() => {
        db!.prepare(
          "INSERT INTO meta (name, platform, type, imported_at) VALUES ('test', 'test', 'group', 1000)",
        ).run()
      })

      db!.close()
    })
  })

  describe('openDatabaseWithMigration', () => {
    it('returns null when session does not exist', () => {
      const db = openDatabaseWithMigration('nonexistent_session')
      assert.equal(db, null)
    })

    it('opens a database and runs migrations on old-schema db', () => {
      // Create a minimal v0 database manually
      const sessionId = 'test_migrate_v0'
      const dbDir = path.join(testDir, 'databases')
      fs.mkdirSync(dbDir, { recursive: true })
      const dbPath = path.join(dbDir, `${sessionId}.db`)

      const db = new Database(dbPath)
      db.pragma('journal_mode = WAL')
      db.exec(`
        CREATE TABLE meta (
          name TEXT NOT NULL,
          platform TEXT NOT NULL,
          type TEXT NOT NULL,
          imported_at INTEGER NOT NULL
        );
        CREATE TABLE member (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          platform_id TEXT NOT NULL UNIQUE,
          account_name TEXT,
          group_nickname TEXT,
          aliases TEXT DEFAULT '[]',
          avatar TEXT
        );
        CREATE TABLE message (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sender_id INTEGER NOT NULL,
          sender_account_name TEXT,
          sender_group_nickname TEXT,
          ts INTEGER NOT NULL,
          type INTEGER NOT NULL,
          content TEXT
        );
        INSERT INTO meta (name, platform, type, imported_at) VALUES ('test', 'wechat', 'group', 1000);
      `)
      db.close()

      // Open with migration
      const migratedDb = openDatabaseWithMigration(sessionId)
      assert.notEqual(migratedDb, null)

      // Check schema_version is now current
      const row = migratedDb!.prepare('SELECT schema_version FROM meta LIMIT 1').get() as { schema_version: number }
      assert.equal(row.schema_version, CURRENT_SCHEMA_VERSION)

      // Check owner_id was added (v1)
      const metaCols = migratedDb!.prepare('PRAGMA table_info(meta)').all() as Array<{ name: string }>
      assert.ok(metaCols.some((c) => c.name === 'owner_id'), 'owner_id added by v1 migration')

      // Check roles was added (v2)
      const memberCols = migratedDb!.prepare('PRAGMA table_info(member)').all() as Array<{ name: string }>
      assert.ok(memberCols.some((c) => c.name === 'roles'), 'roles added by v2 migration')

      // Check reply_to_message_id was added (v2)
      const msgCols = migratedDb!.prepare('PRAGMA table_info(message)').all() as Array<{ name: string }>
      assert.ok(msgCols.some((c) => c.name === 'reply_to_message_id'), 'reply_to_message_id added by v2 migration')

      // Check chat_session table was created (v3)
      const tables = migratedDb!
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chat_session'")
        .all() as Array<{ name: string }>
      assert.equal(tables.length, 1, 'chat_session table created by v3 migration')

      migratedDb!.close()
    })
  })
})
