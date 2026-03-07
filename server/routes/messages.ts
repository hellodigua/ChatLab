/**
 * Message query API routes (US-008)
 *
 * Replaces the Electron IPC handlers for message querying:
 *   POST   /api/sessions/:id/messages/search              - keyword search
 *   GET    /api/sessions/:id/messages/context/:messageId   - message context
 *   GET    /api/sessions/:id/messages/recent               - recent messages
 *   GET    /api/sessions/:id/messages/all-recent            - all recent (incl. system)
 *   POST   /api/sessions/:id/messages/conversation-between - two member conversation
 *   GET    /api/sessions/:id/messages/before/:beforeId     - infinite scroll up
 *   GET    /api/sessions/:id/messages/after/:afterId       - infinite scroll down
 *   POST   /api/sessions/:id/messages/filter               - filter with context
 *   POST   /api/sessions/:id/messages/multi-sessions       - multi session messages
 */

import { Router } from 'express'
import {
  searchMessages,
  getMessageContext,
  getRecentMessages,
  getAllRecentMessages,
  getConversationBetween,
  getMessagesBefore,
  getMessagesAfter,
} from '../services/queries'
import {
  filterMessagesWithContext,
  getMultipleSessionsMessages,
} from '../services/queries/filter'

const router = Router({ mergeParams: true })

/**
 * POST /api/sessions/:id/messages/search - keyword search
 *
 * Body: { keywords: string[], filter?: TimeFilter, limit?, offset?, senderId? }
 * Returns: { messages, total }
 */
router.post('/:id/messages/search', (req, res) => {
  try {
    const sessionId = req.params.id
    const { keywords, filter, limit, offset, senderId } = req.body

    if (!keywords || !Array.isArray(keywords)) {
      res.status(400).json({ error: 'keywords must be an array' })
      return
    }

    const result = searchMessages(
      sessionId,
      keywords,
      filter,
      limit ?? 20,
      offset ?? 0,
      senderId,
    )
    res.json(result)
  } catch (error) {
    console.error('[API] Failed to search messages:', error)
    res.status(500).json({ error: 'Failed to search messages' })
  }
})

/**
 * GET /api/sessions/:id/messages/context/:messageId - message context
 *
 * Query params: contextSize (default 20)
 * Returns: MessageResult[]
 */
router.get('/:id/messages/context/:messageId', (req, res) => {
  try {
    const sessionId = req.params.id
    const messageId = parseInt(req.params.messageId)

    if (isNaN(messageId)) {
      res.status(400).json({ error: 'Invalid messageId' })
      return
    }

    const contextSize = parseInt(req.query.contextSize as string) || 20
    const messages = getMessageContext(sessionId, messageId, contextSize)
    res.json(messages)
  } catch (error) {
    console.error('[API] Failed to get message context:', error)
    res.status(500).json({ error: 'Failed to get message context' })
  }
})

/**
 * GET /api/sessions/:id/messages/recent - recent messages (text only, no system)
 *
 * Query params: limit (default 100), startTs, endTs
 * Returns: { messages, total }
 */
router.get('/:id/messages/recent', (req, res) => {
  try {
    const sessionId = req.params.id
    const limit = parseInt(req.query.limit as string) || 100
    const filter = buildTimeFilterFromQuery(req.query)

    const result = getRecentMessages(sessionId, filter, limit)
    res.json(result)
  } catch (error) {
    console.error('[API] Failed to get recent messages:', error)
    res.status(500).json({ error: 'Failed to get recent messages' })
  }
})

/**
 * GET /api/sessions/:id/messages/all-recent - all recent messages (including system/non-text)
 *
 * Query params: limit (default 100), startTs, endTs
 * Returns: { messages, total }
 */
router.get('/:id/messages/all-recent', (req, res) => {
  try {
    const sessionId = req.params.id
    const limit = parseInt(req.query.limit as string) || 100
    const filter = buildTimeFilterFromQuery(req.query)

    const result = getAllRecentMessages(sessionId, filter, limit)
    res.json(result)
  } catch (error) {
    console.error('[API] Failed to get all recent messages:', error)
    res.status(500).json({ error: 'Failed to get all recent messages' })
  }
})

/**
 * POST /api/sessions/:id/messages/conversation-between - conversation between two members
 *
 * Body: { memberId1: number, memberId2: number, filter?: TimeFilter, limit? }
 * Returns: { messages, total, member1Name, member2Name }
 */
router.post('/:id/messages/conversation-between', (req, res) => {
  try {
    const sessionId = req.params.id
    const { memberId1, memberId2, filter, limit } = req.body

    if (typeof memberId1 !== 'number' || typeof memberId2 !== 'number') {
      res.status(400).json({ error: 'memberId1 and memberId2 must be numbers' })
      return
    }

    const result = getConversationBetween(
      sessionId,
      memberId1,
      memberId2,
      filter,
      limit ?? 100,
    )
    res.json(result)
  } catch (error) {
    console.error('[API] Failed to get conversation:', error)
    res.status(500).json({ error: 'Failed to get conversation' })
  }
})

/**
 * GET /api/sessions/:id/messages/before/:beforeId - infinite scroll up
 *
 * Query params: limit (default 50), senderId, keywords (comma-separated), startTs, endTs
 * Returns: { messages, hasMore }
 */
router.get('/:id/messages/before/:beforeId', (req, res) => {
  try {
    const sessionId = req.params.id
    const beforeId = parseInt(req.params.beforeId)

    if (isNaN(beforeId)) {
      res.status(400).json({ error: 'Invalid beforeId' })
      return
    }

    const limit = parseInt(req.query.limit as string) || 50
    const filter = buildTimeFilterFromQuery(req.query)
    const senderId = req.query.senderId
      ? parseInt(req.query.senderId as string)
      : undefined
    const keywords = req.query.keywords
      ? (req.query.keywords as string).split(',')
      : undefined

    const result = getMessagesBefore(
      sessionId,
      beforeId,
      limit,
      filter,
      senderId,
      keywords,
    )
    res.json(result)
  } catch (error) {
    console.error('[API] Failed to get messages before:', error)
    res.status(500).json({ error: 'Failed to get messages before' })
  }
})

/**
 * GET /api/sessions/:id/messages/after/:afterId - infinite scroll down
 *
 * Query params: limit (default 50), senderId, keywords (comma-separated), startTs, endTs
 * Returns: { messages, hasMore }
 */
router.get('/:id/messages/after/:afterId', (req, res) => {
  try {
    const sessionId = req.params.id
    const afterId = parseInt(req.params.afterId)

    if (isNaN(afterId)) {
      res.status(400).json({ error: 'Invalid afterId' })
      return
    }

    const limit = parseInt(req.query.limit as string) || 50
    const filter = buildTimeFilterFromQuery(req.query)
    const senderId = req.query.senderId
      ? parseInt(req.query.senderId as string)
      : undefined
    const keywords = req.query.keywords
      ? (req.query.keywords as string).split(',')
      : undefined

    const result = getMessagesAfter(
      sessionId,
      afterId,
      limit,
      filter,
      senderId,
      keywords,
    )
    res.json(result)
  } catch (error) {
    console.error('[API] Failed to get messages after:', error)
    res.status(500).json({ error: 'Failed to get messages after' })
  }
})

/**
 * POST /api/sessions/:id/messages/filter - filter messages with context
 *
 * Body: { keywords?, timeFilter?, senderIds?, contextSize?, page?, pageSize? }
 * Returns: FilterResultWithPagination { blocks, stats, pagination }
 */
router.post('/:id/messages/filter', (req, res) => {
  try {
    const sessionId = req.params.id
    const {
      keywords,
      timeFilter,
      senderIds,
      contextSize,
      page,
      pageSize,
    } = req.body

    const result = filterMessagesWithContext(
      sessionId,
      keywords,
      timeFilter,
      senderIds,
      contextSize ?? 10,
      page ?? 1,
      pageSize ?? 50,
    )
    res.json(result)
  } catch (error) {
    console.error('[API] Failed to filter messages:', error)
    res.status(500).json({ error: 'Failed to filter messages' })
  }
})

/**
 * POST /api/sessions/:id/messages/multi-sessions - messages from multiple chat sessions
 *
 * Body: { chatSessionIds: number[], page?, pageSize? }
 * Returns: FilterResultWithPagination
 */
router.post('/:id/messages/multi-sessions', (req, res) => {
  try {
    const sessionId = req.params.id
    const { chatSessionIds, page, pageSize } = req.body

    if (!chatSessionIds || !Array.isArray(chatSessionIds)) {
      res.status(400).json({ error: 'chatSessionIds must be an array' })
      return
    }

    const result = getMultipleSessionsMessages(
      sessionId,
      chatSessionIds,
      page ?? 1,
      pageSize ?? 50,
    )
    res.json(result)
  } catch (error) {
    console.error('[API] Failed to get multi-session messages:', error)
    res.status(500).json({ error: 'Failed to get multi-session messages' })
  }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a TimeFilter from query string params (startTs, endTs).
 * Returns undefined if neither param is present.
 */
function buildTimeFilterFromQuery(
  query: Record<string, any>,
): { startTs: number; endTs: number } | undefined {
  const startTs = query.startTs ? parseInt(query.startTs as string) : undefined
  const endTs = query.endTs ? parseInt(query.endTs as string) : undefined
  if (startTs !== undefined && endTs !== undefined) {
    return { startTs, endTs }
  }
  return undefined
}

export default router
