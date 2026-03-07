/**
 * Tests for NLP API routes (US-009)
 *
 * Uses a temporary database directory to isolate tests from real data.
 * Tests word frequency, text segmentation, and POS tag definitions.
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { Server } from 'node:http'

// Set up a temporary data directory BEFORE any app modules load
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-nlp-test-'))
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
 * Create a test database with members and messages for NLP testing.
 */
function createTestDb(
  sessionId: string,
  messages: Array<{
    senderId: number
    ts: number
    type: number
    content: string | null
  }>,
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

    CREATE INDEX IF NOT EXISTS idx_message_sender ON message(sender_id);
    CREATE INDEX IF NOT EXISTS idx_message_ts ON message(ts);
    CREATE INDEX IF NOT EXISTS idx_message_type ON message(type);
  `)

  db.prepare(
    'INSERT INTO meta (name, platform, type, imported_at) VALUES (?, ?, ?, ?)',
  ).run('Test Group', 'wechat', 'group', Date.now())

  db.prepare(
    'INSERT INTO member (platform_id, account_name, group_nickname, aliases) VALUES (?, ?, ?, ?)',
  ).run('user1', 'Alice', 'Alice', '[]')
  db.prepare(
    'INSERT INTO member (platform_id, account_name, group_nickname, aliases) VALUES (?, ?, ?, ?)',
  ).run('user2', 'Bob', 'Bob', '[]')

  const insertMsg = db.prepare(
    'INSERT INTO message (sender_id, sender_account_name, sender_group_nickname, ts, type, content) VALUES (?, ?, ?, ?, ?, ?)',
  )
  for (const msg of messages) {
    insertMsg.run(msg.senderId, null, null, msg.ts, msg.type, msg.content)
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
// Tests: POST /api/sessions/:id/nlp/word-frequency
// ---------------------------------------------------------------------------

describe('POST /api/sessions/:id/nlp/word-frequency', () => {
  const sessionId = 'nlp-wordfreq-test'

  before(() => {
    // Create messages with repetitive English words for frequency testing
    createTestDb(sessionId, [
      { senderId: 1, ts: 1700000000, type: 0, content: 'programming language javascript typescript' },
      { senderId: 1, ts: 1700000010, type: 0, content: 'programming language typescript react' },
      { senderId: 2, ts: 1700000020, type: 0, content: 'javascript typescript programming framework' },
      { senderId: 2, ts: 1700000030, type: 0, content: 'typescript programming language framework' },
      { senderId: 1, ts: 1700000040, type: 0, content: 'typescript javascript programming language' },
      // Non-text message — should be ignored
      { senderId: 1, ts: 1700000050, type: 1, content: null },
    ])
  })

  it('returns WordFrequencyResult with correct shape', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/nlp/word-frequency`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale: 'en-US', minCount: 1, minWordLength: 3 }),
      },
    )
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok('words' in data)
    assert.ok('totalWords' in data)
    assert.ok('totalMessages' in data)
    assert.ok('uniqueWords' in data)
    assert.ok(Array.isArray(data.words))
    assert.ok(data.totalMessages === 5, `expected 5 messages, got ${data.totalMessages}`)
  })

  it('word items have word, count, percentage', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/nlp/word-frequency`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale: 'en-US', minCount: 1, minWordLength: 3 }),
      },
    )
    const data = await res.json()
    assert.ok(data.words.length > 0)
    const item = data.words[0]
    assert.ok('word' in item)
    assert.ok('count' in item)
    assert.ok('percentage' in item)
    assert.ok(typeof item.word === 'string')
    assert.ok(typeof item.count === 'number')
    assert.ok(typeof item.percentage === 'number')
  })

  it('typescript appears as top word (5 occurrences)', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/nlp/word-frequency`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locale: 'en-US',
          minCount: 1,
          minWordLength: 3,
          topN: 10,
          enableStopwords: false,
        }),
      },
    )
    const data = await res.json()
    const tsWord = data.words.find(
      (w: any) => w.word === 'typescript',
    )
    assert.ok(tsWord, 'expected typescript to appear in results')
    assert.equal(tsWord.count, 5)
  })

  it('returns empty result for nonexistent session', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/nonexistent-session/nlp/word-frequency`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale: 'en-US' }),
      },
    )
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.words.length, 0)
    assert.equal(data.totalMessages, 0)
  })

  it('rejects missing locale', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/nlp/word-frequency`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    )
    assert.equal(res.status, 400)
  })

  it('respects topN parameter', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/nlp/word-frequency`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locale: 'en-US',
          topN: 2,
          minCount: 1,
          minWordLength: 3,
        }),
      },
    )
    const data = await res.json()
    assert.ok(data.words.length <= 2, `expected at most 2 words, got ${data.words.length}`)
  })

  it('percentages sum close to 100', async () => {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/nlp/word-frequency`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locale: 'en-US',
          minCount: 1,
          minWordLength: 3,
          topN: 100,
          enableStopwords: false,
        }),
      },
    )
    const data = await res.json()
    const totalPct = data.words.reduce(
      (sum: number, w: any) => sum + w.percentage,
      0,
    )
    // Should be close to 100 (rounding may cause slight deviation)
    assert.ok(
      totalPct >= 99 && totalPct <= 101,
      `expected percentages to sum near 100, got ${totalPct}`,
    )
  })
})

// ---------------------------------------------------------------------------
// Tests: POST /api/nlp/segment
// ---------------------------------------------------------------------------

describe('POST /api/nlp/segment', () => {
  it('segments English text into words', async () => {
    const res = await fetch(`${baseUrl}/api/nlp/segment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'programming language typescript framework',
        locale: 'en-US',
        minLength: 3,
      }),
    })
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok(Array.isArray(data))
    assert.ok(data.length > 0)
    assert.ok(
      data.includes('programming'),
      `expected "programming" in result, got ${JSON.stringify(data)}`,
    )
  })

  it('returns empty array for empty text', async () => {
    const res = await fetch(`${baseUrl}/api/nlp/segment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '', locale: 'en-US' }),
    })
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok(Array.isArray(data))
    assert.equal(data.length, 0)
  })

  it('rejects missing text', async () => {
    const res = await fetch(`${baseUrl}/api/nlp/segment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale: 'en-US' }),
    })
    assert.equal(res.status, 400)
  })

  it('rejects missing locale', async () => {
    const res = await fetch(`${baseUrl}/api/nlp/segment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello world' }),
    })
    assert.equal(res.status, 400)
  })

  it('filters stopwords by default', async () => {
    const res = await fetch(`${baseUrl}/api/nlp/segment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'the programming language is very good',
        locale: 'en-US',
        minLength: 3,
      }),
    })
    const data = await res.json()
    // "the" and "very" are stopwords and should be filtered
    assert.ok(!data.includes('the'), 'expected "the" to be filtered')
    assert.ok(!data.includes('very'), 'expected "very" to be filtered')
    assert.ok(data.includes('programming'), 'expected "programming" to remain')
  })
})

// ---------------------------------------------------------------------------
// Tests: GET /api/nlp/pos-tags
// ---------------------------------------------------------------------------

describe('GET /api/nlp/pos-tags', () => {
  it('returns array of POS tag definitions', async () => {
    const res = await fetch(`${baseUrl}/api/nlp/pos-tags`)
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok(Array.isArray(data))
    assert.ok(data.length > 0)
  })

  it('each tag has tag, name, description, meaningful', async () => {
    const res = await fetch(`${baseUrl}/api/nlp/pos-tags`)
    const data = await res.json()
    for (const item of data) {
      assert.ok('tag' in item)
      assert.ok('name' in item)
      assert.ok('description' in item)
      assert.ok('meaningful' in item)
      assert.ok(typeof item.tag === 'string')
      assert.ok(typeof item.name === 'string')
      assert.ok(typeof item.description === 'string')
      assert.ok(typeof item.meaningful === 'boolean')
    }
  })

  it('contains known tags like n (noun) and v (verb)', async () => {
    const res = await fetch(`${baseUrl}/api/nlp/pos-tags`)
    const data = await res.json()
    const tags = data.map((d: any) => d.tag)
    assert.ok(tags.includes('n'), 'expected noun tag')
    assert.ok(tags.includes('v'), 'expected verb tag')
    assert.ok(tags.includes('a'), 'expected adjective tag')
  })

  it('noun is meaningful, verb is not', async () => {
    const res = await fetch(`${baseUrl}/api/nlp/pos-tags`)
    const data = await res.json()
    const noun = data.find((d: any) => d.tag === 'n')
    const verb = data.find((d: any) => d.tag === 'v')
    assert.ok(noun)
    assert.ok(verb)
    assert.equal(noun.meaningful, true)
    assert.equal(verb.meaningful, false)
  })
})
