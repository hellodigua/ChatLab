import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { AnalysisSession, MessageType, ImportProgress } from '../../src/types/base'
import type {
  MemberActivity,
  MemberNameHistory,
  HourlyActivity,
  DailyActivity,
  WeekdayActivity,
  MonthlyActivity,
  RepeatAnalysis,
  CatchphraseAnalysis,
  NightOwlAnalysis,
  DragonKingAnalysis,
  DivingAnalysis,
  MonologueAnalysis,
  MentionAnalysis,
  LaughAnalysis,
  CheckInAnalysis,
  MemeBattleAnalysis,
  MemberWithStats,
} from '../../src/types/analysis'
import type { FileParseInfo, ConflictCheckResult, MergeParams, MergeResult } from '../../src/types/format'

// Custom APIs for renderer
const api = {
  send: (channel: string, data?: unknown) => {
    // whitelist channels
    const validChannels = [
      'show-message',
      'check-update',
      'simulate-update',
      'get-gpu-acceleration',
      'set-gpu-acceleration',
      'save-gpu-acceleration',
      'window-close', // 用户协议拒绝时退出应用
    ]
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data)
    }
  },
  receive: (channel: string, func: (...args: unknown[]) => void) => {
    const validChannels = [
      'show-message',
      'chat:importProgress',
      'merge:parseProgress',
      'llm:streamChunk',
      'agent:streamChunk',
      'agent:complete',
    ]
    if (validChannels.includes(channel)) {
      // Deliberately strip event as it includes `sender`
      ipcRenderer.on(channel, (_event, ...args) => func(...args))
    }
  },
  removeListener: (channel: string, func: (...args: unknown[]) => void) => {
    ipcRenderer.removeListener(channel, func)
  },
}

// Chat Analysis API
const chatApi = {
  // ==================== 数据库迁移 ====================

  /**
   * 检查是否需要数据库迁移
   */
  checkMigration: (): Promise<{
    needsMigration: boolean
    count: number
    currentVersion: number
    pendingMigrations: Array<{ version: number; userMessage: string }>
  }> => {
    return ipcRenderer.invoke('chat:checkMigration')
  },

  /**
   * 执行数据库迁移
   */
  runMigration: (): Promise<{ success: boolean; migratedCount: number; error?: string }> => {
    return ipcRenderer.invoke('chat:runMigration')
  },

  // ==================== 聊天记录导入与分析 ====================

  /**
   * 选择聊天记录文件
   */
  selectFile: (): Promise<{ filePath?: string; format?: string; error?: string } | null> => {
    return ipcRenderer.invoke('chat:selectFile')
  },

  /**
   * 导入聊天记录
   */
  import: (filePath: string): Promise<{ success: boolean; sessionId?: string; error?: string }> => {
    return ipcRenderer.invoke('chat:import', filePath)
  },

  /**
   * 获取所有分析会话列表
   */
  getSessions: (): Promise<AnalysisSession[]> => {
    return ipcRenderer.invoke('chat:getSessions')
  },

  /**
   * 获取单个会话信息
   */
  getSession: (sessionId: string): Promise<AnalysisSession | null> => {
    return ipcRenderer.invoke('chat:getSession', sessionId)
  },

  /**
   * 删除会话
   */
  deleteSession: (sessionId: string): Promise<boolean> => {
    return ipcRenderer.invoke('chat:deleteSession', sessionId)
  },

  /**
   * 重命名会话
   */
  renameSession: (sessionId: string, newName: string): Promise<boolean> => {
    return ipcRenderer.invoke('chat:renameSession', sessionId, newName)
  },

  /**
   * 获取可用年份列表
   */
  getAvailableYears: (sessionId: string): Promise<number[]> => {
    return ipcRenderer.invoke('chat:getAvailableYears', sessionId)
  },

  /**
   * 获取成员活跃度排行
   */
  getMemberActivity: (sessionId: string, filter?: { startTs?: number; endTs?: number }): Promise<MemberActivity[]> => {
    return ipcRenderer.invoke('chat:getMemberActivity', sessionId, filter)
  },

  /**
   * 获取成员历史昵称
   */
  getMemberNameHistory: (sessionId: string, memberId: number): Promise<MemberNameHistory[]> => {
    return ipcRenderer.invoke('chat:getMemberNameHistory', sessionId, memberId)
  },

  /**
   * 获取每小时活跃度分布
   */
  getHourlyActivity: (sessionId: string, filter?: { startTs?: number; endTs?: number }): Promise<HourlyActivity[]> => {
    return ipcRenderer.invoke('chat:getHourlyActivity', sessionId, filter)
  },

  /**
   * 获取每日活跃度趋势
   */
  getDailyActivity: (sessionId: string, filter?: { startTs?: number; endTs?: number }): Promise<DailyActivity[]> => {
    return ipcRenderer.invoke('chat:getDailyActivity', sessionId, filter)
  },

  /**
   * 获取星期活跃度分布
   */
  getWeekdayActivity: (
    sessionId: string,
    filter?: { startTs?: number; endTs?: number }
  ): Promise<WeekdayActivity[]> => {
    return ipcRenderer.invoke('chat:getWeekdayActivity', sessionId, filter)
  },

  /**
   * 获取月份活跃度分布
   */
  getMonthlyActivity: (
    sessionId: string,
    filter?: { startTs?: number; endTs?: number }
  ): Promise<MonthlyActivity[]> => {
    return ipcRenderer.invoke('chat:getMonthlyActivity', sessionId, filter)
  },

  /**
   * 获取消息类型分布
   */
  getMessageTypeDistribution: (
    sessionId: string,
    filter?: { startTs?: number; endTs?: number }
  ): Promise<Array<{ type: MessageType; count: number }>> => {
    return ipcRenderer.invoke('chat:getMessageTypeDistribution', sessionId, filter)
  },

  /**
   * 获取时间范围
   */
  getTimeRange: (sessionId: string): Promise<{ start: number; end: number } | null> => {
    return ipcRenderer.invoke('chat:getTimeRange', sessionId)
  },

  /**
   * 获取数据库存储目录
   */
  getDbDirectory: (): Promise<string | null> => {
    return ipcRenderer.invoke('chat:getDbDirectory')
  },

  /**
   * 获取支持的格式列表
   */
  getSupportedFormats: (): Promise<Array<{ name: string; platform: string }>> => {
    return ipcRenderer.invoke('chat:getSupportedFormats')
  },

  /**
   * 监听导入进度
   */
  onImportProgress: (callback: (progress: ImportProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: ImportProgress) => {
      callback(progress)
    }
    ipcRenderer.on('chat:importProgress', handler)
    return () => {
      ipcRenderer.removeListener('chat:importProgress', handler)
    }
  },

  /**
   * 获取复读分析数据
   */
  getRepeatAnalysis: (sessionId: string, filter?: { startTs?: number; endTs?: number }): Promise<RepeatAnalysis> => {
    return ipcRenderer.invoke('chat:getRepeatAnalysis', sessionId, filter)
  },

  /**
   * 获取口头禅分析数据
   */
  getCatchphraseAnalysis: (
    sessionId: string,
    filter?: { startTs?: number; endTs?: number }
  ): Promise<CatchphraseAnalysis> => {
    return ipcRenderer.invoke('chat:getCatchphraseAnalysis', sessionId, filter)
  },

  /**
   * 获取夜猫分析数据
   */
  getNightOwlAnalysis: (
    sessionId: string,
    filter?: { startTs?: number; endTs?: number }
  ): Promise<NightOwlAnalysis> => {
    return ipcRenderer.invoke('chat:getNightOwlAnalysis', sessionId, filter)
  },

  /**
   * 获取龙王分析数据
   */
  getDragonKingAnalysis: (
    sessionId: string,
    filter?: { startTs?: number; endTs?: number }
  ): Promise<DragonKingAnalysis> => {
    return ipcRenderer.invoke('chat:getDragonKingAnalysis', sessionId, filter)
  },

  /**
   * 获取潜水分析数据
   */
  getDivingAnalysis: (sessionId: string, filter?: { startTs?: number; endTs?: number }): Promise<DivingAnalysis> => {
    return ipcRenderer.invoke('chat:getDivingAnalysis', sessionId, filter)
  },

  /**
   * 获取自言自语分析数据
   */
  getMonologueAnalysis: (
    sessionId: string,
    filter?: { startTs?: number; endTs?: number }
  ): Promise<MonologueAnalysis> => {
    return ipcRenderer.invoke('chat:getMonologueAnalysis', sessionId, filter)
  },

  /**
   * 获取 @ 互动分析数据
   */
  getMentionAnalysis: (sessionId: string, filter?: { startTs?: number; endTs?: number }): Promise<MentionAnalysis> => {
    return ipcRenderer.invoke('chat:getMentionAnalysis', sessionId, filter)
  },

  /**
   * 获取含笑量分析数据
   */
  getLaughAnalysis: (
    sessionId: string,
    filter?: { startTs?: number; endTs?: number },
    keywords?: string[]
  ): Promise<LaughAnalysis> => {
    return ipcRenderer.invoke('chat:getLaughAnalysis', sessionId, filter, keywords)
  },

  /**
   * 获取斗图分析数据
   */
  getMemeBattleAnalysis: (
    sessionId: string,
    filter?: { startTs?: number; endTs?: number }
  ): Promise<MemeBattleAnalysis> => {
    return ipcRenderer.invoke('chat:getMemeBattleAnalysis', sessionId, filter)
  },

  /**
   * 获取打卡分析数据（火花榜 + 忠臣榜）
   */
  getCheckInAnalysis: (sessionId: string, filter?: { startTs?: number; endTs?: number }): Promise<CheckInAnalysis> => {
    return ipcRenderer.invoke('chat:getCheckInAnalysis', sessionId, filter)
  },

  // ==================== 成员管理 ====================

  /**
   * 获取所有成员列表（含消息数和别名）
   */
  getMembers: (sessionId: string): Promise<MemberWithStats[]> => {
    return ipcRenderer.invoke('chat:getMembers', sessionId)
  },

  /**
   * 更新成员别名
   */
  updateMemberAliases: (sessionId: string, memberId: number, aliases: string[]): Promise<boolean> => {
    return ipcRenderer.invoke('chat:updateMemberAliases', sessionId, memberId, aliases)
  },

  /**
   * 删除成员及其所有消息
   */
  deleteMember: (sessionId: string, memberId: number): Promise<boolean> => {
    return ipcRenderer.invoke('chat:deleteMember', sessionId, memberId)
  },

  /**
   * 更新会话的所有者（ownerId）
   * @param ownerId 成员的 platformId，设置为 null 则清除
   */
  updateSessionOwnerId: (sessionId: string, ownerId: string | null): Promise<boolean> => {
    return ipcRenderer.invoke('chat:updateSessionOwnerId', sessionId, ownerId)
  },

  // ==================== SQL 实验室 ====================

  /**
   * 执行用户 SQL 查询
   */
  executeSQL: (
    sessionId: string,
    sql: string
  ): Promise<{
    columns: string[]
    rows: any[][]
    rowCount: number
    duration: number
    limited: boolean
  }> => {
    return ipcRenderer.invoke('chat:executeSQL', sessionId, sql)
  },

  /**
   * 获取数据库 Schema
   */
  getSchema: (
    sessionId: string
  ): Promise<
    Array<{
      name: string
      columns: Array<{
        name: string
        type: string
        notnull: boolean
        pk: boolean
      }>
    }>
  > => {
    return ipcRenderer.invoke('chat:getSchema', sessionId)
  },
}

// Merge API - 合并功能
const mergeApi = {
  /**
   * 解析文件获取基本信息（用于合并预览）
   * 解析后结果会被缓存，后续合并时无需再次读取原始文件
   */
  parseFileInfo: (filePath: string): Promise<FileParseInfo> => {
    return ipcRenderer.invoke('merge:parseFileInfo', filePath)
  },

  /**
   * 检测合并冲突
   */
  checkConflicts: (filePaths: string[]): Promise<ConflictCheckResult> => {
    return ipcRenderer.invoke('merge:checkConflicts', filePaths)
  },

  /**
   * 执行合并
   */
  mergeFiles: (params: MergeParams): Promise<MergeResult> => {
    return ipcRenderer.invoke('merge:mergeFiles', params)
  },

  /**
   * 清理解析缓存
   * @param filePath 可选，指定文件路径则清理该文件的缓存，否则清理所有缓存
   */
  clearCache: (filePath?: string): Promise<boolean> => {
    return ipcRenderer.invoke('merge:clearCache', filePath)
  },

  /**
   * 监听解析进度（用于大文件）
   */
  onParseProgress: (callback: (data: { filePath: string; progress: ImportProgress }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { filePath: string; progress: ImportProgress }) => {
      callback(data)
    }
    ipcRenderer.on('merge:parseProgress', handler)
    return () => {
      ipcRenderer.removeListener('merge:parseProgress', handler)
    }
  },
}

// AI API - AI 功能
interface SearchMessageResult {
  id: number
  senderName: string
  senderPlatformId: string
  senderAliases: string[]
  senderAvatar: string | null
  content: string
  timestamp: number
  type: number
}

interface AIConversation {
  id: string
  sessionId: string
  title: string | null
  createdAt: number
  updatedAt: number
}

// 内容块类型（用于 AI 消息的混合渲染）
type ContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'tool'
      tool: {
        name: string
        displayName: string
        status: 'running' | 'done' | 'error'
        params?: Record<string, unknown>
      }
    }

interface AIMessage {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  dataKeywords?: string[]
  dataMessageCount?: number
  contentBlocks?: ContentBlock[]
}

const aiApi = {
  /**
   * 搜索消息（关键词搜索）
   * @param senderId 可选的发送者成员 ID，用于筛选特定成员的消息
   */
  searchMessages: (
    sessionId: string,
    keywords: string[],
    filter?: { startTs?: number; endTs?: number },
    limit?: number,
    offset?: number,
    senderId?: number
  ): Promise<{ messages: SearchMessageResult[]; total: number }> => {
    return ipcRenderer.invoke('ai:searchMessages', sessionId, keywords, filter, limit, offset, senderId)
  },

  /**
   * 获取消息上下文
   * @param messageIds 支持单个或批量消息 ID
   */
  getMessageContext: (
    sessionId: string,
    messageIds: number | number[],
    contextSize?: number
  ): Promise<SearchMessageResult[]> => {
    return ipcRenderer.invoke('ai:getMessageContext', sessionId, messageIds, contextSize)
  },

  /**
   * 获取最近消息（AI Agent 专用）
   */
  getRecentMessages: (
    sessionId: string,
    filter?: { startTs?: number; endTs?: number },
    limit?: number
  ): Promise<{ messages: SearchMessageResult[]; total: number }> => {
    return ipcRenderer.invoke('ai:getRecentMessages', sessionId, filter, limit)
  },

  /**
   * 获取所有最近消息（消息查看器专用）
   */
  getAllRecentMessages: (
    sessionId: string,
    filter?: { startTs?: number; endTs?: number },
    limit?: number
  ): Promise<{ messages: SearchMessageResult[]; total: number }> => {
    return ipcRenderer.invoke('ai:getAllRecentMessages', sessionId, filter, limit)
  },

  /**
   * 获取两人之间的对话
   */
  getConversationBetween: (
    sessionId: string,
    memberId1: number,
    memberId2: number,
    filter?: { startTs?: number; endTs?: number },
    limit?: number
  ): Promise<{ messages: SearchMessageResult[]; total: number; member1Name: string; member2Name: string }> => {
    return ipcRenderer.invoke('ai:getConversationBetween', sessionId, memberId1, memberId2, filter, limit)
  },

  /**
   * 获取指定消息之前的 N 条（用于向上无限滚动）
   */
  getMessagesBefore: (
    sessionId: string,
    beforeId: number,
    limit?: number,
    filter?: { startTs?: number; endTs?: number },
    senderId?: number,
    keywords?: string[]
  ): Promise<{ messages: SearchMessageResult[]; hasMore: boolean }> => {
    return ipcRenderer.invoke('ai:getMessagesBefore', sessionId, beforeId, limit, filter, senderId, keywords)
  },

  /**
   * 获取指定消息之后的 N 条（用于向下无限滚动）
   */
  getMessagesAfter: (
    sessionId: string,
    afterId: number,
    limit?: number,
    filter?: { startTs?: number; endTs?: number },
    senderId?: number,
    keywords?: string[]
  ): Promise<{ messages: SearchMessageResult[]; hasMore: boolean }> => {
    return ipcRenderer.invoke('ai:getMessagesAfter', sessionId, afterId, limit, filter, senderId, keywords)
  },

  /**
   * 创建 AI 对话
   */
  createConversation: (sessionId: string, title?: string): Promise<AIConversation> => {
    return ipcRenderer.invoke('ai:createConversation', sessionId, title)
  },

  /**
   * 获取会话的所有 AI 对话列表
   */
  getConversations: (sessionId: string): Promise<AIConversation[]> => {
    return ipcRenderer.invoke('ai:getConversations', sessionId)
  },

  /**
   * 获取单个 AI 对话
   */
  getConversation: (conversationId: string): Promise<AIConversation | null> => {
    return ipcRenderer.invoke('ai:getConversation', conversationId)
  },

  /**
   * 更新 AI 对话标题
   */
  updateConversationTitle: (conversationId: string, title: string): Promise<boolean> => {
    return ipcRenderer.invoke('ai:updateConversationTitle', conversationId, title)
  },

  /**
   * 删除 AI 对话
   */
  deleteConversation: (conversationId: string): Promise<boolean> => {
    return ipcRenderer.invoke('ai:deleteConversation', conversationId)
  },

  /**
   * 添加 AI 消息
   */
  addMessage: (
    conversationId: string,
    role: 'user' | 'assistant',
    content: string,
    dataKeywords?: string[],
    dataMessageCount?: number,
    contentBlocks?: ContentBlock[]
  ): Promise<AIMessage> => {
    return ipcRenderer.invoke(
      'ai:addMessage',
      conversationId,
      role,
      content,
      dataKeywords,
      dataMessageCount,
      contentBlocks
    )
  },

  /**
   * 获取 AI 对话的所有消息
   */
  getMessages: (conversationId: string): Promise<AIMessage[]> => {
    return ipcRenderer.invoke('ai:getMessages', conversationId)
  },

  /**
   * 删除 AI 消息
   */
  deleteMessage: (messageId: string): Promise<boolean> => {
    return ipcRenderer.invoke('ai:deleteMessage', messageId)
  },
}

// LLM API - LLM 服务功能
interface LLMProvider {
  id: string
  name: string
  description: string
  defaultBaseUrl: string
  models: Array<{ id: string; name: string; description?: string }>
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface ChatOptions {
  temperature?: number
  maxTokens?: number
}

interface ChatStreamChunk {
  content: string
  isFinished: boolean
  finishReason?: 'stop' | 'length' | 'error'
}

// Agent API 类型定义
interface AgentStreamChunk {
  type: 'content' | 'tool_start' | 'tool_result' | 'done' | 'error'
  content?: string
  toolName?: string
  toolParams?: Record<string, unknown>
  toolResult?: unknown
  error?: string
  isFinished?: boolean
}

interface AgentResult {
  content: string
  toolsUsed: string[]
  toolRounds: number
}

interface ToolContext {
  sessionId: string
  timeFilter?: { startTs: number; endTs: number }
}

// AI 服务配置类型（前端用）
interface AIServiceConfigDisplay {
  id: string
  name: string
  provider: string
  apiKey: string // 脱敏后的 API Key
  apiKeySet: boolean
  model?: string
  baseUrl?: string
  maxTokens?: number
  createdAt: number
  updatedAt: number
}

const llmApi = {
  /**
   * 获取所有支持的 LLM 提供商
   */
  getProviders: (): Promise<LLMProvider[]> => {
    return ipcRenderer.invoke('llm:getProviders')
  },

  // ==================== 多配置管理 API ====================

  /**
   * 获取所有配置列表
   */
  getAllConfigs: (): Promise<AIServiceConfigDisplay[]> => {
    return ipcRenderer.invoke('llm:getAllConfigs')
  },

  /**
   * 获取当前激活的配置 ID
   */
  getActiveConfigId: (): Promise<string | null> => {
    return ipcRenderer.invoke('llm:getActiveConfigId')
  },

  /**
   * 添加新配置
   */
  addConfig: (config: {
    name: string
    provider: string
    apiKey: string
    model?: string
    baseUrl?: string
    maxTokens?: number
  }): Promise<{ success: boolean; config?: AIServiceConfigDisplay; error?: string }> => {
    return ipcRenderer.invoke('llm:addConfig', config)
  },

  /**
   * 更新配置
   */
  updateConfig: (
    id: string,
    updates: {
      name?: string
      provider?: string
      apiKey?: string
      model?: string
      baseUrl?: string
      maxTokens?: number
    }
  ): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('llm:updateConfig', id, updates)
  },

  /**
   * 删除配置
   */
  deleteConfig: (id?: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('llm:deleteConfig', id)
  },

  /**
   * 设置激活的配置
   */
  setActiveConfig: (id: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('llm:setActiveConfig', id)
  },

  /**
   * 验证 API Key（支持自定义 baseUrl 和 model）
   */
  validateApiKey: (provider: string, apiKey: string, baseUrl?: string, model?: string): Promise<boolean> => {
    return ipcRenderer.invoke('llm:validateApiKey', provider, apiKey, baseUrl, model)
  },

  /**
   * 检查是否已配置 LLM（是否有激活的配置）
   */
  hasConfig: (): Promise<boolean> => {
    return ipcRenderer.invoke('llm:hasConfig')
  },

  /**
   * 发送 LLM 聊天请求（非流式）
   */
  chat: (
    messages: ChatMessage[],
    options?: ChatOptions
  ): Promise<{ success: boolean; content?: string; error?: string }> => {
    return ipcRenderer.invoke('llm:chat', messages, options)
  },

  /**
   * 发送 LLM 聊天请求（流式）
   * 返回一个 Promise，该 Promise 在流完成后才 resolve
   */
  chatStream: (
    messages: ChatMessage[],
    options?: ChatOptions,
    onChunk?: (chunk: ChatStreamChunk) => void
  ): Promise<{ success: boolean; error?: string }> => {
    return new Promise((resolve) => {
      const requestId = `llm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      console.log('[preload] chatStream 开始，requestId:', requestId)

      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { requestId: string; chunk: ChatStreamChunk; error?: string }
      ) => {
        if (data.requestId === requestId) {
          if (data.error) {
            console.log('[preload] chatStream 收到错误:', data.error)
            if (onChunk) {
              onChunk({ content: '', isFinished: true, finishReason: 'error' })
            }
            ipcRenderer.removeListener('llm:streamChunk', handler)
            resolve({ success: false, error: data.error })
          } else {
            if (onChunk) {
              onChunk(data.chunk)
            }

            // 如果已完成，移除监听器并 resolve
            if (data.chunk.isFinished) {
              console.log('[preload] chatStream 完成，requestId:', requestId)
              ipcRenderer.removeListener('llm:streamChunk', handler)
              resolve({ success: true })
            }
          }
        }
      }

      ipcRenderer.on('llm:streamChunk', handler)

      // 发起请求
      ipcRenderer
        .invoke('llm:chatStream', requestId, messages, options)
        .then((result) => {
          console.log('[preload] chatStream invoke 返回:', result)
          if (!result.success) {
            ipcRenderer.removeListener('llm:streamChunk', handler)
            resolve(result)
          }
          // 如果 success，等待流完成（由 handler 处理 resolve）
        })
        .catch((error) => {
          console.error('[preload] chatStream invoke 错误:', error)
          ipcRenderer.removeListener('llm:streamChunk', handler)
          resolve({ success: false, error: String(error) })
        })
    })
  },
}

// 用户自定义提示词配置
interface PromptConfig {
  roleDefinition: string
  responseRules: string
}

// Agent API - AI Agent 功能（带 Function Calling）
const agentApi = {
  /**
   * 执行 Agent 对话（流式）
   * Agent 会自动调用工具获取数据并生成回答
   * @param historyMessages 对话历史（可选，用于上下文关联）
   * @param chatType 聊天类型（'group' | 'private'）
   * @param promptConfig 用户自定义提示词配置（可选）
   * @param locale 语言设置（可选，默认 'zh-CN'）
   * @returns 返回 { requestId, promise }，requestId 可用于中止请求
   */
  runStream: (
    userMessage: string,
    context: ToolContext,
    onChunk?: (chunk: AgentStreamChunk) => void,
    historyMessages?: Array<{ role: 'user' | 'assistant'; content: string }>,
    chatType?: 'group' | 'private',
    promptConfig?: PromptConfig,
    locale?: string
  ): { requestId: string; promise: Promise<{ success: boolean; result?: AgentResult; error?: string }> } => {
    const requestId = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    console.log(
      '[preload] Agent runStream 开始，requestId:',
      requestId,
      'historyLength:',
      historyMessages?.length ?? 0,
      'chatType:',
      chatType ?? 'group',
      'hasPromptConfig:',
      !!promptConfig
    )

    const promise = new Promise<{ success: boolean; result?: AgentResult; error?: string }>((resolve) => {
      // 监听流式 chunks
      const chunkHandler = (
        _event: Electron.IpcRendererEvent,
        data: { requestId: string; chunk: AgentStreamChunk }
      ) => {
        if (data.requestId === requestId) {
          if (onChunk) {
            onChunk(data.chunk)
          }
        }
      }

      // 监听完成事件
      const completeHandler = (
        _event: Electron.IpcRendererEvent,
        data: { requestId: string; result: AgentResult & { error?: string } }
      ) => {
        if (data.requestId === requestId) {
          console.log('[preload] Agent 完成，requestId:', requestId, 'hasError:', !!data.result?.error)
          ipcRenderer.removeListener('agent:streamChunk', chunkHandler)
          ipcRenderer.removeListener('agent:complete', completeHandler)
          // 如果 result 中包含 error，返回失败状态
          if (data.result?.error) {
            resolve({ success: false, error: data.result.error })
          } else {
            resolve({ success: true, result: data.result })
          }
        }
      }

      ipcRenderer.on('agent:streamChunk', chunkHandler)
      ipcRenderer.on('agent:complete', completeHandler)

      // 发起请求（传递历史消息、聊天类型、提示词配置和语言设置）
      ipcRenderer
        .invoke('agent:runStream', requestId, userMessage, context, historyMessages, chatType, promptConfig, locale)
        .then((result) => {
          console.log('[preload] Agent invoke 返回:', result)
          if (!result.success) {
            ipcRenderer.removeListener('agent:streamChunk', chunkHandler)
            ipcRenderer.removeListener('agent:complete', completeHandler)
            resolve(result)
          }
          // 如果 success，等待完成（由 completeHandler 处理 resolve）
        })
        .catch((error) => {
          console.error('[preload] Agent invoke 错误:', error)
          ipcRenderer.removeListener('agent:streamChunk', chunkHandler)
          ipcRenderer.removeListener('agent:complete', completeHandler)
          resolve({ success: false, error: String(error) })
        })
    })

    return { requestId, promise }
  },

  /**
   * 中止 Agent 请求
   * @param requestId 请求 ID
   */
  abort: (requestId: string): Promise<{ success: boolean; error?: string }> => {
    console.log('[preload] Agent abort 请求，requestId:', requestId)
    return ipcRenderer.invoke('agent:abort', requestId)
  },
}

// Network API - 网络设置
interface ProxyConfig {
  enabled: boolean
  url: string
}

const networkApi = {
  /**
   * 获取代理配置
   */
  getProxyConfig: (): Promise<ProxyConfig> => {
    return ipcRenderer.invoke('network:getProxyConfig')
  },

  /**
   * 保存代理配置
   */
  saveProxyConfig: (config: ProxyConfig): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('network:saveProxyConfig', config)
  },

  /**
   * 测试代理连接
   */
  testProxyConnection: (proxyUrl: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('network:testProxyConnection', proxyUrl)
  },
}

// Cache API - 缓存管理
interface CacheDirectoryInfo {
  id: string
  name: string
  description: string
  path: string
  icon: string
  canClear: boolean
  size: number
  fileCount: number
  exists: boolean
}

interface CacheInfo {
  baseDir: string
  directories: CacheDirectoryInfo[]
  totalSize: number
}

const cacheApi = {
  /**
   * 获取所有缓存目录信息
   */
  getInfo: (): Promise<CacheInfo> => {
    return ipcRenderer.invoke('cache:getInfo')
  },

  /**
   * 清理指定缓存目录
   */
  clear: (cacheId: string): Promise<{ success: boolean; error?: string; message?: string }> => {
    return ipcRenderer.invoke('cache:clear', cacheId)
  },

  /**
   * 在文件管理器中打开缓存目录
   */
  openDir: (cacheId: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('cache:openDir', cacheId)
  },

  /**
   * 保存文件到下载目录
   */
  saveToDownloads: (
    filename: string,
    dataUrl: string
  ): Promise<{ success: boolean; filePath?: string; error?: string }> => {
    return ipcRenderer.invoke('cache:saveToDownloads', filename, dataUrl)
  },

  /**
   * 获取最新的导入日志文件路径
   */
  getLatestImportLog: (): Promise<{ success: boolean; path?: string; name?: string; error?: string }> => {
    return ipcRenderer.invoke('cache:getLatestImportLog')
  },

  /**
   * 在文件管理器中显示并高亮文件
   */
  showInFolder: (filePath: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('cache:showInFolder', filePath)
  },
}

// Session Index API - 会话索引功能
interface SessionStats {
  sessionCount: number
  hasIndex: boolean
  gapThreshold: number
}

interface ChatSessionItem {
  id: number
  startTs: number
  endTs: number
  messageCount: number
  firstMessageId: number
}

const sessionApi = {
  /**
   * 生成会话索引
   * @param sessionId 数据库会话ID
   * @param gapThreshold 时间间隔阈值（秒）
   * @returns 生成的会话数量
   */
  generate: (sessionId: string, gapThreshold?: number): Promise<number> => {
    return ipcRenderer.invoke('session:generate', sessionId, gapThreshold)
  },

  /**
   * 检查是否已生成会话索引
   */
  hasIndex: (sessionId: string): Promise<boolean> => {
    return ipcRenderer.invoke('session:hasIndex', sessionId)
  },

  /**
   * 获取会话索引统计信息
   */
  getStats: (sessionId: string): Promise<SessionStats> => {
    return ipcRenderer.invoke('session:getStats', sessionId)
  },

  /**
   * 清空会话索引
   */
  clear: (sessionId: string): Promise<boolean> => {
    return ipcRenderer.invoke('session:clear', sessionId)
  },

  /**
   * 更新会话切分阈值
   */
  updateGapThreshold: (sessionId: string, gapThreshold: number | null): Promise<boolean> => {
    return ipcRenderer.invoke('session:updateGapThreshold', sessionId, gapThreshold)
  },

  /**
   * 获取会话列表（用于时间线导航）
   */
  getSessions: (sessionId: string): Promise<ChatSessionItem[]> => {
    return ipcRenderer.invoke('session:getSessions', sessionId)
  },
}

// 扩展 api，添加 dialog、clipboard 和应用功能
const extendedApi = {
  ...api,
  dialog: {
    showOpenDialog: (options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> => {
      return ipcRenderer.invoke('dialog:showOpenDialog', options)
    },
  },
  clipboard: {
    /**
     * 复制图片到系统剪贴板
     * @param dataUrl 图片的 base64 data URL
     */
    copyImage: (dataUrl: string): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('copyImage', dataUrl)
    },
  },
  app: {
    /**
     * 获取应用版本号
     */
    getVersion: (): Promise<string> => {
      return ipcRenderer.invoke('app:getVersion')
    },
    /**
     * 检查更新
     */
    checkUpdate: (): void => {
      ipcRenderer.send('check-update')
    },
    /**
     * 模拟更新弹窗（仅开发模式）
     */
    simulateUpdate: (): void => {
      ipcRenderer.send('simulate-update')
    },
    /**
     * 获取远程配置（通过主进程请求，绕过 CORS）
     */
    fetchRemoteConfig: (url: string): Promise<{ success: boolean; data?: unknown; error?: string }> => {
      return ipcRenderer.invoke('app:fetchRemoteConfig', url)
    },
    /**
     * 获取匿名统计开关状态
     */
    getAnalyticsEnabled: (): Promise<boolean> => {
      return ipcRenderer.invoke('analytics:getEnabled')
    },
    /**
     * 设置匿名统计开关状态
     */
    setAnalyticsEnabled: (enabled: boolean): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('analytics:setEnabled', enabled)
    },
  },
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', extendedApi)
    contextBridge.exposeInMainWorld('chatApi', chatApi)
    contextBridge.exposeInMainWorld('mergeApi', mergeApi)
    contextBridge.exposeInMainWorld('aiApi', aiApi)
    contextBridge.exposeInMainWorld('llmApi', llmApi)
    contextBridge.exposeInMainWorld('agentApi', agentApi)
    contextBridge.exposeInMainWorld('cacheApi', cacheApi)
    contextBridge.exposeInMainWorld('networkApi', networkApi)
    contextBridge.exposeInMainWorld('sessionApi', sessionApi)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = extendedApi
  // @ts-ignore (define in dts)
  window.chatApi = chatApi
  // @ts-ignore (define in dts)
  window.mergeApi = mergeApi
  // @ts-ignore (define in dts)
  window.aiApi = aiApi
  // @ts-ignore (define in dts)
  window.llmApi = llmApi
  // @ts-ignore (define in dts)
  window.agentApi = agentApi
  // @ts-ignore (define in dts)
  window.cacheApi = cacheApi
  // @ts-ignore (define in dts)
  window.networkApi = networkApi
  // @ts-ignore (define in dts)
  window.sessionApi = sessionApi
}
