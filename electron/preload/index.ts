import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AnalysisSession,
  MemberActivity,
  MemberNameHistory,
  HourlyActivity,
  DailyActivity,
  WeekdayActivity,
  MonthlyActivity,
  MessageType,
  ImportProgress,
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
  FileParseInfo,
  ConflictCheckResult,
  MergeParams,
  MergeResult,
  MemberWithStats,
} from '../../src/types/chat'

// Custom APIs for renderer
const api = {
  send: (channel: string, data?: unknown) => {
    // whitelist channels
    const validChannels = [
      'show-message',
      'check-update',
      'get-gpu-acceleration',
      'set-gpu-acceleration',
      'save-gpu-acceleration',
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

interface AIMessage {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  dataKeywords?: string[]
  dataMessageCount?: number
}

const aiApi = {
  /**
   * 搜索消息（关键词搜索）
   */
  searchMessages: (
    sessionId: string,
    keywords: string[],
    filter?: { startTs?: number; endTs?: number },
    limit?: number,
    offset?: number
  ): Promise<{ messages: SearchMessageResult[]; total: number }> => {
    return ipcRenderer.invoke('ai:searchMessages', sessionId, keywords, filter, limit, offset)
  },

  /**
   * 获取消息上下文
   */
  getMessageContext: (sessionId: string, messageId: number, contextSize?: number): Promise<SearchMessageResult[]> => {
    return ipcRenderer.invoke('ai:getMessageContext', sessionId, messageId, contextSize)
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
    dataMessageCount?: number
  ): Promise<AIMessage> => {
    return ipcRenderer.invoke('ai:addMessage', conversationId, role, content, dataKeywords, dataMessageCount)
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

interface LLMConfig {
  provider: string
  apiKey: string
  apiKeySet: boolean
  model?: string
  maxTokens?: number
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

  // ==================== 兼容旧 API（deprecated）====================

  /**
   * @deprecated 使用 getAllConfigs 代替
   * 获取当前 LLM 配置
   */
  getConfig: (): Promise<LLMConfig | null> => {
    return ipcRenderer.invoke('llm:getConfig')
  },

  /**
   * @deprecated 使用 addConfig 或 updateConfig 代替
   * 保存 LLM 配置
   */
  saveConfig: (config: {
    provider: string
    apiKey: string
    model?: string
    baseUrl?: string
    maxTokens?: number
  }): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('llm:saveConfig', config)
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

// Agent API - AI Agent 功能（带 Function Calling）
const agentApi = {
  /**
   * 执行 Agent 对话（流式）
   * Agent 会自动调用工具获取数据并生成回答
   */
  runStream: (
    userMessage: string,
    context: ToolContext,
    onChunk?: (chunk: AgentStreamChunk) => void
  ): Promise<{ success: boolean; result?: AgentResult; error?: string }> => {
    return new Promise((resolve) => {
      const requestId = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      console.log('[preload] Agent runStream 开始，requestId:', requestId)

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
      const completeHandler = (_event: Electron.IpcRendererEvent, data: { requestId: string; result: AgentResult }) => {
        if (data.requestId === requestId) {
          console.log('[preload] Agent 完成，requestId:', requestId)
          ipcRenderer.removeListener('agent:streamChunk', chunkHandler)
          ipcRenderer.removeListener('agent:complete', completeHandler)
          resolve({ success: true, result: data.result })
        }
      }

      ipcRenderer.on('agent:streamChunk', chunkHandler)
      ipcRenderer.on('agent:complete', completeHandler)

      // 发起请求
      ipcRenderer
        .invoke('agent:runStream', requestId, userMessage, context)
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
  },
}

// 扩展 api，添加 dialog 功能
const extendedApi = {
  ...api,
  dialog: {
    showOpenDialog: (options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> => {
      return ipcRenderer.invoke('dialog:showOpenDialog', options)
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
}
