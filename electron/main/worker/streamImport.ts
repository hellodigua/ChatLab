/**
 * 流式导入模块
 * 在 Worker 线程中流式解析文件并批量写入数据库
 */

import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import { parentPort } from 'worker_threads'
import {
  streamParseFile,
  detectFormat,
  getPreprocessor,
  needsPreprocess,
  type ParseProgress,
  type ParsedMeta,
  type ParsedMember,
  type ParsedMessage,
} from '../parser'

/** 流式导入结果 */
export interface StreamImportResult {
  success: boolean
  sessionId?: string
  error?: string
}
import { getDbDir } from './dbCore'
import { initPerfLog, logPerf, logPerfDetail, resetPerfLog, getCurrentLogFile } from './perfLogger'

// ==================== 临时数据库相关（用于合并功能） ====================

/**
 * 获取临时数据库目录（Worker 环境）
 */
function getTempDir(): string {
  const dbDir = getDbDir()
  const tempDir = path.join(path.dirname(dbDir), 'temp')
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true })
  }
  return tempDir
}

/**
 * 生成临时数据库文件路径
 */
function generateTempDbPath(sourceFilePath: string): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  const baseName = path.basename(sourceFilePath, path.extname(sourceFilePath))
  const safeName = baseName.replace(/[/\\?%*:|"<>]/g, '_').substring(0, 50)
  return path.join(getTempDir(), `merge_${safeName}_${timestamp}_${random}.db`)
}

/**
 * 创建临时数据库并初始化表结构
 */
function createTempDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath)

  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      type TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS member (
      platform_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      nickname TEXT
    );

    CREATE TABLE IF NOT EXISTS message (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_platform_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      type INTEGER NOT NULL,
      content TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_message_ts ON message(timestamp);
    CREATE INDEX IF NOT EXISTS idx_message_sender ON message(sender_platform_id);
  `)

  return db
}

/**
 * 发送进度到主进程
 */
function sendProgress(requestId: string, progress: ParseProgress): void {
  parentPort?.postMessage({
    id: requestId,
    type: 'progress',
    payload: progress,
  })
}

/**
 * 生成唯一的会话ID
 */
function generateSessionId(): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  return `chat_${timestamp}_${random}`
}

/**
 * 获取数据库文件路径
 */
function getDbPath(sessionId: string): string {
  return path.join(getDbDir(), `${sessionId}.db`)
}

/**
 * 创建数据库并初始化表结构（不含索引，用于快速导入）
 */
function createDatabaseWithoutIndexes(sessionId: string): Database.Database {
  const dbDir = getDbDir()
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }

  const dbPath = getDbPath(sessionId)
  const db = new Database(dbPath)

  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  // 增加缓存大小以提高写入性能
  db.pragma('cache_size = -64000') // 64MB 缓存

  // 创建表结构（不创建索引，导入完成后再创建）
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      type TEXT NOT NULL,
      imported_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS member (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      nickname TEXT
    );

    CREATE TABLE IF NOT EXISTS member_name_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      start_ts INTEGER NOT NULL,
      end_ts INTEGER,
      FOREIGN KEY(member_id) REFERENCES member(id)
    );

    CREATE TABLE IF NOT EXISTS message (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      ts INTEGER NOT NULL,
      type INTEGER NOT NULL,
      content TEXT,
      FOREIGN KEY(sender_id) REFERENCES member(id)
    );
  `)

  return db
}

/**
 * 导入完成后创建索引
 */
function createIndexes(db: Database.Database): void {
  console.log('[StreamImport] 开始创建索引...')
  const startTime = Date.now()

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_message_ts ON message(ts);
    CREATE INDEX IF NOT EXISTS idx_message_sender ON message(sender_id);
    CREATE INDEX IF NOT EXISTS idx_member_name_history_member_id ON member_name_history(member_id);
  `)

  console.log(`[StreamImport] 索引创建完成，耗时: ${Date.now() - startTime}ms`)
}

/**
 * 流式导入聊天记录
 * @param filePath 文件路径
 * @param requestId 请求ID（用于进度回调）
 */
export async function streamImport(filePath: string, requestId: string): Promise<StreamImportResult> {
  // 检测格式
  const formatFeature = detectFormat(filePath)
  if (!formatFeature) {
    return { success: false, error: '无法识别文件格式' }
  }

  console.log(`[StreamImport] 开始导入: ${filePath}, 格式: ${formatFeature.name}`)

  // 初始化性能日志（实时写入文件）
  resetPerfLog()
  const sessionId = generateSessionId()
  initPerfLog(sessionId)
  logPerf('开始导入', 0)

  // 预处理：如果格式需要且文件较大，先精简
  let actualFilePath = filePath
  let tempFilePath: string | null = null
  const preprocessor = getPreprocessor(filePath)

  if (preprocessor && needsPreprocess(filePath)) {
    console.log(`[StreamImport] 文件需要预处理，开始精简...`)
    sendProgress(requestId, {
      stage: 'parsing',
      bytesRead: 0,
      totalBytes: 0,
      messagesProcessed: 0,
      percentage: 0,
      message: '预处理：精简大文件中...',
    })

    try {
      tempFilePath = await preprocessor.preprocess(filePath, (progress) => {
        sendProgress(requestId, {
          ...progress,
          message: progress.message || '预处理中...',
        })
      })
      actualFilePath = tempFilePath
      console.log(`[StreamImport] 预处理完成: ${tempFilePath}`)
    } catch (err) {
      console.error(`[StreamImport] 预处理失败:`, err)
      return {
        success: false,
        error: `预处理失败: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  const db = createDatabaseWithoutIndexes(sessionId)

  // 准备语句
  const insertMeta = db.prepare(`
    INSERT INTO meta (name, platform, type, imported_at) VALUES (?, ?, ?, ?)
  `)
  const insertMember = db.prepare(`
    INSERT OR IGNORE INTO member (platform_id, name, nickname) VALUES (?, ?, ?)
  `)
  const getMemberId = db.prepare(`SELECT id FROM member WHERE platform_id = ?`)
  const insertMessage = db.prepare(`
    INSERT INTO message (sender_id, ts, type, content) VALUES (?, ?, ?, ?)
  `)
  const insertNameHistory = db.prepare(`
    INSERT INTO member_name_history (member_id, name, start_ts, end_ts) VALUES (?, ?, ?, ?)
  `)
  const updateMemberName = db.prepare(`UPDATE member SET name = ? WHERE platform_id = ?`)

  // 成员ID映射（platformId -> dbId）
  const memberIdMap = new Map<string, number>()
  // 昵称追踪器（收集所有变化，最后批量写入）
  const nicknameTracker = new Map<
    string,
    {
      currentName: string
      lastSeenTs: number
      history: Array<{ name: string; startTs: number }>
    }
  >()
  // 是否已插入 meta
  let metaInserted = false

  // 分批提交配置（每 50000 条消息提交一次）
  const BATCH_COMMIT_SIZE = 50000
  // WAL checkpoint 间隔（每 200000 条执行一次 checkpoint）
  const CHECKPOINT_INTERVAL = 200000
  let messageCountInBatch = 0
  let totalMessageCount = 0
  let lastCheckpointCount = 0
  let inTransaction = false

  // 开始第一个事务
  const beginTransaction = () => {
    if (!inTransaction) {
      db.exec('BEGIN TRANSACTION')
      inTransaction = true
    }
  }

  // 执行 WAL checkpoint（将 WAL 日志合并到主数据库）
  const doCheckpoint = () => {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)')
      console.log(`[StreamImport] WAL checkpoint 完成，累计 ${totalMessageCount} 条`)
    } catch (e) {
      console.warn('[StreamImport] WAL checkpoint 失败:', e)
    }
  }

  // 提交当前事务并开始新事务
  const commitAndBeginNew = () => {
    if (inTransaction) {
      db.exec('COMMIT')
      inTransaction = false

      // 记录性能日志
      logPerf(`提交事务`, totalMessageCount, BATCH_COMMIT_SIZE)

      // 定期执行 WAL checkpoint（防止 WAL 文件过大导致变慢）
      if (totalMessageCount - lastCheckpointCount >= CHECKPOINT_INTERVAL) {
        doCheckpoint()
        logPerf('WAL checkpoint', totalMessageCount)
        lastCheckpointCount = totalMessageCount
      }

      console.log(`[StreamImport] 已提交事务，累计 ${totalMessageCount} 条消息`)
      // 发送写入进度
      sendProgress(requestId, {
        stage: 'importing',
        bytesRead: 0,
        totalBytes: 0,
        messagesProcessed: totalMessageCount,
        percentage: 100,
        message: `正在写入数据库... 已处理 ${totalMessageCount.toLocaleString()} 条`,
      })
    }
    beginTransaction()
  }

  beginTransaction()

  try {
    await streamParseFile(actualFilePath, {
      batchSize: 5000,

      onProgress: (progress) => {
        // 转发进度到主进程
        sendProgress(requestId, progress)
      },

      onMeta: (meta: ParsedMeta) => {
        if (!metaInserted) {
          insertMeta.run(meta.name, meta.platform, meta.type, Math.floor(Date.now() / 1000))
          metaInserted = true
          console.log(`[StreamImport] Meta 已写入: ${meta.name}`)
        }
      },

      onMembers: (members: ParsedMember[]) => {
        console.log(`[StreamImport] 收到 ${members.length} 个成员`)
        for (const member of members) {
          insertMember.run(member.platformId, member.name, member.nickname || null)
          const row = getMemberId.get(member.platformId) as { id: number } | undefined
          if (row) {
            memberIdMap.set(member.platformId, row.id)
          }
        }
      },

      onMessageBatch: (messages: ParsedMessage[]) => {
        // 分阶段计时
        let memberLookupTime = 0
        let memberInsertTime = 0
        let messageInsertTime = 0
        let nicknameTrackTime = 0
        let memberLookupCount = 0
        let memberInsertCount = 0
        let nicknameChangeCount = 0

        for (const msg of messages) {
          // 数据验证：跳过无效消息
          if (!msg.senderPlatformId || !msg.senderName) {
            continue
          }
          if (msg.timestamp === undefined || msg.timestamp === null || isNaN(msg.timestamp)) {
            continue
          }
          if (msg.type === undefined || msg.type === null) {
            continue
          }

          // 确保成员存在
          let t0 = Date.now()
          if (!memberIdMap.has(msg.senderPlatformId)) {
            const memberName = msg.senderName || msg.senderPlatformId
            insertMember.run(msg.senderPlatformId, memberName, null)
            const row = getMemberId.get(msg.senderPlatformId) as { id: number } | undefined
            if (row) {
              memberIdMap.set(msg.senderPlatformId, row.id)
            }
            memberInsertCount++
            memberInsertTime += Date.now() - t0
          } else {
            memberLookupCount++
            memberLookupTime += Date.now() - t0
          }

          const senderId = memberIdMap.get(msg.senderPlatformId)
          if (senderId === undefined) continue

          // 插入消息
          t0 = Date.now()
          insertMessage.run(senderId, msg.timestamp, msg.type, msg.content)
          messageInsertTime += Date.now() - t0
          messageCountInBatch++
          totalMessageCount++

          // 追踪昵称变化（仅记录，不写入数据库，最后批量处理）
          t0 = Date.now()
          const senderName = msg.senderName || msg.senderPlatformId
          const tracker = nicknameTracker.get(msg.senderPlatformId)
          if (!tracker) {
            nicknameTracker.set(msg.senderPlatformId, {
              currentName: senderName,
              lastSeenTs: msg.timestamp,
              history: [{ name: senderName, startTs: msg.timestamp }],
            })
            nicknameChangeCount++
          } else if (tracker.currentName !== senderName) {
            // 记录昵称变化（稍后批量写入）
            tracker.history.push({ name: senderName, startTs: msg.timestamp })
            tracker.currentName = senderName
            tracker.lastSeenTs = msg.timestamp
            nicknameChangeCount++
          } else {
            tracker.lastSeenTs = msg.timestamp
          }
          nicknameTrackTime += Date.now() - t0

          // 分批提交（每 50000 条）
          if (messageCountInBatch >= BATCH_COMMIT_SIZE) {
            // 记录详细分阶段耗时
            const detail =
              `[详细] 成员查找: ${memberLookupTime}ms (${memberLookupCount}次) | ` +
              `成员插入: ${memberInsertTime}ms (${memberInsertCount}次) | ` +
              `消息插入: ${messageInsertTime}ms | ` +
              `昵称追踪: ${nicknameTrackTime}ms (变化${nicknameChangeCount}次)`
            logPerfDetail(detail)

            commitAndBeginNew()
            messageCountInBatch = 0

            // 重置计时
            memberLookupTime = 0
            memberInsertTime = 0
            messageInsertTime = 0
            nicknameTrackTime = 0
            memberLookupCount = 0
            memberInsertCount = 0
            nicknameChangeCount = 0
          }
        }
      },
    })

    // 提交最后的消息事务
    if (inTransaction) {
      db.exec('COMMIT')
      inTransaction = false
    }

    // 批量写入昵称历史（在索引创建前，写入速度更快）
    sendProgress(requestId, {
      stage: 'importing',
      bytesRead: 0,
      totalBytes: 0,
      messagesProcessed: totalMessageCount,
      percentage: 100,
      message: '正在写入昵称历史...',
    })
    logPerf('开始写入昵称历史', totalMessageCount)

    // 开始新事务
    db.exec('BEGIN TRANSACTION')
    let historyCount = 0
    for (const [platformId, tracker] of nicknameTracker.entries()) {
      const senderId = memberIdMap.get(platformId)
      if (!senderId) continue

      // 写入所有昵称历史
      for (let i = 0; i < tracker.history.length; i++) {
        const h = tracker.history[i]
        const endTs = i < tracker.history.length - 1 ? tracker.history[i + 1].startTs : null
        insertNameHistory.run(senderId, h.name, h.startTs, endTs)
        historyCount++
      }

      // 更新成员最新昵称
      updateMemberName.run(tracker.currentName, platformId)
    }
    db.exec('COMMIT')
    logPerf(`昵称历史写入完成 (${historyCount}条)`, totalMessageCount)

    // 创建索引（导入完成后批量创建，比边导入边更新快很多）
    sendProgress(requestId, {
      stage: 'importing',
      bytesRead: 0,
      totalBytes: 0,
      messagesProcessed: totalMessageCount,
      percentage: 100,
      message: '正在创建索引...',
    })
    logPerf('开始创建索引', totalMessageCount)
    createIndexes(db)
    logPerf('索引创建完成', totalMessageCount)

    // 最终 WAL checkpoint
    sendProgress(requestId, {
      stage: 'importing',
      bytesRead: 0,
      totalBytes: 0,
      messagesProcessed: totalMessageCount,
      percentage: 100,
      message: '正在优化数据库...',
    })
    doCheckpoint()
    logPerf('WAL checkpoint 完成', totalMessageCount)
    logPerf('导入完成', totalMessageCount)

    console.log(`[StreamImport] 导入完成: ${sessionId}, 总消息数: ${totalMessageCount}`)
    return { success: true, sessionId }
  } catch (error) {
    // 回滚当前事务
    if (inTransaction) {
      try {
        db.exec('ROLLBACK')
      } catch {
        // 忽略回滚错误
      }
    }

    // 删除失败的数据库文件
    const dbPath = getDbPath(sessionId)
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath)
    }

    console.error(`[StreamImport] 导入失败:`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    db.close()

    // 清理临时文件
    if (tempFilePath && preprocessor) {
      preprocessor.cleanup(tempFilePath)
      console.log(`[StreamImport] 已清理临时文件: ${tempFilePath}`)
    }
  }
}

/** 流式解析文件信息的返回结果 */
export interface StreamParseFileInfoResult {
  // 基本信息（用于预览）
  name: string
  format: string
  platform: string
  messageCount: number
  memberCount: number
  fileSize: number
  // 临时数据库路径（用于后续合并，避免内存溢出）
  tempDbPath: string
}

/**
 * 流式解析文件，写入临时数据库
 * 用于合并功能：解析结果存入临时 SQLite，避免内存溢出
 */
export async function streamParseFileInfo(filePath: string, requestId: string): Promise<StreamParseFileInfoResult> {
  const formatFeature = detectFormat(filePath)
  if (!formatFeature) {
    throw new Error('无法识别文件格式')
  }

  // 获取文件大小
  const fileSize = fs.statSync(filePath).size

  // 立即发送初始进度，让用户知道已开始处理
  sendProgress(requestId, {
    stage: 'parsing',
    bytesRead: 0,
    totalBytes: fileSize,
    messagesProcessed: 0,
    percentage: 0,
    message: '正在读取文件...',
  })

  // 创建临时数据库
  const tempDbPath = generateTempDbPath(filePath)
  const db = createTempDatabase(tempDbPath)

  // 准备语句
  const insertMeta = db.prepare('INSERT INTO meta (name, platform, type) VALUES (?, ?, ?)')
  const insertMember = db.prepare('INSERT OR IGNORE INTO member (platform_id, name, nickname) VALUES (?, ?, ?)')
  const insertMessage = db.prepare(`
    INSERT INTO message (sender_platform_id, sender_name, timestamp, type, content)
    VALUES (?, ?, ?, ?, ?)
  `)

  let meta: ParsedMeta = { name: '未知群聊', platform: formatFeature.platform, type: 'group' }
  const memberSet = new Set<string>()
  let messageCount = 0
  let metaInserted = false

  // 开始事务
  db.exec('BEGIN TRANSACTION')

  try {
    await streamParseFile(filePath, {
      // 对于大文件使用更小的批次，以更频繁地更新进度
      batchSize: fileSize > 100 * 1024 * 1024 ? 2000 : 5000,

      onProgress: (progress) => {
        sendProgress(requestId, progress)
      },

      onMeta: (parsedMeta) => {
        meta = parsedMeta
        if (!metaInserted) {
          insertMeta.run(parsedMeta.name, parsedMeta.platform, parsedMeta.type)
          metaInserted = true
        }
      },

      onMembers: (parsedMembers) => {
        for (const m of parsedMembers) {
          if (!memberSet.has(m.platformId)) {
            memberSet.add(m.platformId)
            insertMember.run(m.platformId, m.name, m.nickname || null)
          }
        }
      },

      onMessageBatch: (batch) => {
        for (const msg of batch) {
          // 确保成员存在
          if (!memberSet.has(msg.senderPlatformId)) {
            memberSet.add(msg.senderPlatformId)
            insertMember.run(msg.senderPlatformId, msg.senderName, null)
          }

          insertMessage.run(msg.senderPlatformId, msg.senderName, msg.timestamp, msg.type, msg.content || null)
          messageCount++
        }
      },
    })

    // 提交事务
    db.exec('COMMIT')
    db.close()

    console.log(`[StreamImport] 已写入临时数据库: ${tempDbPath}, 消息数: ${messageCount}`)

    return {
      name: meta.name,
      format: formatFeature.name,
      platform: meta.platform,
      messageCount,
      memberCount: memberSet.size,
      fileSize,
      tempDbPath,
    }
  } catch (error) {
    // 回滚并清理
    try {
      db.exec('ROLLBACK')
    } catch {
      // 忽略回滚错误
    }
    db.close()

    // 删除失败的临时数据库
    if (fs.existsSync(tempDbPath)) {
      fs.unlinkSync(tempDbPath)
    }

    throw error
  }
}
