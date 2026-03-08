/**
 * US-018: Tests for remaining window.* API replacements
 *
 * Verifies that:
 * 1. No window.llmApi, window.embeddingApi, window.nlpApi, window.networkApi,
 *    window.cacheApi, window.sessionApi, window.api, or window.electron
 *    references remain in src/ (excluding tests and comments)
 * 2. appApi, dialogApi, clipboardApi work correctly as web-compatible replacements
 * 3. Stores (llm, embedding, settings, prompt) import from @/services, not window.*
 * 4. TitleBar.vue has no window.electron references
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { setBaseUrl } from '../client'

// ── Helpers ──────────────────────────────────────────────────

const SRC_DIR = join(import.meta.dirname, '../..')

function getAllSourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__') continue
      files.push(...getAllSourceFiles(full))
    } else {
      const ext = extname(entry)
      if ((ext === '.ts' || ext === '.vue') && !entry.includes('.test.')) {
        files.push(full)
      }
    }
  }
  return files
}

function createMockResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { 'Content-Type': 'application/json' },
  })
}

let fetchMock: ReturnType<typeof mock.fn>
let lastUrl: string
let lastInit: RequestInit | undefined

beforeEach(() => {
  setBaseUrl('/api')
  fetchMock = mock.fn((...args: unknown[]) => {
    lastUrl = args[0] as string
    lastInit = args[1] as RequestInit | undefined
    return Promise.resolve(createMockResponse({ _default: true }))
  })
  ;(globalThis as unknown as { fetch: unknown }).fetch = fetchMock
})

afterEach(() => {
  delete (globalThis as unknown as { fetch?: unknown }).fetch
})

function respondWith(body: unknown, status = 200) {
  fetchMock.mock.mockImplementation((...args: unknown[]) => {
    lastUrl = args[0] as string
    lastInit = args[1] as RequestInit | undefined
    return Promise.resolve(createMockResponse(body, status))
  })
}

// ── Source-level verification: no window.* Electron API references ──

describe('Source-level verification: no remaining window.* Electron APIs', () => {
  const patterns = [
    { name: 'window.llmApi', regex: /window\.llmApi/ },
    { name: 'window.embeddingApi', regex: /window\.embeddingApi/ },
    { name: 'window.nlpApi', regex: /window\.nlpApi/ },
    { name: 'window.networkApi', regex: /window\.networkApi/ },
    { name: 'window.cacheApi', regex: /window\.cacheApi/ },
    { name: 'window.sessionApi', regex: /window\.sessionApi/ },
    { name: 'window.chatApi', regex: /window\.chatApi/ },
    { name: 'window.mergeApi', regex: /window\.mergeApi/ },
    { name: 'window.aiApi', regex: /window\.aiApi/ },
    { name: 'window.agentApi', regex: /window\.agentApi/ },
    { name: 'window.api.', regex: /window\.api\./ },
    { name: 'window.electron', regex: /window\.electron/ },
  ]

  const files = getAllSourceFiles(SRC_DIR)

  for (const { name, regex } of patterns) {
    it(`no ${name} references in src/ (excluding tests/comments)`, () => {
      const violations: string[] = []
      for (const file of files) {
        const content = readFileSync(file, 'utf-8')
        const lines = content.split('\n')
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim()
          // Skip comments (single-line //, JSDoc *, and HTML <!-- -->)
          if (line.startsWith('//') || line.startsWith('*') || line.startsWith('<!--')) continue
          // Skip lines that are purely in a multi-line comment block
          if (line.startsWith('/*') || line.startsWith('*/')) continue
          if (regex.test(line)) {
            const relPath = file.replace(SRC_DIR + '/', '')
            violations.push(`${relPath}:${i + 1}: ${line}`)
          }
        }
      }
      assert.equal(
        violations.length,
        0,
        `Found ${violations.length} remaining ${name} reference(s):\n${violations.join('\n')}`,
      )
    })
  }

  it('no @electron imports in src/ (excluding tests/comments)', () => {
    const violations: string[] = []
    const regex = /@electron\//
    for (const file of files) {
      const content = readFileSync(file, 'utf-8')
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim()
        if (line.startsWith('//') || line.startsWith('*') || line.startsWith('<!--')) continue
        if (regex.test(line)) {
          const relPath = file.replace(SRC_DIR + '/', '')
          violations.push(`${relPath}:${i + 1}: ${line}`)
        }
      }
    }
    assert.equal(
      violations.length,
      0,
      `Found ${violations.length} remaining @electron/ import(s):\n${violations.join('\n')}`,
    )
  })
})

// ── Store import verification ──

describe('Store import verification', () => {
  it('src/stores/llm.ts imports llmApi from @/services', () => {
    const content = readFileSync(join(SRC_DIR, 'stores/llm.ts'), 'utf-8')
    assert.ok(content.includes("from '@/services'") || content.includes("from \"@/services\""))
    assert.ok(content.includes('llmApi'))
    assert.ok(!content.includes('window.llmApi'))
  })

  it('src/stores/embedding.ts imports embeddingApi from @/services', () => {
    const content = readFileSync(join(SRC_DIR, 'stores/embedding.ts'), 'utf-8')
    assert.ok(content.includes("from '@/services'") || content.includes("from \"@/services\""))
    assert.ok(content.includes('embeddingApi'))
    assert.ok(!content.includes('window.embeddingApi'))
  })

  it('src/stores/settings.ts imports aiApi from @/services, no window.electron', () => {
    const content = readFileSync(join(SRC_DIR, 'stores/settings.ts'), 'utf-8')
    assert.ok(content.includes("from '@/services'") || content.includes("from \"@/services\""))
    assert.ok(content.includes('aiApi'))
    assert.ok(!content.includes('window.aiApi'))
    assert.ok(!content.includes('window.electron'))
  })

  it('src/stores/prompt.ts imports appApi from @/services, no window.api', () => {
    const content = readFileSync(join(SRC_DIR, 'stores/prompt.ts'), 'utf-8')
    assert.ok(content.includes("from '@/services'") || content.includes("from \"@/services\""))
    assert.ok(content.includes('appApi'))
    assert.ok(!content.includes('window.api.'))
  })

  it('TitleBar.vue has no window.electron references', () => {
    const content = readFileSync(join(SRC_DIR, 'components/common/TitleBar.vue'), 'utf-8')
    assert.ok(!content.includes('window.electron'))
  })
})

// ── appApi tests ──

describe('appApi', () => {
  it('getVersion should GET /api/app/version and extract version string', async () => {
    respondWith({ version: '1.2.3' })
    const { appApi } = await import('../app')
    const version = await appApi.getVersion()
    assert.equal(version, '1.2.3')
    assert.equal(lastUrl, '/api/app/version')
  })

  it('getVersion should return 0.0.0 on failure', async () => {
    fetchMock.mock.mockImplementation(() => Promise.reject(new Error('Network error')))
    const { appApi } = await import('../app')
    const version = await appApi.getVersion()
    assert.equal(version, '0.0.0')
  })

  it('fetchRemoteConfig should POST to /api/app/fetch-remote', async () => {
    respondWith({ success: true, data: { key: 'value' } })
    const { appApi } = await import('../app')
    const result = await appApi.fetchRemoteConfig('https://example.com/config.json')
    assert.equal(result.success, true)
    assert.deepEqual(result.data, { key: 'value' })
    assert.equal(lastUrl, '/api/app/fetch-remote')
    assert.equal(lastInit?.method, 'POST')
    const body = JSON.parse(lastInit?.body as string)
    assert.equal(body.url, 'https://example.com/config.json')
  })

  it('checkUpdate should be a no-op', async () => {
    const { appApi } = await import('../app')
    // Should not throw
    appApi.checkUpdate()
  })

  it('getAnalyticsEnabled should return false', async () => {
    const { appApi } = await import('../app')
    const result = await appApi.getAnalyticsEnabled()
    assert.equal(result, false)
  })

  it('setAnalyticsEnabled should be a no-op returning void', async () => {
    const { appApi } = await import('../app')
    const result = await appApi.setAnalyticsEnabled(true)
    assert.equal(result, undefined)
  })

  it('setThemeSource should be a no-op', async () => {
    const { appApi } = await import('../app')
    // Should not throw
    appApi.setThemeSource('dark')
  })

  it('send should be a no-op', async () => {
    const { appApi } = await import('../app')
    // Should not throw
    appApi.send('some-channel', { data: 'test' })
  })
})

// ── clipboardApi tests ──

describe('clipboardApi', () => {
  it('copyImage should return success:false when clipboard API unavailable', async () => {
    // In node:test, navigator.clipboard is not available
    const { clipboardApi } = await import('../app')
    const result = await clipboardApi.copyImage('data:image/png;base64,iVBOR')
    // fetch of data URL works but navigator.clipboard.write will fail in node
    assert.equal(result.success, false)
    assert.ok(result.error)
  })
})

// ── dialogApi tests ──

describe('dialogApi', () => {
  it('should exist and have showOpenDialog method', async () => {
    const { dialogApi } = await import('../app')
    assert.equal(typeof dialogApi.showOpenDialog, 'function')
  })
})

// ── cacheApi web-only methods ──

describe('cacheApi web-only methods', () => {
  it('openDir should return not-supported error', async () => {
    const { cacheApi } = await import('../cache')
    const result = await cacheApi.openDir('temp')
    assert.equal(result.success, false)
    assert.ok(result.error?.includes('Not supported'))
  })

  it('selectDataDir should return not-supported error', async () => {
    const { cacheApi } = await import('../cache')
    const result = await cacheApi.selectDataDir()
    assert.equal(result.success, false)
  })

  it('showInFolder should return not-supported error', async () => {
    const { cacheApi } = await import('../cache')
    const result = await cacheApi.showInFolder('/some/path')
    assert.equal(result.success, false)
    assert.ok(result.error?.includes('Not supported'))
  })

  it('getInfo should GET /api/cache/info', async () => {
    respondWith({ baseDir: '/data', directories: [], totalSize: 0 })
    const { cacheApi } = await import('../cache')
    const result = await cacheApi.getInfo()
    assert.equal(result.baseDir, '/data')
    assert.equal(lastUrl, '/api/cache/info')
  })

  it('getDataDir should GET /api/cache/data-dir', async () => {
    respondWith({ path: '/data', isCustom: false })
    const { cacheApi } = await import('../cache')
    const result = await cacheApi.getDataDir()
    assert.equal(result.path, '/data')
    assert.equal(lastUrl, '/api/cache/data-dir')
  })

  it('setDataDir should POST to /api/cache/data-dir', async () => {
    respondWith({ success: true })
    const { cacheApi } = await import('../cache')
    await cacheApi.setDataDir('/new/path', true)
    assert.equal(lastUrl, '/api/cache/data-dir')
    assert.equal(lastInit?.method, 'POST')
    const body = JSON.parse(lastInit?.body as string)
    assert.equal(body.path, '/new/path')
    assert.equal(body.migrate, true)
  })

  it('saveToDownloads should POST to /api/cache/save-download', async () => {
    respondWith({ success: true, filePath: '/downloads/test.png' })
    const { cacheApi } = await import('../cache')
    const result = await cacheApi.saveToDownloads('test.png', 'data:image/png;base64,...')
    assert.equal(result.success, true)
    assert.equal(lastUrl, '/api/cache/save-download')
    assert.equal(lastInit?.method, 'POST')
  })

  it('getLatestImportLog should GET /api/cache/import-log', async () => {
    respondWith({ success: true, path: '/logs/import.log', name: 'import.log' })
    const { cacheApi } = await import('../cache')
    const result = await cacheApi.getLatestImportLog()
    assert.equal(result.success, true)
    assert.equal(result.name, 'import.log')
    assert.equal(lastUrl, '/api/cache/import-log')
  })
})

// ── networkApi tests ──

describe('networkApi additional tests', () => {
  it('testProxyConnection should POST to /api/network/proxy/test', async () => {
    respondWith({ success: true })
    const { networkApi } = await import('../network')
    const result = await networkApi.testProxyConnection('http://proxy:8080')
    assert.equal(result.success, true)
    assert.equal(lastUrl, '/api/network/proxy/test')
    assert.equal(lastInit?.method, 'POST')
    const body = JSON.parse(lastInit?.body as string)
    assert.equal(body.proxyUrl, 'http://proxy:8080')
  })
})

// ── sessionApi additional tests ──

describe('sessionApi additional tests', () => {
  it('hasIndex should GET and extract boolean', async () => {
    respondWith({ hasIndex: true })
    const { sessionApi } = await import('../session-index')
    const result = await sessionApi.hasIndex('s1')
    assert.equal(result, true)
    assert.equal(lastUrl, '/api/sessions/s1/session-index/has-index')
  })

  it('clear should DELETE /api/sessions/:id/session-index/clear', async () => {
    respondWith({ success: true })
    const { sessionApi } = await import('../session-index')
    const result = await sessionApi.clear('s1')
    assert.equal(result, true)
    assert.equal(lastUrl, '/api/sessions/s1/session-index/clear')
    assert.equal(lastInit?.method, 'DELETE')
  })

  it('updateGapThreshold should PUT', async () => {
    respondWith({ success: true })
    const { sessionApi } = await import('../session-index')
    const result = await sessionApi.updateGapThreshold('s1', 600)
    assert.equal(result, true)
    assert.equal(lastUrl, '/api/sessions/s1/session-index/gap-threshold')
    assert.equal(lastInit?.method, 'PUT')
    const body = JSON.parse(lastInit?.body as string)
    assert.equal(body.gapThreshold, 600)
  })

  it('generateSummary should POST with correct body', async () => {
    respondWith({ success: true, summary: 'Test summary' })
    const { sessionApi } = await import('../session-index')
    const result = await sessionApi.generateSummary('s1', 5, 'en', true)
    assert.equal(result.success, true)
    assert.equal(result.summary, 'Test summary')
    assert.equal(lastUrl, '/api/sessions/s1/session-index/summary')
    assert.equal(lastInit?.method, 'POST')
    const body = JSON.parse(lastInit?.body as string)
    assert.equal(body.chatSessionId, 5)
    assert.equal(body.locale, 'en')
    assert.equal(body.forceRegenerate, true)
  })

  it('generateSummaries should POST for batch', async () => {
    respondWith({ success: 3, failed: 0, skipped: 1 })
    const { sessionApi } = await import('../session-index')
    const result = await sessionApi.generateSummaries('s1', [1, 2, 3, 4], 'zh-CN')
    assert.equal(result.success, 3)
    assert.equal(result.skipped, 1)
    assert.equal(lastUrl, '/api/sessions/s1/session-index/summaries')
    assert.equal(lastInit?.method, 'POST')
  })

  it('getByTimeRange should GET with params', async () => {
    respondWith([{ id: 1, startTs: 100, endTs: 200, messageCount: 10, summary: null }])
    const { sessionApi } = await import('../session-index')
    const result = await sessionApi.getByTimeRange('s1', 100, 200)
    assert.equal(result.length, 1)
    assert.ok(lastUrl.includes('/api/sessions/s1/session-index/by-time-range'))
    assert.ok(lastUrl.includes('startTs=100'))
    assert.ok(lastUrl.includes('endTs=200'))
  })

  it('getRecent should GET with limit', async () => {
    respondWith([])
    const { sessionApi } = await import('../session-index')
    const result = await sessionApi.getRecent('s1', 10)
    assert.deepEqual(result, [])
    assert.ok(lastUrl.includes('/api/sessions/s1/session-index/recent'))
    assert.ok(lastUrl.includes('limit=10'))
  })
})

// ── llmApi additional tests ──

describe('llmApi additional tests', () => {
  it('getActiveConfigId should extract from response', async () => {
    respondWith({ configs: [], activeConfigId: 'cfg_abc' })
    const { llmApi } = await import('../llm')
    const result = await llmApi.getActiveConfigId()
    assert.equal(result, 'cfg_abc')
  })

  it('addConfig should POST to /api/llm/configs', async () => {
    respondWith({ id: 'c1', name: 'Test', provider: 'openai', apiKeySet: true, createdAt: 0, updatedAt: 0 })
    const { llmApi } = await import('../llm')
    const result = await llmApi.addConfig({ name: 'Test', provider: 'openai', apiKey: 'sk-test' })
    assert.equal(result.success, true)
    assert.ok(result.config)
    assert.equal(lastUrl, '/api/llm/configs')
    assert.equal(lastInit?.method, 'POST')
  })

  it('updateConfig should PUT to /api/llm/configs/:id', async () => {
    respondWith({ success: true })
    const { llmApi } = await import('../llm')
    await llmApi.updateConfig('c1', { name: 'Updated' })
    assert.equal(lastUrl, '/api/llm/configs/c1')
    assert.equal(lastInit?.method, 'PUT')
  })

  it('deleteConfig should DELETE /api/llm/configs/:id', async () => {
    respondWith({ success: true })
    const { llmApi } = await import('../llm')
    await llmApi.deleteConfig('c1')
    assert.equal(lastUrl, '/api/llm/configs/c1')
    assert.equal(lastInit?.method, 'DELETE')
  })

  it('validateApiKey should POST and return boolean', async () => {
    respondWith({ success: true })
    const { llmApi } = await import('../llm')
    const result = await llmApi.validateApiKey('openai', 'sk-test')
    assert.equal(result, true)
    assert.equal(lastUrl, '/api/llm/validate')
    assert.equal(lastInit?.method, 'POST')
  })
})

// ── embeddingApi additional tests ──

describe('embeddingApi additional tests', () => {
  it('getActiveConfigId should GET and extract from response', async () => {
    respondWith({ configs: [], activeConfigId: 'emb_1' })
    const { embeddingApi } = await import('../embedding')
    const result = await embeddingApi.getActiveConfigId()
    assert.equal(result, 'emb_1')
  })

  it('setActiveConfig should PUT to activate', async () => {
    respondWith({ success: true })
    const { embeddingApi } = await import('../embedding')
    const result = await embeddingApi.setActiveConfig('e1')
    assert.equal(result.success, true)
    assert.ok(lastUrl.includes('/api/embedding/configs/e1/activate'))
    assert.equal(lastInit?.method, 'PUT')
  })

  it('isEnabled should GET and extract boolean', async () => {
    respondWith({ enabled: true })
    const { embeddingApi } = await import('../embedding')
    const result = await embeddingApi.isEnabled()
    assert.equal(result, true)
  })

  it('clearVectorStore should POST to /api/embedding/vector-store/clear', async () => {
    respondWith({ success: true })
    const { embeddingApi } = await import('../embedding')
    const result = await embeddingApi.clearVectorStore()
    assert.equal(result.success, true)
    assert.equal(lastUrl, '/api/embedding/vector-store/clear')
    assert.equal(lastInit?.method, 'POST')
  })

  it('addConfig should POST to /api/embedding/configs', async () => {
    respondWith({ id: 'e1', name: 'Test', provider: 'openai' })
    const { embeddingApi } = await import('../embedding')
    await embeddingApi.addConfig({ name: 'Test', provider: 'openai', apiKey: 'sk-test' })
    assert.equal(lastUrl, '/api/embedding/configs')
    assert.equal(lastInit?.method, 'POST')
  })
})

// ── nlpApi additional tests ──

describe('nlpApi additional tests', () => {
  it('getWordFrequency should include all options', async () => {
    respondWith({ words: [], totalWords: 0, totalMessages: 0, uniqueWords: 0 })
    const { nlpApi } = await import('../nlp')
    await nlpApi.getWordFrequency({
      sessionId: 's1',
      locale: 'en-US',
      timeFilter: { startTs: 100, endTs: 200 },
      memberId: 42,
      topN: 50,
    })
    assert.equal(lastUrl, '/api/sessions/s1/nlp/word-frequency')
    assert.equal(lastInit?.method, 'POST')
    const body = JSON.parse(lastInit?.body as string)
    assert.equal(body.locale, 'en-US')
    assert.deepEqual(body.timeFilter, { startTs: 100, endTs: 200 })
    assert.equal(body.memberId, 42)
    assert.equal(body.topN, 50)
  })
})

// ── Module export completeness ──

describe('All API modules exported from index', () => {
  it('index.ts exports all API modules', async () => {
    const services = await import('../index')
    const requiredExports = [
      'chatApi', 'mergeApi', 'aiApi', 'agentApi',
      'llmApi', 'embeddingApi', 'nlpApi',
      'networkApi', 'cacheApi', 'sessionApi',
      'appApi', 'dialogApi', 'clipboardApi',
    ]
    for (const name of requiredExports) {
      assert.ok(
        (services as Record<string, unknown>)[name],
        `${name} should be exported from @/services`,
      )
    }
  })

  it('all API modules have their primary methods', async () => {
    const { llmApi } = await import('../llm')
    assert.equal(typeof llmApi.getProviders, 'function')
    assert.equal(typeof llmApi.getAllConfigs, 'function')
    assert.equal(typeof llmApi.hasConfig, 'function')
    assert.equal(typeof llmApi.chat, 'function')
    assert.equal(typeof llmApi.chatStream, 'function')

    const { embeddingApi } = await import('../embedding')
    assert.equal(typeof embeddingApi.getAllConfigs, 'function')
    assert.equal(typeof embeddingApi.deleteConfig, 'function')
    assert.equal(typeof embeddingApi.getVectorStoreStats, 'function')
    assert.equal(typeof embeddingApi.clearVectorStore, 'function')

    const { nlpApi } = await import('../nlp')
    assert.equal(typeof nlpApi.getWordFrequency, 'function')
    assert.equal(typeof nlpApi.getPosTags, 'function')

    const { networkApi } = await import('../network')
    assert.equal(typeof networkApi.getProxyConfig, 'function')
    assert.equal(typeof networkApi.saveProxyConfig, 'function')
    assert.equal(typeof networkApi.testProxyConnection, 'function')

    const { cacheApi } = await import('../cache')
    assert.equal(typeof cacheApi.getInfo, 'function')
    assert.equal(typeof cacheApi.clear, 'function')
    assert.equal(typeof cacheApi.openDir, 'function')
    assert.equal(typeof cacheApi.getDataDir, 'function')
    assert.equal(typeof cacheApi.setDataDir, 'function')

    const { sessionApi } = await import('../session-index')
    assert.equal(typeof sessionApi.generate, 'function')
    assert.equal(typeof sessionApi.hasIndex, 'function')
    assert.equal(typeof sessionApi.getSessions, 'function')
    assert.equal(typeof sessionApi.generateSummary, 'function')

    const { appApi } = await import('../app')
    assert.equal(typeof appApi.getVersion, 'function')
    assert.equal(typeof appApi.fetchRemoteConfig, 'function')
    assert.equal(typeof appApi.checkUpdate, 'function')
    assert.equal(typeof appApi.getAnalyticsEnabled, 'function')
    assert.equal(typeof appApi.setThemeSource, 'function')
    assert.equal(typeof appApi.send, 'function')

    const { dialogApi } = await import('../app')
    assert.equal(typeof dialogApi.showOpenDialog, 'function')

    const { clipboardApi } = await import('../app')
    assert.equal(typeof clipboardApi.copyImage, 'function')
  })
})
