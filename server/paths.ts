/**
 * Server-side path management module
 * Replaces electron/main/paths.ts without Electron dependencies.
 *
 * Data directory resolution:
 *   1. process.env.CHATLAB_DATA_DIR (explicit override)
 *   2. ~/.chatlab/data (default, cross-platform)
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

/**
 * Resolve the application data root directory.
 * Environment variable takes precedence, otherwise falls back to ~/.chatlab/data.
 */
export function getAppDataDir(): string {
  const envDir = process.env.CHATLAB_DATA_DIR?.trim()
  if (envDir && path.isAbsolute(envDir)) {
    return envDir
  }
  return path.join(os.homedir(), '.chatlab', 'data')
}

/**
 * Get the database storage directory.
 */
export function getDatabaseDir(): string {
  return path.join(getAppDataDir(), 'databases')
}

/**
 * Get the settings directory.
 */
export function getSettingsDir(): string {
  return path.join(getAppDataDir(), 'settings')
}

/**
 * Get the AI data directory (conversation history, LLM config).
 */
export function getAiDataDir(): string {
  return path.join(getAppDataDir(), 'ai')
}

/**
 * Get the temporary files directory.
 */
export function getTempDir(): string {
  return path.join(getAppDataDir(), 'temp')
}

/**
 * Get the logs directory.
 */
export function getLogsDir(): string {
  return path.join(getAppDataDir(), 'logs')
}

/**
 * Ensure a directory exists, creating it recursively if necessary.
 */
export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

/**
 * Ensure all standard application directories exist.
 */
export function ensureAppDirs(): void {
  ensureDir(getDatabaseDir())
  ensureDir(getAiDataDir())
  ensureDir(getSettingsDir())
  ensureDir(getTempDir())
  ensureDir(getLogsDir())
}
