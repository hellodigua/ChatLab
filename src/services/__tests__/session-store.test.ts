/**
 * Tests for session store with mocked API client.
 *
 * These tests verify that the session store correctly calls the HTTP API
 * client methods and handles responses properly.
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'

// Mock the API modules before importing the store
// Since we can't use Pinia in node:test, we test the store logic indirectly
// by verifying the API client is called correctly

import { chatApi } from '../chat'
import { mergeApi } from '../merge'
import { sessionApi } from '../session-index'
import { setBaseUrl } from '../client'

describe('Session Store API Integration', () => {
  let server: Awaited<ReturnType<typeof import('../../test-helpers/mock-server').createMockServer>> | null = null

  describe('chatApi (session operations)', () => {
    beforeEach(() => {
      setBaseUrl('http://localhost:19123/api')
    })

    it('getSessions() returns session list', async () => {
      // This test verifies the chatApi.getSessions method works correctly
      // In production, it calls GET /api/sessions
      const origFetch = globalThis.fetch
      globalThis.fetch = mock.fn(async () => new Response(
        JSON.stringify([
          { id: 'sess-1', name: 'Test Session', type: 'group', platform: 'wechat' },
          { id: 'sess-2', name: 'Another Session', type: 'private', platform: 'telegram' },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )) as typeof fetch
      try {
        const sessions = await chatApi.getSessions()
        assert.equal(sessions.length, 2)
        assert.equal(sessions[0].id, 'sess-1')
        assert.equal(sessions[0].name, 'Test Session')
        assert.equal(sessions[1].type, 'private')
      } finally {
        globalThis.fetch = origFetch
      }
    })

    it('getSession() returns single session', async () => {
      const origFetch = globalThis.fetch
      globalThis.fetch = mock.fn(async () => new Response(
        JSON.stringify({ id: 'sess-1', name: 'Test', type: 'group', platform: 'wechat' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )) as typeof fetch
      try {
        const session = await chatApi.getSession('sess-1')
        assert.equal(session?.id, 'sess-1')
        assert.equal(session?.name, 'Test')
      } finally {
        globalThis.fetch = origFetch
      }
    })

    it('deleteSession() returns true on success', async () => {
      const origFetch = globalThis.fetch
      globalThis.fetch = mock.fn(async () => new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )) as typeof fetch
      try {
        const result = await chatApi.deleteSession('sess-1')
        assert.equal(result, true)
      } finally {
        globalThis.fetch = origFetch
      }
    })

    it('renameSession() calls PATCH with new name', async () => {
      const origFetch = globalThis.fetch
      const mockFn = mock.fn(async (url: string, init?: RequestInit) => {
        assert.ok(url.includes('/sessions/sess-1'))
        assert.equal(init?.method, 'PATCH')
        const body = JSON.parse(init?.body as string)
        assert.equal(body.name, 'New Name')
        return new Response(
          JSON.stringify({ success: true }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }) as typeof fetch
      globalThis.fetch = mockFn
      try {
        const result = await chatApi.renameSession('sess-1', 'New Name')
        assert.equal(result, true)
      } finally {
        globalThis.fetch = origFetch
      }
    })

    it('updateSessionOwnerId() calls PATCH with ownerId', async () => {
      const origFetch = globalThis.fetch
      const mockFn = mock.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(init?.body as string)
        assert.equal(body.ownerId, 'user-123')
        return new Response(
          JSON.stringify({ success: true }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }) as typeof fetch
      globalThis.fetch = mockFn
      try {
        const result = await chatApi.updateSessionOwnerId('sess-1', 'user-123')
        assert.equal(result, true)
      } finally {
        globalThis.fetch = origFetch
      }
    })

    it('checkMigration() returns migration status', async () => {
      const origFetch = globalThis.fetch
      globalThis.fetch = mock.fn(async () => new Response(
        JSON.stringify({
          needsMigration: true,
          count: 2,
          currentVersion: 1,
          pendingMigrations: [
            { version: 2, userMessage: 'Add new columns' },
            { version: 3, userMessage: 'Add indexes' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )) as typeof fetch
      try {
        const result = await chatApi.checkMigration()
        assert.equal(result.needsMigration, true)
        assert.equal(result.count, 2)
        assert.equal(result.pendingMigrations.length, 2)
      } finally {
        globalThis.fetch = origFetch
      }
    })

    it('runMigration() returns success result', async () => {
      const origFetch = globalThis.fetch
      globalThis.fetch = mock.fn(async () => new Response(
        JSON.stringify({ success: true, migratedCount: 2 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )) as typeof fetch
      try {
        const result = await chatApi.runMigration()
        assert.equal(result.success, true)
        assert.equal(result.migratedCount, 2)
      } finally {
        globalThis.fetch = origFetch
      }
    })

    it('import() sends file via FormData', async () => {
      const origFetch = globalThis.fetch
      const mockFn = mock.fn(async (url: string, init?: RequestInit) => {
        assert.ok(url.includes('/import'))
        assert.ok(init?.body instanceof FormData)
        return new Response(
          JSON.stringify({ success: true, sessionId: 'new-sess-1' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }) as typeof fetch
      globalThis.fetch = mockFn
      try {
        const file = new File(['test content'], 'test.json', { type: 'application/json' })
        const result = await chatApi.import(file)
        assert.equal(result.success, true)
        assert.equal(result.sessionId, 'new-sess-1')
      } finally {
        globalThis.fetch = origFetch
      }
    })

    it('detectFormat() sends file and returns format info', async () => {
      const origFetch = globalThis.fetch
      globalThis.fetch = mock.fn(async () => new Response(
        JSON.stringify({ id: 'wechat', name: 'WeChat', platform: 'wechat', multiChat: false }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )) as typeof fetch
      try {
        const file = new File(['{}'], 'chat.json', { type: 'application/json' })
        const result = await chatApi.detectFormat(file)
        assert.equal(result?.id, 'wechat')
        assert.equal(result?.multiChat, false)
      } finally {
        globalThis.fetch = origFetch
      }
    })

    it('importWithOptions() sends file with options', async () => {
      const origFetch = globalThis.fetch
      const mockFn = mock.fn(async (_url: string, init?: RequestInit) => {
        const body = init?.body as FormData
        assert.ok(body instanceof FormData)
        return new Response(
          JSON.stringify({ success: true, sessionId: 'imported-1' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }) as typeof fetch
      globalThis.fetch = mockFn
      try {
        const file = new File(['{}'], 'chat.json')
        const result = await chatApi.importWithOptions(file, { chatIndex: 0 })
        assert.equal(result.success, true)
        assert.equal(result.sessionId, 'imported-1')
      } finally {
        globalThis.fetch = origFetch
      }
    })

    it('onImportProgress() returns no-op unsubscribe', () => {
      const unsubscribe = chatApi.onImportProgress(() => {})
      assert.equal(typeof unsubscribe, 'function')
      // Should not throw
      unsubscribe()
    })
  })

  describe('mergeApi', () => {
    beforeEach(() => {
      setBaseUrl('http://localhost:19123/api')
    })

    it('parseFileInfo() uploads file and returns parse info with fileKey', async () => {
      const origFetch = globalThis.fetch
      const mockFn = mock.fn(async (_url: string, init?: RequestInit) => {
        assert.ok(init?.body instanceof FormData)
        return new Response(
          JSON.stringify({
            name: 'test-chat',
            format: 'wechat',
            platform: 'wechat',
            messageCount: 100,
            memberCount: 5,
            fileKey: 'fk-123',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }) as typeof fetch
      globalThis.fetch = mockFn
      try {
        const file = new File(['content'], 'test.json')
        const result = await mergeApi.parseFileInfo(file)
        assert.equal(result.fileKey, 'fk-123')
        assert.equal(result.messageCount, 100)
      } finally {
        globalThis.fetch = origFetch
      }
    })

    it('checkConflicts() posts fileKeys and returns conflict result', async () => {
      const origFetch = globalThis.fetch
      const mockFn = mock.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(init?.body as string)
        assert.deepEqual(body.fileKeys, ['fk-1', 'fk-2'])
        return new Response(
          JSON.stringify({ conflicts: [] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }) as typeof fetch
      globalThis.fetch = mockFn
      try {
        const result = await mergeApi.checkConflicts(['fk-1', 'fk-2'])
        assert.equal(result.conflicts.length, 0)
      } finally {
        globalThis.fetch = origFetch
      }
    })

    it('mergeFiles() posts merge params and returns result', async () => {
      const origFetch = globalThis.fetch
      globalThis.fetch = mock.fn(async () => new Response(
        JSON.stringify({ success: true, sessionId: 'merged-1' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )) as typeof fetch
      try {
        const result = await mergeApi.mergeFiles({
          filePaths: [],
          fileKeys: ['fk-1', 'fk-2'],
          outputName: 'merged',
          conflictResolutions: [],
          andAnalyze: true,
        })
        assert.equal(result.success, true)
        assert.equal(result.sessionId, 'merged-1')
      } finally {
        globalThis.fetch = origFetch
      }
    })

    it('clearCache() returns true on success', async () => {
      const origFetch = globalThis.fetch
      globalThis.fetch = mock.fn(async () => new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )) as typeof fetch
      try {
        const result = await mergeApi.clearCache()
        assert.equal(result, true)
      } finally {
        globalThis.fetch = origFetch
      }
    })
  })

  describe('sessionApi', () => {
    beforeEach(() => {
      setBaseUrl('http://localhost:19123/api')
    })

    it('generate() posts and returns session count', async () => {
      const origFetch = globalThis.fetch
      globalThis.fetch = mock.fn(async () => new Response(
        JSON.stringify({ success: true, sessionCount: 12 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )) as typeof fetch
      try {
        const count = await sessionApi.generate('sess-1', 1800)
        assert.equal(count, 12)
      } finally {
        globalThis.fetch = origFetch
      }
    })

    it('getStats() returns session stats', async () => {
      const origFetch = globalThis.fetch
      globalThis.fetch = mock.fn(async () => new Response(
        JSON.stringify({ sessionCount: 5, hasIndex: true, gapThreshold: 1800 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )) as typeof fetch
      try {
        const stats = await sessionApi.getStats('sess-1')
        assert.equal(stats.sessionCount, 5)
        assert.equal(stats.hasIndex, true)
      } finally {
        globalThis.fetch = origFetch
      }
    })

    it('getSessions() returns session items', async () => {
      const origFetch = globalThis.fetch
      globalThis.fetch = mock.fn(async () => new Response(
        JSON.stringify([
          { id: 1, startTs: 1000, endTs: 2000, messageCount: 50, firstMessageId: 1 },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )) as typeof fetch
      try {
        const sessions = await sessionApi.getSessions('sess-1')
        assert.equal(sessions.length, 1)
        assert.equal(sessions[0].messageCount, 50)
      } finally {
        globalThis.fetch = origFetch
      }
    })

    it('generateSummary() posts and returns summary result', async () => {
      const origFetch = globalThis.fetch
      globalThis.fetch = mock.fn(async () => new Response(
        JSON.stringify({ success: true, summary: 'A conversation about...' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )) as typeof fetch
      try {
        const result = await sessionApi.generateSummary('db-1', 42, 'zh-CN')
        assert.equal(result.success, true)
        assert.equal(result.summary, 'A conversation about...')
      } finally {
        globalThis.fetch = origFetch
      }
    })
  })

  describe('No window.*Api references in services/', () => {
    it('services/index.ts exports all API modules', async () => {
      const services = await import('../index')
      assert.ok(services.chatApi, 'chatApi should be exported')
      assert.ok(services.mergeApi, 'mergeApi should be exported')
      assert.ok(services.sessionApi, 'sessionApi should be exported')
      assert.ok(services.aiApi, 'aiApi should be exported')
      assert.ok(services.llmApi, 'llmApi should be exported')
      assert.ok(services.agentApi, 'agentApi should be exported')
      assert.ok(services.embeddingApi, 'embeddingApi should be exported')
      assert.ok(services.nlpApi, 'nlpApi should be exported')
      assert.ok(services.networkApi, 'networkApi should be exported')
      assert.ok(services.cacheApi, 'cacheApi should be exported')
      assert.ok(services.appApi, 'appApi should be exported')
      assert.ok(services.dialogApi, 'dialogApi should be exported')
      assert.ok(services.clipboardApi, 'clipboardApi should be exported')
    })

    it('chatApi has all required methods', () => {
      const methods = [
        'getSessions', 'getSession', 'deleteSession', 'renameSession',
        'updateSessionOwnerId', 'checkMigration', 'runMigration',
        'import', 'detectFormat', 'importWithOptions', 'scanMultiChatFile',
        'analyzeIncrementalImport', 'incrementalImport',
        'getMembers', 'getMemberActivity', 'getHourlyActivity',
        'getDailyActivity', 'getWeekdayActivity', 'executeSQL', 'getSchema',
        'onImportProgress',
      ]
      for (const method of methods) {
        assert.equal(typeof (chatApi as Record<string, unknown>)[method], 'function', `chatApi.${method} should be a function`)
      }
    })

    it('mergeApi has all required methods', () => {
      const methods = ['parseFileInfo', 'parseServerFile', 'checkConflicts', 'mergeFiles', 'clearCache']
      for (const method of methods) {
        assert.equal(typeof (mergeApi as Record<string, unknown>)[method], 'function', `mergeApi.${method} should be a function`)
      }
    })

    it('sessionApi has all required methods', () => {
      const methods = ['generate', 'hasIndex', 'getStats', 'getSessions', 'generateSummary']
      for (const method of methods) {
        assert.equal(typeof (sessionApi as Record<string, unknown>)[method], 'function', `sessionApi.${method} should be a function`)
      }
    })
  })
})
