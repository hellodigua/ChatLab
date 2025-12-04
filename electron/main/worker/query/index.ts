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
  getMessageTypeDistribution,
  getTimeRange,
  getMemberNameHistory,
  getAllSessions,
  getSession,
  // 成员管理
  getMembers,
  updateMemberAliases,
  deleteMember,
} from './basic'

// 高级分析
export {
  getRepeatAnalysis,
  getCatchphraseAnalysis,
  getNightOwlAnalysis,
  getDragonKingAnalysis,
  getDivingAnalysis,
  getCheckInAnalysis,
  getMonologueAnalysis,
  getMemeBattleAnalysis,
  getMentionAnalysis,
  getLaughAnalysis,
} from './advanced'

// AI 查询
export { searchMessages, getMessageContext, getRecentMessages, getConversationBetween } from './ai'
