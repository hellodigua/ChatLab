/**
 * 临时数据库模块
 * 用于合并导入时的临时文件处理
 */

import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'

// 在 Worker 线程中，无法直接使用 electron 的 app 模块
// 需要通过其他方式获取临时目录
function getTempDir(): string {
  // 在 worker 中，使用系统临时目录
  const tmpDir = process.env.TMPDIR || process.env.TMP || '/tmp'
  const chatLabTmp = path.join(tmpDir, 'chatlab-temp')
  if (!fs.existsSync(chatLabTmp)) {
    fs.mkdirSync(chatLabTmp, { recursive: true })
  }
  return chatLabTmp
}

/**
 * 创建临时数据库用于合并
 */
export function createTempDatabase(): { db: Database.Database; path: string } {
  const tempDir = getTempDir()
  const tempPath = path.join(tempDir, `merge_${Date.now()}_${Math.random().toString(36).slice(2)}.db`)
  const db = new Database(tempPath)

  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('cache_size = -64000')

  // 创建临时表结构
  db.exec(`
    CREATE TABLE IF NOT EXISTS member (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform_id TEXT NOT NULL UNIQUE,
      account_name TEXT,
      group_nickname TEXT,
      aliases TEXT DEFAULT '[]',
      avatar TEXT,
      roles TEXT DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS message (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_platform_id TEXT NOT NULL,
      sender_account_name TEXT,
      sender_group_nickname TEXT,
      ts INTEGER NOT NULL,
      type INTEGER NOT NULL,
      content TEXT,
      reply_to_message_id TEXT DEFAULT NULL,
      platform_message_id TEXT DEFAULT NULL
    );
  `)

  return { db, path: tempPath }
}

/**
 * 关闭并清理临时数据库
 */
export function cleanupTempDatabase(dbPath: string): void {
  try {
    // 尝试删除 WAL 和 SHM 文件
    const walPath = `${dbPath}-wal`
    const shmPath = `${dbPath}-shm`

    if (fs.existsSync(walPath)) {
      fs.unlinkSync(walPath)
    }
    if (fs.existsSync(shmPath)) {
      fs.unlinkSync(shmPath)
    }
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath)
    }
  } catch (err) {
    console.error('清理临时数据库失败:', err)
  }
}

/**
 * 生成消息去重键
 * 使用 timestamp + senderPlatformId + contentLength 作为去重标识
 */
export function generateMessageKey(timestamp: number, senderPlatformId: string, content: string | null): string {
  const contentLength = content ? content.length : 0
  return `${timestamp}_${senderPlatformId}_${contentLength}`
}
