/**
 * Tests for member management API routes (US-007)
 *
 * Uses a temporary database directory to isolate tests from real data.
 * Tests getMembers, getMembersPaginated, updateMemberAliases, deleteMember.
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { Server } from 'node:http'

// Set up a temporary data directory BEFORE any app modules load
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-members-test-'))
process.env.CHATLAB_DATA_DIR = tmpDir

import { createApp } from '../index.js'
import Database from 'better-sqlite3'
import { getDatabaseDir, ensureDir } from '../paths.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let server: Server
let baseUrl: string

/**
 * Create a test database with members and messages for member endpoints.
 */
function createTestDb(
  sessionId: string,
  opts?: {
    name?: string
    members?: Array<{
      platformId: string
      accountName: string | null
      groupNickname: string | null
      aliases?: string[]
    }>
    messages?: Array<{
      senderId: number
      ts: number
      type: number
      content: string | null
    }>
  },
) {
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
      message_count INTEGER NOT NULL DEFAULT 0,
      member_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS message_context (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL UNIQUE,
      context TEXT,
      FOREIGN KEY(message_id) REFERENCES message(id)
    );

    CREATE INDEX IF NOT EXISTS idx_message_sender ON message(sender_id);
    CREATE INDEX IF NOT EXISTS idx_message_ts ON message(ts);
    CREATE INDEX IF NOT EXISTS idx_message_type ON message(type);
  `)

  // Insert meta
  db.prepare(
    'INSERT INTO meta (name, platform, type, imported_at) VALUES (?, ?, ?, ?)',
  ).run(opts?.name || 'Test Group', 'wechat', 'group', Date.now())

  // Insert members
  const insertMember = db.prepare(
    'INSERT INTO member (platform_id, account_name, group_nickname, aliases) VALUES (?, ?, ?, ?)',
  )
  const members = opts?.members || [
    { platformId: 'user1', accountName: 'Alice', groupNickname: 'Alice' },
    { platformId: 'user2', accountName: 'Bob', groupNickname: 'Bob' },
    { platformId: 'user3', accountName: 'Charlie', groupNickname: 'Charlie' },
  ]
  for (const m of members) {
    insertMember.run(
      m.platformId,
      m.accountName,
      m.groupNickname,
      JSON.stringify(m.aliases || []),
    )
  }

  // Insert messages
  const insertMsg = db.prepare(
    'INSERT INTO message (sender_id, sender_account_name, sender_group_nickname, ts, type, content) VALUES (?, ?, ?, ?, ?, ?)',
  )
  const messages = opts?.messages || [
    // Alice: 5 messages
    { senderId: 1, ts: 1700000000, type: 1, content: 'Hello' },
    { senderId: 1, ts: 1700000010, type: 1, content: 'World' },
    { senderId: 1, ts: 1700000020, type: 1, content: 'Test' },
    { senderId: 1, ts: 1700000030, type: 1, content: 'Foo' },
    { senderId: 1, ts: 1700000040, type: 1, content: 'Bar' },
    // Bob: 3 messages
    { senderId: 2, ts: 1700000050, type: 1, content: 'Hi' },
    { senderId: 2, ts: 1700000060, type: 1, content: 'Hey' },
    { senderId: 2, ts: 1700000070, type: 1, content: 'Yo' },
    // Charlie: 1 message
    { senderId: 3, ts: 1700000080, type: 1, content: 'Sup' },
  ]
  for (const msg of messages) {
    insertMsg.run(
      msg.senderId,
      null,
      null,
      msg.ts,
      msg.type,
      msg.content,
    )
  }

  db.close()
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

before(async () => {
  const app = createApp()
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve())
  })
  const addr = server.address()!
  const port = typeof addr === 'string' ? addr : addr.port
  baseUrl = `http://localhost:${port}`
})

after(async () => {
  const { closeAllDatabases } = await import('../services/queries.js')
  closeAllDatabases()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/sessions/:id/members', () => {
  const sessionId = 'members-all-test'

  before(() => {
    createTestDb(sessionId)
  })

  it('returns all members with stats', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/members`)
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok(Array.isArray(data))
    assert.equal(data.length, 3)
  })

  it('members have correct shape', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/members`)
    const data = await res.json()
    const member = data[0]
    assert.ok('id' in member)
    assert.ok('platformId' in member)
    assert.ok('accountName' in member)
    assert.ok('groupNickname' in member)
    assert.ok('aliases' in member)
    assert.ok('messageCount' in member)
    assert.ok(Array.isArray(member.aliases))
  })

  it('members sorted by messageCount descending', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/members`)
    const data = await res.json()
    assert.ok(data[0].messageCount >= data[1].messageCount)
    assert.ok(data[1].messageCount >= data[2].messageCount)
  })

  it('returns empty array for non-existent session', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/nonexistent/members`)
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok(Array.isArray(data))
    assert.equal(data.length, 0)
  })
})

describe('GET /api/sessions/:id/members/paginated', () => {
  const sessionId = 'members-paginated-test'

  before(() => {
    // Create with more members for pagination testing
    const members = []
    const messages = []
    for (let i = 1; i <= 25; i++) {
      members.push({
        platformId: `user${i}`,
        accountName: `User ${i}`,
        groupNickname: `User ${i}`,
      })
      // Each member gets i messages
      for (let j = 0; j < i; j++) {
        messages.push({
          senderId: i,
          ts: 1700000000 + i * 100 + j,
          type: 1,
          content: `Message ${j} from user ${i}`,
        })
      }
    }
    createTestDb(sessionId, { members, messages })
  })

  it('returns paginated result with correct shape', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/members/paginated?page=1&pageSize=10`,
    )
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok('members' in data)
    assert.ok('total' in data)
    assert.ok('page' in data)
    assert.ok('pageSize' in data)
    assert.ok('totalPages' in data)
    assert.ok(Array.isArray(data.members))
  })

  it('respects page and pageSize', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/members/paginated?page=1&pageSize=10`,
    )
    const data = await res.json()
    assert.equal(data.members.length, 10)
    assert.equal(data.page, 1)
    assert.equal(data.pageSize, 10)
    assert.equal(data.total, 25)
    assert.equal(data.totalPages, 3)
  })

  it('returns correct page 2', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/members/paginated?page=2&pageSize=10`,
    )
    const data = await res.json()
    assert.equal(data.members.length, 10)
    assert.equal(data.page, 2)
  })

  it('returns partial last page', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/members/paginated?page=3&pageSize=10`,
    )
    const data = await res.json()
    assert.equal(data.members.length, 5)
    assert.equal(data.page, 3)
  })

  it('supports search filter', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/members/paginated?search=User 1&pageSize=50`,
    )
    const data = await res.json()
    // Should match "User 1", "User 10"-"User 19" = 11 members
    assert.ok(data.members.length > 0)
    assert.ok(data.total <= 25)
  })

  it('supports ascending sort order', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/members/paginated?sortOrder=asc&pageSize=5`,
    )
    const data = await res.json()
    assert.ok(data.members[0].messageCount <= data.members[1].messageCount)
  })

  it('defaults to descending sort order', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/members/paginated?pageSize=5`,
    )
    const data = await res.json()
    assert.ok(data.members[0].messageCount >= data.members[1].messageCount)
  })

  it('returns empty for non-existent session', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/nonexistent/members/paginated`,
    )
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.members.length, 0)
    assert.equal(data.total, 0)
  })
})

describe('PATCH /api/sessions/:id/members/:memberId/aliases', () => {
  const sessionId = 'members-alias-test'

  before(() => {
    createTestDb(sessionId)
  })

  it('updates member aliases', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/members/1/aliases`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aliases: ['小A', 'A同学'] }),
      },
    )
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.success, true)
  })

  it('aliases are persisted after update', async () => {
    // First update aliases
    await fetch(`${baseUrl}/api/sessions/${sessionId}/members/1/aliases`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aliases: ['NewAlias1', 'NewAlias2'] }),
    })

    // Then fetch members and verify
    const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/members`)
    const members = await res.json()
    const alice = members.find((m: any) => m.id === 1)
    assert.ok(alice)
    assert.deepEqual(alice.aliases, ['NewAlias1', 'NewAlias2'])
  })

  it('rejects non-array aliases', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/members/1/aliases`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aliases: 'not-an-array' }),
      },
    )
    assert.equal(res.status, 400)
    const data = await res.json()
    assert.ok(data.error)
  })

  it('rejects invalid memberId', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/members/abc/aliases`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aliases: ['test'] }),
      },
    )
    assert.equal(res.status, 400)
    const data = await res.json()
    assert.equal(data.error, 'Invalid memberId')
  })

  it('can set empty aliases array', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/members/1/aliases`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aliases: [] }),
      },
    )
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.success, true)
  })
})

describe('DELETE /api/sessions/:id/members/:memberId', () => {
  const sessionId = 'members-delete-test'

  before(() => {
    createTestDb(sessionId)
  })

  it('deletes a member and returns success', async () => {
    // First verify member exists
    const before = await fetch(`${baseUrl}/api/sessions/${sessionId}/members`)
    const membersBefore = await before.json()
    assert.equal(membersBefore.length, 3)

    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/members/3`,
      { method: 'DELETE' },
    )
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.success, true)
  })

  it('member is actually removed after delete', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/members`)
    const members = await res.json()
    assert.equal(members.length, 2)
    const charlie = members.find((m: any) => m.id === 3)
    assert.equal(charlie, undefined)
  })

  it('rejects invalid memberId', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/members/xyz`,
      { method: 'DELETE' },
    )
    assert.equal(res.status, 400)
    const data = await res.json()
    assert.equal(data.error, 'Invalid memberId')
  })

  it('returns success false for non-existent session', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/nonexistent/members/1`,
      { method: 'DELETE' },
    )
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.success, false)
  })
})
