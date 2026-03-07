/**
 * AI conversation CRUD routes (server-side)
 *
 * GET    /api/ai-conversations/:sessionId           — list conversations for session
 * POST   /api/ai-conversations/:sessionId           — create new conversation
 * GET    /api/ai-conversations/detail/:conversationId  — get single conversation
 * PUT    /api/ai-conversations/:conversationId/title   — update title
 * DELETE /api/ai-conversations/:conversationId          — delete conversation
 * GET    /api/ai-conversations/:conversationId/messages — get messages
 * POST   /api/ai-conversations/:conversationId/messages — add message
 * DELETE /api/ai-conversations/messages/:messageId      — delete message
 * GET    /api/ai-conversations/counts/by-session        — conversation counts by session
 */

import { Router } from 'express'
import type { Request, Response } from 'express'
import {
  createConversation,
  getConversations,
  getConversation,
  updateConversationTitle,
  deleteConversation,
  getMessages,
  addMessage,
  deleteMessage,
  getConversationCountsBySession,
} from '../ai/conversations.js'

const router = Router()

/** Extract a single string param (Express 5 params can be string | string[]) */
function param(req: Request, name: string): string {
  const v = req.params[name]
  return Array.isArray(v) ? v[0] : v
}

/**
 * GET /api/ai-conversations/counts/by-session
 * Returns { [sessionId]: count } for all sessions
 */
router.get('/counts/by-session', (_req: Request, res: Response) => {
  const counts = getConversationCountsBySession()
  const obj: Record<string, number> = {}
  for (const [k, v] of counts) {
    obj[k] = v
  }
  res.json(obj)
})

/**
 * GET /api/ai-conversations/detail/:conversationId
 * Get a single conversation by ID
 */
router.get('/detail/:conversationId', (req: Request, res: Response) => {
  const conversation = getConversation(param(req, 'conversationId'))
  if (!conversation) {
    res.status(404).json({ error: 'Conversation not found' })
    return
  }
  res.json(conversation)
})

/**
 * GET /api/ai-conversations/:sessionId
 * List all conversations for a session
 */
router.get('/:sessionId', (req: Request, res: Response) => {
  const conversations = getConversations(param(req, 'sessionId'))
  res.json(conversations)
})

/**
 * POST /api/ai-conversations/:sessionId
 * Create a new conversation
 * Body: { title?: string }
 */
router.post('/:sessionId', (req: Request, res: Response) => {
  const sessionId = param(req, 'sessionId')
  const { title } = req.body || {}
  const conversation = createConversation(sessionId, title)
  res.status(201).json(conversation)
})

/**
 * PUT /api/ai-conversations/:conversationId/title
 * Update conversation title
 * Body: { title: string }
 */
router.put('/:conversationId/title', (req: Request, res: Response) => {
  const { title } = req.body
  if (!title || typeof title !== 'string') {
    res.status(400).json({ error: 'title is required' })
    return
  }
  const success = updateConversationTitle(param(req, 'conversationId'), title)
  if (!success) {
    res.status(404).json({ error: 'Conversation not found' })
    return
  }
  res.json({ success: true })
})

/**
 * DELETE /api/ai-conversations/:conversationId
 * Delete a conversation and all its messages
 */
router.delete('/:conversationId', (req: Request, res: Response) => {
  const success = deleteConversation(param(req, 'conversationId'))
  if (!success) {
    res.status(404).json({ error: 'Conversation not found' })
    return
  }
  res.json({ success: true })
})

/**
 * GET /api/ai-conversations/:conversationId/messages
 * Get all messages for a conversation
 */
router.get('/:conversationId/messages', (req: Request, res: Response) => {
  const messages = getMessages(param(req, 'conversationId'))
  res.json(messages)
})

/**
 * POST /api/ai-conversations/:conversationId/messages
 * Add a message to a conversation
 * Body: { role: 'user' | 'assistant', content: string, dataKeywords?: string[], dataMessageCount?: number, contentBlocks?: ContentBlock[] }
 */
router.post('/:conversationId/messages', (req: Request, res: Response) => {
  const { role, content, dataKeywords, dataMessageCount, contentBlocks } = req.body
  if (!role || !content) {
    res.status(400).json({ error: 'role and content are required' })
    return
  }
  if (role !== 'user' && role !== 'assistant') {
    res.status(400).json({ error: 'role must be "user" or "assistant"' })
    return
  }
  const message = addMessage(param(req, 'conversationId'), role, content, dataKeywords, dataMessageCount, contentBlocks)
  res.status(201).json(message)
})

/**
 * DELETE /api/ai-conversations/messages/:messageId
 * Delete a single message
 */
router.delete('/messages/:messageId', (req: Request, res: Response) => {
  const success = deleteMessage(param(req, 'messageId'))
  if (!success) {
    res.status(404).json({ error: 'Message not found' })
    return
  }
  res.json({ success: true })
})

export default router
