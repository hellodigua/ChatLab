/**
 * Embedding configuration API routes (US-012)
 *
 * Endpoints:
 *   GET    /api/embedding/configs              - List all configs (API keys masked)
 *   GET    /api/embedding/configs/:id          - Get single config (API key masked)
 *   POST   /api/embedding/configs              - Create a new config
 *   PUT    /api/embedding/configs/:id          - Update an existing config
 *   DELETE /api/embedding/configs/:id          - Delete a config
 *   PUT    /api/embedding/configs/:id/activate - Set config as active
 *   POST   /api/embedding/validate             - Validate an embedding config
 *   GET    /api/embedding/vector-store/stats   - Get vector store statistics
 *   POST   /api/embedding/vector-store/clear   - Clear the vector store
 */

import { Router } from 'express'
import {
  loadEmbeddingConfigStore,
  getAllEmbeddingConfigs,
  getEmbeddingConfigById,
  addEmbeddingConfig,
  updateEmbeddingConfig,
  deleteEmbeddingConfig,
  setActiveEmbeddingConfig,
  validateEmbeddingConfig,
  getVectorStoreStats,
  resetVectorStore,
} from '../ai/rag/index.js'
import type { EmbeddingServiceConfigDisplay } from '../ai/rag/types.js'

const router = Router()

/**
 * Mask an API key for safe display (show first 4 and last 4 chars).
 */
function maskApiKey(key?: string): string {
  if (!key) return ''
  if (key.length <= 8) return '****'
  return `${key.slice(0, 4)}****${key.slice(-4)}`
}

// GET /api/embedding/configs
router.get('/configs', (_req, res) => {
  const store = loadEmbeddingConfigStore()
  const configs: EmbeddingServiceConfigDisplay[] = store.configs.map((c) => ({
    id: c.id,
    name: c.name,
    apiSource: c.apiSource,
    model: c.model,
    baseUrl: c.baseUrl,
    apiKey: maskApiKey(c.apiKey),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }))
  res.json({
    configs,
    activeConfigId: store.activeConfigId,
    enabled: store.enabled,
  })
})

// GET /api/embedding/configs/:id
router.get('/configs/:id', (req, res) => {
  const config = getEmbeddingConfigById(req.params.id)
  if (!config) {
    res.status(404).json({ error: 'Config not found' })
    return
  }
  const display: EmbeddingServiceConfigDisplay = {
    id: config.id,
    name: config.name,
    apiSource: config.apiSource,
    model: config.model,
    baseUrl: config.baseUrl,
    apiKey: maskApiKey(config.apiKey),
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  }
  res.json(display)
})

// POST /api/embedding/configs
router.post('/configs', (req, res) => {
  const { name, apiSource, model, baseUrl, apiKey } = req.body

  if (!name || typeof name !== 'string') {
    res.status(400).json({ error: 'name is required' })
    return
  }
  if (!model || typeof model !== 'string') {
    res.status(400).json({ error: 'model is required' })
    return
  }

  const validSources = ['reuse_llm', 'custom']
  const source = apiSource || 'reuse_llm'
  if (!validSources.includes(source)) {
    res.status(400).json({ error: `Invalid apiSource: ${apiSource}` })
    return
  }

  if (source === 'custom' && !baseUrl) {
    res.status(400).json({ error: 'baseUrl is required for custom apiSource' })
    return
  }

  const result = addEmbeddingConfig({
    name,
    apiSource: source,
    model,
    baseUrl,
    apiKey,
  })

  if (!result.success) {
    res.status(400).json({ error: result.error })
    return
  }

  res.status(201).json(result.config)
})

// PUT /api/embedding/configs/:id
router.put('/configs/:id', (req, res) => {
  const { name, apiSource, model, baseUrl, apiKey } = req.body

  const updates: Record<string, unknown> = {}
  if (name !== undefined) updates.name = name
  if (apiSource !== undefined) updates.apiSource = apiSource
  if (model !== undefined) updates.model = model
  if (baseUrl !== undefined) updates.baseUrl = baseUrl
  if (apiKey !== undefined) updates.apiKey = apiKey

  const result = updateEmbeddingConfig(req.params.id, updates)

  if (!result.success) {
    res.status(404).json({ error: result.error })
    return
  }

  res.json({ success: true })
})

// DELETE /api/embedding/configs/:id
router.delete('/configs/:id', (req, res) => {
  const result = deleteEmbeddingConfig(req.params.id)

  if (!result.success) {
    res.status(404).json({ error: result.error })
    return
  }

  res.json({ success: true })
})

// PUT /api/embedding/configs/:id/activate
router.put('/configs/:id/activate', (req, res) => {
  const result = setActiveEmbeddingConfig(req.params.id)

  if (!result.success) {
    res.status(404).json({ error: result.error })
    return
  }

  res.json({ success: true })
})

// POST /api/embedding/validate
router.post('/validate', async (req, res) => {
  const { apiSource, model, baseUrl, apiKey } = req.body

  if (!model) {
    res.status(400).json({ error: 'model is required' })
    return
  }

  const result = await validateEmbeddingConfig({
    enabled: true,
    provider: 'api',
    apiSource: apiSource || 'reuse_llm',
    model,
    baseUrl,
    apiKey,
  })

  res.json(result)
})

// GET /api/embedding/vector-store/stats
router.get('/vector-store/stats', async (_req, res) => {
  const stats = await getVectorStoreStats()
  res.json(stats)
})

// POST /api/embedding/vector-store/clear
router.post('/vector-store/clear', async (_req, res) => {
  await resetVectorStore()
  res.json({ success: true })
})

export default router
