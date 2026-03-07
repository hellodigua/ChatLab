/**
 * Session index (chat session segmentation) API routes
 *
 * Replaces Electron IPC handlers for session index management:
 *   POST   /api/sessions/:id/session-index/generate           - generate session index
 *   GET    /api/sessions/:id/session-index/has-index           - check if index exists
 *   GET    /api/sessions/:id/session-index/stats               - get session stats
 *   DELETE /api/sessions/:id/session-index/clear               - clear session index
 *   PUT    /api/sessions/:id/session-index/gap-threshold       - update gap threshold
 *   GET    /api/sessions/:id/session-index/sessions            - list all chat sessions
 *   POST   /api/sessions/:id/session-index/summary             - generate single session summary
 *   POST   /api/sessions/:id/session-index/summaries           - batch generate summaries
 *   POST   /api/sessions/:id/session-index/check-can-summarize - check if sessions can be summarized
 *   GET    /api/sessions/:id/session-index/by-time-range       - query sessions by time range
 *   GET    /api/sessions/:id/session-index/recent              - get recent sessions
 *
 * All routes are scoped to a chat database session (:id).
 */

import { Router, type Request } from 'express'
import {
  generateSessions,
  generateIncrementalSessions,
  hasSessionIndex,
  getSessionStats,
  clearSessions,
  updateSessionGapThreshold,
  getSessions,
  saveSessionSummary,
  getSessionSummary,
} from '../services/queries/session-index.js'
import { openReadonlyDatabase } from '../services/db-pool.js'

const router = Router({ mergeParams: true })

/** Extract a single string param (Express 5 params can be string | string[]) */
function param(req: Request, name: string): string {
  const v = req.params[name]
  return Array.isArray(v) ? v[0] : v
}

// ==================== Index management ====================

/**
 * POST /api/sessions/:id/session-index/generate
 * Generate session index using gap-based algorithm.
 * Body: { gapThreshold?: number, incremental?: boolean }
 */
router.post('/:id/session-index/generate', (req, res) => {
  const sessionId = param(req, 'id')
  const { gapThreshold, incremental } = req.body as { gapThreshold?: number; incremental?: boolean }

  try {
    let count: number
    if (incremental) {
      count = generateIncrementalSessions(sessionId, gapThreshold)
    } else {
      count = generateSessions(sessionId, gapThreshold)
    }
    res.json({ success: true, sessionCount: count })
  } catch (error) {
    console.error('[SessionIndex] Failed to generate:', error)
    res.status(500).json({ success: false, error: String(error) })
  }
})

/**
 * GET /api/sessions/:id/session-index/has-index
 * Check whether session index has been generated.
 */
router.get('/:id/session-index/has-index', (req, res) => {
  const sessionId = param(req, 'id')
  try {
    const result = hasSessionIndex(sessionId)
    res.json({ hasIndex: result })
  } catch (error) {
    console.error('[SessionIndex] Failed to check index:', error)
    res.json({ hasIndex: false })
  }
})

/**
 * GET /api/sessions/:id/session-index/stats
 * Get session index statistics.
 */
router.get('/:id/session-index/stats', (req, res) => {
  const sessionId = param(req, 'id')
  try {
    const stats = getSessionStats(sessionId)
    res.json(stats)
  } catch (error) {
    console.error('[SessionIndex] Failed to get stats:', error)
    res.json({ sessionCount: 0, hasIndex: false, gapThreshold: 1800 })
  }
})

/**
 * DELETE /api/sessions/:id/session-index/clear
 * Clear all session index data.
 */
router.delete('/:id/session-index/clear', (req, res) => {
  const sessionId = param(req, 'id')
  try {
    clearSessions(sessionId)
    res.json({ success: true })
  } catch (error) {
    console.error('[SessionIndex] Failed to clear:', error)
    res.status(500).json({ success: false, error: String(error) })
  }
})

/**
 * PUT /api/sessions/:id/session-index/gap-threshold
 * Update the session gap threshold. Body: { gapThreshold: number | null }
 */
router.put('/:id/session-index/gap-threshold', (req, res) => {
  const sessionId = param(req, 'id')
  const { gapThreshold } = req.body as { gapThreshold: number | null }

  try {
    updateSessionGapThreshold(sessionId, gapThreshold)
    res.json({ success: true })
  } catch (error) {
    console.error('[SessionIndex] Failed to update threshold:', error)
    res.status(500).json({ success: false, error: String(error) })
  }
})

// ==================== Session listing ====================

/**
 * GET /api/sessions/:id/session-index/sessions
 * Get all chat sessions (timeline navigation).
 */
router.get('/:id/session-index/sessions', (req, res) => {
  const sessionId = param(req, 'id')
  try {
    const sessions = getSessions(sessionId)
    res.json(sessions)
  } catch (error) {
    console.error('[SessionIndex] Failed to get sessions:', error)
    res.json([])
  }
})

/**
 * GET /api/sessions/:id/session-index/by-time-range
 * Query sessions by time range. Query params: startTs, endTs.
 */
router.get('/:id/session-index/by-time-range', (req, res) => {
  const sessionId = param(req, 'id')
  const startTs = Number(req.query.startTs)
  const endTs = Number(req.query.endTs)

  if (isNaN(startTs) || isNaN(endTs)) {
    res.status(400).json({ error: 'startTs and endTs query params are required (numbers)' })
    return
  }

  try {
    const db = openReadonlyDatabase(sessionId)
    if (!db) {
      res.json([])
      return
    }

    try {
      const sessions = db.prepare(`
        SELECT id, start_ts as startTs, end_ts as endTs, message_count as messageCount, summary
        FROM chat_session
        WHERE start_ts >= ? AND start_ts <= ?
        ORDER BY start_ts DESC
      `).all(startTs, endTs)

      res.json(sessions)
    } finally {
      db.close()
    }
  } catch (error) {
    console.error('[SessionIndex] Failed to query by time range:', error)
    res.json([])
  }
})

/**
 * GET /api/sessions/:id/session-index/recent
 * Get the most recent N sessions. Query param: limit (default 10).
 */
router.get('/:id/session-index/recent', (req, res) => {
  const sessionId = param(req, 'id')
  const limit = Number(req.query.limit) || 10

  try {
    const db = openReadonlyDatabase(sessionId)
    if (!db) {
      res.json([])
      return
    }

    try {
      // Check if table exists
      const tableInfo = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chat_session'").get()
      if (!tableInfo) {
        res.json([])
        return
      }

      const sessions = db.prepare(`
        SELECT id, start_ts as startTs, end_ts as endTs, message_count as messageCount, summary
        FROM chat_session
        ORDER BY start_ts DESC
        LIMIT ?
      `).all(limit)

      res.json(sessions)
    } finally {
      db.close()
    }
  } catch (error) {
    console.error('[SessionIndex] Failed to get recent sessions:', error)
    res.json([])
  }
})

// ==================== Summaries ====================

/**
 * POST /api/sessions/:id/session-index/summary
 * Generate summary for a single chat session.
 * Body: { chatSessionId: number, locale?: string, forceRegenerate?: boolean }
 */
router.post('/:id/session-index/summary', async (req, res) => {
  const sessionId = param(req, 'id')
  const { chatSessionId, locale, forceRegenerate } = req.body as {
    chatSessionId?: number
    locale?: string
    forceRegenerate?: boolean
  }

  if (chatSessionId === undefined || chatSessionId === null) {
    res.status(400).json({ success: false, error: 'chatSessionId is required' })
    return
  }

  try {
    const { generateSessionSummary } = await import('../ai/summary/index.js')
    const result = await generateSessionSummary(
      sessionId,
      chatSessionId,
      locale || 'zh-CN',
      forceRegenerate || false,
    )
    res.json(result)
  } catch (error) {
    console.error('[SessionIndex] Failed to generate summary:', error)
    res.status(500).json({ success: false, error: String(error) })
  }
})

/**
 * POST /api/sessions/:id/session-index/summaries
 * Batch generate summaries for multiple chat sessions.
 * Body: { chatSessionIds: number[], locale?: string }
 */
router.post('/:id/session-index/summaries', async (req, res) => {
  const sessionId = param(req, 'id')
  const { chatSessionIds, locale } = req.body as { chatSessionIds?: number[]; locale?: string }

  if (!chatSessionIds || !Array.isArray(chatSessionIds)) {
    res.status(400).json({ success: false, error: 'chatSessionIds array is required' })
    return
  }

  try {
    const { generateSessionSummaries } = await import('../ai/summary/index.js')
    const result = await generateSessionSummaries(sessionId, chatSessionIds, locale || 'zh-CN')
    res.json(result)
  } catch (error) {
    console.error('[SessionIndex] Failed to batch generate summaries:', error)
    res.status(500).json({ success: 0, failed: chatSessionIds.length, skipped: 0 })
  }
})

/**
 * POST /api/sessions/:id/session-index/check-can-summarize
 * Check which sessions can have summaries generated.
 * Body: { chatSessionIds: number[] }
 */
router.post('/:id/session-index/check-can-summarize', async (req, res) => {
  const sessionId = param(req, 'id')
  const { chatSessionIds } = req.body as { chatSessionIds?: number[] }

  if (!chatSessionIds || !Array.isArray(chatSessionIds)) {
    res.status(400).json({ error: 'chatSessionIds array is required' })
    return
  }

  try {
    const { checkSessionsCanGenerateSummary } = await import('../ai/summary/index.js')
    const results = checkSessionsCanGenerateSummary(sessionId, chatSessionIds)
    // Convert Map to plain object for JSON serialization
    const obj: Record<number, { canGenerate: boolean; reason?: string }> = {}
    for (const [id, result] of results) {
      obj[id] = result
    }
    res.json(obj)
  } catch (error) {
    console.error('[SessionIndex] Failed to check can summarize:', error)
    res.json({})
  }
})

export default router
