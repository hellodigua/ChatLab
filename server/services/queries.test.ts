/**
 * Tests for server/services/queries (US-003)
 *
 * Validates that query functions ported from electron/main/worker/query/
 * produce correct results when called directly (no worker_threads).
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import Database from 'better-sqlite3'
import {
  getMemberActivity,
  getHourlyActivity,
  getTimeRange,
  getDailyActivity,
  getWeekdayActivity,
  getMonthlyActivity,
  getYearlyActivity,
  getMessageTypeDistribution,
  getMessageLengthDistribution,
  getAvailableYears,
  getMembers,
  getMemberNameHistory,
  getSession,
  getAllSessions,
  closeAllDatabases,
} from './queries'

const testDir = path.join(os.tmpdir(), 'chatlab-test-queries-' + Date.now())
const SESSION_ID = 'test_queries_session'

/**
 * Create a test database with sample data for query testing.
 */
function createTestDatabase(sessionId: string): void {
  const dbDir = path.join(testDir, 'databases')
  fs.mkdirSync(dbDir, { recursive: true })
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
      schema_version INTEGER DEFAULT 3,
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

  // Insert meta
  db.prepare(
    "INSERT INTO meta (name, platform, type, imported_at) VALUES ('TestGroup', 'wechat', 'group', 1700000000)",
  ).run()

  // Insert members
  // Member 1 — Alice (normal user)
  db.prepare(
    "INSERT INTO member (id, platform_id, account_name, group_nickname, avatar) VALUES (1, 'alice_id', 'Alice', 'Alice-GN', 'avatar_alice.jpg')",
  ).run()
  // Member 2 — Bob (normal user)
  db.prepare(
    "INSERT INTO member (id, platform_id, account_name, group_nickname) VALUES (2, 'bob_id', 'Bob', 'Bob-GN')",
  ).run()
  // Member 3 — System (should be excluded from most queries)
  db.prepare(
    "INSERT INTO member (id, platform_id, account_name, group_nickname) VALUES (3, 'system_id', '系统消息', '系统消息')",
  ).run()

  // Insert messages with varied timestamps
  // Timestamps chosen to cover different hours, days, weekdays
  // 2024-01-15 08:00 UTC (Monday) = 1705305600
  // 2024-01-15 14:30 UTC (Monday) = 1705329000
  // 2024-01-16 09:00 UTC (Tuesday) = 1705395600
  // 2024-01-16 20:00 UTC (Tuesday) = 1705435200
  // 2024-06-20 10:00 UTC (Thursday) = 1718874000
  const messages = [
    // Alice messages — type 0 = text
    { sender_id: 1, ts: 1705305600, type: 0, content: 'Hello everyone' },       // 2024-01-15 08:00 UTC
    { sender_id: 1, ts: 1705329000, type: 0, content: 'Good afternoon' },       // 2024-01-15 14:30 UTC
    { sender_id: 1, ts: 1705395600, type: 0, content: 'Morning!' },             // 2024-01-16 09:00 UTC
    // Bob messages
    { sender_id: 2, ts: 1705305660, type: 0, content: 'Hi Alice' },             // 2024-01-15 08:01 UTC
    { sender_id: 2, ts: 1705435200, type: 0, content: 'Good evening' },         // 2024-01-16 20:00 UTC
    { sender_id: 2, ts: 1718874000, type: 0, content: 'Hello from June' },      // 2024-06-20 10:00 UTC
    // Image message from Alice (type 1)
    { sender_id: 1, ts: 1705329060, type: 1, content: null },                   // 2024-01-15 14:31 UTC
    // System message (should be excluded)
    { sender_id: 3, ts: 1705305700, type: 0, content: 'Alice joined the group' },
  ]

  const insert = db.prepare(
    'INSERT INTO message (sender_id, ts, type, content) VALUES (@sender_id, @ts, @type, @content)',
  )
  for (const msg of messages) {
    insert.run(msg)
  }

  // Member name history for Alice
  db.prepare(
    "INSERT INTO member_name_history (member_id, name_type, name, start_ts, end_ts) VALUES (1, 'group_nickname', 'OldAlice', 1700000000, 1705000000)",
  ).run()
  db.prepare(
    "INSERT INTO member_name_history (member_id, name_type, name, start_ts) VALUES (1, 'group_nickname', 'Alice-GN', 1705000000)",
  ).run()

  db.close()
}

describe('server/services/queries', () => {
  before(() => {
    process.env.CHATLAB_DATA_DIR = testDir
    createTestDatabase(SESSION_ID)
  })

  after(() => {
    closeAllDatabases()
    delete process.env.CHATLAB_DATA_DIR
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true })
    }
  })

  // =========================================================================
  // Core acceptance criteria: getMemberActivity, getHourlyActivity, getTimeRange
  // =========================================================================

  describe('getMemberActivity', () => {
    it('returns activity for all non-system members', () => {
      const result = getMemberActivity(SESSION_ID)
      // Should have Alice and Bob, NOT system
      assert.equal(result.length, 2)
      const names = result.map((r: any) => r.name)
      assert.ok(names.includes('Alice-GN'), 'Alice present')
      assert.ok(names.includes('Bob-GN'), 'Bob present')
      assert.ok(!names.includes('系统消息'), 'System member excluded')
    })

    it('returns correct message counts (excludes system messages)', () => {
      const result = getMemberActivity(SESSION_ID)
      // Alice: 4 messages (3 text + 1 image), Bob: 3 messages
      const alice = result.find((r: any) => r.name === 'Alice-GN')
      const bob = result.find((r: any) => r.name === 'Bob-GN')
      assert.equal(alice.messageCount, 4, 'Alice has 4 messages')
      assert.equal(bob.messageCount, 3, 'Bob has 3 messages')
    })

    it('calculates percentages correctly', () => {
      const result = getMemberActivity(SESSION_ID)
      const alice = result.find((r: any) => r.name === 'Alice-GN')
      const bob = result.find((r: any) => r.name === 'Bob-GN')
      // Total non-system messages = 7
      // Alice = 4/7 ≈ 57.14%
      // Bob = 3/7 ≈ 42.86%
      assert.equal(alice.percentage, Math.round((4 / 7) * 10000) / 100)
      assert.equal(bob.percentage, Math.round((3 / 7) * 10000) / 100)
    })

    it('includes avatar data when available', () => {
      const result = getMemberActivity(SESSION_ID)
      const alice = result.find((r: any) => r.name === 'Alice-GN')
      const bob = result.find((r: any) => r.name === 'Bob-GN')
      assert.equal(alice.avatar, 'avatar_alice.jpg')
      assert.equal(bob.avatar, null)
    })

    it('returns results ordered by messageCount desc', () => {
      const result = getMemberActivity(SESSION_ID)
      assert.ok(result[0].messageCount >= result[1].messageCount)
    })

    it('returns empty array for non-existent session', () => {
      const result = getMemberActivity('nonexistent_session')
      assert.deepEqual(result, [])
    })

    it('filters by time range', () => {
      // Only messages on 2024-01-15 (before 2024-01-16)
      const result = getMemberActivity(SESSION_ID, {
        startTs: 1705305600,
        endTs: 1705329060,
      })
      // Alice: "Hello everyone" (08:00), "Good afternoon" (14:30), image (14:31) = 3
      // Bob: "Hi Alice" (08:01) = 1
      const alice = result.find((r: any) => r.name === 'Alice-GN')
      const bob = result.find((r: any) => r.name === 'Bob-GN')
      assert.equal(alice.messageCount, 3, 'Alice has 3 messages in range')
      assert.equal(bob.messageCount, 1, 'Bob has 1 message in range')
    })
  })

  describe('getHourlyActivity', () => {
    it('returns 24 hours (0-23)', () => {
      const result = getHourlyActivity(SESSION_ID)
      assert.equal(result.length, 24)
      assert.equal(result[0].hour, 0)
      assert.equal(result[23].hour, 23)
    })

    it('returns zero for hours with no messages', () => {
      const result = getHourlyActivity(SESSION_ID)
      // Hour 0 should have zero messages (unless timezone shifts put something there)
      // At least some hours should be zero
      const zeroHours = result.filter((r: any) => r.messageCount === 0)
      assert.ok(zeroHours.length > 0, 'Some hours have zero messages')
    })

    it('excludes system messages', () => {
      const result = getHourlyActivity(SESSION_ID)
      const totalCount = result.reduce(
        (sum: number, r: any) => sum + r.messageCount,
        0,
      )
      // 7 non-system messages total
      assert.equal(totalCount, 7, 'Total count excludes system messages')
    })

    it('returns empty array for non-existent session', () => {
      const result = getHourlyActivity('nonexistent_session')
      assert.deepEqual(result, [])
    })
  })

  describe('getTimeRange', () => {
    it('returns start and end timestamps', () => {
      const result = getTimeRange(SESSION_ID)
      assert.notEqual(result, null)
      assert.ok(result!.start <= result!.end, 'start <= end')
    })

    it('returns correct min/max timestamps', () => {
      const result = getTimeRange(SESSION_ID)
      // Earliest message: 1705305600, latest: 1718874000
      assert.equal(result!.start, 1705305600)
      assert.equal(result!.end, 1718874000)
    })

    it('returns null for non-existent session', () => {
      const result = getTimeRange('nonexistent_session')
      assert.equal(result, null)
    })
  })

  // =========================================================================
  // Additional query tests (beyond acceptance criteria minimum)
  // =========================================================================

  describe('getAvailableYears', () => {
    it('returns years present in message data', () => {
      const years = getAvailableYears(SESSION_ID)
      assert.ok(years.includes(2024), 'Contains 2024')
    })

    it('returns years in descending order', () => {
      const years = getAvailableYears(SESSION_ID)
      for (let i = 1; i < years.length; i++) {
        assert.ok(years[i - 1] >= years[i], 'Descending order')
      }
    })
  })

  describe('getDailyActivity', () => {
    it('returns daily message counts', () => {
      const result = getDailyActivity(SESSION_ID)
      assert.ok(result.length > 0, 'Has daily data')
      // Each entry should have date and messageCount
      for (const entry of result) {
        assert.ok(entry.date, 'Has date')
        assert.ok(typeof entry.messageCount === 'number', 'Has messageCount')
      }
    })
  })

  describe('getMessageTypeDistribution', () => {
    it('returns distribution of message types', () => {
      const result = getMessageTypeDistribution(SESSION_ID)
      assert.ok(result.length > 0)
      // Should have type 0 (text) and type 1 (image)
      const textType = result.find((r: any) => r.type === 0)
      const imageType = result.find((r: any) => r.type === 1)
      assert.ok(textType, 'Text type present')
      assert.ok(imageType, 'Image type present')
      // 6 text messages (excluding system), 1 image
      assert.equal(textType.count, 6, '6 text messages')
      assert.equal(imageType.count, 1, '1 image message')
    })
  })

  describe('getMessageLengthDistribution', () => {
    it('returns detail and grouped distributions', () => {
      const result = getMessageLengthDistribution(SESSION_ID)
      assert.ok(result.detail, 'Has detail array')
      assert.ok(result.grouped, 'Has grouped array')
      assert.equal(result.detail.length, 25, 'Detail has 25 entries (len 1-25)')
      assert.equal(result.grouped.length, 15, 'Grouped has 15 ranges')
    })
  })

  describe('getMembers', () => {
    it('returns non-system members with message counts', () => {
      const result = getMembers(SESSION_ID)
      assert.equal(result.length, 2, 'Two non-system members')
      const names = result.map((m: any) => m.groupNickname || m.accountName)
      assert.ok(!names.includes('系统消息'), 'System excluded')
    })
  })

  describe('getMemberNameHistory', () => {
    it('returns name history for a member', () => {
      const result = getMemberNameHistory(SESSION_ID, 1) // Alice
      assert.equal(result.length, 2, 'Alice has 2 name history entries')
      assert.equal(result[0].name, 'Alice-GN', 'Most recent name first (descending)')
      assert.equal(result[1].name, 'OldAlice', 'Old name second')
    })

    it('returns empty array for non-existent member', () => {
      const result = getMemberNameHistory(SESSION_ID, 999)
      assert.deepEqual(result, [])
    })
  })

  describe('no worker_threads or electron imports', () => {
    it('server/services/ files contain no worker_threads imports', () => {
      const servicesDir = path.join(
        path.dirname(new URL(import.meta.url).pathname),
        'services',
      )
      const files = getAllTsFiles(servicesDir)
      for (const file of files) {
        const content = fs.readFileSync(file, 'utf-8')
        const lines = content.split('\n')
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          // Skip comment lines
          if (line.trim().startsWith('*') || line.trim().startsWith('//')) continue
          assert.ok(
            !line.includes("from 'worker_threads'") &&
              !line.includes("require('worker_threads')") &&
              !line.includes('from "worker_threads"') &&
              !line.includes('require("worker_threads")'),
            `${path.basename(file)}:${i + 1} should not import worker_threads`,
          )
        }
      }
    })

    it('server/services/ files contain no electron imports', () => {
      const servicesDir = path.join(
        path.dirname(new URL(import.meta.url).pathname),
        'services',
      )
      const files = getAllTsFiles(servicesDir)
      for (const file of files) {
        const content = fs.readFileSync(file, 'utf-8')
        const lines = content.split('\n')
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          if (line.trim().startsWith('*') || line.trim().startsWith('//')) continue
          assert.ok(
            !line.includes("from 'electron'") &&
              !line.includes("require('electron')") &&
              !line.includes('from "electron"') &&
              !line.includes('require("electron")'),
            `${path.basename(file)}:${i + 1} should not import electron`,
          )
        }
      }
    })
  })
})

/**
 * Recursively find all .ts files (excluding .test.ts) in a directory.
 */
function getAllTsFiles(dir: string): string[] {
  const results: string[] = []
  if (!fs.existsSync(dir)) return results
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...getAllTsFiles(fullPath))
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      results.push(fullPath)
    }
  }
  return results
}
