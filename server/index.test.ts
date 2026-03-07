import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from './index.js'
import type { Server } from 'node:http'

describe('Health endpoint', () => {
  let server: Server

  after(() => {
    if (server) server.close()
  })

  it('GET /api/health returns { status: "ok" }', async () => {
    const app = createApp()
    server = app.listen(0)
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Failed to get server address')

    const res = await fetch(`http://localhost:${address.port}/api/health`)
    assert.equal(res.status, 200)

    const body = await res.json()
    assert.deepEqual(body, { status: 'ok' })
  })
})
