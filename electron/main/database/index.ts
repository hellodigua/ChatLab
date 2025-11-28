/**
 * 数据库服务模块
 * 统一导出入口
 */

// 核心功能
export { importData, getAllSessions, getSession, deleteSession, getDbDirectory, openDatabase, getDbPath } from './core'

// 分析查询
export {
  getAvailableYears,
  getMemberActivity,
  getHourlyActivity,
  getDailyActivity,
  getWeekdayActivity,
  getMessageTypeDistribution,
  getTimeRange,
  getMemberNameHistory,
  getRepeatAnalysis,
  getCatchphraseAnalysis,
  getNightOwlAnalysis,
  getDragonKingAnalysis,
  getDivingAnalysis,
} from './analysis'

// 类型导出
export type { TimeFilter } from './analysis'
