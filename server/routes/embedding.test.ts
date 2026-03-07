/**
 * Tests for Embedding config API routes (US-012)
 *
 * Uses a temporary data directory to isolate tests from real data.
 * Tests config CRUD, activation, vector store stats, and persistence.
 */

import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { Server } from 'node:http'

// Set up a temporary data directory BEFORE any app modules load
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-embedding-test-'))
process.env.CHATLAB_DATA_DIR = tmpDir
process.env.CHATLAB_ENCRYPTION_KEY = 'test-encryption-key-for-embedding-tests'

import { createApp } from '../index.js'
import { _resetConfigPaths } from '../ai/rag/index.js'
import { getAiDataDir, ensureDir } from '../paths.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let server: Server
let baseUrl: string

function url(p: string): string {
  return `${baseUrl}${p}`
}

async function json(method: string, p: string, body?: unknown) {
  const opts: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  if (body !== undefined) {
    opts.body = JSON.stringify(body)
  }
  const res = await fetch(url(p), opts)
  const data = await res.json()
  return { status: res.status, data }
}

/**
 * Clear the embedding config file between tests to ensure isolation.
 */
function clearConfigFile() {
  const configPath = path.join(getAiDataDir(), 'embedding-config.json')
  if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath)
  }
  _resetConfigPaths()
}

before(async () => {
  ensureDir(getAiDataDir())
  const app = createApp()
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address()
      if (typeof addr === 'object' && addr) {
        baseUrl = `http://localhost:${addr.port}`
      }
      resolve()
    })
  })
})

after(() => {
  server?.close()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/embedding/configs', () => {
  beforeEach(() => clearConfigFile())

  it('returns empty list when no configs exist', async () => {
    const { status, data } = await json('GET', '/api/embedding/configs')
    assert.equal(status, 200)
    assert.deepEqual(data.configs, [])
    assert.equal(data.activeConfigId, null)
    assert.equal(data.enabled, false)
  })

  it('returns EmbeddingServiceConfigDisplay[] with masked API keys', async () => {
    await json('POST', '/api/embedding/configs', {
      name: 'Test Embedding',
      apiSource: 'custom',
      model: 'nomic-embed-text',
      baseUrl: 'http://localhost:11434/v1',
      apiKey: 'sk-test-embedding-key',
    })
    const { status, data } = await json('GET', '/api/embedding/configs')
    assert.equal(status, 200)
    assert.equal(data.configs.length, 1)
    const config = data.configs[0]
    assert.ok(config.id, 'should have an id')
    assert.equal(config.name, 'Test Embedding')
    assert.equal(config.apiSource, 'custom')
    assert.equal(config.model, 'nomic-embed-text')
    assert.ok(config.apiKey.includes('****'), 'API key should be masked')
    assert.ok(!config.apiKey.includes('test-embedding'), 'plaintext should not appear')
    assert.ok(config.createdAt > 0)
    assert.ok(config.updatedAt > 0)
  })
})

describe('POST /api/embedding/configs', () => {
  beforeEach(() => clearConfigFile())

  it('creates a new config with reuse_llm source', async () => {
    const { status, data } = await json('POST', '/api/embedding/configs', {
      name: 'My Embedding',
      model: 'nomic-embed-text',
    })
    assert.equal(status, 201)
    assert.ok(data.id)
    assert.equal(data.name, 'My Embedding')
    assert.equal(data.apiSource, 'reuse_llm')
    assert.equal(data.model, 'nomic-embed-text')
  })

  it('creates a new config with custom source', async () => {
    const { status, data } = await json('POST', '/api/embedding/configs', {
      name: 'Custom Embedding',
      apiSource: 'custom',
      model: 'text-embedding-3-small',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-custom-key',
    })
    assert.equal(status, 201)
    assert.equal(data.apiSource, 'custom')
    assert.equal(data.model, 'text-embedding-3-small')
  })

  it('auto-activates the first config', async () => {
    const { data: created } = await json('POST', '/api/embedding/configs', {
      name: 'First',
      model: 'nomic-embed-text',
    })
    const { data } = await json('GET', '/api/embedding/configs')
    assert.equal(data.activeConfigId, created.id)
  })

  it('rejects missing name', async () => {
    const { status, data } = await json('POST', '/api/embedding/configs', {
      model: 'nomic-embed-text',
    })
    assert.equal(status, 400)
    assert.ok(data.error.includes('name'))
  })

  it('rejects missing model', async () => {
    const { status, data } = await json('POST', '/api/embedding/configs', {
      name: 'Test',
    })
    assert.equal(status, 400)
    assert.ok(data.error.includes('model'))
  })

  it('rejects custom apiSource without baseUrl', async () => {
    const { status, data } = await json('POST', '/api/embedding/configs', {
      name: 'Test',
      apiSource: 'custom',
      model: 'nomic-embed-text',
    })
    assert.equal(status, 400)
    assert.ok(data.error.includes('baseUrl'))
  })

  it('rejects invalid apiSource', async () => {
    const { status, data } = await json('POST', '/api/embedding/configs', {
      name: 'Test',
      apiSource: 'invalid',
      model: 'nomic-embed-text',
    })
    assert.equal(status, 400)
    assert.ok(data.error.includes('Invalid apiSource'))
  })
})

describe('GET /api/embedding/configs/:id', () => {
  beforeEach(() => clearConfigFile())

  it('returns a single config with masked API key', async () => {
    const { data: created } = await json('POST', '/api/embedding/configs', {
      name: 'Single',
      apiSource: 'custom',
      model: 'nomic-embed-text',
      baseUrl: 'http://localhost:11434/v1',
      apiKey: 'sk-long-test-api-key',
    })
    const { status, data } = await json('GET', `/api/embedding/configs/${created.id}`)
    assert.equal(status, 200)
    assert.equal(data.name, 'Single')
    assert.ok(data.apiKey.includes('****'))
  })

  it('returns 404 for nonexistent config', async () => {
    const { status } = await json('GET', '/api/embedding/configs/nonexistent-id')
    assert.equal(status, 404)
  })
})

describe('PUT /api/embedding/configs/:id', () => {
  beforeEach(() => clearConfigFile())

  it('updates config fields', async () => {
    const { data: created } = await json('POST', '/api/embedding/configs', {
      name: 'Original',
      model: 'nomic-embed-text',
    })
    const { status } = await json('PUT', `/api/embedding/configs/${created.id}`, {
      name: 'Updated',
      model: 'text-embedding-3-large',
    })
    assert.equal(status, 200)

    const { data: fetched } = await json('GET', `/api/embedding/configs/${created.id}`)
    assert.equal(fetched.name, 'Updated')
    assert.equal(fetched.model, 'text-embedding-3-large')
  })

  it('returns 404 for nonexistent config', async () => {
    const { status } = await json('PUT', '/api/embedding/configs/nonexistent-id', {
      name: 'Nope',
    })
    assert.equal(status, 404)
  })
})

describe('DELETE /api/embedding/configs/:id', () => {
  beforeEach(() => clearConfigFile())

  it('deletes a config', async () => {
    const { data: created } = await json('POST', '/api/embedding/configs', {
      name: 'To Delete',
      model: 'nomic-embed-text',
    })
    const { status } = await json('DELETE', `/api/embedding/configs/${created.id}`)
    assert.equal(status, 200)

    const { data } = await json('GET', '/api/embedding/configs')
    assert.equal(data.configs.length, 0)
  })

  it('clears activeConfigId when deleting active config', async () => {
    const { data: created } = await json('POST', '/api/embedding/configs', {
      name: 'Only',
      model: 'nomic-embed-text',
    })
    await json('DELETE', `/api/embedding/configs/${created.id}`)
    const { data } = await json('GET', '/api/embedding/configs')
    assert.equal(data.activeConfigId, null)
  })

  it('promotes next config when deleting active', async () => {
    const { data: c1 } = await json('POST', '/api/embedding/configs', {
      name: 'First',
      model: 'nomic-embed-text',
    })
    const { data: c2 } = await json('POST', '/api/embedding/configs', {
      name: 'Second',
      model: 'text-embedding-3-small',
    })
    await json('DELETE', `/api/embedding/configs/${c1.id}`)
    const { data } = await json('GET', '/api/embedding/configs')
    assert.equal(data.activeConfigId, c2.id)
  })

  it('returns 404 for nonexistent config', async () => {
    const { status } = await json('DELETE', '/api/embedding/configs/nonexistent-id')
    assert.equal(status, 404)
  })
})

describe('PUT /api/embedding/configs/:id/activate', () => {
  beforeEach(() => clearConfigFile())

  it('activates a specific config', async () => {
    await json('POST', '/api/embedding/configs', {
      name: 'First',
      model: 'nomic-embed-text',
    })
    const { data: c2 } = await json('POST', '/api/embedding/configs', {
      name: 'Second',
      model: 'text-embedding-3-small',
    })
    const { status } = await json('PUT', `/api/embedding/configs/${c2.id}/activate`)
    assert.equal(status, 200)

    const { data } = await json('GET', '/api/embedding/configs')
    assert.equal(data.activeConfigId, c2.id)
  })

  it('returns 404 for nonexistent config', async () => {
    const { status } = await json('PUT', '/api/embedding/configs/nonexistent-id/activate')
    assert.equal(status, 404)
  })
})

describe('GET /api/embedding/vector-store/stats', () => {
  it('returns store stats', async () => {
    const { status, data } = await json('GET', '/api/embedding/vector-store/stats')
    assert.equal(status, 200)
    // Default config has vectorStore.enabled = true, type = 'sqlite'
    assert.ok('enabled' in data)
  })
})

describe('POST /api/embedding/vector-store/clear', () => {
  it('clears the vector store', async () => {
    const { status, data } = await json('POST', '/api/embedding/vector-store/clear')
    assert.equal(status, 200)
    assert.equal(data.success, true)
  })
})

describe('Config persistence', () => {
  beforeEach(() => clearConfigFile())

  it('persists configs to a JSON file on disk', async () => {
    await json('POST', '/api/embedding/configs', {
      name: 'Persistent',
      model: 'nomic-embed-text',
    })
    const configPath = path.join(getAiDataDir(), 'embedding-config.json')
    assert.ok(fs.existsSync(configPath), 'config file should exist on disk')

    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    assert.equal(raw.configs.length, 1)
    assert.equal(raw.configs[0].name, 'Persistent')
  })
})

describe('Config limit', () => {
  beforeEach(() => clearConfigFile())

  it('rejects creation when max config count is reached', async () => {
    // Create 10 configs (the maximum)
    for (let i = 0; i < 10; i++) {
      const { status } = await json('POST', '/api/embedding/configs', {
        name: `Config ${i}`,
        model: 'nomic-embed-text',
      })
      assert.equal(status, 201, `config ${i} should be created`)
    }

    // 11th should fail
    const { status, data } = await json('POST', '/api/embedding/configs', {
      name: 'Overflow',
      model: 'nomic-embed-text',
    })
    assert.equal(status, 400)
    assert.ok(data.error.includes('10'), 'error should mention the limit')
  })
})
