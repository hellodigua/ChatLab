/**
 * Tests for merge and migration API routes (US-014)
 */

import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { Server } from 'node:http'

// Set up a temporary data directory BEFORE any app modules load
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-test-014-'))
process.env.CHATLAB_DATA_DIR = tmpDir
process.env.CHATLAB_ENCRYPTION_KEY = 'test-key-014'

import { createApp } from '../index.js'
import { _getTempDbCache } from './merge.js'
import Database from 'better-sqlite3'
import { getDatabaseDir, ensureDir } from '../paths.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let server: Server
let baseUrl: string

/**
 * Create a minimal ChatLab JSON file for testing parse/merge.
 */
function createTestChatFile(
  dir: string,
  filename: string,
  opts?: {
    name?: string
    platform?: string
    memberCount?: number
    messageCount?: number
  },
): string {
  const name = opts?.name || 'Test Group'
  const platform = opts?.platform || 'wechat'
  const memberCount = opts?.memberCount || 2
  const messageCount = opts?.messageCount || 5

  const members: Array<{
    platformId: string
    accountName: string
    groupNickname: string
  }> = []
  for (let i = 0; i < memberCount; i++) {
    members.push({
      platformId: `user_${i}`,
      accountName: `User ${i}`,
      groupNickname: `Nickname ${i}`,
    })
  }

  const messages: Array<{
    sender: string
    accountName: string
    timestamp: number
    type: number
    content: string
  }> = []
  for (let i = 0; i < messageCount; i++) {
    messages.push({
      sender: members[i % memberCount].platformId,
      accountName: members[i % memberCount].accountName,
      timestamp: 1700000000 + i * 60,
      type: 0,
      content: `Message ${i} from ${members[i % memberCount].accountName}`,
    })
  }

  const chatLabData = {
    chatlab: {
      version: '0.0.1',
      exportedAt: Math.floor(Date.now() / 1000),
      generator: 'ChatLab Test',
    },
    meta: {
      name,
      platform,
      type: 'group',
    },
    members,
    messages,
  }

  const filePath = path.join(dir, filename)
  ensureDir(dir)
  fs.writeFileSync(filePath, JSON.stringify(chatLabData, null, 2), 'utf-8')
  return filePath
}

/**
 * Create a test session database (for migration testing).
 */
function createTestDb(
  sessionId: string,
  opts?: { schemaVersion?: number; skipVersionColumn?: boolean },
): void {
  const dbDir = getDatabaseDir()
  ensureDir(dbDir)
  const dbPath = path.join(dbDir, `${sessionId}.db`)
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')

  const schemaVersion = opts?.schemaVersion ?? 0
  const skipVersionColumn = opts?.skipVersionColumn ?? false

  // Create minimal schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      type TEXT NOT NULL,
      imported_at INTEGER NOT NULL
      ${skipVersionColumn ? '' : ', schema_version INTEGER DEFAULT ' + schemaVersion}
    );

    CREATE TABLE IF NOT EXISTS member (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform_id TEXT NOT NULL UNIQUE,
      account_name TEXT,
      group_nickname TEXT
    );

    CREATE TABLE IF NOT EXISTS message (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      sender_account_name TEXT,
      ts INTEGER NOT NULL,
      type INTEGER NOT NULL,
      content TEXT
    );
  `)

  db.prepare(
    `INSERT INTO meta (name, platform, type, imported_at${skipVersionColumn ? '' : ', schema_version'})
     VALUES (?, ?, ?, ?${skipVersionColumn ? '' : ', ?'})`,
  ).run(
    ...[
      'Test Chat',
      'wechat',
      'group',
      Math.floor(Date.now() / 1000),
      ...(skipVersionColumn ? [] : [schemaVersion]),
    ],
  )

  db.prepare('INSERT INTO member (platform_id, account_name) VALUES (?, ?)').run('user_1', 'User 1')
  db.prepare('INSERT INTO message (sender_id, sender_account_name, ts, type, content) VALUES (?, ?, ?, ?, ?)').run(
    1,
    'User 1',
    1700000000,
    0,
    'Hello',
  )

  db.close()
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

before(async () => {
  const app = createApp()
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })
  const addr = server.address()
  if (typeof addr === 'object' && addr) {
    baseUrl = `http://localhost:${addr.port}`
  }
})

after(async () => {
  // Clear merge cache
  _getTempDbCache().clear()

  await new Promise<void>((resolve) => {
    server.close(() => resolve())
  })
  // Clean up temp directory
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Merge Routes Tests
// ---------------------------------------------------------------------------

describe('Merge API Routes', () => {
  describe('POST /api/merge/parse', () => {
    it('should reject requests with no file', async () => {
      const res = await fetch(`${baseUrl}/api/merge/parse`, {
        method: 'POST',
      })
      assert.equal(res.status, 400)
      const body = await res.json()
      assert.equal(body.error, 'No file uploaded')
    })

    it('should parse a valid ChatLab JSON file and return file info', async () => {
      const testDir = path.join(tmpDir, 'merge-test-files')
      const testFile = createTestChatFile(testDir, 'test_chat.json', {
        name: 'My Group Chat',
        platform: 'wechat',
        memberCount: 3,
        messageCount: 10,
      })

      const fileContent = fs.readFileSync(testFile)
      const formData = new FormData()
      formData.append('file', new Blob([fileContent]), 'test_chat.json')

      const res = await fetch(`${baseUrl}/api/merge/parse`, {
        method: 'POST',
        body: formData,
      })

      assert.equal(res.status, 200)
      const body = await res.json()
      assert.equal(body.name, 'My Group Chat')
      assert.equal(body.platform, 'wechat')
      assert.equal(body.messageCount, 10)
      assert.equal(body.memberCount, 3)
      assert.ok(body.fileKey, 'should return a fileKey')
      assert.ok(body.fileSize > 0, 'should return fileSize')

      // Verify it was cached
      assert.ok(_getTempDbCache().has(body.fileKey), 'should cache the temp database')
    })
  })

  describe('POST /api/merge/check-conflicts', () => {
    it('should reject empty fileKeys', async () => {
      const res = await fetch(`${baseUrl}/api/merge/check-conflicts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileKeys: [] }),
      })
      assert.equal(res.status, 400)
    })

    it('should reject unknown fileKeys', async () => {
      const res = await fetch(`${baseUrl}/api/merge/check-conflicts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileKeys: ['nonexistent_key'] }),
      })
      assert.equal(res.status, 400)
      const body = await res.json()
      assert.ok(body.error.includes('not found in cache'))
    })
  })

  describe('POST /api/merge/execute', () => {
    it('should reject missing fileKeys', async () => {
      const res = await fetch(`${baseUrl}/api/merge/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outputName: 'test' }),
      })
      assert.equal(res.status, 400)
    })

    it('should reject missing outputName', async () => {
      const res = await fetch(`${baseUrl}/api/merge/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileKeys: ['key1'] }),
      })
      assert.equal(res.status, 400)
    })
  })

  describe('POST /api/merge/clear-cache', () => {
    it('should clear all cache successfully', async () => {
      const res = await fetch(`${baseUrl}/api/merge/clear-cache`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      assert.equal(res.status, 200)
      const body = await res.json()
      assert.equal(body.success, true)
    })

    it('should clear a specific file key from cache', async () => {
      // Parse a file first to populate cache
      const testDir = path.join(tmpDir, 'merge-clear-cache-test')
      const testFile = createTestChatFile(testDir, 'clear_test.json', {
        name: 'Clear Test',
        messageCount: 2,
      })

      const fileContent = fs.readFileSync(testFile)
      const formData = new FormData()
      formData.append('file', new Blob([fileContent]), 'clear_test.json')

      const parseRes = await fetch(`${baseUrl}/api/merge/parse`, {
        method: 'POST',
        body: formData,
      })
      const parseBody = await parseRes.json()
      const fileKey = parseBody.fileKey
      assert.ok(_getTempDbCache().has(fileKey))

      // Clear that specific key
      const clearRes = await fetch(`${baseUrl}/api/merge/clear-cache`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileKey }),
      })
      assert.equal(clearRes.status, 200)
      const clearBody = await clearRes.json()
      assert.equal(clearBody.success, true)
      assert.ok(!_getTempDbCache().has(fileKey), 'fileKey should be removed from cache')
    })
  })

  describe('Full merge flow', () => {
    it('should parse two files, check conflicts, and merge', async () => {
      const testDir = path.join(tmpDir, 'merge-flow-test')

      // Create two test files with overlapping time range
      const file1 = createTestChatFile(testDir, 'file1.json', {
        name: 'Test Group',
        platform: 'wechat',
        memberCount: 2,
        messageCount: 5,
      })
      const file2 = createTestChatFile(testDir, 'file2.json', {
        name: 'Test Group',
        platform: 'wechat',
        memberCount: 2,
        messageCount: 3,
      })

      // Parse file 1
      const formData1 = new FormData()
      formData1.append('file', new Blob([fs.readFileSync(file1)]), 'file1.json')
      const parse1 = await fetch(`${baseUrl}/api/merge/parse`, {
        method: 'POST',
        body: formData1,
      })
      const parseBody1 = await parse1.json()
      assert.equal(parseBody1.messageCount, 5)

      // Parse file 2
      const formData2 = new FormData()
      formData2.append('file', new Blob([fs.readFileSync(file2)]), 'file2.json')
      const parse2 = await fetch(`${baseUrl}/api/merge/parse`, {
        method: 'POST',
        body: formData2,
      })
      const parseBody2 = await parse2.json()
      assert.equal(parseBody2.messageCount, 3)

      // Check conflicts
      const conflictRes = await fetch(`${baseUrl}/api/merge/check-conflicts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileKeys: [parseBody1.fileKey, parseBody2.fileKey],
        }),
      })
      assert.equal(conflictRes.status, 200)
      const conflictBody = await conflictRes.json()
      assert.ok(typeof conflictBody.totalMessages === 'number')
      assert.ok(Array.isArray(conflictBody.conflicts))

      // Execute merge
      const mergeRes = await fetch(`${baseUrl}/api/merge/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileKeys: [parseBody1.fileKey, parseBody2.fileKey],
          outputName: 'Merged Chat',
          conflictResolutions: [],
          andAnalyze: false,
        }),
      })
      assert.equal(mergeRes.status, 200)
      const mergeBody = await mergeRes.json()
      assert.equal(mergeBody.success, true)
      assert.ok(mergeBody.outputPath, 'should return output path')
      assert.ok(fs.existsSync(mergeBody.outputPath), 'output file should exist')

      // Verify the merged output
      const merged = JSON.parse(fs.readFileSync(mergeBody.outputPath, 'utf-8'))
      assert.equal(merged.meta.name, 'Merged Chat')
      assert.ok(merged.messages.length > 0, 'merged file should contain messages')

      // Cache should be cleared after successful merge
      assert.ok(!_getTempDbCache().has(parseBody1.fileKey), 'cache should be cleared for file1')
      assert.ok(!_getTempDbCache().has(parseBody2.fileKey), 'cache should be cleared for file2')
    })
  })
})

// ---------------------------------------------------------------------------
// Migration Routes Tests
// ---------------------------------------------------------------------------

describe('Migration API Routes', () => {
  describe('GET /api/migration/check', () => {
    it('should return migration status when no databases exist', async () => {
      const res = await fetch(`${baseUrl}/api/migration/check`)
      assert.equal(res.status, 200)
      const body = await res.json()
      assert.equal(typeof body.needsMigration, 'boolean')
      assert.equal(typeof body.count, 'number')
      assert.equal(typeof body.currentVersion, 'number')
      assert.ok(Array.isArray(body.pendingMigrations))
    })

    it('should detect databases needing migration', async () => {
      // Create a database with schema_version 0
      createTestDb('migration_test_check', { schemaVersion: 0 })

      const res = await fetch(`${baseUrl}/api/migration/check`)
      assert.equal(res.status, 200)
      const body = await res.json()
      assert.equal(body.needsMigration, true)
      assert.ok(body.count >= 1)
      assert.ok(body.pendingMigrations.length > 0)
    })
  })

  describe('POST /api/migration/run', () => {
    it('should run migrations on databases that need them', async () => {
      // Create a database that needs migration (version 0)
      createTestDb('migration_test_run', { schemaVersion: 0 })

      const res = await fetch(`${baseUrl}/api/migration/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      assert.equal(res.status, 200)
      const body = await res.json()
      assert.equal(body.success, true)
      assert.ok(body.migratedCount >= 1)
    })

    it('should succeed when no databases need migration', async () => {
      // After the previous test, all databases should be up to date
      const res = await fetch(`${baseUrl}/api/migration/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      assert.equal(res.status, 200)
      const body = await res.json()
      assert.equal(body.success, true)
      assert.equal(body.migratedCount, 0)
    })
  })
})
