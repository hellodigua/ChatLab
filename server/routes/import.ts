/**
 * Chat import API routes
 *
 * Replaces the Electron IPC handlers for file import:
 *   POST /api/import                          - upload and import a chat file
 *   POST /api/import/detect-format            - detect file format from uploaded file
 *   POST /api/import/scan-multi-chat          - scan multi-chat file
 *   POST /api/import/with-options             - import with format options
 *   POST /api/sessions/:id/incremental-import - incremental import
 *   POST /api/sessions/:id/analyze-incremental - analyze incremental import
 */

import { Router } from 'express'
import multer from 'multer'
import * as fs from 'fs'
import * as path from 'path'
import { getTempDir, ensureDir } from '../paths'
import {
  detectFormat,
  diagnoseFormat,
  scanMultiChatFile,
  streamParseFile,
  type ParsedMeta,
  type ParsedMember,
  type ParsedMessage,
} from '../parser'
import {
  generateSessionId,
  getDbPath,
  createDatabaseWithoutIndexes,
  createIndexes,
  generateMessageKey,
} from '../services/import'
import { closeDatabase } from '../services/queries'
import Database from 'better-sqlite3'

// ---------------------------------------------------------------------------
// Multer setup — store uploads in the app temp directory
// ---------------------------------------------------------------------------

function getUploadDir(): string {
  const dir = path.join(getTempDir(), 'uploads')
  ensureDir(dir)
  return dir
}

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, getUploadDir())
  },
  filename(_req, _file, cb) {
    const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const ext = path.extname(_file.originalname)
    cb(null, `upload_${unique}${ext}`)
  },
})

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 GB
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Remove an uploaded temp file (best-effort). */
function cleanupUpload(filePath: string | undefined): void {
  if (!filePath) return
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = Router()

/**
 * POST /api/import/detect-format
 * Detect the format of an uploaded chat file.
 */
router.post('/detect-format', upload.single('file'), (req, res) => {
  const filePath = req.file?.path
  try {
    if (!filePath) {
      res.status(400).json({ error: 'No file uploaded' })
      return
    }

    const formatFeature = detectFormat(filePath)
    if (!formatFeature) {
      const diagnosis = diagnoseFormat(filePath)
      res.json({
        detected: false,
        diagnosis: {
          suggestion: diagnosis.suggestion,
          partialMatches: diagnosis.partialMatches.map((m) => ({
            formatName: m.formatName,
            missingFields: m.missingFields,
          })),
        },
      })
      return
    }

    res.json({
      detected: true,
      format: {
        id: formatFeature.id,
        name: formatFeature.name,
        platform: formatFeature.platform,
        multiChat: formatFeature.multiChat || false,
      },
    })
  } catch (error) {
    console.error('[API] detect-format error:', error)
    res.status(500).json({ error: 'Failed to detect format' })
  } finally {
    cleanupUpload(filePath)
  }
})

/**
 * POST /api/import/scan-multi-chat
 * Scan a multi-chat file and return the list of chats.
 */
router.post('/scan-multi-chat', upload.single('file'), async (req, res) => {
  const filePath = req.file?.path
  try {
    if (!filePath) {
      res.status(400).json({ error: 'No file uploaded' })
      return
    }

    const chats = await scanMultiChatFile(filePath)
    res.json({ success: true, chats })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[API] scan-multi-chat error:', error)
    res.status(400).json({ success: false, error: message, chats: [] })
  } finally {
    cleanupUpload(filePath)
  }
})

/**
 * POST /api/import
 * Upload and import a chat file. Returns { success, sessionId }.
 */
router.post('/', upload.single('file'), async (req, res) => {
  const filePath = req.file?.path
  try {
    if (!filePath) {
      res.status(400).json({ success: false, error: 'No file uploaded' })
      return
    }

    const result = await importFile(filePath)
    res.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[API] import error:', error)
    res.status(500).json({ success: false, error: message })
  } finally {
    cleanupUpload(filePath)
  }
})

/**
 * POST /api/import/with-options
 * Import with explicit format options (e.g. chatIndex for multi-chat formats).
 */
router.post('/with-options', upload.single('file'), async (req, res) => {
  const filePath = req.file?.path
  try {
    if (!filePath) {
      res.status(400).json({ success: false, error: 'No file uploaded' })
      return
    }

    // formatOptions come as a JSON string in the multipart body
    let formatOptions: Record<string, unknown> = {}
    if (req.body.formatOptions) {
      try {
        formatOptions = JSON.parse(req.body.formatOptions)
      } catch {
        res.status(400).json({ success: false, error: 'Invalid formatOptions JSON' })
        return
      }
    }

    const result = await importFile(filePath, formatOptions)
    res.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[API] import-with-options error:', error)
    res.status(500).json({ success: false, error: message })
  } finally {
    cleanupUpload(filePath)
  }
})

// ---------------------------------------------------------------------------
// Session-scoped incremental routes
// (Mounted under /api/sessions/:id by the parent router)
// ---------------------------------------------------------------------------

export const incrementalRouter = Router({ mergeParams: true })

/**
 * POST /api/sessions/:id/analyze-incremental
 * Analyze how many new messages an incremental import would add.
 */
incrementalRouter.post('/analyze-incremental', upload.single('file'), async (req, res) => {
  const filePath = req.file?.path
  const sessionId = req.params.id as string
  try {
    if (!filePath) {
      res.status(400).json({ error: 'No file uploaded' })
      return
    }

    const result = await analyzeIncremental(sessionId, filePath)
    res.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[API] analyze-incremental error:', error)
    res.status(500).json({ error: message })
  } finally {
    cleanupUpload(filePath)
  }
})

/**
 * POST /api/sessions/:id/incremental-import
 * Execute an incremental import into an existing session.
 */
incrementalRouter.post('/incremental-import', upload.single('file'), async (req, res) => {
  const filePath = req.file?.path
  const sessionId = req.params.id as string
  try {
    if (!filePath) {
      res.status(400).json({ success: false, error: 'No file uploaded' })
      return
    }

    const result = await runIncrementalImport(sessionId, filePath)
    res.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[API] incremental-import error:', error)
    res.status(500).json({ success: false, error: message })
  } finally {
    cleanupUpload(filePath)
  }
})

// ---------------------------------------------------------------------------
// Core import logic (shared by /api/import and /api/import/with-options)
// ---------------------------------------------------------------------------

interface ImportResult {
  success: boolean
  sessionId?: string
  error?: string
}

async function importFile(
  filePath: string,
  formatOptions?: Record<string, unknown>,
): Promise<ImportResult> {
  const formatFeature = detectFormat(filePath)
  if (!formatFeature) {
    const diagnosis = diagnoseFormat(filePath)
    return {
      success: false,
      error: 'error.unrecognized_format',
    }
  }

  const sessionId = generateSessionId()
  const db = createDatabaseWithoutIndexes(sessionId)

  const insertMeta = db.prepare(`
    INSERT INTO meta (name, platform, type, imported_at, group_id, group_avatar, owner_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  const insertMember = db.prepare(`
    INSERT OR IGNORE INTO member (platform_id, account_name, group_nickname, avatar, roles)
    VALUES (?, ?, ?, ?, ?)
  `)
  const getMemberId = db.prepare(`SELECT id FROM member WHERE platform_id = ?`)
  const insertMessage = db.prepare(`
    INSERT INTO message (sender_id, sender_account_name, sender_group_nickname, ts, type, content, reply_to_message_id, platform_message_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const memberIdMap = new Map<string, number>()
  let metaInserted = false
  let totalMessageCount = 0

  db.exec('BEGIN TRANSACTION')

  try {
    await streamParseFile(
      filePath,
      {
        batchSize: 5000,
        formatOptions,

        onProgress: () => {
          // No real-time progress in HTTP — we complete and respond once.
        },

        onMeta: (meta: ParsedMeta) => {
          if (!metaInserted) {
            insertMeta.run(
              meta.name,
              meta.platform,
              meta.type,
              Math.floor(Date.now() / 1000),
              meta.groupId || null,
              meta.groupAvatar || null,
              meta.ownerId || null,
            )
            metaInserted = true
          }
        },

        onMembers: (members: ParsedMember[]) => {
          for (const member of members) {
            insertMember.run(
              member.platformId,
              member.accountName || null,
              member.groupNickname || null,
              member.avatar || null,
              member.roles ? JSON.stringify(member.roles) : '[]',
            )
            const row = getMemberId.get(member.platformId) as { id: number } | undefined
            if (row) {
              memberIdMap.set(member.platformId, row.id)
            }
          }
        },

        onMessageBatch: (messages: ParsedMessage[]) => {
          for (const msg of messages) {
            if (!msg.senderPlatformId || !msg.senderAccountName) continue
            if (msg.timestamp === undefined || msg.timestamp === null || isNaN(msg.timestamp)) continue
            if (msg.type === undefined || msg.type === null) continue

            // Ensure member exists
            if (!memberIdMap.has(msg.senderPlatformId)) {
              insertMember.run(
                msg.senderPlatformId,
                msg.senderAccountName || null,
                msg.senderGroupNickname || null,
                null,
                '[]',
              )
              const row = getMemberId.get(msg.senderPlatformId) as { id: number } | undefined
              if (row) {
                memberIdMap.set(msg.senderPlatformId, row.id)
              }
            }

            const senderId = memberIdMap.get(msg.senderPlatformId)
            if (senderId === undefined) continue

            let safeContent: string | null = null
            if (msg.content != null) {
              safeContent = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
            }

            insertMessage.run(
              senderId,
              msg.senderAccountName || null,
              msg.senderGroupNickname || null,
              msg.timestamp,
              msg.type,
              safeContent,
              msg.replyToMessageId || null,
              msg.platformMessageId || null,
            )
            totalMessageCount++
          }
        },
      },
      formatFeature.id,
    )

    db.exec('COMMIT')

    if (totalMessageCount === 0) {
      db.close()
      // Clean up the empty database
      const dbPath = getDbPath(sessionId)
      cleanupDbFiles(dbPath)
      return { success: false, error: 'error.no_messages' }
    }

    // Create indexes after bulk import
    createIndexes(db)
    db.pragma('wal_checkpoint(TRUNCATE)')
    db.close()

    return { success: true, sessionId }
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* ignore */ }
    db.close()

    const dbPath = getDbPath(sessionId)
    cleanupDbFiles(dbPath)

    throw error
  }
}

// ---------------------------------------------------------------------------
// Incremental import helpers
// ---------------------------------------------------------------------------

interface IncrementalAnalyzeResult {
  newMessageCount: number
  duplicateCount: number
  totalInFile: number
  error?: string
}

async function analyzeIncremental(
  sessionId: string,
  filePath: string,
): Promise<IncrementalAnalyzeResult> {
  const formatFeature = detectFormat(filePath)
  if (!formatFeature) {
    return { error: 'error.unrecognized_format', newMessageCount: 0, duplicateCount: 0, totalInFile: 0 }
  }

  const dbPath = getDbPath(sessionId)
  if (!fs.existsSync(dbPath)) {
    return { error: 'error.session_not_found', newMessageCount: 0, duplicateCount: 0, totalInFile: 0 }
  }

  // Close any cached connection so we can open read-only
  closeDatabase(sessionId)

  const db = new Database(dbPath, { readonly: true })
  db.pragma('journal_mode = WAL')

  const existingKeys = new Set<string>()
  const rows = db
    .prepare(`
      SELECT msg.ts, m.platform_id as sender_platform_id, msg.content
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
    `)
    .all() as Array<{ ts: number; sender_platform_id: string; content: string | null }>

  for (const row of rows) {
    existingKeys.add(generateMessageKey(row.ts, row.sender_platform_id, row.content))
  }
  db.close()

  let totalInFile = 0
  let newMessageCount = 0
  let duplicateCount = 0

  await streamParseFile(filePath, {
    onMeta: () => {},
    onMembers: () => {},
    onProgress: () => {},
    onMessageBatch: (batch) => {
      for (const msg of batch) {
        totalInFile++
        const key = generateMessageKey(msg.timestamp, msg.senderPlatformId, msg.content)
        if (existingKeys.has(key)) {
          duplicateCount++
        } else {
          newMessageCount++
        }
      }
    },
  })

  return { newMessageCount, duplicateCount, totalInFile }
}

interface IncrementalImportResult {
  success: boolean
  newMessageCount: number
  error?: string
}

async function runIncrementalImport(
  sessionId: string,
  filePath: string,
): Promise<IncrementalImportResult> {
  const formatFeature = detectFormat(filePath)
  if (!formatFeature) {
    return { success: false, newMessageCount: 0, error: 'error.unrecognized_format' }
  }

  const dbPath = getDbPath(sessionId)
  if (!fs.existsSync(dbPath)) {
    return { success: false, newMessageCount: 0, error: 'error.session_not_found' }
  }

  // Close any cached read-only connection for this session
  closeDatabase(sessionId)

  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')

  try {
    // Build existing key set
    const existingKeys = new Set<string>()
    const rows = db
      .prepare(`
        SELECT msg.ts, m.platform_id as sender_platform_id, msg.content
        FROM message msg
        JOIN member m ON msg.sender_id = m.id
      `)
      .all() as Array<{ ts: number; sender_platform_id: string; content: string | null }>

    for (const row of rows) {
      existingKeys.add(generateMessageKey(row.ts, row.sender_platform_id, row.content))
    }

    // Build member id map
    const memberIdMap = new Map<string, number>()
    const existingMembers = db
      .prepare('SELECT id, platform_id FROM member')
      .all() as Array<{ id: number; platform_id: string }>
    for (const m of existingMembers) {
      memberIdMap.set(m.platform_id, m.id)
    }

    const insertMember = db.prepare(`
      INSERT INTO member (platform_id, account_name, group_nickname, avatar)
      VALUES (?, ?, ?, ?)
    `)
    const insertMessage = db.prepare(`
      INSERT INTO message (sender_id, sender_account_name, sender_group_nickname, ts, type, content)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    db.exec('BEGIN TRANSACTION')

    let newMessageCount = 0

    await streamParseFile(filePath, {
      onMeta: () => {},
      onMembers: (members) => {
        for (const m of members) {
          if (!memberIdMap.has(m.platformId)) {
            const result = insertMember.run(
              m.platformId,
              m.accountName || null,
              m.groupNickname || null,
              m.avatar || null,
            )
            memberIdMap.set(m.platformId, result.lastInsertRowid as number)
          }
        }
      },
      onProgress: () => {},
      onMessageBatch: (batch) => {
        for (const msg of batch) {
          const key = generateMessageKey(msg.timestamp, msg.senderPlatformId, msg.content)
          if (existingKeys.has(key)) continue

          let memberId = memberIdMap.get(msg.senderPlatformId)
          if (!memberId) {
            const result = insertMember.run(
              msg.senderPlatformId,
              msg.senderAccountName || null,
              msg.senderGroupNickname || null,
              null,
            )
            memberId = result.lastInsertRowid as number
            memberIdMap.set(msg.senderPlatformId, memberId)
          }

          insertMessage.run(
            memberId,
            msg.senderAccountName || null,
            msg.senderGroupNickname || null,
            msg.timestamp,
            msg.type,
            msg.content || null,
          )
          existingKeys.add(key)
          newMessageCount++
        }
      },
    })

    db.exec('COMMIT')
    db.prepare('UPDATE meta SET imported_at = ?').run(Math.floor(Date.now() / 1000))
    db.close()

    return { success: true, newMessageCount }
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* ignore */ }
    db.close()
    console.error('[IncrementalImport] Error:', error)
    return { success: false, newMessageCount: 0, error: String(error) }
  }
}

// ---------------------------------------------------------------------------
// DB file cleanup helper
// ---------------------------------------------------------------------------

function cleanupDbFiles(dbPath: string): void {
  try {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
    const walPath = `${dbPath}-wal`
    const shmPath = `${dbPath}-shm`
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath)
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath)
  } catch {
    // ignore cleanup errors
  }
}

export default router
