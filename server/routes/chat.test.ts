/**
 * Tests for chat session API routes (US-004)
 *
 * Uses a temporary database directory to isolate tests from real data.
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { Server } from 'node:http'

// Set up a temporary data directory BEFORE any app modules load
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-test-'))
process.env.CHATLAB_DATA_DIR = tmpDir

import { createApp } from '../index.js'
import Database from 'better-sqlite3'
import { getDatabaseDir, ensureDir } from '../paths.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let server: Server
let baseUrl: string

/** Create a test database with a given sessionId and some minimal data. */
function createTestDb(sessionId: string, opts?: { name?: string; platform?: string; messages?: number }) {
  const dbDir = getDatabaseDir()
  ensureDir(dbDir)
  const dbPath = path.join(dbDir, `${sessionId}.db`)
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
      schema_version INTEGER DEFAULT 1,
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
  `)

  const name = opts?.name ?? 'Test Chat'
  const platform = opts?.platform ?? 'wechat'
  db.prepare(
    'INSERT INTO meta (name, platform, type, imported_at, owner_id) VALUES (?, ?, ?, ?, ?)',
  ).run(name, platform, 'group', Math.floor(Date.now() / 1000), 'owner_123')

  // Add a member
  db.prepare(
    "INSERT INTO member (platform_id, account_name, group_nickname) VALUES ('user1', 'Alice', 'Alice')",
  ).run()

  // Add messages
  const msgCount = opts?.messages ?? 5
  const now = Math.floor(Date.now() / 1000)
  for (let i = 0; i < msgCount; i++) {
    db.prepare(
      'INSERT INTO message (sender_id, ts, type, content) VALUES (1, ?, 0, ?)',
    ).run(now - (msgCount - i) * 60, `Message ${i + 1}`)
  }

  db.close()
  return dbPath
}

/** Remove a test database. */
function removeTestDb(sessionId: string) {
  const dbDir = getDatabaseDir()
  for (const ext of ['', '-wal', '-shm']) {
    const p = path.join(dbDir, `${sessionId}.db${ext}`)
    if (fs.existsSync(p)) fs.unlinkSync(p)
  }
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

before(() => {
  const app = createApp()
  server = app.listen(0)
  const addr = server.address()
  if (!addr || typeof addr === 'string') throw new Error('Failed to get server address')
  baseUrl = `http://localhost:${addr.port}`
})

after(() => {
  if (server) server.close()
  // Clean up the temp directory
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/sessions', () => {
  it('returns an array of sessions', async () => {
    createTestDb('test_list_1', { name: 'Chat A' })
    createTestDb('test_list_2', { name: 'Chat B' })

    const res = await fetch(`${baseUrl}/api/sessions`)
    assert.equal(res.status, 200)
    const body = await res.json() as any[]
    assert.ok(Array.isArray(body))
    assert.ok(body.length >= 2)

    const ids = body.map((s: any) => s.id)
    assert.ok(ids.includes('test_list_1'))
    assert.ok(ids.includes('test_list_2'))

    // Verify session structure
    const session = body.find((s: any) => s.id === 'test_list_1')
    assert.ok(session)
    assert.equal(session.name, 'Chat A')
    assert.equal(session.platform, 'wechat')
    assert.ok(typeof session.messageCount === 'number')
    assert.ok(typeof session.memberCount === 'number')

    removeTestDb('test_list_1')
    removeTestDb('test_list_2')
  })

  it('returns empty array when no sessions exist', async () => {
    // Remove any leftover dbs from previous tests
    const dbDir = getDatabaseDir()
    if (fs.existsSync(dbDir)) {
      for (const f of fs.readdirSync(dbDir).filter((f) => f.endsWith('.db'))) {
        const sessionId = f.replace('.db', '')
        removeTestDb(sessionId)
      }
    }

    const res = await fetch(`${baseUrl}/api/sessions`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.ok(Array.isArray(body))
    assert.equal(body.length, 0)
  })
})

describe('GET /api/sessions/:id', () => {
  it('returns session details for a valid id', async () => {
    createTestDb('test_get_1', { name: 'My Session', messages: 10 })

    const res = await fetch(`${baseUrl}/api/sessions/test_get_1`)
    assert.equal(res.status, 200)
    const body = await res.json() as any
    assert.equal(body.id, 'test_get_1')
    assert.equal(body.name, 'My Session')
    assert.equal(body.messageCount, 10)

    removeTestDb('test_get_1')
  })

  it('returns 404 for non-existent session', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/nonexistent`)
    assert.equal(res.status, 404)
    const body = await res.json() as any
    assert.ok(body.error)
  })
})

describe('DELETE /api/sessions/:id', () => {
  it('deletes a session and returns { success: true }', async () => {
    createTestDb('test_delete_1')
    const dbDir = getDatabaseDir()
    assert.ok(fs.existsSync(path.join(dbDir, 'test_delete_1.db')))

    const res = await fetch(`${baseUrl}/api/sessions/test_delete_1`, {
      method: 'DELETE',
    })
    assert.equal(res.status, 200)
    const body = await res.json() as any
    assert.equal(body.success, true)

    // Verify file is gone
    assert.ok(!fs.existsSync(path.join(dbDir, 'test_delete_1.db')))
  })

  it('returns { success: true } for non-existent session (idempotent)', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/nonexistent_del`, {
      method: 'DELETE',
    })
    assert.equal(res.status, 200)
    const body = await res.json() as any
    assert.equal(body.success, true)
  })
})

describe('PATCH /api/sessions/:id', () => {
  it('renames a session with { name }', async () => {
    createTestDb('test_rename_1', { name: 'Old Name' })

    const res = await fetch(`${baseUrl}/api/sessions/test_rename_1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Name' }),
    })
    assert.equal(res.status, 200)
    const body = await res.json() as any
    assert.equal(body.success, true)

    // Verify the rename took effect
    const getRes = await fetch(`${baseUrl}/api/sessions/test_rename_1`)
    const session = await getRes.json() as any
    assert.equal(session.name, 'New Name')

    removeTestDb('test_rename_1')
  })

  it('updates ownerId with { ownerId }', async () => {
    createTestDb('test_owner_1')

    const res = await fetch(`${baseUrl}/api/sessions/test_owner_1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerId: 'new_owner_456' }),
    })
    assert.equal(res.status, 200)
    const body = await res.json() as any
    assert.equal(body.success, true)

    // Verify the update took effect
    const getRes = await fetch(`${baseUrl}/api/sessions/test_owner_1`)
    const session = await getRes.json() as any
    assert.equal(session.ownerId, 'new_owner_456')

    removeTestDb('test_owner_1')
  })

  it('returns { success: false } for non-existent session', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/nonexistent_patch`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test' }),
    })
    assert.equal(res.status, 200)
    const body = await res.json() as any
    assert.equal(body.success, false)
  })
})

describe('GET /api/sessions/:id/years', () => {
  it('returns available years', async () => {
    createTestDb('test_years_1', { messages: 3 })

    const res = await fetch(`${baseUrl}/api/sessions/test_years_1/years`)
    assert.equal(res.status, 200)
    const body = await res.json() as any[]
    assert.ok(Array.isArray(body))
    // Messages were created with current timestamps so current year should be present
    const currentYear = new Date().getFullYear()
    assert.ok(body.includes(currentYear))

    removeTestDb('test_years_1')
  })

  it('returns empty array for non-existent session', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/nonexistent_years/years`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.ok(Array.isArray(body))
    assert.equal(body.length, 0)
  })
})

describe('GET /api/sessions/:id/time-range', () => {
  it('returns time range', async () => {
    createTestDb('test_range_1', { messages: 5 })

    const res = await fetch(`${baseUrl}/api/sessions/test_range_1/time-range`)
    assert.equal(res.status, 200)
    const body = await res.json() as any
    assert.ok(typeof body.start === 'number')
    assert.ok(typeof body.end === 'number')
    assert.ok(body.start <= body.end)

    removeTestDb('test_range_1')
  })

  it('returns 404 for non-existent session', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/nonexistent_range/time-range`)
    assert.equal(res.status, 404)
  })
})

describe('GET /api/sessions/:id/schema', () => {
  it('returns database schema', async () => {
    createTestDb('test_schema_1')

    const res = await fetch(`${baseUrl}/api/sessions/test_schema_1/schema`)
    assert.equal(res.status, 200)
    const body = await res.json() as any[]
    assert.ok(Array.isArray(body))

    // Should have our core tables
    const tableNames = body.map((t: any) => t.name)
    assert.ok(tableNames.includes('meta'))
    assert.ok(tableNames.includes('member'))
    assert.ok(tableNames.includes('message'))

    // Each table should have columns
    const messageTable = body.find((t: any) => t.name === 'message')
    assert.ok(messageTable)
    assert.ok(Array.isArray(messageTable.columns))
    assert.ok(messageTable.columns.length > 0)

    removeTestDb('test_schema_1')
  })

  it('returns 500 for non-existent session', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/nonexistent_schema/schema`)
    assert.equal(res.status, 500)
  })
})

describe('POST /api/sessions/:id/sql', () => {
  it('executes a SELECT query and returns { columns, rows, rowCount, duration, limited }', async () => {
    createTestDb('test_sql_1', { messages: 3 })

    const res = await fetch(`${baseUrl}/api/sessions/test_sql_1/sql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: 'SELECT id, content FROM message ORDER BY id' }),
    })
    assert.equal(res.status, 200)
    const body = await res.json() as any
    assert.ok(Array.isArray(body.columns))
    assert.deepEqual(body.columns, ['id', 'content'])
    assert.ok(Array.isArray(body.rows))
    assert.equal(body.rowCount, 3)
    assert.ok(typeof body.duration === 'number')
    assert.equal(body.limited, false)

    // Rows are arrays of values
    assert.equal(body.rows[0][1], 'Message 1')

    removeTestDb('test_sql_1')
  })

  it('returns 400 for missing sql parameter', async () => {
    createTestDb('test_sql_missing')

    const res = await fetch(`${baseUrl}/api/sessions/test_sql_missing/sql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    assert.equal(res.status, 400)
    const body = await res.json() as any
    assert.ok(body.error)

    removeTestDb('test_sql_missing')
  })

  it('returns 400 for non-SELECT query', async () => {
    createTestDb('test_sql_write')

    const res = await fetch(`${baseUrl}/api/sessions/test_sql_write/sql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: "DELETE FROM message WHERE id = 1" }),
    })
    assert.equal(res.status, 400)
    const body = await res.json() as any
    assert.ok(body.error)

    removeTestDb('test_sql_write')
  })

  it('returns 400 for invalid SQL', async () => {
    createTestDb('test_sql_invalid')

    const res = await fetch(`${baseUrl}/api/sessions/test_sql_invalid/sql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: 'SELECT * FROM nonexistent_table' }),
    })
    assert.equal(res.status, 400)
    const body = await res.json() as any
    assert.ok(body.error)

    removeTestDb('test_sql_invalid')
  })
})
