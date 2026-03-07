/**
 * Cache management API routes
 *
 * Replaces Electron IPC handlers for cache/storage management:
 *   GET    /api/cache/info            - get all cache directory info
 *   DELETE /api/cache/clear/:cacheId  - clear a specific cache directory
 *   GET    /api/cache/data-dir        - get current data directory
 *   POST   /api/cache/data-dir        - set custom data directory
 *   POST   /api/cache/save-download   - save file to downloads directory
 *   GET    /api/cache/import-log      - get latest import log path
 *
 * Electron-specific features removed:
 *   - shell.openPath / shell.showItemInFolder (no OS file manager in browser)
 *   - dialog.showOpenDialog (no native dialogs in browser)
 */

import { Router, type Request } from 'express'
import * as fs from 'fs'
import * as fsPromises from 'fs/promises'
import * as path from 'path'
import {
  getAppDataDir,
  getDatabaseDir,
  getAiDataDir,
  getLogsDir,
  ensureDir,
  ensureAppDirs,
} from '../paths.js'

const router = Router()

// ==================== Helpers ====================

/**
 * Recursively calculate directory size in bytes.
 */
async function getDirSize(dirPath: string): Promise<number> {
  let totalSize = 0
  try {
    if (!fs.existsSync(dirPath)) return 0
    const files = await fsPromises.readdir(dirPath, { withFileTypes: true })
    for (const file of files) {
      const filePath = path.join(dirPath, file.name)
      if (file.isDirectory()) {
        totalSize += await getDirSize(filePath)
      } else {
        const stat = await fsPromises.stat(filePath)
        totalSize += stat.size
      }
    }
  } catch (error) {
    console.error('[Cache] Error getting dir size:', dirPath, error)
  }
  return totalSize
}

/**
 * Recursively count files in a directory.
 */
async function getFileCount(dirPath: string): Promise<number> {
  let count = 0
  try {
    if (!fs.existsSync(dirPath)) return 0
    const files = await fsPromises.readdir(dirPath, { withFileTypes: true })
    for (const file of files) {
      const filePath = path.join(dirPath, file.name)
      if (file.isDirectory()) {
        count += await getFileCount(filePath)
      } else {
        count++
      }
    }
  } catch (error) {
    console.error('[Cache] Error getting file count:', dirPath, error)
  }
  return count
}

// ==================== Routes ====================

/**
 * GET /api/cache/info
 * Returns size, file count, and metadata for each cache directory.
 */
router.get('/info', async (_req, res) => {
  try {
    const appDataDir = getAppDataDir()

    const cacheDirectories = [
      {
        id: 'databases',
        name: 'settings.storage.cache.databases.name',
        description: 'settings.storage.cache.databases.description',
        path: getDatabaseDir(),
        icon: 'i-heroicons-circle-stack',
        canClear: false,
      },
      {
        id: 'ai',
        name: 'settings.storage.cache.ai.name',
        description: 'settings.storage.cache.ai.description',
        path: getAiDataDir(),
        icon: 'i-heroicons-sparkles',
        canClear: false,
      },
      {
        id: 'logs',
        name: 'settings.storage.cache.logs.name',
        description: 'settings.storage.cache.logs.description',
        path: getLogsDir(),
        icon: 'i-heroicons-document-text',
        canClear: true,
      },
    ]

    const results = await Promise.all(
      cacheDirectories.map(async (dir) => {
        const size = await getDirSize(dir.path)
        const fileCount = await getFileCount(dir.path)
        const exists = fs.existsSync(dir.path)
        return { ...dir, size, fileCount, exists }
      }),
    )

    res.json({
      baseDir: appDataDir,
      directories: results,
      totalSize: results.reduce((sum, dir) => sum + dir.size, 0),
    })
  } catch (error) {
    console.error('[Cache] Error getting cache info:', error)
    res.status(500).json({ error: 'Failed to get cache info' })
  }
})

/**
 * DELETE /api/cache/clear/:cacheId
 * Clear files in an allowed cache directory (currently only 'logs').
 */
router.delete('/clear/:cacheId', async (req, res) => {
  const cacheId = Array.isArray(req.params.cacheId) ? req.params.cacheId[0] : req.params.cacheId

  const allowedDirs: Record<string, string> = {
    logs: getLogsDir(),
  }

  const dirPath = allowedDirs[cacheId]
  if (!dirPath) {
    res.status(400).json({ success: false, error: 'Cannot clear this directory' })
    return
  }

  try {
    if (!fs.existsSync(dirPath)) {
      res.json({ success: true, message: 'Directory does not exist, nothing to clear' })
      return
    }

    const files = await fsPromises.readdir(dirPath)
    for (const file of files) {
      const filePath = path.join(dirPath, file)
      const stat = await fsPromises.stat(filePath)
      if (stat.isDirectory()) {
        await fsPromises.rm(filePath, { recursive: true })
      } else {
        await fsPromises.unlink(filePath)
      }
    }

    console.log(`[Cache] Cleared directory: ${dirPath}`)
    res.json({ success: true })
  } catch (error) {
    console.error('[Cache] Error clearing cache:', error)
    res.status(500).json({ success: false, error: String(error) })
  }
})

/**
 * GET /api/cache/data-dir
 * Returns the current data directory path and whether it's custom.
 */
router.get('/data-dir', (_req, res) => {
  res.json({
    path: getAppDataDir(),
    isCustom: Boolean(process.env.CHATLAB_DATA_DIR?.trim()),
  })
})

/**
 * POST /api/cache/data-dir
 * Set a custom data directory. Expects { path: string | null, migrate?: boolean }.
 *
 * In the web version, custom data dir is controlled via CHATLAB_DATA_DIR env var.
 * This endpoint validates the path and updates the env var for the current process.
 * A server restart may be needed for full effect.
 */
router.post('/data-dir', (req, res) => {
  const { path: targetPath, migrate } = req.body as { path?: string | null; migrate?: boolean }

  if (targetPath === null || targetPath === undefined || targetPath === '') {
    // Reset to default
    delete process.env.CHATLAB_DATA_DIR
    ensureAppDirs()
    res.json({ success: true, path: getAppDataDir() })
    return
  }

  if (typeof targetPath !== 'string' || !path.isAbsolute(targetPath)) {
    res.status(400).json({ success: false, error: 'Data directory must be an absolute path' })
    return
  }

  try {
    ensureDir(targetPath)
    process.env.CHATLAB_DATA_DIR = targetPath
    ensureAppDirs()
    res.json({ success: true, path: getAppDataDir() })
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) })
  }
})

/**
 * POST /api/cache/save-download
 * Save a file from a data URL. Expects { filename: string, dataUrl: string }.
 * Returns the path where the file was saved.
 */
router.post('/save-download', async (req, res) => {
  const { filename, dataUrl } = req.body as { filename?: string; dataUrl?: string }

  if (!filename || !dataUrl) {
    res.status(400).json({ success: false, error: 'filename and dataUrl are required' })
    return
  }

  // Use a downloads subdirectory inside the data dir
  const downloadsDir = path.join(getAppDataDir(), 'downloads')

  try {
    ensureDir(downloadsDir)

    let buffer: Buffer

    if (dataUrl.includes(';base64,')) {
      const base64Data = dataUrl.split(';base64,')[1]
      buffer = Buffer.from(base64Data, 'base64')
    } else if (dataUrl.includes('charset=utf-8,')) {
      const textData = dataUrl.split('charset=utf-8,')[1]
      buffer = Buffer.from(decodeURIComponent(textData), 'utf-8')
    } else {
      const base64Data = dataUrl.replace(/^data:[^,]+,/, '')
      buffer = Buffer.from(base64Data, 'base64')
    }

    const filePath = path.join(downloadsDir, filename)
    await fsPromises.writeFile(filePath, buffer)

    console.log(`[Cache] Saved file to downloads: ${filePath}`)
    res.json({ success: true, filePath })
  } catch (error) {
    console.error('[Cache] Error saving download:', error)
    res.status(500).json({ success: false, error: String(error) })
  }
})

/**
 * GET /api/cache/import-log
 * Get the path of the latest import log file.
 */
router.get('/import-log', async (_req, res) => {
  const importLogDir = path.join(getLogsDir(), 'import')

  try {
    if (!fs.existsSync(importLogDir)) {
      res.status(404).json({ success: false, error: 'Log directory does not exist' })
      return
    }

    const files = await fsPromises.readdir(importLogDir)
    const logFiles = files.filter((f) => f.startsWith('import_') && f.endsWith('.log'))

    if (logFiles.length === 0) {
      res.status(404).json({ success: false, error: 'No import logs found' })
      return
    }

    const fileStats = await Promise.all(
      logFiles.map(async (f) => {
        const filePath = path.join(importLogDir, f)
        const stat = await fsPromises.stat(filePath)
        return { name: f, path: filePath, mtime: stat.mtime.getTime() }
      }),
    )

    fileStats.sort((a, b) => b.mtime - a.mtime)
    const latest = fileStats[0]

    res.json({ success: true, path: latest.path, name: latest.name })
  } catch (error) {
    console.error('[Cache] Error getting latest import log:', error)
    res.status(500).json({ success: false, error: String(error) })
  }
})

export default router
