/**
 * Chat session API routes
 *
 * Replaces the Electron IPC handlers for session management:
 *   GET    /api/sessions            - list all sessions
 *   GET    /api/sessions/:id        - get single session
 *   DELETE /api/sessions/:id        - delete session
 *   PATCH  /api/sessions/:id        - rename session / update ownerId
 *   GET    /api/sessions/:id/years  - available years
 *   GET    /api/sessions/:id/time-range - time range
 *   GET    /api/sessions/:id/schema - database schema
 *   POST   /api/sessions/:id/sql    - execute SQL query
 */

import { Router } from 'express'
import {
  getAllSessions,
  getSession,
  getAvailableYears,
  getTimeRange,
  getSchema,
  executeRawSQL,
  closeDatabase,
} from '../services/queries'
import {
  deleteSession,
  renameSession,
  updateSessionOwnerId,
} from '../database/core'

const router = Router()

/**
 * GET /api/sessions - list all analysis sessions
 */
router.get('/', (_req, res) => {
  try {
    const sessions = getAllSessions()
    res.json(sessions)
  } catch (error) {
    console.error('[API] Failed to get sessions:', error)
    res.status(500).json({ error: 'Failed to get sessions' })
  }
})

/**
 * GET /api/sessions/:id - get single session
 */
router.get('/:id', (req, res) => {
  try {
    const session = getSession(req.params.id)
    if (!session) {
      res.status(404).json({ error: 'Session not found' })
      return
    }
    res.json(session)
  } catch (error) {
    console.error('[API] Failed to get session:', error)
    res.status(500).json({ error: 'Failed to get session' })
  }
})

/**
 * DELETE /api/sessions/:id - delete session
 */
router.delete('/:id', (req, res) => {
  try {
    closeDatabase(req.params.id)
    const success = deleteSession(req.params.id)
    res.json({ success })
  } catch (error) {
    console.error('[API] Failed to delete session:', error)
    res.status(500).json({ error: 'Failed to delete session', success: false })
  }
})

/**
 * PATCH /api/sessions/:id - rename session and/or update ownerId
 */
router.patch('/:id', (req, res) => {
  try {
    const { name, ownerId } = req.body
    const sessionId = req.params.id

    closeDatabase(sessionId)

    let success = true

    if (name !== undefined) {
      success = renameSession(sessionId, name)
    }

    if (success && ownerId !== undefined) {
      success = updateSessionOwnerId(sessionId, ownerId)
    }

    res.json({ success })
  } catch (error) {
    console.error('[API] Failed to update session:', error)
    res.status(500).json({ error: 'Failed to update session', success: false })
  }
})

/**
 * GET /api/sessions/:id/years - available years in session data
 */
router.get('/:id/years', (req, res) => {
  try {
    const years = getAvailableYears(req.params.id)
    res.json(years)
  } catch (error) {
    console.error('[API] Failed to get available years:', error)
    res.status(500).json({ error: 'Failed to get available years' })
  }
})

/**
 * GET /api/sessions/:id/time-range - time range of messages
 */
router.get('/:id/time-range', (req, res) => {
  try {
    const range = getTimeRange(req.params.id)
    if (!range) {
      res.status(404).json({ error: 'No messages found' })
      return
    }
    res.json(range)
  } catch (error) {
    console.error('[API] Failed to get time range:', error)
    res.status(500).json({ error: 'Failed to get time range' })
  }
})

/**
 * GET /api/sessions/:id/schema - database schema
 */
router.get('/:id/schema', (req, res) => {
  try {
    const schema = getSchema(req.params.id)
    res.json(schema)
  } catch (error) {
    console.error('[API] Failed to get schema:', error)
    res.status(500).json({ error: 'Failed to get schema' })
  }
})

/**
 * POST /api/sessions/:id/sql - execute SQL query
 */
router.post('/:id/sql', (req, res) => {
  try {
    const { sql } = req.body
    if (!sql || typeof sql !== 'string') {
      res.status(400).json({ error: 'Missing or invalid sql parameter' })
      return
    }
    const result = executeRawSQL(req.params.id, sql)
    res.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SQL execution failed'
    res.status(400).json({ error: message })
  }
})

export default router
