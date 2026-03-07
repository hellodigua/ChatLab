/**
 * Tests for message query API routes (US-008)
 *
 * Uses a temporary database directory to isolate tests from real data.
 * Tests search, context, recent, before/after, filter, and multi-sessions.
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { Server } from 'node:http'

// Set up a temporary data directory BEFORE any app modules load
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-messages-test-'))
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
 * Create a test database with members, messages, chat_sessions, etc.
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
      platformMessageId?: string | null
      replyToMessageId?: string | null
    }>
    chatSessions?: Array<{
      startTs: number
      endTs: number
      messageCount: number
      memberCount?: number
    }>
    messageContexts?: Array<{
      messageId: number
      sessionId: number
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
      message_id INTEGER NOT NULL,
      session_id INTEGER NOT NULL,
      context TEXT,
      FOREIGN KEY(message_id) REFERENCES message(id),
      FOREIGN KEY(session_id) REFERENCES chat_session(id)
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
    { platformId: 'user3', accountName: '系统消息', groupNickname: '系统消息' },
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
    'INSERT INTO message (sender_id, sender_account_name, sender_group_nickname, ts, type, content, platform_message_id, reply_to_message_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
  const messages = opts?.messages || [
    // Alice: text messages
    { senderId: 1, ts: 1700000000, type: 0, content: 'Hello everyone' },
    { senderId: 1, ts: 1700000010, type: 0, content: 'How is the weather today' },
    { senderId: 1, ts: 1700000020, type: 0, content: 'Hello world' },
    // Bob: text messages
    { senderId: 2, ts: 1700000030, type: 0, content: 'Hi Alice' },
    { senderId: 2, ts: 1700000040, type: 0, content: 'Weather is great' },
    { senderId: 2, ts: 1700000050, type: 0, content: 'Goodbye' },
    // Alice: image message (type 1)
    { senderId: 1, ts: 1700000060, type: 1, content: null },
    // System message
    { senderId: 3, ts: 1700000070, type: 0, content: 'System notification' },
    // More text messages for pagination
    { senderId: 1, ts: 1700000080, type: 0, content: 'Another message' },
    { senderId: 2, ts: 1700000090, type: 0, content: 'Final message' },
  ]
  for (const msg of messages) {
    insertMsg.run(
      msg.senderId,
      null,
      null,
      msg.ts,
      msg.type,
      msg.content,
      msg.platformMessageId || null,
      msg.replyToMessageId || null,
    )
  }

  // Insert chat sessions if provided
  if (opts?.chatSessions) {
    const insertSession = db.prepare(
      'INSERT INTO chat_session (start_ts, end_ts, message_count, member_count) VALUES (?, ?, ?, ?)',
    )
    for (const s of opts.chatSessions) {
      insertSession.run(s.startTs, s.endTs, s.messageCount, s.memberCount ?? 2)
    }
  }

  // Insert message contexts if provided
  if (opts?.messageContexts) {
    const insertCtx = db.prepare(
      'INSERT INTO message_context (message_id, session_id) VALUES (?, ?)',
    )
    for (const ctx of opts.messageContexts) {
      insertCtx.run(ctx.messageId, ctx.sessionId)
    }
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
// Tests: POST /api/sessions/:id/messages/search
// ---------------------------------------------------------------------------

describe('POST /api/sessions/:id/messages/search', () => {
  const sessionId = 'msg-search-test'

  before(() => {
    createTestDb(sessionId)
  })

  it('returns { messages, total } for keyword search', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/messages/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords: ['Hello'] }),
    })
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok('messages' in data)
    assert.ok('total' in data)
    assert.ok(Array.isArray(data.messages))
    assert.ok(data.total >= 2, `expected at least 2 results, got ${data.total}`)
  })

  it('returns empty result for no matches', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/messages/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords: ['zzz_nonexistent_zzz'] }),
    })
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.total, 0)
    assert.equal(data.messages.length, 0)
  })

  it('supports limit and offset', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/messages/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords: ['Hello'], limit: 1, offset: 0 }),
    })
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.messages.length, 1)
    assert.ok(data.total >= 2)
  })

  it('rejects missing keywords', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/messages/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    assert.equal(res.status, 400)
  })

  it('rejects non-array keywords', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/messages/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords: 'Hello' }),
    })
    assert.equal(res.status, 400)
  })

  it('supports senderId filter', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/messages/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords: ['Hello'], senderId: 1 }),
    })
    assert.equal(res.status, 200)
    const data = await res.json()
    // All results should be from sender 1 (Alice)
    for (const msg of data.messages) {
      assert.equal(msg.senderId, 1)
    }
  })

  it('messages have correct shape', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/messages/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords: ['Hello'] }),
    })
    const data = await res.json()
    assert.ok(data.messages.length > 0)
    const msg = data.messages[0]
    assert.ok('id' in msg)
    assert.ok('senderId' in msg)
    assert.ok('senderName' in msg)
    assert.ok('content' in msg)
    assert.ok('timestamp' in msg)
  })
})

// ---------------------------------------------------------------------------
// Tests: GET /api/sessions/:id/messages/before/:beforeId
// ---------------------------------------------------------------------------

describe('GET /api/sessions/:id/messages/before/:beforeId', () => {
  const sessionId = 'msg-before-test'

  before(() => {
    createTestDb(sessionId)
  })

  it('returns { messages, hasMore }', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/messages/before/10?limit=3`,
    )
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok('messages' in data)
    assert.ok('hasMore' in data)
    assert.ok(Array.isArray(data.messages))
    assert.ok(typeof data.hasMore === 'boolean')
  })

  it('returns messages with id < beforeId', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/messages/before/5?limit=10`,
    )
    assert.equal(res.status, 200)
    const data = await res.json()
    for (const msg of data.messages) {
      assert.ok(msg.id < 5, `expected id < 5, got ${msg.id}`)
    }
  })

  it('hasMore is true when more messages exist', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/messages/before/10?limit=2`,
    )
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.hasMore, true)
  })

  it('hasMore is false when no more messages exist', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/messages/before/10?limit=100`,
    )
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.hasMore, false)
  })

  it('rejects invalid beforeId', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/messages/before/abc`,
    )
    assert.equal(res.status, 400)
  })
})

// ---------------------------------------------------------------------------
// Tests: GET /api/sessions/:id/messages/after/:afterId
// ---------------------------------------------------------------------------

describe('GET /api/sessions/:id/messages/after/:afterId', () => {
  const sessionId = 'msg-after-test'

  before(() => {
    createTestDb(sessionId)
  })

  it('returns { messages, hasMore }', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/messages/after/1?limit=3`,
    )
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok('messages' in data)
    assert.ok('hasMore' in data)
  })

  it('returns messages with id > afterId', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/messages/after/5?limit=10`,
    )
    assert.equal(res.status, 200)
    const data = await res.json()
    for (const msg of data.messages) {
      assert.ok(msg.id > 5, `expected id > 5, got ${msg.id}`)
    }
  })

  it('rejects invalid afterId', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/messages/after/abc`,
    )
    assert.equal(res.status, 400)
  })
})

// ---------------------------------------------------------------------------
// Tests: GET /api/sessions/:id/messages/recent
// ---------------------------------------------------------------------------

describe('GET /api/sessions/:id/messages/recent', () => {
  const sessionId = 'msg-recent-test'

  before(() => {
    createTestDb(sessionId)
  })

  it('returns { messages, total }', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/messages/recent`,
    )
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok('messages' in data)
    assert.ok('total' in data)
    assert.ok(Array.isArray(data.messages))
  })

  it('excludes system messages and non-text types', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/messages/recent`,
    )
    const data = await res.json()
    // System messages (sender "系统消息") and type != 0 should be excluded
    for (const msg of data.messages) {
      assert.notEqual(msg.senderName, '系统消息')
    }
  })

  it('respects limit parameter', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/messages/recent?limit=2`,
    )
    const data = await res.json()
    assert.ok(data.messages.length <= 2)
  })
})

// ---------------------------------------------------------------------------
// Tests: GET /api/sessions/:id/messages/all-recent
// ---------------------------------------------------------------------------

describe('GET /api/sessions/:id/messages/all-recent', () => {
  const sessionId = 'msg-allrecent-test'

  before(() => {
    createTestDb(sessionId)
  })

  it('returns { messages, total } including all message types', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/messages/all-recent`,
    )
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok('messages' in data)
    assert.ok('total' in data)
    // all-recent should include more messages than recent (system + non-text)
    assert.ok(data.total > 0)
  })
})

// ---------------------------------------------------------------------------
// Tests: GET /api/sessions/:id/messages/context/:messageId
// ---------------------------------------------------------------------------

describe('GET /api/sessions/:id/messages/context/:messageId', () => {
  const sessionId = 'msg-context-test'

  before(() => {
    createTestDb(sessionId)
  })

  it('returns array of messages around the target', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/messages/context/5?contextSize=2`,
    )
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok(Array.isArray(data))
    // Should include message 5 plus context
    const ids = data.map((m: any) => m.id)
    assert.ok(ids.includes(5))
  })

  it('rejects invalid messageId', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/messages/context/abc`,
    )
    assert.equal(res.status, 400)
  })

  it('returns empty array for non-existent session', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/nonexistent/messages/context/1`,
    )
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok(Array.isArray(data))
    assert.equal(data.length, 0)
  })
})

// ---------------------------------------------------------------------------
// Tests: POST /api/sessions/:id/messages/conversation-between
// ---------------------------------------------------------------------------

describe('POST /api/sessions/:id/messages/conversation-between', () => {
  const sessionId = 'msg-convo-test'

  before(() => {
    createTestDb(sessionId)
  })

  it('returns conversation between two members', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/messages/conversation-between`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId1: 1, memberId2: 2 }),
      },
    )
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok('messages' in data)
    assert.ok('total' in data)
    assert.ok('member1Name' in data)
    assert.ok('member2Name' in data)
    assert.ok(data.messages.length > 0)
  })

  it('rejects non-number memberIds', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/messages/conversation-between`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId1: 'a', memberId2: 'b' }),
      },
    )
    assert.equal(res.status, 400)
  })
})

// ---------------------------------------------------------------------------
// Tests: POST /api/sessions/:id/messages/filter
// ---------------------------------------------------------------------------

describe('POST /api/sessions/:id/messages/filter', () => {
  const sessionId = 'msg-filter-test'

  before(() => {
    createTestDb(sessionId)
  })

  it('returns blocks with pagination', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/messages/filter`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: ['Hello'], page: 1, pageSize: 10 }),
      },
    )
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok('blocks' in data)
    assert.ok('stats' in data)
    assert.ok('pagination' in data)
    assert.ok(Array.isArray(data.blocks))
    assert.ok('page' in data.pagination)
    assert.ok('pageSize' in data.pagination)
    assert.ok('totalBlocks' in data.pagination)
    assert.ok('totalHits' in data.pagination)
    assert.ok('hasMore' in data.pagination)
  })

  it('filter with keywords returns matching blocks', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/messages/filter`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: ['Hello'] }),
      },
    )
    const data = await res.json()
    assert.ok(data.blocks.length > 0, 'expected at least one block')
    assert.ok(data.pagination.totalHits >= 2, 'expected at least 2 hits for Hello')
    // Each block should have messages with isHit flags
    for (const block of data.blocks) {
      assert.ok(Array.isArray(block.messages))
      assert.ok(block.hitCount > 0)
    }
  })

  it('filter with no matches returns empty blocks', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/messages/filter`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: ['zzz_nonexistent_zzz'] }),
      },
    )
    const data = await res.json()
    assert.equal(data.blocks.length, 0)
    assert.equal(data.pagination.totalHits, 0)
  })

  it('filter with senderIds narrows results', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/messages/filter`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: ['Hello'], senderIds: [2] }),
      },
    )
    const data = await res.json()
    // Bob (id=2) never says "Hello", only Alice does
    assert.equal(data.blocks.length, 0)
  })

  it('filter without keywords returns all messages', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/messages/filter`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    )
    const data = await res.json()
    assert.ok(data.pagination.totalHits >= 10, 'expected all messages as hits')
  })
})

// ---------------------------------------------------------------------------
// Tests: POST /api/sessions/:id/messages/multi-sessions
// ---------------------------------------------------------------------------

describe('POST /api/sessions/:id/messages/multi-sessions', () => {
  const sessionId = 'msg-multisession-test'

  before(() => {
    createTestDb(sessionId, {
      chatSessions: [
        { startTs: 1700000000, endTs: 1700000030, messageCount: 3 },
        { startTs: 1700000040, endTs: 1700000060, messageCount: 3 },
      ],
      messageContexts: [
        { messageId: 1, sessionId: 1 },
        { messageId: 2, sessionId: 1 },
        { messageId: 3, sessionId: 1 },
        { messageId: 4, sessionId: 2 },
        { messageId: 5, sessionId: 2 },
        { messageId: 6, sessionId: 2 },
      ],
    })
  })

  it('returns blocks from multiple chat sessions', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/messages/multi-sessions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatSessionIds: [1, 2] }),
      },
    )
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok('blocks' in data)
    assert.ok('pagination' in data)
    assert.equal(data.blocks.length, 2)
  })

  it('rejects missing chatSessionIds', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/messages/multi-sessions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    )
    assert.equal(res.status, 400)
  })

  it('rejects non-array chatSessionIds', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/messages/multi-sessions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatSessionIds: 1 }),
      },
    )
    assert.equal(res.status, 400)
  })
})
