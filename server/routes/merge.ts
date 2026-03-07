/**
 * Merge API routes
 *
 * Replaces the Electron IPC handlers for file merging:
 *   POST   /api/merge/parse         - parse a file for merge preview (file upload)
 *   POST   /api/merge/check-conflicts - check conflicts among cached files
 *   POST   /api/merge/execute       - execute merge with conflict resolutions
 *   POST   /api/merge/clear-cache   - clear temp database cache (single or all)
 */

import { Router } from 'express'
import multer from 'multer'
import * as fs from 'fs'
import * as path from 'path'
import { getTempDir, ensureDir } from '../paths'
import { parseFileInfo, streamParseFile, type ParsedMeta, type ParsedMember, type ParsedMessage } from '../parser'
import { TempDbWriter, generateTempDbPath, deleteTempDatabase, cleanupAllTempDatabases } from '../merger/tempCache'
import { checkConflictsWithTempDb, mergeFilesWithTempDb } from '../merger'
import type { MergeParams } from '../../src/types/format'

// ---------------------------------------------------------------------------
// Multer setup — store uploads in a merge-specific temp directory
// ---------------------------------------------------------------------------

function getMergeUploadDir(): string {
  const dir = path.join(getTempDir(), 'merge-uploads')
  ensureDir(dir)
  return dir
}

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, getMergeUploadDir())
  },
  filename(_req, _file, cb) {
    const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const ext = path.extname(_file.originalname)
    cb(null, `merge_${unique}${ext}`)
  },
})

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 GB
})

// ---------------------------------------------------------------------------
// In-memory temp database cache (keyed by original filename / virtual path)
// ---------------------------------------------------------------------------

// Maps a "file key" (original filename or virtual path) to a temp database path
const tempDbCache = new Map<string, string>()

/**
 * Get the temp database cache (exported for testing).
 */
export function _getTempDbCache(): Map<string, string> {
  return tempDbCache
}

/** Remove uploaded temp file (best-effort). */
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
 * POST /api/merge/parse
 * Parse a file for merge preview. Accepts a file upload.
 * The file is parsed and its data written to a temporary database.
 * Returns FileParseInfo: { name, format, platform, messageCount, memberCount, fileSize, fileKey }.
 *
 * The `fileKey` is used to reference this parsed file in subsequent merge operations.
 */
router.post('/parse', upload.single('file'), async (req, res) => {
  const filePath = req.file?.path
  const originalName = req.file?.originalname || 'unknown'

  try {
    if (!filePath) {
      res.status(400).json({ error: 'No file uploaded' })
      return
    }

    // Generate a unique file key for this upload
    const fileKey = `merge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${originalName}`

    // Create temp database and stream parse into it
    const tempDbPath = generateTempDbPath(filePath)
    const writer = new TempDbWriter(tempDbPath)

    let name = 'Unknown'
    let format = 'unknown'
    let platform = 'unknown'
    let messageCount = 0
    let memberCount = 0

    try {
      await streamParseFile(filePath, {
        onProgress: () => {},
        onMeta: (meta: ParsedMeta) => {
          name = meta.name
          platform = meta.platform
          writer.writeMeta({
            name: meta.name,
            platform: meta.platform,
            type: meta.type,
            groupId: meta.groupId,
            groupAvatar: meta.groupAvatar,
          })
        },
        onMembers: (members: ParsedMember[]) => {
          memberCount += members.length
          writer.writeMembers(members)
        },
        onMessageBatch: (messages: ParsedMessage[]) => {
          messageCount += messages.length
          writer.writeMessages(messages)
        },
      })

      const counts = writer.finish()
      messageCount = counts.messageCount
      memberCount = counts.memberCount
    } catch (parseError) {
      writer.abort()
      throw parseError
    }

    // Cache the temp database
    tempDbCache.set(fileKey, tempDbPath)

    const fileSize = fs.statSync(filePath).size

    res.json({
      name,
      format,
      platform,
      messageCount,
      memberCount,
      fileSize,
      fileKey,
    })
  } catch (error) {
    console.error('[API] merge/parse error:', error)
    const message = error instanceof Error ? error.message : String(error)
    res.status(500).json({ error: `Failed to parse file: ${message}` })
  } finally {
    cleanupUpload(filePath)
  }
})

/**
 * POST /api/merge/check-conflicts
 * Check for merge conflicts among already-parsed files.
 * Body: { fileKeys: string[] }
 * Returns ConflictCheckResult: { conflicts, totalMessages }
 */
router.post('/check-conflicts', async (req, res) => {
  const { fileKeys } = req.body as { fileKeys?: string[] }

  if (!fileKeys || !Array.isArray(fileKeys) || fileKeys.length === 0) {
    res.status(400).json({ error: 'fileKeys array is required' })
    return
  }

  try {
    // Validate all file keys have cached temp databases
    for (const key of fileKeys) {
      if (!tempDbCache.has(key)) {
        res.status(400).json({ error: `File not found in cache: ${key}` })
        return
      }
    }

    const result = await checkConflictsWithTempDb(fileKeys, tempDbCache)
    res.json(result)
  } catch (error) {
    console.error('[API] merge/check-conflicts error:', error)
    const message = error instanceof Error ? error.message : String(error)
    res.status(500).json({ error: `Failed to check conflicts: ${message}` })
  }
})

/**
 * POST /api/merge/execute
 * Execute the merge operation.
 * Body: MergeParams (with filePaths replaced by fileKeys) + fileKeys
 * Returns MergeResult: { success, outputPath?, sessionId?, error? }
 */
router.post('/execute', async (req, res) => {
  const {
    fileKeys,
    outputName,
    outputDir,
    outputFormat,
    conflictResolutions = [],
    andAnalyze = false,
  } = req.body as {
    fileKeys: string[]
    outputName: string
    outputDir?: string
    outputFormat?: 'json' | 'jsonl'
    conflictResolutions?: Array<{ id: string; resolution: 'keep1' | 'keep2' | 'keepBoth' }>
    andAnalyze?: boolean
  }

  if (!fileKeys || !Array.isArray(fileKeys) || fileKeys.length === 0) {
    res.status(400).json({ success: false, error: 'fileKeys array is required' })
    return
  }

  if (!outputName) {
    res.status(400).json({ success: false, error: 'outputName is required' })
    return
  }

  try {
    // Validate all file keys
    for (const key of fileKeys) {
      if (!tempDbCache.has(key)) {
        res.status(400).json({ success: false, error: `File not found in cache: ${key}` })
        return
      }
    }

    const params: MergeParams = {
      filePaths: fileKeys,
      outputName,
      outputDir,
      outputFormat,
      conflictResolutions,
      andAnalyze,
    }

    const result = await mergeFilesWithTempDb(params, tempDbCache)

    // Clean up temp databases on success
    if (result.success) {
      for (const key of fileKeys) {
        const tempDbPath = tempDbCache.get(key)
        if (tempDbPath) {
          deleteTempDatabase(tempDbPath)
          tempDbCache.delete(key)
        }
      }
    }

    res.json(result)
  } catch (error) {
    console.error('[API] merge/execute error:', error)
    const message = error instanceof Error ? error.message : String(error)
    res.status(500).json({ success: false, error: message })
  }
})

/**
 * POST /api/merge/clear-cache
 * Clear temp database cache.
 * Body: { fileKey?: string } — if fileKey is provided, clears that single entry; otherwise clears all.
 */
router.post('/clear-cache', (_req, res) => {
  const { fileKey } = _req.body as { fileKey?: string }

  try {
    if (fileKey) {
      const tempDbPath = tempDbCache.get(fileKey)
      if (tempDbPath) {
        deleteTempDatabase(tempDbPath)
        tempDbCache.delete(fileKey)
      }
    } else {
      // Clear all cached temp databases
      for (const tempDbPath of tempDbCache.values()) {
        deleteTempDatabase(tempDbPath)
      }
      tempDbCache.clear()
      // Also clean up any orphaned temp databases
      cleanupAllTempDatabases()
    }

    res.json({ success: true })
  } catch (error) {
    console.error('[API] merge/clear-cache error:', error)
    res.status(500).json({ success: false, error: String(error) })
  }
})

export default router
