/**
 * 聊天记录导入与分析 IPC 处理器
 */

import { ipcMain, app, dialog } from 'electron'
import * as databaseCore from '../database/core'
import * as worker from '../worker/workerManager'
import * as parser from '../parser'
import { detectFormat, diagnoseFormat, type ParseProgress } from '../parser'
import type { IpcContext } from './types'
import { CURRENT_SCHEMA_VERSION, getPendingMigrationInfos, type MigrationInfo } from '../database/migrations'

/**
 * 注册聊天记录相关 IPC 处理器
 */
export function registerChatHandlers(ctx: IpcContext): void {
  const { win } = ctx

  // ==================== 数据库迁移 ====================

  /**
   * 检查是否需要数据库迁移
   */
  ipcMain.handle('chat:checkMigration', async () => {
    try {
      const result = databaseCore.checkMigrationNeeded()
      // 获取待执行的迁移信息（从最低版本开始）
      const pendingMigrations = getPendingMigrationInfos(result.lowestVersion)
      return {
        needsMigration: result.count > 0,
        count: result.count,
        currentVersion: CURRENT_SCHEMA_VERSION,
        pendingMigrations,
      }
    } catch (error) {
      console.error('[IpcMain] 检查迁移失败:', error)
      return { needsMigration: false, count: 0, currentVersion: CURRENT_SCHEMA_VERSION, pendingMigrations: [] }
    }
  })

  /**
   * 执行数据库迁移
   */
  ipcMain.handle('chat:runMigration', async () => {
    try {
      const result = databaseCore.migrateAllDatabases()
      return result
    } catch (error) {
      console.error('[IpcMain] 执行迁移失败:', error)
      return { success: false, migratedCount: 0, error: String(error) }
    }
  })

  // ==================== 聊天记录导入与分析 ====================

  /**
   * 选择聊天记录文件
   */
  ipcMain.handle('chat:selectFile', async () => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: '选择聊天记录文件',
        defaultPath: app.getPath('documents'),
        properties: ['openFile'],
        filters: [
          { name: '聊天记录', extensions: ['json', 'jsonl', 'txt'] },
          { name: '所有文件', extensions: ['*'] },
        ],
        buttonLabel: '导入',
      })

      if (canceled || filePaths.length === 0) {
        return null
      }

      const filePath = filePaths[0]

      // 检测文件格式（使用流式检测，只读取文件开头）
      const formatFeature = detectFormat(filePath)
      const format = formatFeature?.name || null
      if (!format) {
        // 使用诊断功能获取详细的错误信息
        const diagnosis = diagnoseFormat(filePath)
        // 返回详细的错误信息
        return {
          error: 'error.unrecognized_format',
          diagnosis: {
            suggestion: diagnosis.suggestion,
            partialMatches: diagnosis.partialMatches.map((m) => ({
              formatName: m.formatName,
              missingFields: m.missingFields,
            })),
          },
        }
      }

      return { filePath, format }
    } catch (error) {
      console.error('[IpcMain] Error selecting file:', error)
      return { error: String(error) }
    }
  })

  /**
   * 导入聊天记录（流式版本）
   */
  ipcMain.handle('chat:import', async (_, filePath: string) => {
    try {
      // Send progress: detecting format (message not used by frontend, stage-based translation)
      win.webContents.send('chat:importProgress', {
        stage: 'detecting',
        progress: 5,
        message: '', // Frontend translates based on stage
      })

      // 使用流式导入（在 Worker 线程中执行）
      const result = await worker.streamImport(filePath, (progress: ParseProgress) => {
        // 转发进度到渲染进程
        win.webContents.send('chat:importProgress', {
          stage: progress.stage,
          progress: progress.percentage,
          message: progress.message,
          bytesRead: progress.bytesRead,
          totalBytes: progress.totalBytes,
          messagesProcessed: progress.messagesProcessed,
        })
      })

      if (result.success) {
        console.log('[IpcMain] Stream import successful, sessionId:', result.sessionId)
        return { success: true, sessionId: result.sessionId }
      } else {
        console.error('[IpcMain] Stream import failed:', result.error)
        win.webContents.send('chat:importProgress', {
          stage: 'error',
          progress: 0,
          message: result.error,
        })

        // 如果是格式不识别错误，提供诊断信息
        if (result.error === 'error.unrecognized_format') {
          const diagnosis = diagnoseFormat(filePath)
          return {
            success: false,
            error: result.error,
            diagnosis: {
              suggestion: diagnosis.suggestion,
              partialMatches: diagnosis.partialMatches.map((m) => ({
                formatName: m.formatName,
                missingFields: m.missingFields,
              })),
            },
          }
        }

        return { success: false, error: result.error }
      }
    } catch (error) {
      console.error('[IpcMain] Import failed:', error)

      win.webContents.send('chat:importProgress', {
        stage: 'error',
        progress: 0,
        message: String(error),
      })

      return { success: false, error: String(error) }
    }
  })

  /**
   * 获取所有分析会话列表
   */
  ipcMain.handle('chat:getSessions', async () => {
    try {
      const sessions = await worker.getAllSessions()
      return sessions
    } catch (error) {
      console.error('[IpcMain] Error getting sessions:', error)
      return []
    }
  })

  /**
   * 获取单个会话信息
   */
  ipcMain.handle('chat:getSession', async (_, sessionId: string) => {
    try {
      return await worker.getSession(sessionId)
    } catch (error) {
      console.error('获取会话信息失败：', error)
      return null
    }
  })

  /**
   * 删除会话
   */
  ipcMain.handle('chat:deleteSession', async (_, sessionId: string) => {
    try {
      // 先关闭 Worker 中的数据库连接
      await worker.closeDatabase(sessionId)
      // 然后删除文件（使用核心模块）
      const result = databaseCore.deleteSession(sessionId)
      return result
    } catch (error) {
      console.error('删除会话失败：', error)
      return false
    }
  })

  /**
   * 重命名会话
   */
  ipcMain.handle('chat:renameSession', async (_, sessionId: string, newName: string) => {
    try {
      // 先关闭 Worker 中的数据库连接（确保没有其他进程占用）
      await worker.closeDatabase(sessionId)
      // 执行重命名
      return databaseCore.renameSession(sessionId, newName)
    } catch (error) {
      console.error('重命名会话失败：', error)
      return false
    }
  })

  /**
   * 获取可用年份列表
   */
  ipcMain.handle('chat:getAvailableYears', async (_, sessionId: string) => {
    try {
      return await worker.getAvailableYears(sessionId)
    } catch (error) {
      console.error('获取可用年份失败：', error)
      return []
    }
  })

  /**
   * 获取成员活跃度排行
   */
  ipcMain.handle(
    'chat:getMemberActivity',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }) => {
      try {
        return await worker.getMemberActivity(sessionId, filter)
      } catch (error) {
        console.error('获取成员活跃度失败：', error)
        return []
      }
    }
  )

  /**
   * 获取成员历史昵称
   */
  ipcMain.handle('chat:getMemberNameHistory', async (_, sessionId: string, memberId: number) => {
    try {
      return await worker.getMemberNameHistory(sessionId, memberId)
    } catch (error) {
      console.error('获取成员历史昵称失败：', error)
      return []
    }
  })

  /**
   * 获取每小时活跃度分布
   */
  ipcMain.handle(
    'chat:getHourlyActivity',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }) => {
      try {
        return await worker.getHourlyActivity(sessionId, filter)
      } catch (error) {
        console.error('获取小时活跃度失败：', error)
        return []
      }
    }
  )

  /**
   * 获取每日活跃度趋势
   */
  ipcMain.handle(
    'chat:getDailyActivity',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }) => {
      try {
        return await worker.getDailyActivity(sessionId, filter)
      } catch (error) {
        console.error('获取日活跃度失败：', error)
        return []
      }
    }
  )

  /**
   * 获取星期活跃度分布
   */
  ipcMain.handle(
    'chat:getWeekdayActivity',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }) => {
      try {
        return await worker.getWeekdayActivity(sessionId, filter)
      } catch (error) {
        console.error('获取星期活跃度失败：', error)
        return []
      }
    }
  )

  /**
   * 获取月份活跃度分布
   */
  ipcMain.handle(
    'chat:getMonthlyActivity',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }) => {
      try {
        return await worker.getMonthlyActivity(sessionId, filter)
      } catch (error) {
        console.error('获取月份活跃度失败：', error)
        return []
      }
    }
  )

  /**
   * 获取消息类型分布
   */
  ipcMain.handle(
    'chat:getMessageTypeDistribution',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }) => {
      try {
        return await worker.getMessageTypeDistribution(sessionId, filter)
      } catch (error) {
        console.error('获取消息类型分布失败：', error)
        return []
      }
    }
  )

  /**
   * 获取时间范围
   */
  ipcMain.handle('chat:getTimeRange', async (_, sessionId: string) => {
    try {
      return await worker.getTimeRange(sessionId)
    } catch (error) {
      console.error('获取时间范围失败：', error)
      return null
    }
  })

  /**
   * 获取数据库存储目录
   */
  ipcMain.handle('chat:getDbDirectory', async () => {
    try {
      return worker.getDbDirectory()
    } catch (error) {
      console.error('获取数据库目录失败：', error)
      return null
    }
  })

  /**
   * 获取支持的格式列表
   */
  ipcMain.handle('chat:getSupportedFormats', async () => {
    return parser.getSupportedFormats()
  })

  /**
   * 获取复读分析数据
   */
  ipcMain.handle(
    'chat:getRepeatAnalysis',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }) => {
      try {
        return await worker.getRepeatAnalysis(sessionId, filter)
      } catch (error) {
        console.error('获取复读分析失败：', error)
        return { originators: [], initiators: [], breakers: [], totalRepeatChains: 0 }
      }
    }
  )

  /**
   * 获取口头禅分析数据
   */
  ipcMain.handle(
    'chat:getCatchphraseAnalysis',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }) => {
      try {
        return await worker.getCatchphraseAnalysis(sessionId, filter)
      } catch (error) {
        console.error('获取口头禅分析失败：', error)
        return { members: [] }
      }
    }
  )

  /**
   * 获取夜猫分析数据
   */
  ipcMain.handle(
    'chat:getNightOwlAnalysis',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }) => {
      try {
        return await worker.getNightOwlAnalysis(sessionId, filter)
      } catch (error) {
        console.error('获取夜猫分析失败：', error)
        return {
          nightOwlRank: [],
          lastSpeakerRank: [],
          firstSpeakerRank: [],
          consecutiveRecords: [],
          champions: [],
          totalDays: 0,
        }
      }
    }
  )

  /**
   * 获取龙王分析数据
   */
  ipcMain.handle(
    'chat:getDragonKingAnalysis',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }) => {
      try {
        return await worker.getDragonKingAnalysis(sessionId, filter)
      } catch (error) {
        console.error('获取龙王分析失败：', error)
        return { rank: [], totalDays: 0 }
      }
    }
  )

  /**
   * 获取潜水分析数据
   */
  ipcMain.handle(
    'chat:getDivingAnalysis',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }) => {
      try {
        return await worker.getDivingAnalysis(sessionId, filter)
      } catch (error) {
        console.error('获取潜水分析失败：', error)
        return { rank: [] }
      }
    }
  )

  /**
   * 获取自言自语分析数据
   */
  ipcMain.handle(
    'chat:getMonologueAnalysis',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }) => {
      try {
        return await worker.getMonologueAnalysis(sessionId, filter)
      } catch (error) {
        console.error('获取自言自语分析失败：', error)
        return { rank: [], maxComboRecord: null }
      }
    }
  )

  /**
   * 获取 @ 互动分析数据
   */
  ipcMain.handle(
    'chat:getMentionAnalysis',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }) => {
      try {
        return await worker.getMentionAnalysis(sessionId, filter)
      } catch (error) {
        console.error('获取 @ 互动分析失败：', error)
        return { topMentioners: [], topMentioned: [], oneWay: [], twoWay: [], totalMentions: 0, memberDetails: [] }
      }
    }
  )

  /**
   * 获取含笑量分析数据
   */
  ipcMain.handle(
    'chat:getLaughAnalysis',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }, keywords?: string[]) => {
      try {
        return await worker.getLaughAnalysis(sessionId, filter, keywords)
      } catch (error) {
        console.error('获取含笑量分析失败：', error)
        return {
          rankByRate: [],
          rankByCount: [],
          typeDistribution: [],
          totalLaughs: 0,
          totalMessages: 0,
          groupLaughRate: 0,
        }
      }
    }
  )

  /**
   * 获取斗图分析数据
   */
  ipcMain.handle(
    'chat:getMemeBattleAnalysis',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }) => {
      try {
        return await worker.getMemeBattleAnalysis(sessionId, filter)
      } catch (error) {
        console.error('获取斗图分析失败：', error)
        return {
          longestBattle: null,
          rankByCount: [],
          rankByImageCount: [],
          totalBattles: 0,
        }
      }
    }
  )

  /**
   * 获取打卡分析数据（火花榜 + 忠臣榜）
   */
  ipcMain.handle(
    'chat:getCheckInAnalysis',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }) => {
      try {
        return await worker.getCheckInAnalysis(sessionId, filter)
      } catch (error) {
        console.error('获取打卡分析失败：', error)
        return {
          streakRank: [],
          loyaltyRank: [],
          totalDays: 0,
        }
      }
    }
  )

  // ==================== 成员管理 ====================

  /**
   * 获取所有成员列表（含消息数和别名）
   */
  ipcMain.handle('chat:getMembers', async (_, sessionId: string) => {
    try {
      return await worker.getMembers(sessionId)
    } catch (error) {
      console.error('获取成员列表失败：', error)
      return []
    }
  })

  /**
   * 更新成员别名
   */
  ipcMain.handle('chat:updateMemberAliases', async (_, sessionId: string, memberId: number, aliases: string[]) => {
    try {
      return await worker.updateMemberAliases(sessionId, memberId, aliases)
    } catch (error) {
      console.error('更新成员别名失败：', error)
      return false
    }
  })

  /**
   * 删除成员及其所有消息
   */
  ipcMain.handle('chat:deleteMember', async (_, sessionId: string, memberId: number) => {
    try {
      // 先关闭数据库连接
      await worker.closeDatabase(sessionId)
      // 执行删除
      return await worker.deleteMember(sessionId, memberId)
    } catch (error) {
      console.error('删除成员失败：', error)
      return false
    }
  })

  /**
   * 更新会话的所有者（ownerId）
   */
  ipcMain.handle('chat:updateSessionOwnerId', async (_, sessionId: string, ownerId: string | null) => {
    try {
      // 先关闭数据库连接
      await worker.closeDatabase(sessionId)
      // 执行更新
      return databaseCore.updateSessionOwnerId(sessionId, ownerId)
    } catch (error) {
      console.error('更新会话所有者失败：', error)
      return false
    }
  })

  // ==================== SQL 实验室 ====================

  /**
   * 执行用户 SQL 查询
   */
  ipcMain.handle('chat:executeSQL', async (_, sessionId: string, sql: string) => {
    try {
      return await worker.executeRawSQL(sessionId, sql)
    } catch (error) {
      console.error('执行 SQL 失败：', error)
      throw error
    }
  })

  /**
   * 获取数据库 Schema
   */
  ipcMain.handle('chat:getSchema', async (_, sessionId: string) => {
    try {
      return await worker.getSchema(sessionId)
    } catch (error) {
      console.error('获取 Schema 失败：', error)
      return []
    }
  })

  // ==================== 会话索引 ====================

  /**
   * 生成会话索引
   */
  ipcMain.handle('session:generate', async (_, sessionId: string, gapThreshold?: number) => {
    try {
      return await worker.generateSessions(sessionId, gapThreshold)
    } catch (error) {
      console.error('生成会话索引失败：', error)
      throw error
    }
  })

  /**
   * 检查是否已生成会话索引
   */
  ipcMain.handle('session:hasIndex', async (_, sessionId: string) => {
    try {
      return await worker.hasSessionIndex(sessionId)
    } catch (error) {
      console.error('检查会话索引失败：', error)
      return false
    }
  })

  /**
   * 获取会话索引统计信息
   */
  ipcMain.handle('session:getStats', async (_, sessionId: string) => {
    try {
      return await worker.getSessionStats(sessionId)
    } catch (error) {
      console.error('获取会话统计失败：', error)
      return { sessionCount: 0, hasIndex: false, gapThreshold: 1800 }
    }
  })

  /**
   * 清空会话索引
   */
  ipcMain.handle('session:clear', async (_, sessionId: string) => {
    try {
      await worker.clearSessions(sessionId)
      return true
    } catch (error) {
      console.error('清空会话索引失败：', error)
      return false
    }
  })

  /**
   * 更新会话切分阈值
   */
  ipcMain.handle('session:updateGapThreshold', async (_, sessionId: string, gapThreshold: number | null) => {
    try {
      await worker.updateSessionGapThreshold(sessionId, gapThreshold)
      return true
    } catch (error) {
      console.error('更新阈值失败：', error)
      return false
    }
  })

  /**
   * 获取会话列表（用于时间线导航）
   */
  ipcMain.handle('session:getSessions', async (_, sessionId: string) => {
    try {
      return await worker.getSessions(sessionId)
    } catch (error) {
      console.error('获取会话列表失败：', error)
      return []
    }
  })
}
