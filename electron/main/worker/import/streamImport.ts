/**
 * 流式导入模块
 * 在 Worker 线程中流式解析文件并批量写入数据库
 */

import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import {
  streamParseFile,
  detectFormat,
  getPreprocessor,
  needsPreprocess,
  type ParsedMeta,
  type ParsedMember,
  type ParsedMessage,
} from '../../parser'
import { getDbDir } from '../core'
import {
  initPerfLog,
  logPerf,
  logPerfDetail,
  resetPerfLog,
  logInfo,
  logError,
  logSummary,
  getCurrentLogFile,
} from '../core'
import { sendProgress, generateSessionId, getDbPath, createDatabaseWithoutIndexes, createIndexes } from './utils'

/** 跳过消息的原因统计 */
export interface SkipReasons {
  noSenderId: number
  noAccountName: number
  invalidTimestamp: number
  noType: number
}

/** 导入诊断信息 */
export interface ImportDiagnostics {
  /** 日志文件路径 */
  logFile: string | null
  /** 检测到的格式 */
  detectedFormat: string | null
  /** 收到的消息数 */
  messagesReceived: number
  /** 写入的消息数 */
  messagesWritten: number
  /** 跳过的消息数 */
  messagesSkipped: number
  /** 跳过原因统计 */
  skipReasons: SkipReasons
}

/** 流式导入结果 */
export interface StreamImportResult {
  success: boolean
  sessionId?: string
  error?: string
  /** 诊断信息（成功或失败时都返回） */
  diagnostics?: ImportDiagnostics
}

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
      type TEXT NOT NULL,
      group_id TEXT,
      group_avatar TEXT,
      owner_id TEXT,
      schema_version INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS member (
      platform_id TEXT PRIMARY KEY,
      account_name TEXT,
      group_nickname TEXT,
      avatar TEXT
    );

    CREATE TABLE IF NOT EXISTS message (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_platform_id TEXT NOT NULL,
      sender_account_name TEXT,
      sender_group_nickname TEXT,
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
 * 流式导入聊天记录
 * @param filePath 文件路径
 * @param requestId 请求ID（用于进度回调）
 */
export async function streamImport(filePath: string, requestId: string): Promise<StreamImportResult> {
  // 检测格式
  const formatFeature = detectFormat(filePath)
  if (!formatFeature) {
    return { success: false, error: 'error.unrecognized_format' }
  }

  // 初始化性能日志（实时写入文件）
  resetPerfLog()
  const sessionId = generateSessionId()
  initPerfLog(sessionId)

  // 记录导入开始信息
  logInfo(`文件路径: ${filePath}`)
  logInfo(`检测到格式: ${formatFeature.name} (${formatFeature.id})`)
  logInfo(`平台: ${formatFeature.platform}`)
  logPerf('开始导入', 0)

  // 预处理：如果格式需要且文件较大，先精简
  let actualFilePath = filePath
  let tempFilePath: string | null = null
  const preprocessor = getPreprocessor(filePath)

  if (preprocessor && needsPreprocess(filePath)) {
    logInfo('文件需要预处理，开始精简大文件...')
    sendProgress(requestId, {
      stage: 'parsing',
      bytesRead: 0,
      totalBytes: 0,
      messagesProcessed: 0,
      percentage: 0,
      message: '', // Frontend translates based on stage
    })

    try {
      tempFilePath = await preprocessor.preprocess(filePath, (progress) => {
        sendProgress(requestId, {
          ...progress,
          message: '', // Frontend translates based on stage
        })
      })
      actualFilePath = tempFilePath
      logInfo(`预处理完成，临时文件: ${tempFilePath}`)
    } catch (err) {
      const errorMsg = `预处理失败: ${err instanceof Error ? err.message : String(err)}`
      logError(errorMsg, err instanceof Error ? err : undefined)
      return {
        success: false,
        error: errorMsg,
      }
    }
  }

  const db = createDatabaseWithoutIndexes(sessionId)

  // 准备语句
  const insertMeta = db.prepare(`
    INSERT INTO meta (name, platform, type, imported_at, group_id, group_avatar, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  const insertMember = db.prepare(`
    INSERT OR IGNORE INTO member (platform_id, account_name, group_nickname, avatar, roles) VALUES (?, ?, ?, ?, ?)
  `)
  const getMemberId = db.prepare(`SELECT id FROM member WHERE platform_id = ?`)
  const insertMessage = db.prepare(`
    INSERT INTO message (sender_id, sender_account_name, sender_group_nickname, ts, type, content, reply_to_message_id, platform_message_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertNameHistory = db.prepare(`
    INSERT INTO member_name_history (member_id, name_type, name, start_ts, end_ts) VALUES (?, ?, ?, ?, ?)
  `)
  const updateMemberAccountName = db.prepare(`UPDATE member SET account_name = ? WHERE platform_id = ?`)
  const updateMemberGroupNickname = db.prepare(`UPDATE member SET group_nickname = ? WHERE platform_id = ?`)

  // 成员ID映射（platformId -> dbId）
  const memberIdMap = new Map<string, number>()
  // 分别追踪 account_name 和 group_nickname 的变化
  const accountNameTracker = new Map<
    string,
    {
      currentName: string
      lastSeenTs: number
      history: Array<{ name: string; startTs: number }>
    }
  >()
  const groupNicknameTracker = new Map<
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
    } catch {
      // 忽略 WAL checkpoint 失败
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

      // Send write progress (frontend shows messagesProcessed count)
      sendProgress(requestId, {
        stage: 'importing',
        bytesRead: 0,
        totalBytes: 0,
        messagesProcessed: totalMessageCount,
        percentage: 100,
        message: '', // Frontend translates based on stage and shows messagesProcessed
      })
    }
    beginTransaction()
  }

  beginTransaction()

  // 标记是否需要在 finally 中删除数据库文件
  // 仅在导入失败或消息数为 0 时设置为 true
  let shouldDeleteDb = false
  let importError: string | null = null

  // 统计回调调用次数（用于诊断）
  const callbackStats = {
    onProgressCalls: 0,
    onLogCalls: 0,
    onMetaCalls: 0,
    onMembersCalls: 0,
    onMessageBatchCalls: 0,
    totalMembersReceived: 0,
    totalMessagesReceived: 0,
    skippedNoSenderId: 0,
    skippedNoAccountName: 0,
    skippedInvalidTimestamp: 0,
    skippedNoType: 0,
  }

  logInfo('开始调用 streamParseFile...')

  try {
    await streamParseFile(actualFilePath, {
      batchSize: 5000,

      onProgress: (progress) => {
        callbackStats.onProgressCalls++
        // 转发进度到主进程
        sendProgress(requestId, progress)
      },

      onLog: (level, message) => {
        callbackStats.onLogCalls++
        // 将解析器日志写入导入日志文件
        if (level === 'error') {
          logError(message)
        } else {
          logInfo(message)
        }
      },

      onMeta: (meta: ParsedMeta) => {
        callbackStats.onMetaCalls++
        if (!metaInserted) {
          logInfo(`写入 meta: name=${meta.name}, type=${meta.type}, platform=${meta.platform}`)
          insertMeta.run(
            meta.name,
            meta.platform,
            meta.type,
            Math.floor(Date.now() / 1000),
            meta.groupId || null,
            meta.groupAvatar || null,
            meta.ownerId || null
          )
          metaInserted = true
        }
      },

      onMembers: (members: ParsedMember[]) => {
        callbackStats.onMembersCalls++
        callbackStats.totalMembersReceived += members.length
        logInfo(`收到成员批次: ${members.length} 个成员`)
        for (const member of members) {
          insertMember.run(
            member.platformId,
            member.accountName || null,
            member.groupNickname || null,
            member.avatar || null,
            member.roles ? JSON.stringify(member.roles) : '[]'
          )
          const row = getMemberId.get(member.platformId) as { id: number } | undefined
          if (row) {
            memberIdMap.set(member.platformId, row.id)
          }
        }
      },

      onMessageBatch: (messages: ParsedMessage[]) => {
        callbackStats.onMessageBatchCalls++
        callbackStats.totalMessagesReceived += messages.length
        // 每收到 10 批消息记录一次日志
        if (callbackStats.onMessageBatchCalls <= 3 || callbackStats.onMessageBatchCalls % 10 === 0) {
          logInfo(`收到消息批次 #${callbackStats.onMessageBatchCalls}: ${messages.length} 条消息`)
        }

        // 分阶段计时
        let memberLookupTime = 0
        let memberInsertTime = 0
        let messageInsertTime = 0
        let nicknameTrackTime = 0
        let memberLookupCount = 0
        let memberInsertCount = 0
        let nicknameChangeCount = 0

        for (const msg of messages) {
          // 数据验证：跳过无效消息（带统计）
          if (!msg.senderPlatformId) {
            callbackStats.skippedNoSenderId++
            continue
          }
          if (!msg.senderAccountName) {
            callbackStats.skippedNoAccountName++
            continue
          }
          if (msg.timestamp === undefined || msg.timestamp === null || isNaN(msg.timestamp)) {
            callbackStats.skippedInvalidTimestamp++
            continue
          }
          if (msg.type === undefined || msg.type === null) {
            callbackStats.skippedNoType++
            continue
          }

          // 确保成员存在
          let t0 = Date.now()
          if (!memberIdMap.has(msg.senderPlatformId)) {
            // 消息中没有头像和角色信息，设为默认值
            insertMember.run(
              msg.senderPlatformId,
              msg.senderAccountName || null,
              msg.senderGroupNickname || null,
              null,
              '[]'
            )
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
          // 防御性处理：确保所有值都是 SQLite 兼容的类型
          // SQLite 只支持: numbers, strings, bigints, buffers, null
          let safeContent: string | null = null
          if (msg.content != null) {
            safeContent = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
          }

          t0 = Date.now()
          insertMessage.run(
            senderId,
            msg.senderAccountName || null,
            msg.senderGroupNickname || null,
            msg.timestamp,
            msg.type,
            safeContent,
            msg.replyToMessageId || null,
            msg.platformMessageId || null
          )
          messageInsertTime += Date.now() - t0
          messageCountInBatch++
          totalMessageCount++

          // 追踪昵称变化（仅记录，不写入数据库，最后批量处理）
          t0 = Date.now()

          // 追踪 account_name 变化
          const accountName = msg.senderAccountName
          if (accountName && accountName !== msg.senderPlatformId) {
            const tracker = accountNameTracker.get(msg.senderPlatformId)
            if (!tracker) {
              accountNameTracker.set(msg.senderPlatformId, {
                currentName: accountName,
                lastSeenTs: msg.timestamp,
                history: [{ name: accountName, startTs: msg.timestamp }],
              })
              nicknameChangeCount++
            } else if (tracker.currentName !== accountName) {
              tracker.history.push({ name: accountName, startTs: msg.timestamp })
              tracker.currentName = accountName
              tracker.lastSeenTs = msg.timestamp
              nicknameChangeCount++
            } else {
              tracker.lastSeenTs = msg.timestamp
            }
          }

          // 追踪 group_nickname 变化
          const groupNickname = msg.senderGroupNickname
          if (groupNickname) {
            const tracker = groupNicknameTracker.get(msg.senderPlatformId)
            if (!tracker) {
              groupNicknameTracker.set(msg.senderPlatformId, {
                currentName: groupNickname,
                lastSeenTs: msg.timestamp,
                history: [{ name: groupNickname, startTs: msg.timestamp }],
              })
              nicknameChangeCount++
            } else if (tracker.currentName !== groupNickname) {
              tracker.history.push({ name: groupNickname, startTs: msg.timestamp })
              tracker.currentName = groupNickname
              tracker.lastSeenTs = msg.timestamp
              nicknameChangeCount++
            } else {
              tracker.lastSeenTs = msg.timestamp
            }
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
      message: '', // Frontend translates based on stage
    })
    logPerf('开始写入昵称历史', totalMessageCount)

    // 开始新事务
    db.exec('BEGIN TRANSACTION')
    let historyCount = 0
    let filteredCount = 0

    // 处理 account_name 历史
    for (const [platformId, tracker] of accountNameTracker.entries()) {
      if (!platformId || platformId === '0' || platformId === 'undefined') continue

      const senderId = memberIdMap.get(platformId)
      if (!senderId) continue

      // 清理历史记录
      const uniqueNames = new Map<string, { startTs: number; lastTs: number }>()
      for (const h of tracker.history) {
        const existing = uniqueNames.get(h.name)
        if (!existing) {
          uniqueNames.set(h.name, { startTs: h.startTs, lastTs: h.startTs })
        } else {
          existing.lastTs = h.startTs
        }
      }

      uniqueNames.delete(platformId)

      if (uniqueNames.size <= 1) {
        filteredCount++
        updateMemberAccountName.run(tracker.currentName, platformId)
        continue
      }

      const sortedHistory = Array.from(uniqueNames.entries()).sort((a, b) => a[1].startTs - b[1].startTs)
      for (let i = 0; i < sortedHistory.length; i++) {
        const [name, { startTs }] = sortedHistory[i]
        const endTs = i < sortedHistory.length - 1 ? sortedHistory[i + 1][1].startTs : null
        insertNameHistory.run(senderId, 'account_name', name, startTs, endTs)
        historyCount++
      }

      updateMemberAccountName.run(tracker.currentName, platformId)
    }

    // 处理 group_nickname 历史
    for (const [platformId, tracker] of groupNicknameTracker.entries()) {
      if (!platformId || platformId === '0' || platformId === 'undefined') continue

      const senderId = memberIdMap.get(platformId)
      if (!senderId) continue

      const uniqueNames = new Map<string, { startTs: number; lastTs: number }>()
      for (const h of tracker.history) {
        const existing = uniqueNames.get(h.name)
        if (!existing) {
          uniqueNames.set(h.name, { startTs: h.startTs, lastTs: h.startTs })
        } else {
          existing.lastTs = h.startTs
        }
      }

      if (uniqueNames.size <= 1) {
        filteredCount++
        updateMemberGroupNickname.run(tracker.currentName, platformId)
        continue
      }

      const sortedHistory = Array.from(uniqueNames.entries()).sort((a, b) => a[1].startTs - b[1].startTs)
      for (let i = 0; i < sortedHistory.length; i++) {
        const [name, { startTs }] = sortedHistory[i]
        const endTs = i < sortedHistory.length - 1 ? sortedHistory[i + 1][1].startTs : null
        insertNameHistory.run(senderId, 'group_nickname', name, startTs, endTs)
        historyCount++
      }

      updateMemberGroupNickname.run(tracker.currentName, platformId)
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
      message: '', // Frontend translates based on stage
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
      message: '', // Frontend translates based on stage
    })
    doCheckpoint()
    logPerf('WAL checkpoint 完成', totalMessageCount)
    logPerf('导入完成', totalMessageCount)

    // 记录解析器回调统计（诊断信息）
    logInfo(`=== 解析器回调统计 ===`)
    logInfo(`onProgress 调用次数: ${callbackStats.onProgressCalls}`)
    logInfo(`onLog 调用次数: ${callbackStats.onLogCalls}`)
    logInfo(`onMeta 调用次数: ${callbackStats.onMetaCalls}`)
    logInfo(`onMembers 调用次数: ${callbackStats.onMembersCalls}, 总成员数: ${callbackStats.totalMembersReceived}`)
    logInfo(
      `onMessageBatch 调用次数: ${callbackStats.onMessageBatchCalls}, 总消息数: ${callbackStats.totalMessagesReceived}`
    )
    if (
      callbackStats.skippedNoSenderId > 0 ||
      callbackStats.skippedNoAccountName > 0 ||
      callbackStats.skippedInvalidTimestamp > 0 ||
      callbackStats.skippedNoType > 0
    ) {
      logInfo(`=== 消息跳过统计 ===`)
      if (callbackStats.skippedNoSenderId > 0) logInfo(`  无 senderPlatformId: ${callbackStats.skippedNoSenderId}`)
      if (callbackStats.skippedNoAccountName > 0)
        logInfo(`  无 senderAccountName: ${callbackStats.skippedNoAccountName}`)
      if (callbackStats.skippedInvalidTimestamp > 0)
        logInfo(`  无效 timestamp: ${callbackStats.skippedInvalidTimestamp}`)
      if (callbackStats.skippedNoType > 0) logInfo(`  无 type: ${callbackStats.skippedNoType}`)
    }

    // 写入日志摘要
    logSummary(totalMessageCount, memberIdMap.size)

    // 检查消息数量，如果为 0 则视为导入失败
    if (totalMessageCount === 0) {
      logError(
        `导入失败：未解析到任何消息 (收到 ${callbackStats.totalMessagesReceived} 条消息，全部被跳过或未收到任何消息)`
      )
      // 标记需要删除数据库文件（将在 finally 中执行，确保数据库已关闭）
      shouldDeleteDb = true
      importError = 'error.no_messages'
    }
  } catch (error) {
    // 记录错误日志
    logError('导入失败', error instanceof Error ? error : undefined)

    // 回滚当前事务
    if (inTransaction) {
      try {
        db.exec('ROLLBACK')
      } catch {
        // 忽略回滚错误
      }
    }

    // 标记需要删除数据库文件（将在 finally 中执行，确保数据库已关闭）
    shouldDeleteDb = true
    importError = error instanceof Error ? error.message : String(error)
  } finally {
    // 先关闭数据库连接（释放文件锁）
    db.close()

    // 清理临时文件
    if (tempFilePath && preprocessor) {
      preprocessor.cleanup(tempFilePath)
    }

    // 删除失败的数据库文件（在数据库关闭后执行，避免 Windows 上的 EBUSY 错误）
    if (shouldDeleteDb) {
      const dbPath = getDbPath(sessionId)
      try {
        if (fs.existsSync(dbPath)) {
          fs.unlinkSync(dbPath)
        }
        // 同时清理 WAL 和 SHM 文件
        const walPath = dbPath + '-wal'
        const shmPath = dbPath + '-shm'
        if (fs.existsSync(walPath)) {
          fs.unlinkSync(walPath)
        }
        if (fs.existsSync(shmPath)) {
          fs.unlinkSync(shmPath)
        }
      } catch (cleanupError) {
        logError('清理失败的数据库文件时出错', cleanupError instanceof Error ? cleanupError : undefined)
      }
    }
  }

  // 构造诊断信息
  const diagnostics: ImportDiagnostics = {
    logFile: getCurrentLogFile(),
    detectedFormat: formatFeature ? `${formatFeature.name} (${formatFeature.id})` : null,
    messagesReceived: callbackStats.totalMessagesReceived,
    messagesWritten: totalMessageCount,
    messagesSkipped:
      callbackStats.skippedNoSenderId +
      callbackStats.skippedNoAccountName +
      callbackStats.skippedInvalidTimestamp +
      callbackStats.skippedNoType,
    skipReasons: {
      noSenderId: callbackStats.skippedNoSenderId,
      noAccountName: callbackStats.skippedNoAccountName,
      invalidTimestamp: callbackStats.skippedInvalidTimestamp,
      noType: callbackStats.skippedNoType,
    },
  }

  // 返回结果（移到 try-catch-finally 之外）
  if (importError) {
    return { success: false, error: importError, diagnostics }
  }
  return { success: true, sessionId, diagnostics }
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
    message: '', // Frontend translates based on stage
  })

  // 创建临时数据库
  const tempDbPath = generateTempDbPath(filePath)
  const db = createTempDatabase(tempDbPath)

  // 准备语句
  const insertMeta = db.prepare(
    'INSERT INTO meta (name, platform, type, group_id, group_avatar, owner_id) VALUES (?, ?, ?, ?, ?, ?)'
  )
  const insertMember = db.prepare(
    'INSERT OR IGNORE INTO member (platform_id, account_name, group_nickname, avatar) VALUES (?, ?, ?, ?)'
  )
  const insertMessage = db.prepare(`
    INSERT INTO message (sender_platform_id, sender_account_name, sender_group_nickname, timestamp, type, content)
    VALUES (?, ?, ?, ?, ?, ?)
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
          insertMeta.run(
            parsedMeta.name,
            parsedMeta.platform,
            parsedMeta.type,
            parsedMeta.groupId || null,
            parsedMeta.groupAvatar || null,
            parsedMeta.ownerId || null
          )
          metaInserted = true
        }
      },

      onMembers: (parsedMembers) => {
        for (const m of parsedMembers) {
          if (!memberSet.has(m.platformId)) {
            memberSet.add(m.platformId)
            insertMember.run(m.platformId, m.accountName || null, m.groupNickname || null, m.avatar || null)
          }
        }
      },

      onMessageBatch: (batch) => {
        for (const msg of batch) {
          // 确保成员存在
          if (!memberSet.has(msg.senderPlatformId)) {
            memberSet.add(msg.senderPlatformId)
            // 消息中没有头像信息，设为 null
            insertMember.run(msg.senderPlatformId, msg.senderAccountName || null, msg.senderGroupNickname || null, null)
          }

          insertMessage.run(
            msg.senderPlatformId,
            msg.senderAccountName || null,
            msg.senderGroupNickname || null,
            msg.timestamp,
            msg.type,
            msg.content || null
          )
          messageCount++
        }
      },
    })

    // 提交事务
    db.exec('COMMIT')
    db.close()

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
