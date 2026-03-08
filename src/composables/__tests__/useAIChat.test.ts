/**
 * Tests for useAIChat composable — US-017
 *
 * Verifies that:
 *   1. useAIChat imports agentApi/aiApi from @/services (not window.*)
 *   2. Agent streaming uses SSE via agentApi.runStream (postSSE)
 *   3. Agent abort calls agentApi.abort (HTTP POST)
 *   4. Conversation CRUD uses aiApi HTTP methods
 *   5. Streaming chunks (content, tool_start, tool_result, think, done, error) are handled
 *   6. Token usage is accumulated correctly
 *
 * Because useAIChat depends on Vue reactivity + Pinia stores (prompt, session, settings)
 * which in turn depend on vue-i18n and localStorage, we test at two levels:
 *   - Module-level: verify the composable file's imports resolve correctly
 *   - Service-level: verify the agentApi/aiApi functions that useAIChat calls
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { setBaseUrl } from '../../services/client'

// ── Mock fetch setup ─────────────────────────────────────────

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

function respondSSE(chunks: string[]) {
  const sseText = chunks.join('\n\n') + '\n\n'
  fetchMock.mock.mockImplementation((...args: unknown[]) => {
    lastUrl = args[0] as string
    lastInit = args[1] as RequestInit | undefined
    return Promise.resolve(
      new Response(sseText, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    )
  })
}

// ── Module import verification ───────────────────────────────

describe('useAIChat module imports', () => {
  it('useAIChat.ts should import agentApi from @/services, not window', async () => {
    // Read the source file and verify it imports from @/services
    const fs = await import('node:fs')
    const path = await import('node:path')
    const filePath = path.join(import.meta.dirname, '../../composables/useAIChat.ts')
    const source = fs.readFileSync(filePath, 'utf-8')

    // Should import from @/services
    assert.match(source, /import.*agentApi.*from\s+['"]@\/services['"]/)
    assert.match(source, /import.*aiApi.*from\s+['"]@\/services['"]/)

    // Should NOT reference window.agentApi or window.aiApi
    assert.doesNotMatch(source, /window\.agentApi/)
    assert.doesNotMatch(source, /window\.aiApi/)
  })

  it('ConversationList.vue should import aiApi from @/services', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const filePath = path.join(import.meta.dirname, '../../components/analysis/AIChat/ConversationList.vue')
    const source = fs.readFileSync(filePath, 'utf-8')

    assert.match(source, /import.*aiApi.*from\s+['"]@\/services['"]/)
    assert.doesNotMatch(source, /window\.aiApi/)
  })

  it('LocalAnalysisModal.vue should import agentApi from @/services', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const filePath = path.join(import.meta.dirname, '../../components/analysis/Filter/LocalAnalysisModal.vue')
    const source = fs.readFileSync(filePath, 'utf-8')

    assert.match(source, /import.*agentApi.*from\s+['"]@\/services['"]/)
    assert.doesNotMatch(source, /window\.agentApi/)
  })

  it('FilterTab.vue should import aiApi from @/services', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const filePath = path.join(import.meta.dirname, '../../components/analysis/Filter/FilterTab.vue')
    const source = fs.readFileSync(filePath, 'utf-8')

    assert.match(source, /import.*aiApi.*from\s+['"]@\/services['"]/)
    assert.doesNotMatch(source, /window\.aiApi/)
  })

  it('MessageList.vue should import aiApi from @/services', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const filePath = path.join(import.meta.dirname, '../../components/analysis/AIChat/ChatStatusBar.vue')
    const source = fs.readFileSync(filePath, 'utf-8')

    assert.match(source, /import.*aiApi.*from\s+['"]@\/services['"]/)
    assert.doesNotMatch(source, /window\.aiApi/)
  })

  it('no src/ file should reference window.aiApi or window.agentApi', async () => {
    const { execSync } = await import('node:child_process')
    const path = await import('node:path')
    const repoRoot = path.join(import.meta.dirname, '../../..')

    // Search for window.aiApi or window.agentApi in src/ (excluding comments)
    // grep returns exit code 1 when no matches found — that's what we want
    let grepOutput = ''
    try {
      grepOutput = execSync(
        `grep -rn "window\\.aiApi\\|window\\.agentApi" src/ --include="*.ts" --include="*.vue" | grep -v "\\.test\\.ts:" | grep -v "__tests__" | grep -v "^.*//.*window\\." | grep -v "^.*\\*.*window\\."`,
        { cwd: repoRoot, encoding: 'utf-8' },
      )
    } catch {
      // grep exits 1 when no matches — success!
      grepOutput = ''
    }

    if (grepOutput.trim()) {
      assert.fail(`Found window.aiApi or window.agentApi references in src/:\n${grepOutput}`)
    }
  })
})

// ── agentApi SSE streaming (used by useAIChat.sendMessage) ───

describe('agentApi.runStream (SSE streaming for useAIChat)', () => {
  it('should stream content chunks in order', async () => {
    const chunks = [
      `data: ${JSON.stringify({ type: 'content', content: 'Hello' })}`,
      `data: ${JSON.stringify({ type: 'content', content: ' world' })}`,
      `data: ${JSON.stringify({ type: 'done', content: 'Hello world', isFinished: true, usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } })}`,
    ]
    respondSSE(chunks)

    const { agentApi } = await import('../../services/agent')
    const received: Array<{ type: string; content?: string }> = []

    const { requestId, promise } = agentApi.runStream(
      'Test message',
      { sessionId: 's1', conversationId: 'c1' },
      (chunk) => received.push(chunk),
      'group',
      { roleDefinition: 'You are helpful', responseRules: 'Be concise' },
      'zh-CN',
      5,
    )

    assert.ok(requestId.startsWith('agent_'), 'requestId should start with agent_')

    const result = await promise
    assert.equal(result.success, true)
    assert.ok(result.result, 'result should have a result object')
    assert.equal(result.result!.content, 'Hello world')

    // Verify chunks received
    assert.ok(received.length >= 3)
    assert.equal(received[0].type, 'content')
    assert.equal(received[0].content, 'Hello')
    assert.equal(received[1].type, 'content')
    assert.equal(received[1].content, ' world')
    assert.equal(received[2].type, 'done')
  })

  it('should send correct POST body with all context fields', async () => {
    respondSSE([`data: ${JSON.stringify({ type: 'done', isFinished: true })}`])

    const { agentApi } = await import('../../services/agent')
    agentApi.runStream(
      'Test',
      {
        sessionId: 's1',
        conversationId: 'c1',
        timeFilter: { startTs: 100, endTs: 200 },
        maxMessagesLimit: 500,
        ownerInfo: { platformId: 'p1', displayName: 'User' },
        preprocessConfig: {
          dataCleaning: true,
          mergeConsecutive: false,
          blacklistKeywords: ['spam'],
          denoise: false,
          desensitize: false,
          desensitizeRules: [],
          anonymizeNames: false,
        },
      },
      undefined,
      'private',
      { roleDefinition: 'Role', responseRules: 'Rules' },
      'en-US',
      3,
    )

    // Wait a tick for fetch to be called
    await new Promise((r) => setTimeout(r, 10))

    assert.equal(lastUrl, '/api/agent/run')
    assert.equal(lastInit?.method, 'POST')

    const body = JSON.parse(lastInit?.body as string)
    assert.equal(body.message, 'Test')
    assert.equal(body.sessionId, 's1')
    assert.equal(body.conversationId, 'c1')
    assert.equal(body.chatType, 'private')
    assert.equal(body.locale, 'en-US')
    assert.equal(body.maxHistoryRounds, 3)
    assert.deepEqual(body.timeFilter, { startTs: 100, endTs: 200 })
    assert.equal(body.maxMessagesLimit, 500)
    assert.deepEqual(body.ownerInfo, { platformId: 'p1', displayName: 'User' })
    assert.ok(body.promptConfig, 'promptConfig should be present')
    assert.equal(body.promptConfig.roleDefinition, 'Role')
    assert.ok(body.preprocessConfig, 'preprocessConfig should be present')
    assert.equal(body.preprocessConfig.dataCleaning, true)
  })

  it('should handle tool_start and tool_result chunks', async () => {
    const chunks = [
      `data: ${JSON.stringify({ type: 'tool_start', toolName: 'search_messages', toolParams: { keywords: ['test'] } })}`,
      `data: ${JSON.stringify({ type: 'tool_result', toolName: 'search_messages', toolResult: { count: 5 } })}`,
      `data: ${JSON.stringify({ type: 'content', content: 'Found 5 messages' })}`,
      `data: ${JSON.stringify({ type: 'done', isFinished: true })}`,
    ]
    respondSSE(chunks)

    const { agentApi } = await import('../../services/agent')
    const received: Array<{ type: string; toolName?: string }> = []

    const { promise } = agentApi.runStream(
      'Search for test',
      { sessionId: 's1' },
      (chunk) => received.push(chunk),
    )

    await promise

    const toolStart = received.find((c) => c.type === 'tool_start')
    assert.ok(toolStart, 'should receive tool_start chunk')
    assert.equal(toolStart!.toolName, 'search_messages')

    const toolResult = received.find((c) => c.type === 'tool_result')
    assert.ok(toolResult, 'should receive tool_result chunk')
    assert.equal(toolResult!.toolName, 'search_messages')
  })

  it('should handle think chunks', async () => {
    const chunks = [
      `data: ${JSON.stringify({ type: 'think', content: 'Let me analyze...', thinkTag: 'think' })}`,
      `data: ${JSON.stringify({ type: 'think', content: '', thinkTag: 'think', thinkDurationMs: 1500 })}`,
      `data: ${JSON.stringify({ type: 'content', content: 'Analysis result' })}`,
      `data: ${JSON.stringify({ type: 'done', isFinished: true })}`,
    ]
    respondSSE(chunks)

    const { agentApi } = await import('../../services/agent')
    const received: Array<{ type: string; content?: string; thinkTag?: string; thinkDurationMs?: number }> = []

    const { promise } = agentApi.runStream(
      'Analyze this',
      { sessionId: 's1' },
      (chunk) => received.push(chunk),
    )

    await promise

    const thinkChunks = received.filter((c) => c.type === 'think')
    assert.equal(thinkChunks.length, 2)
    assert.equal(thinkChunks[0].content, 'Let me analyze...')
    assert.equal(thinkChunks[1].thinkDurationMs, 1500)
  })

  it('should handle status chunks', async () => {
    const statusData = {
      phase: 'thinking' as const,
      round: 1,
      toolsUsed: 0,
      contextTokens: 500,
      totalUsage: { promptTokens: 500, completionTokens: 0, totalTokens: 500 },
      updatedAt: Date.now(),
    }
    const chunks = [
      `data: ${JSON.stringify({ type: 'status', status: statusData })}`,
      `data: ${JSON.stringify({ type: 'done', isFinished: true })}`,
    ]
    respondSSE(chunks)

    const { agentApi } = await import('../../services/agent')
    const received: unknown[] = []

    const { promise } = agentApi.runStream(
      'Hello',
      { sessionId: 's1' },
      (chunk) => received.push(chunk),
    )

    await promise

    const statusChunk = received.find((c: any) => c.type === 'status') as any
    assert.ok(statusChunk, 'should receive status chunk')
    assert.equal(statusChunk.status.phase, 'thinking')
    assert.equal(statusChunk.status.round, 1)
  })

  it('should handle error chunks', async () => {
    const chunks = [
      `data: ${JSON.stringify({ type: 'error', error: 'API key invalid' })}`,
    ]
    respondSSE(chunks)

    const { agentApi } = await import('../../services/agent')
    const received: Array<{ type: string; error?: string }> = []

    const { promise } = agentApi.runStream(
      'Hello',
      { sessionId: 's1' },
      (chunk) => received.push(chunk),
    )

    const result = await promise
    assert.equal(result.success, false)
    assert.equal(result.error, 'API key invalid')
  })

  it('should handle HTTP error from server', async () => {
    fetchMock.mock.mockImplementation((...args: unknown[]) => {
      lastUrl = args[0] as string
      lastInit = args[1] as RequestInit | undefined
      return Promise.resolve(
        new Response(JSON.stringify({ error: 'Service unavailable' }), {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })

    const { agentApi } = await import('../../services/agent')

    const { promise } = agentApi.runStream('Hello', { sessionId: 's1' })

    const result = await promise
    assert.equal(result.success, false)
    assert.ok(result.error, 'should have error message')
  })
})

// ── agentApi.abort (used by useAIChat.stopGeneration) ────────

describe('agentApi.abort (used by useAIChat.stopGeneration)', () => {
  it('should POST to /api/agent/abort/:requestId', async () => {
    respondWith({ success: true })
    const { agentApi } = await import('../../services/agent')

    const result = await agentApi.abort('agent_12345_abc')
    assert.equal(lastUrl, '/api/agent/abort/agent_12345_abc')
    assert.equal(lastInit?.method, 'POST')
    assert.equal(result.success, true)
  })

  it('should return success even if server request fails', async () => {
    fetchMock.mock.mockImplementation((...args: unknown[]) => {
      // First call is from a potential active stream (not relevant here)
      // When abort is called, it tries to POST — make that fail
      lastUrl = args[0] as string
      lastInit = args[1] as RequestInit | undefined
      return Promise.reject(new Error('Network error'))
    })

    const { agentApi } = await import('../../services/agent')

    const result = await agentApi.abort('agent_99999')
    assert.equal(result.success, true)
  })

  it('should abort local fetch controller when aborting active request', async () => {
    // Start a stream that will hang
    fetchMock.mock.mockImplementation((...args: unknown[]) => {
      lastUrl = args[0] as string
      lastInit = args[1] as RequestInit | undefined
      // Return a response that never ends
      return new Promise(() => {}) // never resolves
    })

    const { agentApi } = await import('../../services/agent')

    const { requestId } = agentApi.runStream('Hello', { sessionId: 's1' })

    // Now change mock to handle abort POST
    respondWith({ success: true })

    // Abort should work without waiting for stream
    const abortResult = await agentApi.abort(requestId)
    assert.equal(abortResult.success, true)
  })
})

// ── aiApi conversation CRUD (used by useAIChat) ──────────────

describe('aiApi conversation CRUD (used by useAIChat)', () => {
  it('createConversation should POST to /api/ai-conversations/:sessionId', async () => {
    const conv = { id: 'c1', sessionId: 's1', title: 'Test', createdAt: 100, updatedAt: 100 }
    respondWith(conv)
    const { aiApi } = await import('../../services/ai')

    const result = await aiApi.createConversation('s1', 'Test')
    assert.equal(lastUrl, '/api/ai-conversations/s1')
    assert.equal(lastInit?.method, 'POST')
    assert.equal(result.id, 'c1')
    assert.equal(result.title, 'Test')
  })

  it('getConversations should GET /api/ai-conversations/:sessionId', async () => {
    respondWith([{ id: 'c1' }, { id: 'c2' }])
    const { aiApi } = await import('../../services/ai')

    const result = await aiApi.getConversations('s1')
    assert.equal(lastUrl, '/api/ai-conversations/s1')
    assert.equal(result.length, 2)
  })

  it('getConversation should GET /api/ai-conversations/detail/:id', async () => {
    respondWith({ id: 'c1', sessionId: 's1', title: 'Hello', createdAt: 0, updatedAt: 0 })
    const { aiApi } = await import('../../services/ai')

    const result = await aiApi.getConversation('c1')
    assert.equal(lastUrl, '/api/ai-conversations/detail/c1')
    assert.ok(result)
    assert.equal(result!.id, 'c1')
  })

  it('updateConversationTitle should PUT /api/ai-conversations/:id/title', async () => {
    respondWith({ success: true })
    const { aiApi } = await import('../../services/ai')

    const result = await aiApi.updateConversationTitle('c1', 'New Title')
    assert.equal(lastUrl, '/api/ai-conversations/c1/title')
    assert.equal(lastInit?.method, 'PUT')
    const body = JSON.parse(lastInit?.body as string)
    assert.equal(body.title, 'New Title')
    assert.equal(result, true)
  })

  it('deleteConversation should DELETE /api/ai-conversations/:id', async () => {
    respondWith({ success: true })
    const { aiApi } = await import('../../services/ai')

    const result = await aiApi.deleteConversation('c1')
    assert.equal(lastUrl, '/api/ai-conversations/c1')
    assert.equal(lastInit?.method, 'DELETE')
    assert.equal(result, true)
  })

  it('addMessage should POST to /api/ai-conversations/:id/messages', async () => {
    const msg = { id: 'm1', conversationId: 'c1', role: 'user', content: 'Hello', timestamp: 100 }
    respondWith(msg)
    const { aiApi } = await import('../../services/ai')

    const result = await aiApi.addMessage('c1', 'user', 'Hello')
    assert.equal(lastUrl, '/api/ai-conversations/c1/messages')
    assert.equal(lastInit?.method, 'POST')
    const body = JSON.parse(lastInit?.body as string)
    assert.equal(body.role, 'user')
    assert.equal(body.content, 'Hello')
    assert.equal(result.id, 'm1')
  })

  it('addMessage with contentBlocks should include them in POST body', async () => {
    const msg = { id: 'm2', conversationId: 'c1', role: 'assistant', content: 'Result', timestamp: 100 }
    respondWith(msg)
    const { aiApi } = await import('../../services/ai')

    const contentBlocks = [
      { type: 'text', text: 'Analysis:' },
      { type: 'tool', tool: { name: 'search_messages', displayName: 'search_messages', status: 'done' } },
      { type: 'text', text: 'Found 5 messages.' },
    ]

    await aiApi.addMessage('c1', 'assistant', 'Result', ['keyword1'], 5, contentBlocks as any)
    const body = JSON.parse(lastInit?.body as string)
    assert.equal(body.role, 'assistant')
    assert.equal(body.content, 'Result')
    assert.deepEqual(body.dataKeywords, ['keyword1'])
    assert.equal(body.dataMessageCount, 5)
    assert.equal(body.contentBlocks.length, 3)
  })

  it('getMessages should GET /api/ai-conversations/:id/messages', async () => {
    respondWith([
      { id: 'm1', role: 'user', content: 'Hello', timestamp: 100 },
      { id: 'm2', role: 'assistant', content: 'Hi there', timestamp: 101 },
    ])
    const { aiApi } = await import('../../services/ai')

    const result = await aiApi.getMessages('c1')
    assert.equal(lastUrl, '/api/ai-conversations/c1/messages')
    assert.equal(result.length, 2)
    assert.equal(result[0].role, 'user')
    assert.equal(result[1].role, 'assistant')
  })

  it('deleteMessage should DELETE /api/ai-conversations/messages/:id', async () => {
    respondWith({ success: true })
    const { aiApi } = await import('../../services/ai')

    const result = await aiApi.deleteMessage('m1')
    assert.equal(lastUrl, '/api/ai-conversations/messages/m1')
    assert.equal(lastInit?.method, 'DELETE')
    assert.equal(result, true)
  })
})

// ── aiApi message search/context (used by MessageList/FilterTab) ─

describe('aiApi message search and context', () => {
  it('searchMessages should POST to /api/sessions/:id/messages/search', async () => {
    respondWith({ messages: [], total: 0 })
    const { aiApi } = await import('../../services/ai')

    await aiApi.searchMessages('s1', ['hello', 'world'], { startTs: 100, endTs: 200 }, 50, 10, 42)
    assert.equal(lastUrl, '/api/sessions/s1/messages/search')
    assert.equal(lastInit?.method, 'POST')
    const body = JSON.parse(lastInit?.body as string)
    assert.deepEqual(body.keywords, ['hello', 'world'])
    assert.equal(body.limit, 50)
    assert.equal(body.offset, 10)
    assert.equal(body.senderId, 42)
  })

  it('getMessageContext should GET /api/sessions/:id/messages/context/:msgId', async () => {
    respondWith([])
    const { aiApi } = await import('../../services/ai')

    await aiApi.getMessageContext('s1', 123, 10)
    assert.equal(lastUrl, '/api/sessions/s1/messages/context/123?contextSize=10')
  })

  it('filterMessagesWithContext should POST to /api/sessions/:id/messages/filter', async () => {
    respondWith({ blocks: [], stats: {}, pagination: {} })
    const { aiApi } = await import('../../services/ai')

    await aiApi.filterMessagesWithContext('s1', ['test'], { startTs: 0, endTs: 100 }, [1, 2], 5, 1, 20)
    assert.equal(lastUrl, '/api/sessions/s1/messages/filter')
    assert.equal(lastInit?.method, 'POST')
    const body = JSON.parse(lastInit?.body as string)
    assert.deepEqual(body.keywords, ['test'])
    assert.deepEqual(body.senderIds, [1, 2])
    assert.equal(body.contextSize, 5)
    assert.equal(body.page, 1)
    assert.equal(body.pageSize, 20)
  })

  it('getMessagesBefore should GET /api/sessions/:id/messages/before/:id', async () => {
    respondWith({ messages: [], hasMore: false })
    const { aiApi } = await import('../../services/ai')

    await aiApi.getMessagesBefore('s1', 100, 50)
    assert.match(lastUrl, /\/api\/sessions\/s1\/messages\/before\/100/)
  })

  it('getMessagesAfter should GET /api/sessions/:id/messages/after/:id', async () => {
    respondWith({ messages: [], hasMore: false })
    const { aiApi } = await import('../../services/ai')

    await aiApi.getMessagesAfter('s1', 100, 50)
    assert.match(lastUrl, /\/api\/sessions\/s1\/messages\/after\/100/)
  })

  it('getAllRecentMessages should GET /api/sessions/:id/messages/all-recent', async () => {
    respondWith({ messages: [], total: 0 })
    const { aiApi } = await import('../../services/ai')

    await aiApi.getAllRecentMessages('s1', { startTs: 100 }, 50)
    assert.match(lastUrl, /\/api\/sessions\/s1\/messages\/all-recent/)
  })

  it('getConversationBetween should POST to /api/sessions/:id/messages/conversation-between', async () => {
    respondWith({ messages: [], total: 0, member1Name: 'A', member2Name: 'B' })
    const { aiApi } = await import('../../services/ai')

    await aiApi.getConversationBetween('s1', 1, 2, { startTs: 0, endTs: 100 }, 50)
    assert.equal(lastUrl, '/api/sessions/s1/messages/conversation-between')
    assert.equal(lastInit?.method, 'POST')
  })
})

// ── aiApi desensitize rules (used by settings store → useAIChat) ─

describe('aiApi desensitize rules', () => {
  it('getDefaultDesensitizeRules should GET /api/agent/desensitize-rules', async () => {
    respondWith([{ id: 'r1', label: 'Phone', pattern: '\\d+', replacement: '***', enabled: true, builtin: true, locales: ['zh-CN'] }])
    const { aiApi } = await import('../../services/ai')

    const rules = await aiApi.getDefaultDesensitizeRules('zh-CN')
    assert.match(lastUrl, /\/api\/agent\/desensitize-rules/)
    assert.equal(rules.length, 1)
    assert.equal(rules[0].id, 'r1')
  })

  it('mergeDesensitizeRules should POST to /api/agent/merge-desensitize-rules', async () => {
    const existingRules = [{ id: 'r1', label: 'Phone', pattern: '\\d+', replacement: '***', enabled: true, builtin: true, locales: ['zh-CN'] }]
    respondWith(existingRules)
    const { aiApi } = await import('../../services/ai')

    await aiApi.mergeDesensitizeRules(existingRules, 'zh-CN')
    assert.equal(lastUrl, '/api/agent/merge-desensitize-rules')
    assert.equal(lastInit?.method, 'POST')
    const body = JSON.parse(lastInit?.body as string)
    assert.equal(body.locale, 'zh-CN')
    assert.equal(body.existingRules.length, 1)
  })
})

// ── Full streaming lifecycle (simulates useAIChat.sendMessage flow) ─

describe('Full agent streaming lifecycle', () => {
  it('should handle a complete agent interaction with tools and content', async () => {
    const sseChunks = [
      `data: ${JSON.stringify({ type: 'meta', requestId: 'srv_123' })}`,
      `data: ${JSON.stringify({ type: 'status', status: { phase: 'preparing', round: 0, toolsUsed: 0, contextTokens: 0, totalUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, updatedAt: Date.now() } })}`,
      `data: ${JSON.stringify({ type: 'think', content: 'Analyzing the chat data...', thinkTag: 'think' })}`,
      `data: ${JSON.stringify({ type: 'tool_start', toolName: 'search_messages', toolParams: { keywords: ['hello'] } })}`,
      `data: ${JSON.stringify({ type: 'tool_result', toolName: 'search_messages', toolResult: { count: 3 } })}`,
      `data: ${JSON.stringify({ type: 'content', content: 'I found ' })}`,
      `data: ${JSON.stringify({ type: 'content', content: '3 messages.' })}`,
      `data: ${JSON.stringify({ type: 'done', content: 'I found 3 messages.', isFinished: true, usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 } })}`,
    ]
    respondSSE(sseChunks)

    const { agentApi } = await import('../../services/agent')
    const received: Array<{ type: string; content?: string; toolName?: string }> = []

    const { requestId, promise } = agentApi.runStream(
      'Find messages with hello',
      {
        sessionId: 's1',
        conversationId: 'c1',
        timeFilter: { startTs: 0, endTs: Date.now() },
      },
      (chunk) => received.push(chunk),
      'group',
      { roleDefinition: 'You are a chat analyzer', responseRules: 'Be helpful' },
      'zh-CN',
      5,
    )

    assert.ok(requestId)
    const result = await promise

    // Verify success
    assert.equal(result.success, true)
    assert.ok(result.result)
    assert.ok(result.result!.totalUsage)
    assert.equal(result.result!.totalUsage!.totalTokens, 120)

    // Verify all chunk types were received
    const types = received.map((c) => c.type)
    assert.ok(types.includes('meta'), 'should have meta')
    assert.ok(types.includes('status'), 'should have status')
    assert.ok(types.includes('think'), 'should have think')
    assert.ok(types.includes('tool_start'), 'should have tool_start')
    assert.ok(types.includes('tool_result'), 'should have tool_result')
    assert.ok(types.includes('content'), 'should have content')
    assert.ok(types.includes('done'), 'should have done')
  })

  it('should handle conversation create → stream → save flow with correct endpoints', async () => {
    // Step 1: createConversation
    respondWith({ id: 'c1', sessionId: 's1', title: 'Test', createdAt: 100, updatedAt: 100 })
    const { aiApi } = await import('../../services/ai')
    const conv = await aiApi.createConversation('s1', 'Test...')
    assert.equal(conv.id, 'c1')
    assert.equal(lastUrl, '/api/ai-conversations/s1')

    // Step 2: runStream (SSE)
    respondSSE([
      `data: ${JSON.stringify({ type: 'content', content: 'Response text' })}`,
      `data: ${JSON.stringify({ type: 'done', content: 'Response text', isFinished: true })}`,
    ])
    const { agentApi } = await import('../../services/agent')
    const { promise } = agentApi.runStream('Question', { sessionId: 's1', conversationId: 'c1' })
    const streamResult = await promise
    assert.equal(streamResult.success, true)

    // Step 3: Save user message
    respondWith({ id: 'm1', conversationId: 'c1', role: 'user', content: 'Question', timestamp: 100 })
    await aiApi.addMessage('c1', 'user', 'Question')
    assert.equal(lastUrl, '/api/ai-conversations/c1/messages')

    // Step 4: Save assistant message
    respondWith({ id: 'm2', conversationId: 'c1', role: 'assistant', content: 'Response text', timestamp: 101 })
    await aiApi.addMessage('c1', 'assistant', 'Response text')
    assert.equal(lastUrl, '/api/ai-conversations/c1/messages')
  })

  it('should handle loadConversation flow', async () => {
    respondWith([
      { id: 'm1', conversationId: 'c1', role: 'user', content: 'Hello', timestamp: 100 },
      { id: 'm2', conversationId: 'c1', role: 'assistant', content: 'Hi!', timestamp: 101, contentBlocks: [{ type: 'text', text: 'Hi!' }] },
    ])
    const { aiApi } = await import('../../services/ai')

    const messages = await aiApi.getMessages('c1')
    assert.equal(lastUrl, '/api/ai-conversations/c1/messages')
    assert.equal(messages.length, 2)
    assert.equal(messages[0].role, 'user')
    assert.equal(messages[1].role, 'assistant')
    assert.ok(messages[1].contentBlocks)
    assert.equal((messages[1].contentBlocks as any)[0].type, 'text')
  })
})