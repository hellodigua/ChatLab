/**
 * 数据库 Worker 线程
 * 在独立线程中执行数据库操作，避免阻塞主进程
 *
 * 本文件作为 Worker 入口，负责：
 * 1. 初始化数据库目录
 * 2. 接收主进程消息
 * 3. 分发到对应的查询模块
 * 4. 返回结果
 */

import { parentPort, workerData } from 'worker_threads'
import { initDbDir, closeDatabase, closeAllDatabases } from './core'
import {
  getAvailableYears,
  getMemberActivity,
  getHourlyActivity,
  getDailyActivity,
  getWeekdayActivity,
  getMonthlyActivity,
  getMessageTypeDistribution,
  getTimeRange,
  getMemberNameHistory,
  getAllSessions,
  getSession,
  getRepeatAnalysis,
  getCatchphraseAnalysis,
  getNightOwlAnalysis,
  getDragonKingAnalysis,
  getDivingAnalysis,
  getMonologueAnalysis,
  getMentionAnalysis,
  getLaughAnalysis,
  getMemeBattleAnalysis,
  getCheckInAnalysis,
  searchMessages,
  getMessageContext,
  getRecentMessages,
  getAllRecentMessages,
  getConversationBetween,
  getMessagesBefore,
  getMessagesAfter,
  // 成员管理
  getMembers,
  updateMemberAliases,
  deleteMember,
  // SQL 实验室
  executeRawSQL,
  getSchema,
  // 会话索引
  generateSessions,
  clearSessions,
  hasSessionIndex,
  getSessionStats,
  updateSessionGapThreshold,
  getSessions,
} from './query'
import { streamImport, streamParseFileInfo } from './import'

// 初始化数据库目录
initDbDir(workerData.dbDir)

// ==================== 消息处理 ====================

interface WorkerMessage {
  id: string
  type: string
  payload: any
}

// 同步消息处理器
const syncHandlers: Record<string, (payload: any) => any> = {
  // 基础查询
  getAvailableYears: (p) => getAvailableYears(p.sessionId),
  getMemberActivity: (p) => getMemberActivity(p.sessionId, p.filter),
  getHourlyActivity: (p) => getHourlyActivity(p.sessionId, p.filter),
  getDailyActivity: (p) => getDailyActivity(p.sessionId, p.filter),
  getWeekdayActivity: (p) => getWeekdayActivity(p.sessionId, p.filter),
  getMonthlyActivity: (p) => getMonthlyActivity(p.sessionId, p.filter),
  getMessageTypeDistribution: (p) => getMessageTypeDistribution(p.sessionId, p.filter),
  getTimeRange: (p) => getTimeRange(p.sessionId),
  getMemberNameHistory: (p) => getMemberNameHistory(p.sessionId, p.memberId),

  // 会话管理
  getAllSessions: () => getAllSessions(),
  getSession: (p) => getSession(p.sessionId),
  closeDatabase: (p) => {
    closeDatabase(p.sessionId)
    return true
  },
  closeAll: () => {
    closeAllDatabases()
    return true
  },

  // 成员管理
  getMembers: (p) => getMembers(p.sessionId),
  updateMemberAliases: (p) => updateMemberAliases(p.sessionId, p.memberId, p.aliases),
  deleteMember: (p) => deleteMember(p.sessionId, p.memberId),

  // 高级分析
  getRepeatAnalysis: (p) => getRepeatAnalysis(p.sessionId, p.filter),
  getCatchphraseAnalysis: (p) => getCatchphraseAnalysis(p.sessionId, p.filter),
  getNightOwlAnalysis: (p) => getNightOwlAnalysis(p.sessionId, p.filter),
  getDragonKingAnalysis: (p) => getDragonKingAnalysis(p.sessionId, p.filter),
  getDivingAnalysis: (p) => getDivingAnalysis(p.sessionId, p.filter),
  getMonologueAnalysis: (p) => getMonologueAnalysis(p.sessionId, p.filter),
  getMentionAnalysis: (p) => getMentionAnalysis(p.sessionId, p.filter),
  getLaughAnalysis: (p) => getLaughAnalysis(p.sessionId, p.filter, p.keywords),
  getMemeBattleAnalysis: (p) => getMemeBattleAnalysis(p.sessionId, p.filter),
  getCheckInAnalysis: (p) => getCheckInAnalysis(p.sessionId, p.filter),

  // AI 查询
  searchMessages: (p) => searchMessages(p.sessionId, p.keywords, p.filter, p.limit, p.offset, p.senderId),
  getMessageContext: (p) => getMessageContext(p.sessionId, p.messageIds, p.contextSize),
  getRecentMessages: (p) => getRecentMessages(p.sessionId, p.filter, p.limit),
  getAllRecentMessages: (p) => getAllRecentMessages(p.sessionId, p.filter, p.limit),
  getConversationBetween: (p) => getConversationBetween(p.sessionId, p.memberId1, p.memberId2, p.filter, p.limit),
  getMessagesBefore: (p) => getMessagesBefore(p.sessionId, p.beforeId, p.limit, p.filter, p.senderId, p.keywords),
  getMessagesAfter: (p) => getMessagesAfter(p.sessionId, p.afterId, p.limit, p.filter, p.senderId, p.keywords),

  // SQL 实验室
  executeRawSQL: (p) => executeRawSQL(p.sessionId, p.sql),
  getSchema: (p) => getSchema(p.sessionId),

  // 会话索引
  generateSessions: (p) => generateSessions(p.sessionId, p.gapThreshold),
  clearSessions: (p) => clearSessions(p.sessionId),
  hasSessionIndex: (p) => hasSessionIndex(p.sessionId),
  getSessionStats: (p) => getSessionStats(p.sessionId),
  updateSessionGapThreshold: (p) => updateSessionGapThreshold(p.sessionId, p.gapThreshold),
  getSessions: (p) => getSessions(p.sessionId),
}

// 异步消息处理器（流式操作）
const asyncHandlers: Record<string, (payload: any, requestId: string) => Promise<any>> = {
  // 流式导入
  streamImport: (p, id) => streamImport(p.filePath, id),
  // 流式解析文件信息（用于合并预览）
  streamParseFileInfo: (p, id) => streamParseFileInfo(p.filePath, id),
}

// 处理消息
parentPort?.on('message', async (message: WorkerMessage) => {
  const { id, type, payload } = message

  try {
    // 检查是否是异步处理器
    const asyncHandler = asyncHandlers[type]
    if (asyncHandler) {
      const result = await asyncHandler(payload, id)
      parentPort?.postMessage({ id, success: true, result })
      return
    }

    // 同步处理器
    const syncHandler = syncHandlers[type]
    if (!syncHandler) {
      throw new Error(`Unknown message type: ${type}`)
    }

    const result = syncHandler(payload)
    parentPort?.postMessage({ id, success: true, result })
  } catch (error) {
    parentPort?.postMessage({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
})

// 进程退出时关闭所有数据库连接
process.on('exit', () => {
  closeAllDatabases()
})
