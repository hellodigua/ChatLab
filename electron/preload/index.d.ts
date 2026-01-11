import { ElectronAPI } from '@electron-toolkit/preload'
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
  MemeBattleAnalysis,
  CheckInAnalysis,
  MemberWithStats,
} from '../../src/types/analysis'
import type { FileParseInfo, ConflictCheckResult, MergeParams, MergeResult } from '../../src/types/format'
import type { TableSchema, SQLResult } from '../../src/components/analysis/SQLLab/types'

interface TimeFilter {
  startTs?: number
  endTs?: number
}

// 迁移相关类型
interface MigrationInfo {
  version: number
  description: string
  userMessage: string
}

interface MigrationCheckResult {
  needsMigration: boolean
  count: number
  currentVersion: number
  pendingMigrations: MigrationInfo[]
}

// 格式诊断信息（简化版，用于前端显示）
interface FormatDiagnosisSimple {
  suggestion: string
  partialMatches: Array<{
    formatName: string
    missingFields: string[]
  }>
}

interface ChatApi {
  selectFile: () => Promise<{
    filePath?: string
    format?: string
    error?: string
    diagnosis?: FormatDiagnosisSimple
  } | null>
  import: (filePath: string) => Promise<{
    success: boolean
    sessionId?: string
    error?: string
    diagnosis?: FormatDiagnosisSimple
  }>
  getSessions: () => Promise<AnalysisSession[]>
  getSession: (sessionId: string) => Promise<AnalysisSession | null>
  deleteSession: (sessionId: string) => Promise<boolean>
  renameSession: (sessionId: string, newName: string) => Promise<boolean>
  // 迁移相关
  checkMigration: () => Promise<MigrationCheckResult>
  runMigration: () => Promise<{ success: boolean; error?: string }>
  // 会话所有者
  updateSessionOwnerId: (sessionId: string, ownerId: string | null) => Promise<boolean>
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
  // SQL 实验室
  getSchema: (sessionId: string) => Promise<TableSchema[]>
  executeSQL: (sessionId: string, sql: string) => Promise<SQLResult>
}

interface Api {
  send: (channel: string, data?: unknown) => void
  receive: (channel: string, func: (...args: unknown[]) => void) => void
  removeListener: (channel: string, func: (...args: unknown[]) => void) => void
  dialog: {
    showOpenDialog: (options: Electron.OpenDialogOptions) => Promise<Electron.OpenDialogReturnValue>
  }
  clipboard: {
    copyImage: (dataUrl: string) => Promise<{ success: boolean; error?: string }>
  }
  app: {
    getVersion: () => Promise<string>
    checkUpdate: () => void
    simulateUpdate: () => void
    fetchRemoteConfig: (url: string) => Promise<{ success: boolean; data?: unknown; error?: string }>
    getAnalyticsEnabled: () => Promise<boolean>
    setAnalyticsEnabled: (enabled: boolean) => Promise<{ success: boolean }>
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
type AIContentBlock =
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
  contentBlocks?: AIContentBlock[]
}

interface AiApi {
  searchMessages: (
    sessionId: string,
    keywords: string[],
    filter?: TimeFilter,
    limit?: number,
    offset?: number,
    senderId?: number
  ) => Promise<{ messages: SearchMessageResult[]; total: number }>
  getMessageContext: (
    sessionId: string,
    messageIds: number | number[],
    contextSize?: number
  ) => Promise<SearchMessageResult[]>
  getRecentMessages: (
    sessionId: string,
    filter?: TimeFilter,
    limit?: number
  ) => Promise<{ messages: SearchMessageResult[]; total: number }>
  getAllRecentMessages: (
    sessionId: string,
    filter?: TimeFilter,
    limit?: number
  ) => Promise<{ messages: SearchMessageResult[]; total: number }>
  getConversationBetween: (
    sessionId: string,
    memberId1: number,
    memberId2: number,
    filter?: TimeFilter,
    limit?: number
  ) => Promise<{ messages: SearchMessageResult[]; total: number; member1Name: string; member2Name: string }>
  getMessagesBefore: (
    sessionId: string,
    beforeId: number,
    limit?: number,
    filter?: TimeFilter,
    senderId?: number,
    keywords?: string[]
  ) => Promise<{ messages: SearchMessageResult[]; hasMore: boolean }>
  getMessagesAfter: (
    sessionId: string,
    afterId: number,
    limit?: number,
    filter?: TimeFilter,
    senderId?: number,
    keywords?: string[]
  ) => Promise<{ messages: SearchMessageResult[]; hasMore: boolean }>
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
    dataMessageCount?: number,
    contentBlocks?: AIContentBlock[]
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
  validateApiKey: (
    provider: string,
    apiKey: string,
    baseUrl?: string,
    model?: string
  ) => Promise<{ success: boolean; error?: string }>
  hasConfig: () => Promise<boolean>

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

// Token 使用量类型
interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
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
  /** Token 使用量（type=done 时返回累计值） */
  usage?: TokenUsage
}

interface AgentResult {
  content: string
  toolsUsed: string[]
  toolRounds: number
  /** 总 Token 使用量（累计所有 LLM 调用） */
  totalUsage?: TokenUsage
}

/** Owner 信息（当前用户在对话中的身份） */
interface OwnerInfo {
  /** Owner 的 platformId */
  platformId: string
  /** Owner 的显示名称 */
  displayName: string
}

interface ToolContext {
  sessionId: string
  timeFilter?: { startTs: number; endTs: number }
  /** 用户配置：每次发送给 AI 的最大消息条数 */
  maxMessagesLimit?: number
  /** Owner 信息（当前用户在对话中的身份） */
  ownerInfo?: OwnerInfo
}

// 用户自定义提示词配置
interface PromptConfig {
  roleDefinition: string
  responseRules: string
}

interface AgentApi {
  runStream: (
    userMessage: string,
    context: ToolContext,
    onChunk?: (chunk: AgentStreamChunk) => void,
    historyMessages?: Array<{ role: 'user' | 'assistant'; content: string }>,
    chatType?: 'group' | 'private',
    promptConfig?: PromptConfig,
    locale?: string
  ) => { requestId: string; promise: Promise<{ success: boolean; result?: AgentResult; error?: string }> }
  abort: (requestId: string) => Promise<{ success: boolean; error?: string }>
}

// Cache API 类型
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

interface CacheApi {
  getInfo: () => Promise<CacheInfo>
  clear: (cacheId: string) => Promise<{ success: boolean; error?: string; message?: string }>
  openDir: (cacheId: string) => Promise<{ success: boolean; error?: string }>
  saveToDownloads: (
    filename: string,
    dataUrl: string
  ) => Promise<{ success: boolean; filePath?: string; error?: string }>
  getLatestImportLog: () => Promise<{ success: boolean; path?: string; name?: string; error?: string }>
  showInFolder: (filePath: string) => Promise<{ success: boolean; error?: string }>
}

// Network API 类型 - 网络代理配置
interface ProxyConfig {
  enabled: boolean
  url: string
}

interface NetworkApi {
  getProxyConfig: () => Promise<ProxyConfig>
  saveProxyConfig: (config: ProxyConfig) => Promise<{ success: boolean; error?: string }>
  testProxyConnection: (proxyUrl: string) => Promise<{ success: boolean; error?: string }>
}

// Session Index API 类型 - 会话索引功能
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

interface SessionApi {
  generate: (sessionId: string, gapThreshold?: number) => Promise<number>
  hasIndex: (sessionId: string) => Promise<boolean>
  getStats: (sessionId: string) => Promise<SessionStats>
  clear: (sessionId: string) => Promise<boolean>
  updateGapThreshold: (sessionId: string, gapThreshold: number | null) => Promise<boolean>
  getSessions: (sessionId: string) => Promise<ChatSessionItem[]>
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
    cacheApi: CacheApi
    networkApi: NetworkApi
    sessionApi: SessionApi
  }
}

export {
  ChatApi,
  Api,
  MergeApi,
  AiApi,
  LlmApi,
  AgentApi,
  CacheApi,
  NetworkApi,
  ProxyConfig,
  SearchMessageResult,
  AIConversation,
  AIMessage,
  LLMProviderInfo,
  AIServiceConfigDisplay,
  LLMChatMessage,
  LLMChatOptions,
  LLMChatStreamChunk,
  AgentStreamChunk,
  AgentResult,
  ToolContext,
  PromptConfig,
  TokenUsage,
  CacheDirectoryInfo,
  CacheInfo,
}
