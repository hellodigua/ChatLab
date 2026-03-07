/**
 * AI conversation history management module (server-side)
 * Manages persistent storage of AI conversations.
 * Ported from electron/main/ai/conversations.ts — no Electron imports.
 */

import Database from 'better-sqlite3'
import * as path from 'path'
import { getAiDataDir, ensureDir } from '../paths.js'

// AI database instance
let AI_DB: Database.Database | null = null

function getAiDbDir(): string {
  return getAiDataDir()
}

function ensureAiDbDir(): void {
  ensureDir(getAiDbDir())
}

/**
 * Get the AI database instance (singleton).
 */
function getAiDb(): Database.Database {
  if (AI_DB) return AI_DB

  ensureAiDbDir()
  const dbPath = path.join(getAiDbDir(), 'conversations.db')
  AI_DB = new Database(dbPath)
  AI_DB.pragma('journal_mode = WAL')

  AI_DB.exec(`
    CREATE TABLE IF NOT EXISTS ai_conversation (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      title TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_message (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      data_keywords TEXT,
      data_message_count INTEGER,
      content_blocks TEXT,
      FOREIGN KEY(conversation_id) REFERENCES ai_conversation(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_ai_conversation_session ON ai_conversation(session_id);
    CREATE INDEX IF NOT EXISTS idx_ai_message_conversation ON ai_message(conversation_id);
  `)

  migrateAiDatabase(AI_DB)
  return AI_DB
}

function migrateAiDatabase(db: Database.Database): void {
  try {
    const tableInfo = db.pragma('table_info(ai_message)') as Array<{ name: string }>
    const columnNames = tableInfo.map((col) => col.name)

    if (!columnNames.includes('content_blocks')) {
      db.exec('ALTER TABLE ai_message ADD COLUMN content_blocks TEXT')
      console.log('[AI DB Migration] Adding content_blocks column')
    }
  } catch (error) {
    console.error('[AI DB Migration] Migration failed:', error)
  }
}

/**
 * Close the AI database connection.
 */
export function closeAiDatabase(): void {
  if (AI_DB) {
    AI_DB.close()
    AI_DB = null
  }
}

/**
 * Reset AI database (for testing). Closes the connection so next call creates a new one.
 */
export function _resetAiDatabase(): void {
  closeAiDatabase()
}

// ==================== Type definitions ====================

export interface AIConversation {
  id: string
  sessionId: string
  title: string | null
  createdAt: number
  updatedAt: number
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'think'; tag: string; text: string; durationMs?: number }
  | {
      type: 'tool'
      tool: {
        name: string
        displayName: string
        status: 'running' | 'done' | 'error'
        params?: Record<string, unknown>
      }
    }

export interface AIMessage {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  dataKeywords?: string[]
  dataMessageCount?: number
  contentBlocks?: ContentBlock[]
}

// ==================== Conversation management ====================

export function createConversation(sessionId: string, title?: string): AIConversation {
  const db = getAiDb()
  const now = Math.floor(Date.now() / 1000)
  const id = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  db.prepare(`
    INSERT INTO ai_conversation (id, session_id, title, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, sessionId, title || null, now, now)

  return { id, sessionId, title: title || null, createdAt: now, updatedAt: now }
}

export function getConversationCountsBySession(): Map<string, number> {
  const result = new Map<string, number>()
  try {
    const db = getAiDb()
    const rows = db
      .prepare('SELECT session_id, COUNT(*) as count FROM ai_conversation GROUP BY session_id')
      .all() as Array<{ session_id: string; count: number }>
    for (const row of rows) {
      result.set(row.session_id, row.count)
    }
  } catch {
    // AI database may not be initialized yet
  }
  return result
}

export function getConversations(sessionId: string): AIConversation[] {
  const db = getAiDb()
  return db
    .prepare(`
      SELECT id, session_id as sessionId, title, created_at as createdAt, updated_at as updatedAt
      FROM ai_conversation WHERE session_id = ? ORDER BY updated_at DESC
    `)
    .all(sessionId) as AIConversation[]
}

export function getConversation(conversationId: string): AIConversation | null {
  const db = getAiDb()
  const row = db
    .prepare(`
      SELECT id, session_id as sessionId, title, created_at as createdAt, updated_at as updatedAt
      FROM ai_conversation WHERE id = ?
    `)
    .get(conversationId) as AIConversation | undefined
  return row || null
}

export function updateConversationTitle(conversationId: string, title: string): boolean {
  const db = getAiDb()
  const now = Math.floor(Date.now() / 1000)
  const result = db
    .prepare('UPDATE ai_conversation SET title = ?, updated_at = ? WHERE id = ?')
    .run(title, now, conversationId)
  return result.changes > 0
}

export function deleteConversation(conversationId: string): boolean {
  const db = getAiDb()
  db.prepare('DELETE FROM ai_message WHERE conversation_id = ?').run(conversationId)
  const result = db.prepare('DELETE FROM ai_conversation WHERE id = ?').run(conversationId)
  return result.changes > 0
}

// ==================== Message management ====================

export function addMessage(
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  dataKeywords?: string[],
  dataMessageCount?: number,
  contentBlocks?: ContentBlock[],
): AIMessage {
  const db = getAiDb()
  const now = Math.floor(Date.now() / 1000)
  const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  db.prepare(`
    INSERT INTO ai_message (id, conversation_id, role, content, timestamp, data_keywords, data_message_count, content_blocks)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    conversationId,
    role,
    content,
    now,
    dataKeywords ? JSON.stringify(dataKeywords) : null,
    dataMessageCount ?? null,
    contentBlocks ? JSON.stringify(contentBlocks) : null,
  )

  db.prepare('UPDATE ai_conversation SET updated_at = ? WHERE id = ?').run(now, conversationId)

  return {
    id,
    conversationId,
    role,
    content,
    timestamp: now,
    dataKeywords,
    dataMessageCount,
    contentBlocks,
  }
}

export function getMessages(conversationId: string): AIMessage[] {
  const db = getAiDb()

  const rows = db
    .prepare(`
      SELECT id, conversation_id as conversationId, role, content, timestamp,
             data_keywords as dataKeywords, data_message_count as dataMessageCount,
             content_blocks as contentBlocks
      FROM ai_message WHERE conversation_id = ? ORDER BY timestamp ASC
    `)
    .all(conversationId) as Array<{
    id: string
    conversationId: string
    role: string
    content: string
    timestamp: number
    dataKeywords: string | null
    dataMessageCount: number | null
    contentBlocks: string | null
  }>

  return rows.map((row) => ({
    id: row.id,
    conversationId: row.conversationId,
    role: row.role as 'user' | 'assistant',
    content: row.content,
    timestamp: row.timestamp,
    dataKeywords: row.dataKeywords ? JSON.parse(row.dataKeywords) : undefined,
    dataMessageCount: row.dataMessageCount ?? undefined,
    contentBlocks: row.contentBlocks ? JSON.parse(row.contentBlocks) : undefined,
  }))
}

export function deleteMessage(messageId: string): boolean {
  const db = getAiDb()
  const result = db.prepare('DELETE FROM ai_message WHERE id = ?').run(messageId)
  return result.changes > 0
}

// ==================== Agent helpers ====================

export function getHistoryForAgent(
  conversationId: string,
  maxMessages?: number,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const messages = getMessages(conversationId)
  const filtered = messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content?.trim())
    .map((m) => ({ role: m.role, content: m.content }))

  if (maxMessages && filtered.length > maxMessages) {
    return filtered.slice(-maxMessages)
  }
  return filtered
}
