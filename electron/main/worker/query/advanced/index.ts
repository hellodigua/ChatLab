/**
 * 高级分析模块入口
 * 统一导出所有分析函数
 */

// 复读 + 口头禅分析
export { getRepeatAnalysis, getCatchphraseAnalysis } from './repeat'

// 活跃度分析：夜猫、龙王、潜水、打卡
export { getNightOwlAnalysis, getDragonKingAnalysis, getDivingAnalysis, getCheckInAnalysis } from './activity'

// 行为分析：自言自语、斗图
export { getMonologueAnalysis, getMemeBattleAnalysis } from './behavior'

// 社交分析：@ 互动、含笑量
export { getMentionAnalysis, getMentionGraph, getLaughAnalysis } from './social'
export type { MentionGraphData, MentionGraphNode, MentionGraphLink } from './social'
