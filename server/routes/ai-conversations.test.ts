/**
 * Tests for AI conversation CRUD routes and conversations module
 */

import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import http from 'node:http'

// Set up temp dir BEFORE importing app modules
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-ai-conv-test-'))
process.env.CHATLAB_DATA_DIR = tmpDir

import { createApp } from '../index.js'
import { _resetAiDatabase } from '../ai/conversations.js'

let server: http.Server
let port: number

async function request(
  method: string,
  urlPath: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = {
      hostname: '127.0.0.1',
      port,
      path: urlPath,
      method,
      headers: { 'Content-Type': 'application/json' },
    }
    const req = http.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode!, body: data ? JSON.parse(data) : null })
        } catch {
          resolve({ status: res.statusCode!, body: data })
        }
      })
    })
    req.on('error', reject)
    if (body !== undefined) {
      req.write(JSON.stringify(body))
    }
    req.end()
  })
}

before(async () => {
  const app = createApp()
  server = app.listen(0)
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const addr = server.address()
  port = typeof addr === 'object' && addr ? addr.port : 0
})

after(async () => {
  _resetAiDatabase()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// ==================== Conversation CRUD ====================

describe('AI Conversations API', () => {
  let conversationId: string
  const sessionId = 'test-session-001'

  it('POST /api/ai-conversations/:sessionId — creates a conversation', async () => {
    const res = await request('POST', `/api/ai-conversations/${sessionId}`, { title: 'Test Conv' })
    assert.equal(res.status, 201)
    assert.ok(res.body.id)
    assert.equal(res.body.sessionId, sessionId)
    assert.equal(res.body.title, 'Test Conv')
    assert.ok(res.body.createdAt)
    assert.ok(res.body.updatedAt)
    conversationId = res.body.id
  })

  it('POST /api/ai-conversations/:sessionId — creates without title', async () => {
    const res = await request('POST', `/api/ai-conversations/${sessionId}`)
    assert.equal(res.status, 201)
    assert.equal(res.body.title, null)
  })

  it('GET /api/ai-conversations/:sessionId — lists conversations', async () => {
    const res = await request('GET', `/api/ai-conversations/${sessionId}`)
    assert.equal(res.status, 200)
    assert.ok(Array.isArray(res.body))
    assert.ok(res.body.length >= 2) // created 2 above
  })

  it('GET /api/ai-conversations/detail/:conversationId — gets single', async () => {
    const res = await request('GET', `/api/ai-conversations/detail/${conversationId}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.id, conversationId)
    assert.equal(res.body.title, 'Test Conv')
  })

  it('GET /api/ai-conversations/detail/:conversationId — 404 for missing', async () => {
    const res = await request('GET', `/api/ai-conversations/detail/nonexistent`)
    assert.equal(res.status, 404)
  })

  it('PUT /api/ai-conversations/:conversationId/title — updates title', async () => {
    const res = await request('PUT', `/api/ai-conversations/${conversationId}/title`, { title: 'Updated Title' })
    assert.equal(res.status, 200)
    assert.deepEqual(res.body, { success: true })

    // Verify
    const verify = await request('GET', `/api/ai-conversations/detail/${conversationId}`)
    assert.equal(verify.body.title, 'Updated Title')
  })

  it('PUT /api/ai-conversations/:conversationId/title — 400 without title', async () => {
    const res = await request('PUT', `/api/ai-conversations/${conversationId}/title`, {})
    assert.equal(res.status, 400)
  })

  it('PUT /api/ai-conversations/:conversationId/title — 404 for missing', async () => {
    const res = await request('PUT', `/api/ai-conversations/nonexistent/title`, { title: 'X' })
    assert.equal(res.status, 404)
  })

  it('GET /api/ai-conversations/counts/by-session — returns counts', async () => {
    const res = await request('GET', `/api/ai-conversations/counts/by-session`)
    assert.equal(res.status, 200)
    assert.ok(res.body[sessionId] >= 2)
  })

  // ==================== Messages ====================

  describe('Messages', () => {
    it('POST /api/ai-conversations/:conversationId/messages — adds user message', async () => {
      const res = await request('POST', `/api/ai-conversations/${conversationId}/messages`, {
        role: 'user',
        content: 'Hello agent',
      })
      assert.equal(res.status, 201)
      assert.equal(res.body.role, 'user')
      assert.equal(res.body.content, 'Hello agent')
      assert.equal(res.body.conversationId, conversationId)
    })

    it('POST /api/ai-conversations/:conversationId/messages — adds assistant message', async () => {
      const res = await request('POST', `/api/ai-conversations/${conversationId}/messages`, {
        role: 'assistant',
        content: 'Hello! How can I help?',
        dataKeywords: ['greeting'],
        dataMessageCount: 5,
      })
      assert.equal(res.status, 201)
      assert.equal(res.body.role, 'assistant')
      assert.deepEqual(res.body.dataKeywords, ['greeting'])
      assert.equal(res.body.dataMessageCount, 5)
    })

    it('POST — 400 without role', async () => {
      const res = await request('POST', `/api/ai-conversations/${conversationId}/messages`, {
        content: 'test',
      })
      assert.equal(res.status, 400)
    })

    it('POST — 400 with invalid role', async () => {
      const res = await request('POST', `/api/ai-conversations/${conversationId}/messages`, {
        role: 'system',
        content: 'test',
      })
      assert.equal(res.status, 400)
    })

    it('GET /api/ai-conversations/:conversationId/messages — lists messages', async () => {
      const res = await request('GET', `/api/ai-conversations/${conversationId}/messages`)
      assert.equal(res.status, 200)
      assert.ok(Array.isArray(res.body))
      assert.equal(res.body.length, 2)
      assert.equal(res.body[0].role, 'user')
      assert.equal(res.body[1].role, 'assistant')
    })

    it('DELETE /api/ai-conversations/messages/:messageId — deletes message', async () => {
      const msgs = await request('GET', `/api/ai-conversations/${conversationId}/messages`)
      const msgId = msgs.body[0].id

      const res = await request('DELETE', `/api/ai-conversations/messages/${msgId}`)
      assert.equal(res.status, 200)

      const after = await request('GET', `/api/ai-conversations/${conversationId}/messages`)
      assert.equal(after.body.length, 1)
    })

    it('DELETE /api/ai-conversations/messages/:messageId — 404 for missing', async () => {
      const res = await request('DELETE', `/api/ai-conversations/messages/nonexistent`)
      assert.equal(res.status, 404)
    })
  })

  // ==================== Delete conversation ====================

  it('DELETE /api/ai-conversations/:conversationId — deletes conversation and messages', async () => {
    const res = await request('DELETE', `/api/ai-conversations/${conversationId}`)
    assert.equal(res.status, 200)

    const verify = await request('GET', `/api/ai-conversations/detail/${conversationId}`)
    assert.equal(verify.status, 404)
  })

  it('DELETE /api/ai-conversations/:conversationId — 404 for missing', async () => {
    const res = await request('DELETE', `/api/ai-conversations/nonexistent`)
    assert.equal(res.status, 404)
  })
})

// ==================== Agent route validation ====================

describe('Agent API validation', () => {
  it('POST /api/agent/run — 400 without message', async () => {
    const res = await request('POST', '/api/agent/run', { sessionId: 'test' })
    assert.equal(res.status, 400)
    assert.ok(res.body.error.includes('message'))
  })

  it('POST /api/agent/run — 400 without sessionId', async () => {
    const res = await request('POST', '/api/agent/run', { message: 'hello' })
    assert.equal(res.status, 400)
    assert.ok(res.body.error.includes('sessionId'))
  })

  it('POST /api/agent/abort/:requestId — 404 for unknown request', async () => {
    const res = await request('POST', '/api/agent/abort/unknown-request-id')
    assert.equal(res.status, 404)
  })
})
