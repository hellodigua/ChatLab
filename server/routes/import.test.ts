/**
 * Tests for chat import API routes (US-005)
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { fileURLToPath } from 'url'
import { createApp } from '../index.js'
import type { Server } from 'node:http'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a temporary directory for test fixtures. */
function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-import-test-'))
}

/** Create a valid ChatLab JSON fixture file (chatlab format with "chatlab" wrapper). */
function createChatlabJsonFixture(dir: string, filename = 'test.json'): string {
  const data = {
    chatlab: {
      version: '1.0.0',
      exportedAt: '2024-01-01T00:00:00Z',
    },
    meta: {
      name: 'Test Group',
      platform: 'qq',
      type: 'group',
    },
    members: [
      {
        platformId: 'user1',
        accountName: 'Alice',
        groupNickname: 'Alice in Group',
      },
      {
        platformId: 'user2',
        accountName: 'Bob',
      },
    ],
    messages: [
      {
        sender: 'user1',
        accountName: 'Alice',
        groupNickname: 'Alice in Group',
        timestamp: 1700000000,
        type: 0,
        content: 'Hello, world!',
      },
      {
        sender: 'user2',
        accountName: 'Bob',
        timestamp: 1700000060,
        type: 0,
        content: 'Hi there!',
      },
      {
        sender: 'user1',
        accountName: 'Alice',
        groupNickname: 'Alice in Group',
        timestamp: 1700000120,
        type: 0,
        content: 'How are you?',
      },
    ],
  }

  const filePath = path.join(dir, filename)
  fs.writeFileSync(filePath, JSON.stringify(data))
  return filePath
}

/** Create an unrecognised file. */
function createUnknownFixture(dir: string): string {
  const filePath = path.join(dir, 'unknown.xyz')
  fs.writeFileSync(filePath, 'not a valid chat file')
  return filePath
}

/** Build a multipart/form-data body for a single file upload. */
function buildMultipartBody(
  filePath: string,
  fieldName = 'file',
  extra?: Record<string, string>,
): { body: Blob; contentType: string } {
  const boundary = `----FormBoundary${Date.now()}`
  const fileName = path.basename(filePath)
  const fileContent = fs.readFileSync(filePath)

  const parts: Buffer[] = []

  // Extra text fields first
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      parts.push(
        Buffer.from(
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${key}"\r\n\r\n` +
          `${value}\r\n`,
        ),
      )
    }
  }

  // File part
  parts.push(
    Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${fieldName}"; filename="${fileName}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`,
    ),
  )
  parts.push(fileContent)
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`))

  const buf = Buffer.concat(parts)
  return {
    body: new Blob([buf]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Import API routes', () => {
  let server: Server
  let baseUrl: string
  let tempDir: string
  let originalDataDir: string | undefined

  before(() => {
    tempDir = makeTempDir()
    // Override data directory so databases land in temp
    originalDataDir = process.env.CHATLAB_DATA_DIR
    process.env.CHATLAB_DATA_DIR = path.join(tempDir, 'data')

    const app = createApp()
    server = app.listen(0)
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Failed to get server address')
    baseUrl = `http://localhost:${address.port}`
  })

  after(() => {
    if (server) server.close()
    // Restore env
    if (originalDataDir !== undefined) {
      process.env.CHATLAB_DATA_DIR = originalDataDir
    } else {
      delete process.env.CHATLAB_DATA_DIR
    }
    // Clean up temp dir
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  // ========================================================================
  // POST /api/import/detect-format
  // ========================================================================

  describe('POST /api/import/detect-format', () => {
    it('returns detected format for a valid ChatLab JSON file', async () => {
      const fixture = createChatlabJsonFixture(tempDir)
      const { body, contentType } = buildMultipartBody(fixture)

      const res = await fetch(`${baseUrl}/api/import/detect-format`, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body,
      })

      assert.equal(res.status, 200)
      const json = await res.json() as any
      assert.equal(json.detected, true)
      assert.ok(json.format)
      assert.equal(json.format.id, 'chatlab')
      assert.equal(json.format.name, 'ChatLab JSON')
      assert.equal(typeof json.format.platform, 'string')
    })

    it('returns 400 when no file is uploaded', async () => {
      const res = await fetch(`${baseUrl}/api/import/detect-format`, {
        method: 'POST',
      })

      assert.equal(res.status, 400)
      const json = await res.json() as any
      assert.ok(json.error)
    })

    it('returns detected:false for an unrecognised file', async () => {
      const fixture = createUnknownFixture(tempDir)
      const { body, contentType } = buildMultipartBody(fixture)

      const res = await fetch(`${baseUrl}/api/import/detect-format`, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body,
      })

      assert.equal(res.status, 200)
      const json = await res.json() as any
      assert.equal(json.detected, false)
      assert.ok(json.diagnosis)
    })
  })

  // ========================================================================
  // POST /api/import
  // ========================================================================

  describe('POST /api/import', () => {
    it('imports a valid ChatLab JSON file and returns sessionId', async () => {
      const fixture = createChatlabJsonFixture(tempDir, 'import-test.json')
      const { body, contentType } = buildMultipartBody(fixture)

      const res = await fetch(`${baseUrl}/api/import`, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body,
      })

      assert.equal(res.status, 200)
      const json = await res.json() as any
      assert.equal(json.success, true)
      assert.ok(json.sessionId)
      assert.ok(json.sessionId.startsWith('chat_'))
    })

    it('returns 400 when no file is uploaded', async () => {
      const res = await fetch(`${baseUrl}/api/import`, {
        method: 'POST',
      })

      assert.equal(res.status, 400)
      const json = await res.json() as any
      assert.equal(json.success, false)
    })

    it('returns success:false for an unrecognised file', async () => {
      const fixture = createUnknownFixture(tempDir)
      const { body, contentType } = buildMultipartBody(fixture)

      const res = await fetch(`${baseUrl}/api/import`, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body,
      })

      assert.equal(res.status, 200)
      const json = await res.json() as any
      assert.equal(json.success, false)
      assert.ok(json.error)
    })
  })

  // ========================================================================
  // POST /api/import/with-options
  // ========================================================================

  describe('POST /api/import/with-options', () => {
    it('imports a valid file with format options', async () => {
      const fixture = createChatlabJsonFixture(tempDir, 'options-test.json')
      const { body, contentType } = buildMultipartBody(fixture, 'file', {
        formatOptions: JSON.stringify({}),
      })

      const res = await fetch(`${baseUrl}/api/import/with-options`, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body,
      })

      assert.equal(res.status, 200)
      const json = await res.json() as any
      assert.equal(json.success, true)
      assert.ok(json.sessionId)
    })

    it('returns error for invalid formatOptions JSON', async () => {
      const fixture = createChatlabJsonFixture(tempDir, 'bad-options.json')
      const { body, contentType } = buildMultipartBody(fixture, 'file', {
        formatOptions: 'not-valid-json{',
      })

      const res = await fetch(`${baseUrl}/api/import/with-options`, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body,
      })

      assert.equal(res.status, 400)
      const json = await res.json() as any
      assert.equal(json.success, false)
      assert.ok(json.error.includes('Invalid formatOptions'))
    })
  })

  // ========================================================================
  // POST /api/sessions/:id/analyze-incremental
  // ========================================================================

  describe('POST /api/sessions/:id/analyze-incremental', () => {
    it('analyzes incremental import for an existing session', async () => {
      // First import a file to create a session
      const fixture1 = createChatlabJsonFixture(tempDir, 'incr-base.json')
      const { body: body1, contentType: ct1 } = buildMultipartBody(fixture1)

      const importRes = await fetch(`${baseUrl}/api/import`, {
        method: 'POST',
        headers: { 'Content-Type': ct1 },
        body: body1,
      })
      const importJson = await importRes.json() as any
      assert.equal(importJson.success, true)
      const sessionId = importJson.sessionId

      // Now analyze incremental import with the same file (should be all duplicates)
      const fixture2 = createChatlabJsonFixture(tempDir, 'incr-analyze.json')
      const { body: body2, contentType: ct2 } = buildMultipartBody(fixture2)

      const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/analyze-incremental`, {
        method: 'POST',
        headers: { 'Content-Type': ct2 },
        body: body2,
      })

      assert.equal(res.status, 200)
      const json = await res.json() as any
      assert.equal(json.totalInFile, 3)
      assert.equal(json.duplicateCount, 3)
      assert.equal(json.newMessageCount, 0)
    })
  })

  // ========================================================================
  // POST /api/sessions/:id/incremental-import
  // ========================================================================

  describe('POST /api/sessions/:id/incremental-import', () => {
    it('incrementally imports new messages into an existing session', async () => {
      // First create a session via normal import
      const fixture1 = createChatlabJsonFixture(tempDir, 'incr-import-base.json')
      const { body: body1, contentType: ct1 } = buildMultipartBody(fixture1)

      const importRes = await fetch(`${baseUrl}/api/import`, {
        method: 'POST',
        headers: { 'Content-Type': ct1 },
        body: body1,
      })
      const importJson = await importRes.json() as any
      assert.equal(importJson.success, true)
      const sessionId = importJson.sessionId

      // Create a fixture with one new message (ChatLab format)
      const incrementalData = {
        chatlab: { version: '1.0.0', exportedAt: '2024-01-01T00:00:00Z' },
        meta: { name: 'Test Group', platform: 'qq', type: 'group' },
        members: [
          { platformId: 'user1', accountName: 'Alice' },
          { platformId: 'user2', accountName: 'Bob' },
        ],
        messages: [
          // Duplicate of existing
          { sender: 'user1', accountName: 'Alice', timestamp: 1700000000, type: 0, content: 'Hello, world!' },
          // New message
          { sender: 'user2', accountName: 'Bob', timestamp: 1700000200, type: 0, content: 'Brand new message!' },
        ],
      }
      const incrPath = path.join(tempDir, 'incr-import-new.json')
      fs.writeFileSync(incrPath, JSON.stringify(incrementalData))

      const { body: body2, contentType: ct2 } = buildMultipartBody(incrPath)

      const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/incremental-import`, {
        method: 'POST',
        headers: { 'Content-Type': ct2 },
        body: body2,
      })

      assert.equal(res.status, 200)
      const json = await res.json() as any
      assert.equal(json.success, true)
      assert.equal(json.newMessageCount, 1)
    })
  })

  // ========================================================================
  // POST /api/import/scan-multi-chat
  // ========================================================================

  describe('POST /api/import/scan-multi-chat', () => {
    it('returns 400 for a non-multichat file', async () => {
      // ChatLab JSON format is NOT multi-chat, so scanning should error
      const fixture = createChatlabJsonFixture(tempDir, 'not-multi.json')
      const { body, contentType } = buildMultipartBody(fixture)

      const res = await fetch(`${baseUrl}/api/import/scan-multi-chat`, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body,
      })

      assert.equal(res.status, 400)
      const json = await res.json() as any
      assert.equal(json.success, false)
    })
  })

  // ========================================================================
  // Parser directory verification
  // ========================================================================

  describe('server/parser directory', () => {
    it('exists with all format parsers', () => {
      const parserDir = path.join(__dirname, '..', 'parser')
      assert.ok(fs.existsSync(parserDir), 'server/parser/ should exist')
      assert.ok(fs.existsSync(path.join(parserDir, 'index.ts')), 'server/parser/index.ts should exist')
      assert.ok(fs.existsSync(path.join(parserDir, 'sniffer.ts')), 'server/parser/sniffer.ts should exist')
      assert.ok(fs.existsSync(path.join(parserDir, 'types.ts')), 'server/parser/types.ts should exist')
      assert.ok(fs.existsSync(path.join(parserDir, 'utils.ts')), 'server/parser/utils.ts should exist')
      assert.ok(fs.existsSync(path.join(parserDir, 'formats')), 'server/parser/formats/ should exist')
      assert.ok(fs.existsSync(path.join(parserDir, 'formats', 'index.ts')), 'server/parser/formats/index.ts should exist')
    })

    it('has no electron imports', () => {
      // Recursively check all .ts files in server/parser/
      const parserDir = path.join(__dirname, '..', 'parser')
      const tsFiles = getAllTsFiles(parserDir)

      for (const file of tsFiles) {
        const content = fs.readFileSync(file, 'utf-8')
        assert.ok(
          !content.includes("from 'electron") && !content.includes('from "electron'),
          `${path.relative(parserDir, file)} should not import from electron`,
        )
      }
    })
  })
})

/** Recursively get all .ts files in a directory. */
function getAllTsFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...getAllTsFiles(full))
    } else if (entry.name.endsWith('.ts')) {
      files.push(full)
    }
  }
  return files
}
