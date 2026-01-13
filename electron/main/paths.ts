/**
 * 统一路径管理模块
 * 所有应用数据存储在 app.getPath('userData') 目录下
 *
 * 各平台路径：
 * - Windows: %APPDATA%/ChatLab (例如 C:\Users\xxx\AppData\Roaming\ChatLab)
 * - macOS: ~/Library/Application Support/ChatLab
 * - Linux: ~/.config/ChatLab
 */

import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

// 缓存路径，避免重复计算
let _appDataDir: string | null = null
let _legacyDataDir: string | null = null

/**
 * 获取应用数据根目录
 * 使用 userData/data 子目录，与 Electron 缓存隔离
 */
export function getAppDataDir(): string {
  if (_appDataDir) return _appDataDir

  try {
    const userDataPath = app.getPath('userData')
    // 使用子目录存放应用数据，避免与 Electron 缓存混淆
    _appDataDir = path.join(userDataPath, 'data')
  } catch (error) {
    console.error('[Paths] Error getting userData path:', error)
    _appDataDir = path.join(process.cwd(), 'userData', 'data')
  }

  return _appDataDir
}

/**
 * 获取旧版数据目录（Documents/ChatLab）
 * 用于数据迁移检测
 */
export function getLegacyDataDir(): string {
  if (_legacyDataDir) return _legacyDataDir

  try {
    const docPath = app.getPath('documents')
    _legacyDataDir = path.join(docPath, 'ChatLab')
  } catch (error) {
    console.error('[Paths] Error getting documents path:', error)
    _legacyDataDir = path.join(process.cwd(), 'ChatLab')
  }

  return _legacyDataDir
}

/**
 * 获取系统下载目录
 * 用于用户导出文件的默认位置
 */
export function getDownloadsDir(): string {
  try {
    return app.getPath('downloads')
  } catch (error) {
    console.error('[Paths] Error getting downloads path:', error)
    return path.join(process.cwd(), 'downloads')
  }
}

/**
 * 获取数据库目录
 */
export function getDatabaseDir(): string {
  return path.join(getAppDataDir(), 'databases')
}

/**
 * 获取 AI 数据目录（对话历史、LLM 配置）
 */
export function getAiDataDir(): string {
  return path.join(getAppDataDir(), 'ai')
}

/**
 * 获取设置目录
 */
export function getSettingsDir(): string {
  return path.join(getAppDataDir(), 'settings')
}

/**
 * 获取临时文件目录
 */
export function getTempDir(): string {
  return path.join(getAppDataDir(), 'temp')
}

/**
 * 获取日志目录
 */
export function getLogsDir(): string {
  return path.join(getAppDataDir(), 'logs')
}

/**
 * 确保目录存在
 */
export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

/**
 * 确保所有应用目录存在
 */
export function ensureAppDirs(): void {
  ensureDir(getDatabaseDir())
  ensureDir(getAiDataDir())
  ensureDir(getSettingsDir())
  ensureDir(getTempDir())
  ensureDir(getLogsDir())
}

// ==================== 数据迁移 ====================

/**
 * 检查是否需要从 Documents/ChatLab 迁移数据
 */
export function needsLegacyMigration(): boolean {
  const legacyDir = getLegacyDataDir()

  // 检查 Documents/ChatLab 是否存在
  if (fs.existsSync(legacyDir)) {
    return true
  }

  return false
}

/**
 * 从指定源目录迁移数据到目标目录
 * 采用合并策略：只复制不存在的文件，不覆盖已存在的文件
 */
function migrateDirectory(
  srcDir: string,
  destDir: string,
  subDirs: string[]
): { migratedDirs: string[]; skippedDirs: string[] } {
  const migratedDirs: string[] = []
  const skippedDirs: string[] = []

  for (const subDir of subDirs) {
    const srcSubPath = path.join(srcDir, subDir)
    const destSubPath = path.join(destDir, subDir)

    // 如果源子目录不存在或为空，跳过
    if (!fs.existsSync(srcSubPath)) {
      continue
    }

    const srcFiles = fs.readdirSync(srcSubPath).filter((f) => !f.startsWith('.'))
    if (srcFiles.length === 0) {
      continue
    }

    // 确保目标子目录存在
    ensureDir(destSubPath)

    // 获取目标目录中已存在的文件
    const existingFiles = new Set(fs.readdirSync(destSubPath))

    // 合并策略：只复制目标目录中不存在的文件
    let copiedCount = 0
    let skippedCount = 0

    for (const file of srcFiles) {
      const srcPath = path.join(srcSubPath, file)
      const destPath = path.join(destSubPath, file)

      // 如果目标文件已存在，跳过（不覆盖）
      if (existingFiles.has(file)) {
        console.log(`[Paths] Skipping ${subDir}/${file}: already exists in destination`)
        skippedCount++
        continue
      }

      const stat = fs.statSync(srcPath)
      if (stat.isDirectory()) {
        copyDirRecursive(srcPath, destPath)
      } else {
        fs.copyFileSync(srcPath, destPath)
      }
      copiedCount++
    }

    if (copiedCount > 0) {
      migratedDirs.push(subDir)
      console.log(`[Paths] Migrated ${subDir}: ${copiedCount} items copied, ${skippedCount} skipped`)
    } else if (skippedCount > 0) {
      skippedDirs.push(subDir)
      console.log(`[Paths] ${subDir}: all ${skippedCount} items already exist in destination`)
    }
  }

  return { migratedDirs, skippedDirs }
}

/**
 * 写入迁移日志到 app.log
 * 使用内联实现避免循环依赖
 */
function writeMigrationLog(message: string): void {
  try {
    const logDir = getLogsDir()
    ensureDir(logDir)
    const logPath = path.join(logDir, 'app.log')
    const now = new Date()
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
    const logLine = `[${timestamp}] [MIGRATION] ${message}\n`
    fs.appendFileSync(logPath, logLine, 'utf-8')
  } catch {
    // 日志写入失败时静默处理
  }
}

/**
 * 执行从 Documents/ChatLab 到新目录的数据迁移
 * 迁移整个目录的所有内容，采用合并策略：只复制不存在的文件，不覆盖已存在的文件
 * 只有在所有数据都成功迁移后才删除旧目录
 */
export function migrateFromLegacyDir(): { success: boolean; migratedDirs: string[]; error?: string } {
  const legacyDir = getLegacyDataDir()
  const newDir = getAppDataDir()

  try {
    if (!fs.existsSync(legacyDir)) {
      return { success: true, migratedDirs: [] }
    }

    // 获取旧目录下的所有子目录和文件
    const entries = fs.readdirSync(legacyDir, { withFileTypes: true })
    const dirsToMigrate = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name)
    const filesToMigrate = entries.filter((e) => e.isFile() && !e.name.startsWith('.')).map((e) => e.name)

    const result = migrateDirectory(legacyDir, newDir, dirsToMigrate)

    // 迁移根目录下的文件
    ensureDir(newDir)
    for (const file of filesToMigrate) {
      const srcPath = path.join(legacyDir, file)
      const destPath = path.join(newDir, file)
      if (!fs.existsSync(destPath)) {
        fs.copyFileSync(srcPath, destPath)
      }
    }

    // 构建迁移摘要
    const summary: string[] = []
    summary.push(`Migration from ${legacyDir} to ${newDir}`)

    // 迁移成功，删除旧目录
    fs.rmSync(legacyDir, { recursive: true, force: true })
    summary.push('Status: Success, legacy directory removed')

    if (result.migratedDirs.length > 0) {
      summary.push(`Migrated dirs: ${result.migratedDirs.join(', ')}`)
    }
    if (filesToMigrate.length > 0) {
      summary.push(`Migrated files: ${filesToMigrate.length}`)
    }

    // 写入迁移日志
    writeMigrationLog(summary.join(' | '))

    return { success: true, migratedDirs: result.migratedDirs }
  } catch (error) {
    console.error('[Paths] Migration failed:', error)
    const errorMsg = error instanceof Error ? error.message : String(error)
    writeMigrationLog(`Migration failed: ${errorMsg}`)
    return {
      success: false,
      migratedDirs: [],
      error: errorMsg,
    }
  }
}

/**
 * 递归复制目录
 */
function copyDirRecursive(src: string, dest: string): void {
  ensureDir(dest)
  const entries = fs.readdirSync(src, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

/**
 * 删除旧版数据目录（可选，供用户确认后调用）
 */
export function removeLegacyDir(): boolean {
  const legacyDir = getLegacyDataDir()

  if (!fs.existsSync(legacyDir)) {
    return true
  }

  try {
    fs.rmSync(legacyDir, { recursive: true, force: true })
    console.log(`[Paths] Removed legacy directory: ${legacyDir}`)
    return true
  } catch (error) {
    console.error('[Paths] Failed to remove legacy directory:', error)
    return false
  }
}

