/**
 * 查询模块入口
 * 统一导出基础查询和高级分析函数
 */

// 基础查询
export {
  getAvailableYears,
  getMemberActivity,
  getHourlyActivity,
  getDailyActivity,
  getWeekdayActivity,
  getMonthlyActivity,
  getYearlyActivity,
  getMessageLengthDistribution,
  getMessageTypeDistribution,
  getTimeRange,
  getMemberNameHistory,
  getAllSessions,
  getSession,
  // 成员管理
  getMembers,
  getMembersPaginated,
  updateMemberAliases,
  deleteMember,
} from './basic'

// 成员分页类型
export type { MembersPaginationParams, MembersPaginatedResult } from './basic'

// 高级分析
export {
  getRepeatAnalysis,
  getCatchphraseAnalysis,
  getNightOwlAnalysis,
  getDragonKingAnalysis,
  getDivingAnalysis,
  getCheckInAnalysis,
  getMemeBattleAnalysis,
  getMentionAnalysis,
  getMentionGraph,
  getLaughAnalysis,
} from './advanced'

// 聊天记录查询
export {
  searchMessages,
  getMessageContext,
  getRecentMessages,
  getAllRecentMessages,
  getConversationBetween,
  getMessagesBefore,
  getMessagesAfter,
} from './messages'

// 聊天记录查询类型
export type { MessageResult, PaginatedMessages, MessagesWithTotal } from './messages'

// SQL 实验室
export { executeRawSQL, getSchema } from './sql'
export type { SQLResult, TableSchema } from './sql'

// 会话索引
export {
  generateSessions,
  clearSessions,
  hasSessionIndex,
  getSessionStats,
  updateSessionGapThreshold,
  getSessions,
  saveSessionSummary,
  getSessionSummary,
  searchSessions,
  getSessionMessages,
  DEFAULT_SESSION_GAP_THRESHOLD,
  // 自定义筛选
  filterMessagesWithContext,
  getMultipleSessionsMessages,
  // 导出功能
  exportFilterResultToFile,
} from './session'
export type {
  ChatSessionItem,
  SessionSearchResultItem,
  SessionMessagesResult,
  ContextBlock,
  FilterResult,
  FilterMessage,
  PaginationInfo,
  FilterResultWithPagination,
  ExportFilterParams,
  ExportProgress,
} from './session'

// NLP 查询
export { getWordFrequency, segmentText, getPosTags } from './nlp'
