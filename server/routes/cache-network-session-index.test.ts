/**
 * Tests for cache, network, and session-index API routes (US-013)
 */

import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { Server } from 'node:http'

// Set up a temporary data directory BEFORE any app modules load
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-test-013-'))
process.env.CHATLAB_DATA_DIR = tmpDir
process.env.CHATLAB_ENCRYPTION_KEY = 'test-key-013'

import { createApp } from '../index.js'
import { _resetConfigPath } from './network.js'
import Database from 'better-sqlite3'
import { getDatabaseDir, getLogsDir, getSettingsDir, ensureDir, getAppDataDir } from '../paths.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let server: Server
let baseUrl: string

function createTestDb(sessionId: string, opts?: { name?: string; messages?: number; withGapThreshold?: number }) {
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
  const gapThreshold = opts?.withGapThreshold ?? null
  db.prepare(
    'INSERT INTO meta (name, platform, type, imported_at, session_gap_threshold) VALUES (?, ?, ?, ?, ?)',
  ).run(name, 'wechat', 'group', Math.floor(Date.now() / 1000), gapThreshold)

  // Add a member
  db.prepare(
    "INSERT INTO member (platform_id, account_name, group_nickname) VALUES ('user1', 'Alice', 'Alice')",
  ).run()

  // Add messages with time gaps
  const msgCount = opts?.messages ?? 10
  const now = Math.floor(Date.now() / 1000)
  for (let i = 0; i < msgCount; i++) {
    // Messages 60 seconds apart; after the 5th message, add a 2-hour gap
    const offset = i < 5 ? i * 60 : (4 * 60) + 7200 + ((i - 5) * 60)
    db.prepare(
      'INSERT INTO message (sender_id, ts, type, content) VALUES (1, ?, 0, ?)',
    ).run(now - (msgCount * 7200) + offset, `Message ${i + 1}`)
  }

  db.close()
  return dbPath
}

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
  _resetConfigPath()
  const app = createApp()
  server = app.listen(0)
  const addr = server.address()
  if (!addr || typeof addr === 'string') throw new Error('Failed to get server address')
  baseUrl = `http://localhost:${addr.port}`
})

after(() => {
  if (server) server.close()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// ===========================================================================
// Cache routes
// ===========================================================================

describe('Cache routes', () => {
  describe('GET /api/cache/info', () => {
    it('returns cache directory info', async () => {
      // Ensure some dirs exist
      ensureDir(getDatabaseDir())
      ensureDir(getLogsDir())

      const res = await fetch(`${baseUrl}/api/cache/info`)
      assert.equal(res.status, 200)
      const body = await res.json() as any

      assert.ok(body.baseDir)
      assert.ok(Array.isArray(body.directories))
      assert.equal(body.directories.length, 3)
      assert.equal(typeof body.totalSize, 'number')

      // Check each directory entry has expected fields
      for (const dir of body.directories) {
        assert.ok(dir.id)
        assert.ok(dir.name)
        assert.equal(typeof dir.size, 'number')
        assert.equal(typeof dir.fileCount, 'number')
        assert.equal(typeof dir.exists, 'boolean')
        assert.equal(typeof dir.canClear, 'boolean')
      }

      // Check specific IDs exist
      const ids = body.directories.map((d: any) => d.id)
      assert.ok(ids.includes('databases'))
      assert.ok(ids.includes('ai'))
      assert.ok(ids.includes('logs'))
    })
  })

  describe('DELETE /api/cache/clear/:cacheId', () => {
    it('clears the logs directory', async () => {
      // Create some test log files
      const logsDir = getLogsDir()
      ensureDir(logsDir)
      fs.writeFileSync(path.join(logsDir, 'test.log'), 'test log content')
      assert.ok(fs.existsSync(path.join(logsDir, 'test.log')))

      const res = await fetch(`${baseUrl}/api/cache/clear/logs`, { method: 'DELETE' })
      assert.equal(res.status, 200)
      const body = await res.json() as any
      assert.equal(body.success, true)

      // Files should be gone
      const remaining = fs.readdirSync(logsDir)
      assert.equal(remaining.length, 0)
    })

    it('returns 400 for disallowed directories', async () => {
      const res = await fetch(`${baseUrl}/api/cache/clear/databases`, { method: 'DELETE' })
      assert.equal(res.status, 400)
      const body = await res.json() as any
      assert.equal(body.success, false)
    })

    it('succeeds when directory does not exist', async () => {
      // Remove logs dir to test empty case
      const logsDir = getLogsDir()
      if (fs.existsSync(logsDir)) fs.rmSync(logsDir, { recursive: true })

      const res = await fetch(`${baseUrl}/api/cache/clear/logs`, { method: 'DELETE' })
      assert.equal(res.status, 200)
      const body = await res.json() as any
      assert.equal(body.success, true)
    })
  })

  describe('GET /api/cache/data-dir', () => {
    it('returns the current data directory', async () => {
      const res = await fetch(`${baseUrl}/api/cache/data-dir`)
      assert.equal(res.status, 200)
      const body = await res.json() as any
      assert.ok(body.path)
      assert.equal(typeof body.isCustom, 'boolean')
      // Since we set CHATLAB_DATA_DIR, isCustom should be true
      assert.equal(body.isCustom, true)
    })
  })

  describe('POST /api/cache/data-dir', () => {
    it('rejects non-absolute paths', async () => {
      const res = await fetch(`${baseUrl}/api/cache/data-dir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'relative/path' }),
      })
      assert.equal(res.status, 400)
    })

    it('accepts null to reset to default', async () => {
      // Save current env
      const savedDir = process.env.CHATLAB_DATA_DIR

      const res = await fetch(`${baseUrl}/api/cache/data-dir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: null }),
      })
      assert.equal(res.status, 200)
      const body = await res.json() as any
      assert.equal(body.success, true)

      // Restore for other tests
      process.env.CHATLAB_DATA_DIR = savedDir
    })
  })

  describe('POST /api/cache/save-download', () => {
    it('saves a base64 data URL to downloads', async () => {
      const content = Buffer.from('hello world').toString('base64')
      const dataUrl = `data:text/plain;base64,${content}`

      const res = await fetch(`${baseUrl}/api/cache/save-download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: 'test-download.txt', dataUrl }),
      })
      assert.equal(res.status, 200)
      const body = await res.json() as any
      assert.equal(body.success, true)
      assert.ok(body.filePath)

      // Verify file exists and has correct content
      const saved = fs.readFileSync(body.filePath, 'utf-8')
      assert.equal(saved, 'hello world')
    })

    it('returns 400 when filename is missing', async () => {
      const res = await fetch(`${baseUrl}/api/cache/save-download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl: 'data:text/plain;base64,dGVzdA==' }),
      })
      assert.equal(res.status, 400)
    })
  })

  describe('GET /api/cache/import-log', () => {
    it('returns 404 when no log directory exists', async () => {
      const res = await fetch(`${baseUrl}/api/cache/import-log`)
      assert.equal(res.status, 404)
    })

    it('returns the latest import log', async () => {
      const importLogDir = path.join(getLogsDir(), 'import')
      ensureDir(importLogDir)
      fs.writeFileSync(path.join(importLogDir, 'import_001.log'), 'log 1')
      // Slight delay for different mtime
      fs.writeFileSync(path.join(importLogDir, 'import_002.log'), 'log 2')

      const res = await fetch(`${baseUrl}/api/cache/import-log`)
      assert.equal(res.status, 200)
      const body = await res.json() as any
      assert.equal(body.success, true)
      assert.ok(body.name.startsWith('import_'))
    })
  })
})

// ===========================================================================
// Network routes
// ===========================================================================

describe('Network routes', () => {
  beforeEach(() => {
    // Clear proxy config file between tests
    const settingsDir = getSettingsDir()
    const proxyPath = path.join(settingsDir, 'proxy.json')
    if (fs.existsSync(proxyPath)) fs.unlinkSync(proxyPath)
  })

  describe('GET /api/network/proxy', () => {
    it('returns default proxy config when none saved', async () => {
      const res = await fetch(`${baseUrl}/api/network/proxy`)
      assert.equal(res.status, 200)
      const body = await res.json() as any
      assert.equal(body.mode, 'system')
      assert.equal(body.url, '')
    })

    it('returns saved proxy config', async () => {
      // Write a config first
      const settingsDir = getSettingsDir()
      ensureDir(settingsDir)
      fs.writeFileSync(
        path.join(settingsDir, 'proxy.json'),
        JSON.stringify({ mode: 'manual', url: 'http://localhost:7890' }),
      )

      const res = await fetch(`${baseUrl}/api/network/proxy`)
      assert.equal(res.status, 200)
      const body = await res.json() as any
      assert.equal(body.mode, 'manual')
      assert.equal(body.url, 'http://localhost:7890')
    })
  })

  describe('PUT /api/network/proxy', () => {
    it('saves proxy config', async () => {
      const res = await fetch(`${baseUrl}/api/network/proxy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'manual', url: 'http://127.0.0.1:8080' }),
      })
      assert.equal(res.status, 200)
      const body = await res.json() as any
      assert.equal(body.success, true)

      // Verify it was persisted
      const getRes = await fetch(`${baseUrl}/api/network/proxy`)
      const getBody = await getRes.json() as any
      assert.equal(getBody.mode, 'manual')
      assert.equal(getBody.url, 'http://127.0.0.1:8080')
    })

    it('rejects invalid mode', async () => {
      const res = await fetch(`${baseUrl}/api/network/proxy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'invalid', url: '' }),
      })
      assert.equal(res.status, 400)
    })

    it('rejects invalid manual URL', async () => {
      const res = await fetch(`${baseUrl}/api/network/proxy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'manual', url: 'not-a-url' }),
      })
      assert.equal(res.status, 400)
    })

    it('saves off mode', async () => {
      const res = await fetch(`${baseUrl}/api/network/proxy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'off', url: '' }),
      })
      assert.equal(res.status, 200)

      const getRes = await fetch(`${baseUrl}/api/network/proxy`)
      const getBody = await getRes.json() as any
      assert.equal(getBody.mode, 'off')
    })

    it('returns 400 when mode is missing', async () => {
      const res = await fetch(`${baseUrl}/api/network/proxy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'http://localhost:1234' }),
      })
      assert.equal(res.status, 400)
    })
  })

  describe('POST /api/network/proxy/test', () => {
    it('returns 400 when url is missing', async () => {
      const res = await fetch(`${baseUrl}/api/network/proxy/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      assert.equal(res.status, 400)
    })

    it('returns error for invalid URL format', async () => {
      const res = await fetch(`${baseUrl}/api/network/proxy/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'not-a-url' }),
      })
      assert.equal(res.status, 200)
      const body = await res.json() as any
      assert.equal(body.success, false)
      assert.ok(body.error)
    })
  })

  describe('Legacy config migration', () => {
    it('migrates old enabled:true config to manual mode', async () => {
      const settingsDir = getSettingsDir()
      ensureDir(settingsDir)
      fs.writeFileSync(
        path.join(settingsDir, 'proxy.json'),
        JSON.stringify({ enabled: true, url: 'http://legacy:9999' }),
      )

      const res = await fetch(`${baseUrl}/api/network/proxy`)
      const body = await res.json() as any
      assert.equal(body.mode, 'manual')
      assert.equal(body.url, 'http://legacy:9999')
    })

    it('migrates old enabled:false config to system mode', async () => {
      const settingsDir = getSettingsDir()
      ensureDir(settingsDir)
      fs.writeFileSync(
        path.join(settingsDir, 'proxy.json'),
        JSON.stringify({ enabled: false, url: '' }),
      )

      const res = await fetch(`${baseUrl}/api/network/proxy`)
      const body = await res.json() as any
      assert.equal(body.mode, 'system')
    })
  })
})

// ===========================================================================
// Session index routes
// ===========================================================================

describe('Session index routes', () => {
  const SESSION_ID = 'test_session_idx_013'

  before(() => {
    createTestDb(SESSION_ID, { messages: 10 })
  })

  after(() => {
    removeTestDb(SESSION_ID)
  })

  describe('GET /api/sessions/:id/session-index/has-index', () => {
    it('returns false before generating', async () => {
      const res = await fetch(`${baseUrl}/api/sessions/${SESSION_ID}/session-index/has-index`)
      assert.equal(res.status, 200)
      const body = await res.json() as any
      assert.equal(body.hasIndex, false)
    })
  })

  describe('GET /api/sessions/:id/session-index/stats', () => {
    it('returns zero stats before generating', async () => {
      const res = await fetch(`${baseUrl}/api/sessions/${SESSION_ID}/session-index/stats`)
      assert.equal(res.status, 200)
      const body = await res.json() as any
      assert.equal(body.sessionCount, 0)
      assert.equal(body.hasIndex, false)
      assert.equal(body.gapThreshold, 1800)
    })
  })

  describe('POST /api/sessions/:id/session-index/generate', () => {
    it('generates session index', async () => {
      const res = await fetch(`${baseUrl}/api/sessions/${SESSION_ID}/session-index/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      assert.equal(res.status, 200)
      const body = await res.json() as any
      assert.equal(body.success, true)
      assert.ok(body.sessionCount > 0)
    })

    it('has-index returns true after generating', async () => {
      const res = await fetch(`${baseUrl}/api/sessions/${SESSION_ID}/session-index/has-index`)
      const body = await res.json() as any
      assert.equal(body.hasIndex, true)
    })

    it('stats reflect generated sessions', async () => {
      const res = await fetch(`${baseUrl}/api/sessions/${SESSION_ID}/session-index/stats`)
      const body = await res.json() as any
      assert.ok(body.sessionCount > 0)
      assert.equal(body.hasIndex, true)
    })
  })

  describe('GET /api/sessions/:id/session-index/sessions', () => {
    it('returns the session list', async () => {
      const res = await fetch(`${baseUrl}/api/sessions/${SESSION_ID}/session-index/sessions`)
      assert.equal(res.status, 200)
      const body = await res.json() as any[]
      assert.ok(Array.isArray(body))
      assert.ok(body.length > 0)

      // Check session shape
      const first = body[0]
      assert.equal(typeof first.id, 'number')
      assert.equal(typeof first.startTs, 'number')
      assert.equal(typeof first.endTs, 'number')
      assert.equal(typeof first.messageCount, 'number')
    })
  })

  describe('PUT /api/sessions/:id/session-index/gap-threshold', () => {
    it('updates the gap threshold', async () => {
      const res = await fetch(`${baseUrl}/api/sessions/${SESSION_ID}/session-index/gap-threshold`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gapThreshold: 3600 }),
      })
      assert.equal(res.status, 200)
      const body = await res.json() as any
      assert.equal(body.success, true)
    })
  })

  describe('POST /api/sessions/:id/session-index/generate (incremental)', () => {
    it('supports incremental generation', async () => {
      const res = await fetch(`${baseUrl}/api/sessions/${SESSION_ID}/session-index/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ incremental: true }),
      })
      assert.equal(res.status, 200)
      const body = await res.json() as any
      assert.equal(body.success, true)
      // Incremental with no new messages should return 0
      assert.equal(body.sessionCount, 0)
    })
  })

  describe('GET /api/sessions/:id/session-index/recent', () => {
    it('returns recent sessions', async () => {
      const res = await fetch(`${baseUrl}/api/sessions/${SESSION_ID}/session-index/recent?limit=5`)
      assert.equal(res.status, 200)
      const body = await res.json() as any[]
      assert.ok(Array.isArray(body))
      assert.ok(body.length > 0)
      assert.ok(body.length <= 5)
    })
  })

  describe('GET /api/sessions/:id/session-index/by-time-range', () => {
    it('returns 400 when params missing', async () => {
      const res = await fetch(`${baseUrl}/api/sessions/${SESSION_ID}/session-index/by-time-range`)
      assert.equal(res.status, 400)
    })

    it('returns sessions within time range', async () => {
      const startTs = 0
      const endTs = Math.floor(Date.now() / 1000) + 100000
      const res = await fetch(
        `${baseUrl}/api/sessions/${SESSION_ID}/session-index/by-time-range?startTs=${startTs}&endTs=${endTs}`,
      )
      assert.equal(res.status, 200)
      const body = await res.json() as any[]
      assert.ok(Array.isArray(body))
      assert.ok(body.length > 0)
    })

    it('returns empty for out-of-range query', async () => {
      const res = await fetch(
        `${baseUrl}/api/sessions/${SESSION_ID}/session-index/by-time-range?startTs=1&endTs=2`,
      )
      assert.equal(res.status, 200)
      const body = await res.json() as any[]
      assert.deepEqual(body, [])
    })
  })

  describe('DELETE /api/sessions/:id/session-index/clear', () => {
    it('clears the session index', async () => {
      const res = await fetch(`${baseUrl}/api/sessions/${SESSION_ID}/session-index/clear`, {
        method: 'DELETE',
      })
      assert.equal(res.status, 200)
      const body = await res.json() as any
      assert.equal(body.success, true)

      // Verify index is cleared
      const hasRes = await fetch(`${baseUrl}/api/sessions/${SESSION_ID}/session-index/has-index`)
      const hasBody = await hasRes.json() as any
      assert.equal(hasBody.hasIndex, false)
    })
  })

  describe('POST /api/sessions/:id/session-index/summary', () => {
    it('returns 400 when chatSessionId is missing', async () => {
      const res = await fetch(`${baseUrl}/api/sessions/${SESSION_ID}/session-index/summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      assert.equal(res.status, 400)
    })
  })

  describe('POST /api/sessions/:id/session-index/summaries', () => {
    it('returns 400 when chatSessionIds is missing', async () => {
      const res = await fetch(`${baseUrl}/api/sessions/${SESSION_ID}/session-index/summaries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      assert.equal(res.status, 400)
    })
  })

  describe('POST /api/sessions/:id/session-index/check-can-summarize', () => {
    it('returns 400 when chatSessionIds is missing', async () => {
      const res = await fetch(`${baseUrl}/api/sessions/${SESSION_ID}/session-index/check-can-summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      assert.equal(res.status, 400)
    })

    it('returns results for valid chatSessionIds', async () => {
      // Regenerate index first
      await fetch(`${baseUrl}/api/sessions/${SESSION_ID}/session-index/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      // Get sessions to find valid IDs
      const sessRes = await fetch(`${baseUrl}/api/sessions/${SESSION_ID}/session-index/sessions`)
      const sessions = await sessRes.json() as any[]
      assert.ok(sessions.length > 0)

      const chatSessionIds = sessions.map((s: any) => s.id)

      const res = await fetch(`${baseUrl}/api/sessions/${SESSION_ID}/session-index/check-can-summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatSessionIds }),
      })
      assert.equal(res.status, 200)
      const body = await res.json() as any
      // Should have results for each chatSessionId
      for (const id of chatSessionIds) {
        assert.ok(body[id] !== undefined, `Missing result for chatSessionId ${id}`)
        assert.equal(typeof body[id].canGenerate, 'boolean')
      }
    })
  })

  describe('Session index for nonexistent database', () => {
    it('has-index returns false for nonexistent session', async () => {
      const res = await fetch(`${baseUrl}/api/sessions/nonexistent_db/session-index/has-index`)
      assert.equal(res.status, 200)
      const body = await res.json() as any
      assert.equal(body.hasIndex, false)
    })

    it('sessions returns empty array for nonexistent session', async () => {
      const res = await fetch(`${baseUrl}/api/sessions/nonexistent_db/session-index/sessions`)
      assert.equal(res.status, 200)
      const body = await res.json() as any[]
      assert.deepEqual(body, [])
    })
  })
})
