/**
 * Worker 管理器
 * 负责创建、管理 Worker 线程，并处理与主进程的通信
 */

import { Worker } from 'worker_threads'
import { app } from 'electron'
import * as path from 'path'
import type { ParseProgress } from '../parser'
import { getDatabaseDir, ensureDir } from '../paths'

// Worker 实例
let worker: Worker | null = null

// 等待中的请求 Map
const pendingRequests = new Map<
  string,
  {
    resolve: (value: any) => void
    reject: (error: Error) => void
    onProgress?: (progress: ParseProgress) => void // 进度回调
  }
>()

// 请求 ID 计数器
let requestIdCounter = 0

/**
 * 获取数据库目录
 */
function getDbDir(): string {
  const dir = getDatabaseDir()
  ensureDir(dir)
  return dir
}

/**
 * 获取 Worker 文件路径
 * 开发环境和生产环境路径不同
 */
function getWorkerPath(): string {
  // 检查是否在开发环境
  const isDev = !app.isPackaged

  if (isDev) {
    // 开发环境：编译后的 JS 文件在 out/main 目录
    return path.join(__dirname, 'worker', 'dbWorker.js')
  } else {
    // 生产环境：打包后的路径
    return path.join(__dirname, 'worker', 'dbWorker.js')
  }
}

/**
 * 初始化 Worker
 */
export function initWorker(): void {
  if (worker) {
    console.log('[WorkerManager] Worker already initialized')
    return
  }

  const workerPath = getWorkerPath()
  console.log('[WorkerManager] Initializing worker at:', workerPath)

  try {
    worker = new Worker(workerPath, {
      workerData: {
        dbDir: getDbDir(),
      },
    })

    // 监听 Worker 消息
    worker.on('message', (message) => {
      const { id, type, success, result, error, payload } = message

      const pending = pendingRequests.get(id)
      if (!pending) return

      // 处理进度消息（不删除 pending，因为还没完成）
      if (type === 'progress') {
        if (pending.onProgress) {
          pending.onProgress(payload)
        }
        return
      }

      // 处理完成或错误消息
      pendingRequests.delete(id)

      if (success) {
        pending.resolve(result)
      } else {
        pending.reject(new Error(error))
      }
    })

    // 监听 Worker 错误
    worker.on('error', (error) => {
      console.error('[WorkerManager] Worker error:', error)
    })

    // 监听 Worker 退出
    worker.on('exit', (code) => {
      console.log('[WorkerManager] Worker exited with code:', code)
      worker = null

      // 拒绝所有等待中的请求
      for (const [id, pending] of pendingRequests.entries()) {
        pending.reject(new Error('Worker exited unexpectedly'))
        pendingRequests.delete(id)
      }
    })

    console.log('[WorkerManager] Worker initialized successfully')
  } catch (error) {
    console.error('[WorkerManager] Failed to initialize worker:', error)
    throw error
  }
}

/**
 * 发送消息到 Worker 并等待响应
 */
function sendToWorker<T>(type: string, payload: any): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!worker) {
      try {
        initWorker()
      } catch (error) {
        reject(new Error('Worker not initialized'))
        return
      }
    }

    const id = `req_${++requestIdCounter}`

    pendingRequests.set(id, { resolve, reject })

    worker!.postMessage({ id, type, payload })

    // 设置超时（30秒）
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id)
        reject(new Error(`Worker request timeout: ${type}`))
      }
    }, 30000)
  })
}

/**
 * 发送消息到 Worker 并等待响应（带进度回调）
 * 用于流式导入等长时间操作
 */
function sendToWorkerWithProgress<T>(
  type: string,
  payload: any,
  onProgress?: (progress: ParseProgress) => void,
  timeoutMs: number = 600000 // 默认 10 分钟超时
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!worker) {
      try {
        initWorker()
      } catch (error) {
        reject(new Error('Worker not initialized'))
        return
      }
    }

    const id = `req_${++requestIdCounter}`

    pendingRequests.set(id, { resolve, reject, onProgress })

    worker!.postMessage({ id, type, payload })

    // 设置超时
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id)
        reject(new Error(`Worker request timeout: ${type}`))
      }
    }, timeoutMs)
  })
}

/**
 * 关闭 Worker
 */
export function closeWorker(): void {
  if (worker) {
    // 先关闭所有数据库连接
    sendToWorker('closeAll', {}).catch(() => {})

    worker.terminate()
    worker = null
    console.log('[WorkerManager] Worker terminated')
  }
}

// ==================== 导出的异步 API ====================

export async function getAvailableYears(sessionId: string): Promise<number[]> {
  return sendToWorker('getAvailableYears', { sessionId })
}

export async function getMemberActivity(sessionId: string, filter?: any): Promise<any[]> {
  return sendToWorker('getMemberActivity', { sessionId, filter })
}

export async function getHourlyActivity(sessionId: string, filter?: any): Promise<any[]> {
  return sendToWorker('getHourlyActivity', { sessionId, filter })
}

export async function getDailyActivity(sessionId: string, filter?: any): Promise<any[]> {
  return sendToWorker('getDailyActivity', { sessionId, filter })
}

export async function getWeekdayActivity(sessionId: string, filter?: any): Promise<any[]> {
  return sendToWorker('getWeekdayActivity', { sessionId, filter })
}

export async function getMonthlyActivity(sessionId: string, filter?: any): Promise<any[]> {
  return sendToWorker('getMonthlyActivity', { sessionId, filter })
}

export async function getMessageTypeDistribution(sessionId: string, filter?: any): Promise<any[]> {
  return sendToWorker('getMessageTypeDistribution', { sessionId, filter })
}

export async function getTimeRange(sessionId: string): Promise<{ start: number; end: number } | null> {
  return sendToWorker('getTimeRange', { sessionId })
}

export async function getMemberNameHistory(sessionId: string, memberId: number): Promise<any[]> {
  return sendToWorker('getMemberNameHistory', { sessionId, memberId })
}

export async function getRepeatAnalysis(sessionId: string, filter?: any): Promise<any> {
  return sendToWorker('getRepeatAnalysis', { sessionId, filter })
}

export async function getCatchphraseAnalysis(sessionId: string, filter?: any): Promise<any> {
  return sendToWorker('getCatchphraseAnalysis', { sessionId, filter })
}

export async function getNightOwlAnalysis(sessionId: string, filter?: any): Promise<any> {
  return sendToWorker('getNightOwlAnalysis', { sessionId, filter })
}

export async function getDragonKingAnalysis(sessionId: string, filter?: any): Promise<any> {
  return sendToWorker('getDragonKingAnalysis', { sessionId, filter })
}

export async function getDivingAnalysis(sessionId: string, filter?: any): Promise<any> {
  return sendToWorker('getDivingAnalysis', { sessionId, filter })
}

export async function getMonologueAnalysis(sessionId: string, filter?: any): Promise<any> {
  return sendToWorker('getMonologueAnalysis', { sessionId, filter })
}

export async function getMentionAnalysis(sessionId: string, filter?: any): Promise<any> {
  return sendToWorker('getMentionAnalysis', { sessionId, filter })
}

export async function getLaughAnalysis(sessionId: string, filter?: any, keywords?: string[]): Promise<any> {
  return sendToWorker('getLaughAnalysis', { sessionId, filter, keywords })
}

export async function getMemeBattleAnalysis(sessionId: string, filter?: any): Promise<any> {
  return sendToWorker('getMemeBattleAnalysis', { sessionId, filter })
}

export async function getCheckInAnalysis(sessionId: string, filter?: any): Promise<any> {
  return sendToWorker('getCheckInAnalysis', { sessionId, filter })
}

export async function getAllSessions(): Promise<any[]> {
  return sendToWorker('getAllSessions', {})
}

export async function getSession(sessionId: string): Promise<any | null> {
  return sendToWorker('getSession', { sessionId })
}

export async function closeDatabase(sessionId: string): Promise<void> {
  return sendToWorker('closeDatabase', { sessionId })
}

// ==================== 成员管理 API ====================

export interface MemberWithStats {
  id: number
  platformId: string
  name: string
  nickname: string | null
  aliases: string[]
  messageCount: number
}

/**
 * 获取所有成员列表（含消息数和别名）
 */
export async function getMembers(sessionId: string): Promise<MemberWithStats[]> {
  return sendToWorker('getMembers', { sessionId })
}

/**
 * 更新成员别名
 */
export async function updateMemberAliases(sessionId: string, memberId: number, aliases: string[]): Promise<boolean> {
  return sendToWorker('updateMemberAliases', { sessionId, memberId, aliases })
}

/**
 * 删除成员及其所有消息
 */
export async function deleteMember(sessionId: string, memberId: number): Promise<boolean> {
  return sendToWorker('deleteMember', { sessionId, memberId })
}

/**
 * 流式解析文件，写入临时数据库（用于合并功能）
 * 返回基本信息和临时数据库路径
 */
export async function streamParseFileInfo(
  filePath: string,
  onProgress?: (progress: ParseProgress) => void
): Promise<{
  name: string
  format: string
  platform: string
  messageCount: number
  memberCount: number
  fileSize: number
  tempDbPath: string
}> {
  return sendToWorkerWithProgress('streamParseFileInfo', { filePath }, onProgress)
}

/**
 * 流式导入聊天记录
 * @param filePath 文件路径
 * @param onProgress 进度回调
 */
export async function streamImport(
  filePath: string,
  onProgress?: (progress: ParseProgress) => void
): Promise<{ success: boolean; sessionId?: string; error?: string }> {
  return sendToWorkerWithProgress('streamImport', { filePath }, onProgress)
}

/**
 * 获取数据库目录（供外部使用）
 */
export function getDbDirectory(): string {
  return getDbDir()
}

// ==================== AI 查询 API ====================

export interface SearchMessageResult {
  id: number
  senderName: string
  senderPlatformId: string
  senderAliases: string[]
  senderAvatar: string | null
  content: string
  timestamp: number
  type: number
}

/**
 * 关键词搜索消息
 */
export async function searchMessages(
  sessionId: string,
  keywords: string[],
  filter?: any,
  limit?: number,
  offset?: number,
  senderId?: number
): Promise<{ messages: SearchMessageResult[]; total: number }> {
  return sendToWorker('searchMessages', { sessionId, keywords, filter, limit, offset, senderId })
}

/**
 * 获取消息上下文
 * 支持单个或批量消息 ID，返回合并去重后的上下文消息
 */
export async function getMessageContext(
  sessionId: string,
  messageIds: number | number[],
  contextSize?: number
): Promise<SearchMessageResult[]> {
  return sendToWorker('getMessageContext', { sessionId, messageIds, contextSize })
}

/**
 * 获取最近消息（用于概览性问题）
 */
export async function getRecentMessages(
  sessionId: string,
  filter?: any,
  limit?: number
): Promise<{ messages: SearchMessageResult[]; total: number }> {
  return sendToWorker('getRecentMessages', { sessionId, filter, limit })
}

/**
 * 获取所有最近消息（消息查看器专用，包含所有类型消息）
 */
export async function getAllRecentMessages(
  sessionId: string,
  filter?: any,
  limit?: number
): Promise<{ messages: SearchMessageResult[]; total: number }> {
  return sendToWorker('getAllRecentMessages', { sessionId, filter, limit })
}

/**
 * 获取两个成员之间的对话
 */
export async function getConversationBetween(
  sessionId: string,
  memberId1: number,
  memberId2: number,
  filter?: any,
  limit?: number
): Promise<{ messages: SearchMessageResult[]; total: number; member1Name: string; member2Name: string }> {
  return sendToWorker('getConversationBetween', { sessionId, memberId1, memberId2, filter, limit })
}

/**
 * 获取指定消息之前的 N 条消息（用于向上无限滚动）
 */
export async function getMessagesBefore(
  sessionId: string,
  beforeId: number,
  limit?: number,
  filter?: any,
  senderId?: number,
  keywords?: string[]
): Promise<{ messages: SearchMessageResult[]; hasMore: boolean }> {
  return sendToWorker('getMessagesBefore', { sessionId, beforeId, limit, filter, senderId, keywords })
}

/**
 * 获取指定消息之后的 N 条消息（用于向下无限滚动）
 */
export async function getMessagesAfter(
  sessionId: string,
  afterId: number,
  limit?: number,
  filter?: any,
  senderId?: number,
  keywords?: string[]
): Promise<{ messages: SearchMessageResult[]; hasMore: boolean }> {
  return sendToWorker('getMessagesAfter', { sessionId, afterId, limit, filter, senderId, keywords })
}

// ==================== SQL 实验室 API ====================

export interface SQLResult {
  columns: string[]
  rows: any[][]
  rowCount: number
  duration: number
  limited: boolean
}

export interface TableSchema {
  name: string
  columns: {
    name: string
    type: string
    notnull: boolean
    pk: boolean
  }[]
}

/**
 * 执行用户 SQL 查询
 */
export async function executeRawSQL(sessionId: string, sql: string): Promise<SQLResult> {
  return sendToWorker('executeRawSQL', { sessionId, sql })
}

/**
 * 获取数据库 Schema
 */
export async function getSchema(sessionId: string): Promise<TableSchema[]> {
  return sendToWorker('getSchema', { sessionId })
}

// ==================== 会话索引 API ====================

export interface SessionStats {
  sessionCount: number
  hasIndex: boolean
  gapThreshold: number
}

/**
 * 生成会话索引
 * @param sessionId 数据库会话ID
 * @param gapThreshold 时间间隔阈值（秒）
 */
export async function generateSessions(sessionId: string, gapThreshold?: number): Promise<number> {
  return sendToWorker('generateSessions', { sessionId, gapThreshold })
}

/**
 * 清空会话索引
 */
export async function clearSessions(sessionId: string): Promise<void> {
  return sendToWorker('clearSessions', { sessionId })
}

/**
 * 检查是否已生成会话索引
 */
export async function hasSessionIndex(sessionId: string): Promise<boolean> {
  return sendToWorker('hasSessionIndex', { sessionId })
}

/**
 * 获取会话索引统计信息
 */
export async function getSessionStats(sessionId: string): Promise<SessionStats> {
  return sendToWorker('getSessionStats', { sessionId })
}

/**
 * 更新单个聊天的会话切分阈值
 */
export async function updateSessionGapThreshold(sessionId: string, gapThreshold: number | null): Promise<void> {
  return sendToWorker('updateSessionGapThreshold', { sessionId, gapThreshold })
}

/**
 * 会话列表项类型
 */
export interface ChatSessionItem {
  id: number
  startTs: number
  endTs: number
  messageCount: number
  firstMessageId: number
}

/**
 * 获取会话列表（用于时间线导航）
 */
export async function getSessions(sessionId: string): Promise<ChatSessionItem[]> {
  return sendToWorker('getSessions', { sessionId })
}
