import { ElectronAPI } from '@electron-toolkit/preload'
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
  MemeBattleAnalysis,
  CheckInAnalysis,
  FileParseInfo,
  ConflictCheckResult,
  MergeParams,
  MergeResult,
  MemberWithStats,
} from '../../src/types/chat'

interface TimeFilter {
  startTs?: number
  endTs?: number
}

interface ChatApi {
  selectFile: () => Promise<{ filePath?: string; format?: string; error?: string } | null>
  import: (filePath: string) => Promise<{ success: boolean; sessionId?: string; error?: string }>
  getSessions: () => Promise<AnalysisSession[]>
  getSession: (sessionId: string) => Promise<AnalysisSession | null>
  deleteSession: (sessionId: string) => Promise<boolean>
  renameSession: (sessionId: string, newName: string) => Promise<boolean>
  getAvailableYears: (sessionId: string) => Promise<number[]>
  getMemberActivity: (sessionId: string, filter?: TimeFilter) => Promise<MemberActivity[]>
  getMemberNameHistory: (sessionId: string, memberId: number) => Promise<MemberNameHistory[]>
  getHourlyActivity: (sessionId: string, filter?: TimeFilter) => Promise<HourlyActivity[]>
  getDailyActivity: (sessionId: string, filter?: TimeFilter) => Promise<DailyActivity[]>
  getWeekdayActivity: (sessionId: string, filter?: TimeFilter) => Promise<WeekdayActivity[]>
  getMonthlyActivity: (sessionId: string, filter?: TimeFilter) => Promise<MonthlyActivity[]>
  getMessageTypeDistribution: (
    sessionId: string,
    filter?: TimeFilter
  ) => Promise<Array<{ type: MessageType; count: number }>>
  getTimeRange: (sessionId: string) => Promise<{ start: number; end: number } | null>
  getDbDirectory: () => Promise<string | null>
  getSupportedFormats: () => Promise<Array<{ name: string; platform: string }>>
  onImportProgress: (callback: (progress: ImportProgress) => void) => () => void
  getRepeatAnalysis: (sessionId: string, filter?: TimeFilter) => Promise<RepeatAnalysis>
  getCatchphraseAnalysis: (sessionId: string, filter?: TimeFilter) => Promise<CatchphraseAnalysis>
  getNightOwlAnalysis: (sessionId: string, filter?: TimeFilter) => Promise<NightOwlAnalysis>
  getDragonKingAnalysis: (sessionId: string, filter?: TimeFilter) => Promise<DragonKingAnalysis>
  getDivingAnalysis: (sessionId: string, filter?: TimeFilter) => Promise<DivingAnalysis>
  getMonologueAnalysis: (sessionId: string, filter?: TimeFilter) => Promise<MonologueAnalysis>
  getMentionAnalysis: (sessionId: string, filter?: TimeFilter) => Promise<MentionAnalysis>
  getLaughAnalysis: (sessionId: string, filter?: TimeFilter, keywords?: string[]) => Promise<LaughAnalysis>
  getMemeBattleAnalysis: (sessionId: string, filter?: TimeFilter) => Promise<MemeBattleAnalysis>
  getCheckInAnalysis: (sessionId: string, filter?: TimeFilter) => Promise<CheckInAnalysis>
  // 成员管理
  getMembers: (sessionId: string) => Promise<MemberWithStats[]>
  updateMemberAliases: (sessionId: string, memberId: number, aliases: string[]) => Promise<boolean>
  deleteMember: (sessionId: string, memberId: number) => Promise<boolean>
}

interface Api {
  send: (channel: string, data?: unknown) => void
  receive: (channel: string, func: (...args: unknown[]) => void) => void
  removeListener: (channel: string, func: (...args: unknown[]) => void) => void
  dialog: {
    showOpenDialog: (options: Electron.OpenDialogOptions) => Promise<Electron.OpenDialogReturnValue>
  }
}

interface MergeApi {
  parseFileInfo: (filePath: string) => Promise<FileParseInfo>
  checkConflicts: (filePaths: string[]) => Promise<ConflictCheckResult>
  mergeFiles: (params: MergeParams) => Promise<MergeResult>
  clearCache: (filePath?: string) => Promise<boolean>
  onParseProgress: (callback: (data: { filePath: string; progress: ImportProgress }) => void) => () => void
}

// AI 相关类型
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

interface AiApi {
  searchMessages: (
    sessionId: string,
    keywords: string[],
    filter?: TimeFilter,
    limit?: number,
    offset?: number
  ) => Promise<{ messages: SearchMessageResult[]; total: number }>
  getMessageContext: (sessionId: string, messageId: number, contextSize?: number) => Promise<SearchMessageResult[]>
  createConversation: (sessionId: string, title?: string) => Promise<AIConversation>
  getConversations: (sessionId: string) => Promise<AIConversation[]>
  getConversation: (conversationId: string) => Promise<AIConversation | null>
  updateConversationTitle: (conversationId: string, title: string) => Promise<boolean>
  deleteConversation: (conversationId: string) => Promise<boolean>
  addMessage: (
    conversationId: string,
    role: 'user' | 'assistant',
    content: string,
    dataKeywords?: string[],
    dataMessageCount?: number
  ) => Promise<AIMessage>
  getMessages: (conversationId: string) => Promise<AIMessage[]>
  deleteMessage: (messageId: string) => Promise<boolean>
}

// LLM 相关类型
interface LLMProviderInfo {
  id: string
  name: string
  description: string
  defaultBaseUrl: string
  models: Array<{ id: string; name: string; description?: string }>
}

// 单个 AI 服务配置（前端显示用，API Key 已脱敏）
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

// 兼容旧 API 的配置类型
interface LLMConfig {
  provider: string
  apiKey: string
  apiKeySet: boolean
  model?: string
  baseUrl?: string
  maxTokens?: number
}

interface LLMChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface LLMChatOptions {
  temperature?: number
  maxTokens?: number
}

interface LLMChatStreamChunk {
  content: string
  isFinished: boolean
  finishReason?: 'stop' | 'length' | 'error'
}

interface LlmApi {
  // 提供商
  getProviders: () => Promise<LLMProviderInfo[]>

  // 多配置管理 API
  getAllConfigs: () => Promise<AIServiceConfigDisplay[]>
  getActiveConfigId: () => Promise<string | null>
  addConfig: (config: {
    name: string
    provider: string
    apiKey: string
    model?: string
    baseUrl?: string
    maxTokens?: number
    disableThinking?: boolean
  }) => Promise<{ success: boolean; config?: AIServiceConfigDisplay; error?: string }>
  updateConfig: (
    id: string,
    updates: {
      name?: string
      provider?: string
      apiKey?: string
      model?: string
      baseUrl?: string
      maxTokens?: number
      disableThinking?: boolean
    }
  ) => Promise<{ success: boolean; error?: string }>
  deleteConfig: (id?: string) => Promise<{ success: boolean; error?: string }>
  setActiveConfig: (id: string) => Promise<{ success: boolean; error?: string }>

  // 验证和检查
  validateApiKey: (provider: string, apiKey: string, baseUrl?: string, model?: string) => Promise<boolean>
  hasConfig: () => Promise<boolean>

  // 兼容旧 API（deprecated）
  /** @deprecated 使用 getAllConfigs 代替 */
  getConfig: () => Promise<LLMConfig | null>
  /** @deprecated 使用 addConfig 或 updateConfig 代替 */
  saveConfig: (config: {
    provider: string
    apiKey: string
    model?: string
    baseUrl?: string
    maxTokens?: number
  }) => Promise<{ success: boolean; error?: string }>

  // 聊天功能
  chat: (
    messages: LLMChatMessage[],
    options?: LLMChatOptions
  ) => Promise<{ success: boolean; content?: string; error?: string }>
  chatStream: (
    messages: LLMChatMessage[],
    options?: LLMChatOptions,
    onChunk?: (chunk: LLMChatStreamChunk) => void
  ) => Promise<{ success: boolean; error?: string }>
}

// Agent 相关类型
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

interface AgentApi {
  runStream: (
    userMessage: string,
    context: ToolContext,
    onChunk?: (chunk: AgentStreamChunk) => void
  ) => Promise<{ success: boolean; result?: AgentResult; error?: string }>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
    chatApi: ChatApi
    mergeApi: MergeApi
    aiApi: AiApi
    llmApi: LlmApi
    agentApi: AgentApi
  }
}

export {
  ChatApi,
  Api,
  MergeApi,
  AiApi,
  LlmApi,
  AgentApi,
  SearchMessageResult,
  AIConversation,
  AIMessage,
  LLMProviderInfo,
  LLMConfig,
  AIServiceConfigDisplay,
  LLMChatMessage,
  LLMChatOptions,
  LLMChatStreamChunk,
  AgentStreamChunk,
  AgentResult,
  ToolContext,
}
