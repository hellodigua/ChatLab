import { ipcMain, app, dialog, clipboard, shell, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import * as fs from 'fs/promises'
import * as fsSync from 'fs'

// 导入数据库核心模块（用于导入和删除操作）
import * as databaseCore from './database/core'
// 导入 Worker 模块（用于异步分析查询和流式导入）
import * as worker from './worker'
// 导入解析器模块
import * as parser from './parser'
import { detectFormat, type ParseProgress } from './parser'
// 导入合并模块
import * as merger from './merger'
import { deleteTempDatabase, cleanupAllTempDatabases } from './merger/tempCache'
// 导入 AI 对话管理模块
import * as aiConversations from './ai/conversations'
// 导入 LLM 服务模块
import * as llm from './ai/llm'
// 导入 AI 日志模块
import { aiLogger } from './ai/logger'
// 导入 AI Agent 模块
import { Agent, type AgentStreamChunk } from './ai/agent'
import type { ToolContext } from './ai/tools/types'
import type { MergeParams } from '../../src/types/chat'

console.log('[IpcMain] Database, Worker and Parser modules imported')

// ==================== 临时数据库缓存 ====================
// 用于合并功能：缓存文件对应的临时数据库路径
// 这样用户删除本地文件后仍然可以进行合并（数据已存入临时数据库）
const tempDbCache = new Map<string, string>()

/**
 * 清理指定文件的缓存（删除临时数据库）
 */
function clearTempDbCache(filePath: string): void {
  const tempDbPath = tempDbCache.get(filePath)
  if (tempDbPath) {
    deleteTempDatabase(tempDbPath)
    tempDbCache.delete(filePath)
  }
}

/**
 * 清理所有缓存（删除所有临时数据库）
 */
function clearAllTempDbCache(): void {
  for (const tempDbPath of tempDbCache.values()) {
    deleteTempDatabase(tempDbPath)
  }
  tempDbCache.clear()
  console.log('[IpcMain] 已清理所有临时数据库缓存')
}

const mainIpcMain = (win: BrowserWindow) => {
  console.log('[IpcMain] Registering IPC handlers...')

  // 清理残留的临时数据库（上次崩溃可能残留）
  cleanupAllTempDatabases()

  // 初始化 Worker
  try {
    worker.initWorker()
    console.log('[IpcMain] Worker initialized successfully')
  } catch (error) {
    console.error('[IpcMain] Failed to initialize worker:', error)
  }
  // ==================== 窗口操作 ====================
  ipcMain.on('window-min', (ev) => {
    ev.preventDefault()
    win.minimize()
  })

  ipcMain.on('window-maxOrRestore', (ev) => {
    const winSizeState = win.isMaximized()
    winSizeState ? win.restore() : win.maximize()
    ev.reply('windowState', win.isMaximized())
  })

  ipcMain.on('window-restore', () => {
    win.restore()
  })

  ipcMain.on('window-hide', () => {
    win.hide()
  })

  ipcMain.on('window-close', () => {
    win.close()
    // @ts-ignore
    app.isQuitting = true
    app.quit()
  })

  ipcMain.on('window-resize', (_, data) => {
    if (data.resize) {
      win.setResizable(true)
    } else {
      win.setSize(1180, 752)
      win.setResizable(false)
    }
  })

  ipcMain.on('open-devtools', () => {
    win.webContents.openDevTools()
  })

  // ==================== 更新检查 ====================
  ipcMain.on('check-update', () => {
    autoUpdater.checkForUpdates()
  })

  // ==================== 通用工具 ====================
  ipcMain.handle('show-message', (event, args) => {
    event.sender.send('show-message', args)
  })

  // 复制到剪贴板
  ipcMain.handle('copyData', async (_, data) => {
    try {
      clipboard.writeText(data)
      return true
    } catch (error) {
      console.error('复制操作出错：', error)
      return false
    }
  })

  // ==================== 文件系统操作 ====================
  // 选择文件夹
  ipcMain.handle('selectDir', async (_, defaultPath = '') => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: '选择目录',
        defaultPath: defaultPath || app.getPath('documents'),
        properties: ['openDirectory', 'createDirectory'],
        buttonLabel: '选择文件夹',
      })
      if (!canceled) {
        return filePaths[0]
      }
      return null
    } catch (err) {
      console.error('选择文件夹时发生错误：', err)
      throw err
    }
  })

  // 检查文件是否存在
  ipcMain.handle('checkFileExist', async (_, filePath) => {
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  })

  // 在文件管理器中打开
  ipcMain.handle('openInFolder', async (_, path) => {
    try {
      await fs.access(path)
      await shell.showItemInFolder(path)
      return true
    } catch (error) {
      console.error('打开目录时出错：', error)
      return false
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
          { name: '聊天记录', extensions: ['json', 'txt'] },
          { name: '所有文件', extensions: ['*'] },
        ],
        buttonLabel: '导入',
      })

      if (canceled || filePaths.length === 0) {
        return null
      }

      const filePath = filePaths[0]
      console.log('[IpcMain] File selected:', filePath)

      // 检测文件格式（使用流式检测，只读取文件开头）
      const formatFeature = detectFormat(filePath)
      const format = formatFeature?.name || null
      console.log('[IpcMain] Detected format:', format)
      if (!format) {
        return { error: '无法识别的文件格式' }
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
    console.log('[IpcMain] chat:import called with:', filePath)

    try {
      // 发送进度：开始检测格式
      win.webContents.send('chat:importProgress', {
        stage: 'detecting',
        progress: 5,
        message: '正在检测文件格式...',
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
      return databaseCore.deleteSession(sessionId)
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

  // ==================== 合并功能 ====================

  /**
   * 解析文件获取基本信息（用于合并预览）
   * 使用流式解析，数据写入临时数据库，避免内存溢出
   */
  ipcMain.handle('merge:parseFileInfo', async (_, filePath: string) => {
    try {
      // 使用流式解析，写入临时数据库
      const result = await worker.streamParseFileInfo(filePath, (progress: ParseProgress) => {
        // 可选：发送进度到渲染进程
        win.webContents.send('merge:parseProgress', {
          filePath,
          progress,
        })
      })

      // 缓存临时数据库路径（用于后续合并）
      // 这样即使用户删除本地文件，也能继续合并（数据已在临时数据库中）
      if (result.tempDbPath) {
        tempDbCache.set(filePath, result.tempDbPath)
        console.log(`[IpcMain] 已缓存临时数据库: ${filePath} -> ${result.tempDbPath}`)
      }

      // 返回基本信息
      return {
        name: result.name,
        format: result.format,
        platform: result.platform,
        messageCount: result.messageCount,
        memberCount: result.memberCount,
        fileSize: result.fileSize,
      }
    } catch (error) {
      console.error('解析文件信息失败：', error)
      throw error
    }
  })

  /**
   * 检测合并冲突（使用临时数据库）
   */
  ipcMain.handle('merge:checkConflicts', async (_, filePaths: string[]) => {
    try {
      return merger.checkConflictsWithTempDb(filePaths, tempDbCache)
    } catch (error) {
      console.error('检测冲突失败：', error)
      throw error
    }
  })

  /**
   * 执行合并（使用临时数据库）
   */
  ipcMain.handle('merge:mergeFiles', async (_, params: MergeParams) => {
    try {
      const result = await merger.mergeFilesWithTempDb(params, tempDbCache)
      // 合并完成后清理缓存
      if (result.success) {
        for (const filePath of params.filePaths) {
          clearTempDbCache(filePath)
        }
      }
      return result
    } catch (error) {
      console.error('合并失败：', error)
      return { success: false, error: String(error) }
    }
  })

  /**
   * 清理合并缓存（用于用户移除文件时）
   */
  ipcMain.handle('merge:clearCache', async (_, filePath?: string) => {
    if (filePath) {
      clearTempDbCache(filePath)
    } else {
      clearAllTempDbCache()
    }
    return true
  })

  /**
   * 显示打开对话框（通用）
   */
  ipcMain.handle('dialog:showOpenDialog', async (_, options) => {
    try {
      return await dialog.showOpenDialog(options)
    } catch (error) {
      console.error('显示对话框失败：', error)
      throw error
    }
  })

  // ==================== AI 功能 ====================

  /**
   * 搜索消息（关键词搜索）
   */
  ipcMain.handle(
    'ai:searchMessages',
    async (
      _,
      sessionId: string,
      keywords: string[],
      filter?: { startTs?: number; endTs?: number },
      limit?: number,
      offset?: number
    ) => {
      aiLogger.info('IPC', '收到搜索消息请求', {
        sessionId,
        keywords,
        filter,
        limit,
        offset,
      })
      try {
        const result = await worker.searchMessages(sessionId, keywords, filter, limit, offset)
        aiLogger.info('IPC', '搜索消息完成', {
          total: result.total,
          returned: result.messages.length,
        })
        return result
      } catch (error) {
        aiLogger.error('IPC', '搜索消息失败', { error: String(error) })
        console.error('搜索消息失败：', error)
        return { messages: [], total: 0 }
      }
    }
  )

  /**
   * 获取消息上下文
   */
  ipcMain.handle('ai:getMessageContext', async (_, sessionId: string, messageId: number, contextSize?: number) => {
    try {
      return await worker.getMessageContext(sessionId, messageId, contextSize)
    } catch (error) {
      console.error('获取消息上下文失败：', error)
      return []
    }
  })

  /**
   * 创建 AI 对话
   */
  ipcMain.handle('ai:createConversation', async (_, sessionId: string, title?: string) => {
    try {
      return aiConversations.createConversation(sessionId, title)
    } catch (error) {
      console.error('创建 AI 对话失败：', error)
      throw error
    }
  })

  /**
   * 获取会话的所有 AI 对话列表
   */
  ipcMain.handle('ai:getConversations', async (_, sessionId: string) => {
    try {
      return aiConversations.getConversations(sessionId)
    } catch (error) {
      console.error('获取 AI 对话列表失败：', error)
      return []
    }
  })

  /**
   * 获取单个 AI 对话
   */
  ipcMain.handle('ai:getConversation', async (_, conversationId: string) => {
    try {
      return aiConversations.getConversation(conversationId)
    } catch (error) {
      console.error('获取 AI 对话失败：', error)
      return null
    }
  })

  /**
   * 更新 AI 对话标题
   */
  ipcMain.handle('ai:updateConversationTitle', async (_, conversationId: string, title: string) => {
    try {
      return aiConversations.updateConversationTitle(conversationId, title)
    } catch (error) {
      console.error('更新 AI 对话标题失败：', error)
      return false
    }
  })

  /**
   * 删除 AI 对话
   */
  ipcMain.handle('ai:deleteConversation', async (_, conversationId: string) => {
    try {
      return aiConversations.deleteConversation(conversationId)
    } catch (error) {
      console.error('删除 AI 对话失败：', error)
      return false
    }
  })

  /**
   * 添加 AI 消息
   */
  ipcMain.handle(
    'ai:addMessage',
    async (
      _,
      conversationId: string,
      role: 'user' | 'assistant',
      content: string,
      dataKeywords?: string[],
      dataMessageCount?: number
    ) => {
      try {
        return aiConversations.addMessage(conversationId, role, content, dataKeywords, dataMessageCount)
      } catch (error) {
        console.error('添加 AI 消息失败：', error)
        throw error
      }
    }
  )

  /**
   * 获取 AI 对话的所有消息
   */
  ipcMain.handle('ai:getMessages', async (_, conversationId: string) => {
    try {
      return aiConversations.getMessages(conversationId)
    } catch (error) {
      console.error('获取 AI 消息失败：', error)
      return []
    }
  })

  /**
   * 删除 AI 消息
   */
  ipcMain.handle('ai:deleteMessage', async (_, messageId: string) => {
    try {
      return aiConversations.deleteMessage(messageId)
    } catch (error) {
      console.error('删除 AI 消息失败：', error)
      return false
    }
  })

  // ==================== LLM 服务（多配置管理）====================

  /**
   * 获取所有支持的 LLM 提供商
   */
  ipcMain.handle('llm:getProviders', async () => {
    return llm.PROVIDERS
  })

  /**
   * 获取所有配置列表
   */
  ipcMain.handle('llm:getAllConfigs', async () => {
    const configs = llm.getAllConfigs()
    // 脱敏 API Key
    return configs.map((c) => ({
      ...c,
      apiKey: c.apiKey ? `${c.apiKey.slice(0, 4)}****${c.apiKey.slice(-4)}` : '',
      apiKeySet: !!c.apiKey,
    }))
  })

  /**
   * 获取当前激活的配置 ID
   */
  ipcMain.handle('llm:getActiveConfigId', async () => {
    const config = llm.getActiveConfig()
    return config?.id || null
  })

  /**
   * 添加新配置
   */
  ipcMain.handle(
    'llm:addConfig',
    async (
      _,
      config: {
        name: string
        provider: llm.LLMProvider
        apiKey: string
        model?: string
        baseUrl?: string
        maxTokens?: number
      }
    ) => {
      try {
        const result = llm.addConfig(config)
        if (result.success && result.config) {
          return {
            success: true,
            config: {
              ...result.config,
              apiKey: result.config.apiKey
                ? `${result.config.apiKey.slice(0, 4)}****${result.config.apiKey.slice(-4)}`
                : '',
              apiKeySet: !!result.config.apiKey,
            },
          }
        }
        return result
      } catch (error) {
        console.error('添加 LLM 配置失败：', error)
        return { success: false, error: String(error) }
      }
    }
  )

  /**
   * 更新配置
   */
  ipcMain.handle(
    'llm:updateConfig',
    async (
      _,
      id: string,
      updates: {
        name?: string
        provider?: llm.LLMProvider
        apiKey?: string
        model?: string
        baseUrl?: string
        maxTokens?: number
      }
    ) => {
      try {
        // 如果 apiKey 为空字符串，表示不更新 API Key
        const cleanUpdates = { ...updates }
        if (cleanUpdates.apiKey === '') {
          delete cleanUpdates.apiKey
        }

        return llm.updateConfig(id, cleanUpdates)
      } catch (error) {
        console.error('更新 LLM 配置失败：', error)
        return { success: false, error: String(error) }
      }
    }
  )

  /**
   * 删除配置
   */
  ipcMain.handle('llm:deleteConfig', async (_, id?: string) => {
    try {
      // 兼容旧 API：如果没有传 id，删除当前激活的配置
      if (!id) {
        const activeConfig = llm.getActiveConfig()
        if (activeConfig) {
          return llm.deleteConfig(activeConfig.id)
        }
        return { success: false, error: '没有激活的配置' }
      }
      return llm.deleteConfig(id)
    } catch (error) {
      console.error('删除 LLM 配置失败：', error)
      return { success: false, error: String(error) }
    }
  })

  /**
   * 设置激活的配置
   */
  ipcMain.handle('llm:setActiveConfig', async (_, id: string) => {
    try {
      return llm.setActiveConfig(id)
    } catch (error) {
      console.error('设置激活配置失败：', error)
      return { success: false, error: String(error) }
    }
  })

  /**
   * 验证 API Key（支持自定义 baseUrl 和 model）
   */
  ipcMain.handle(
    'llm:validateApiKey',
    async (_, provider: llm.LLMProvider, apiKey: string, baseUrl?: string, model?: string) => {
      console.log('[LLM:validateApiKey] 开始验证:', { provider, baseUrl, model, apiKeyLength: apiKey?.length })
      try {
        const service = llm.createLLMService({ provider, apiKey, baseUrl, model })
        const result = await service.validateApiKey()
        console.log('[LLM:validateApiKey] 验证结果:', result)
        return result
      } catch (error) {
        console.error('[LLM:validateApiKey] 验证失败：', error)
        return false
      }
    }
  )

  /**
   * 检查是否已配置 LLM（是否有激活的配置）
   */
  ipcMain.handle('llm:hasConfig', async () => {
    return llm.hasActiveConfig()
  })

  // ==================== 兼容旧 API（deprecated）====================

  /**
   * @deprecated 使用 llm:getAllConfigs 代替
   * 获取当前 LLM 配置
   */
  ipcMain.handle('llm:getConfig', async () => {
    const config = llm.getActiveConfig()
    if (!config) return null
    return {
      provider: config.provider,
      apiKey: config.apiKey ? `${config.apiKey.slice(0, 8)}...${config.apiKey.slice(-4)}` : '',
      apiKeySet: !!config.apiKey,
      model: config.model,
      baseUrl: config.baseUrl,
      maxTokens: config.maxTokens,
    }
  })

  /**
   * @deprecated 使用 llm:addConfig 或 llm:updateConfig 代替
   * 保存 LLM 配置
   */
  ipcMain.handle(
    'llm:saveConfig',
    async (
      _,
      config: { provider: llm.LLMProvider; apiKey: string; model?: string; baseUrl?: string; maxTokens?: number }
    ) => {
      try {
        const activeConfig = llm.getActiveConfig()

        if (activeConfig) {
          // 更新现有配置
          const updates: Record<string, unknown> = { ...config }
          if (!config.apiKey || config.apiKey.trim() === '') {
            delete updates.apiKey
          }
          return llm.updateConfig(activeConfig.id, updates)
        } else {
          // 创建新配置
          if (!config.apiKey || config.apiKey.trim() === '') {
            return { success: false, error: '请输入 API Key' }
          }
          const providerInfo = llm.getProviderInfo(config.provider)
          return llm.addConfig({
            name: providerInfo?.name || config.provider,
            ...config,
          })
        }
      } catch (error) {
        console.error('保存 LLM 配置失败：', error)
        return { success: false, error: String(error) }
      }
    }
  )

  /**
   * 发送 LLM 聊天请求（非流式）
   */
  ipcMain.handle('llm:chat', async (_, messages: llm.ChatMessage[], options?: llm.ChatOptions) => {
    aiLogger.info('IPC', '收到非流式 LLM 请求', {
      messagesCount: messages.length,
      firstMsgRole: messages[0]?.role,
      firstMsgContentLen: messages[0]?.content?.length,
      options,
    })
    try {
      const response = await llm.chat(messages, options)
      aiLogger.info('IPC', '非流式 LLM 请求成功', { responseLength: response.length })
      return { success: true, content: response }
    } catch (error) {
      aiLogger.error('IPC', '非流式 LLM 请求失败', { error: String(error) })
      console.error('LLM 聊天失败：', error)
      return { success: false, error: String(error) }
    }
  })

  /**
   * 发送 LLM 聊天请求（流式）
   * 使用 IPC 事件发送流式数据
   */
  ipcMain.handle(
    'llm:chatStream',
    async (_, requestId: string, messages: llm.ChatMessage[], options?: llm.ChatOptions) => {
      aiLogger.info('IPC', `收到流式聊天请求: ${requestId}`, {
        messagesCount: messages.length,
        options,
      })

      try {
        const generator = llm.chatStream(messages, options)
        aiLogger.info('IPC', `创建流式生成器: ${requestId}`)

        // 异步处理流式响应
        ;(async () => {
          let chunkIndex = 0
          try {
            aiLogger.info('IPC', `开始迭代流式响应: ${requestId}`)
            for await (const chunk of generator) {
              chunkIndex++
              aiLogger.debug('IPC', `发送 chunk #${chunkIndex}: ${requestId}`, {
                contentLength: chunk.content?.length,
                isFinished: chunk.isFinished,
                finishReason: chunk.finishReason,
              })
              win.webContents.send('llm:streamChunk', { requestId, chunk })
            }
            aiLogger.info('IPC', `流式响应完成: ${requestId}`, { totalChunks: chunkIndex })
          } catch (error) {
            aiLogger.error('IPC', `流式响应出错: ${requestId}`, {
              error: String(error),
              chunkIndex,
            })
            win.webContents.send('llm:streamChunk', {
              requestId,
              chunk: { content: '', isFinished: true, finishReason: 'error' },
              error: String(error),
            })
          }
        })()

        return { success: true }
      } catch (error) {
        aiLogger.error('IPC', `创建流式请求失败: ${requestId}`, { error: String(error) })
        console.error('LLM 流式聊天失败：', error)
        return { success: false, error: String(error) }
      }
    }
  )

  // ==================== AI Agent API ====================

  /**
   * 执行 Agent 对话（流式）
   * Agent 会自动调用工具并返回最终结果
   */
  ipcMain.handle('agent:runStream', async (_, requestId: string, userMessage: string, context: ToolContext) => {
    aiLogger.info('IPC', `收到 Agent 流式请求: ${requestId}`, {
      userMessage: userMessage.slice(0, 100),
      sessionId: context.sessionId,
    })

    try {
      const agent = new Agent(context)

      // 异步执行，通过事件发送流式数据
      ;(async () => {
        try {
          const result = await agent.executeStream(userMessage, (chunk: AgentStreamChunk) => {
            aiLogger.debug('IPC', `Agent chunk: ${requestId}`, {
              type: chunk.type,
              contentLength: chunk.content?.length,
              toolName: chunk.toolName,
            })
            win.webContents.send('agent:streamChunk', { requestId, chunk })
          })

          // 发送完成信息
          win.webContents.send('agent:complete', {
            requestId,
            result: {
              content: result.content,
              toolsUsed: result.toolsUsed,
              toolRounds: result.toolRounds,
            },
          })

          aiLogger.info('IPC', `Agent 执行完成: ${requestId}`, {
            toolsUsed: result.toolsUsed,
            toolRounds: result.toolRounds,
            contentLength: result.content.length,
          })
        } catch (error) {
          aiLogger.error('IPC', `Agent 执行出错: ${requestId}`, { error: String(error) })
          win.webContents.send('agent:streamChunk', {
            requestId,
            chunk: { type: 'error', error: String(error), isFinished: true },
          })
        }
      })()

      return { success: true }
    } catch (error) {
      aiLogger.error('IPC', `创建 Agent 请求失败: ${requestId}`, { error: String(error) })
      return { success: false, error: String(error) }
    }
  })
}

export default mainIpcMain
