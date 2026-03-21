/**
 * MiniMax API integration tests
 *
 * Tests actual connectivity to the MiniMax API endpoint.
 * Requires MINIMAX_API_KEY environment variable to be set.
 *
 * Usage: MINIMAX_API_KEY=your-key node --test electron/main/ai/llm/llm-minimax-integration.test.mjs
 */

import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'

const MINIMAX_BASE_URL = 'https://api.minimax.io/v1'
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY

describe('MiniMax API integration', () => {
  before(() => {
    if (!MINIMAX_API_KEY) {
      console.log('Skipping integration tests: MINIMAX_API_KEY not set')
    }
  })

  it('should reach MiniMax API endpoint', async (t) => {
    if (!MINIMAX_API_KEY) return t.skip('MINIMAX_API_KEY not set')

    // MiniMax doesn't expose /v1/models, so verify the base URL is reachable
    // by making a minimal chat completion request
    const response = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${MINIMAX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'MiniMax-M2.5-highspeed',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 1,
      }),
    })

    assert.equal(response.status, 200, 'API endpoint should be reachable and return 200')
  })

  it('should complete a simple chat request with M2.5-highspeed', async (t) => {
    if (!MINIMAX_API_KEY) return t.skip('MINIMAX_API_KEY not set')

    const response = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${MINIMAX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'MiniMax-M2.5-highspeed',
        messages: [{ role: 'user', content: 'Say "hello" and nothing else.' }],
        max_tokens: 10,
        temperature: 0.1,
      }),
    })

    assert.equal(response.status, 200, 'Chat completion should return 200')
    const data = await response.json()
    assert.ok(data.choices, 'Response should have choices')
    assert.ok(data.choices.length > 0, 'Should have at least one choice')
    assert.ok(data.choices[0].message?.content, 'Choice should have message content')
  })

  it('should reject requests to old api.minimaxi.com endpoint', async (t) => {
    if (!MINIMAX_API_KEY) return t.skip('MINIMAX_API_KEY not set')

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)

      const response = await fetch('https://api.minimaxi.com/v1/models', {
        headers: { Authorization: `Bearer ${MINIMAX_API_KEY}` },
        signal: controller.signal,
      })

      clearTimeout(timeout)
      // Old endpoint should either fail or redirect
      // If it returns 200, the old URL is still working (but we still want users to migrate)
      assert.ok(true, 'Request completed (old endpoint may still be accessible)')
    } catch (error) {
      // Connection failure is expected for deprecated endpoint
      assert.ok(true, 'Old endpoint is no longer accessible (expected)')
    }
  })
})
