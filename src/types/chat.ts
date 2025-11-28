/**
 * ChatLab 聊天数据模型定义
 * 统一的数据结构，支持多平台聊天记录导入
 */

// ==================== 枚举定义 ====================

/**
 * 消息类型枚举
 */
export enum MessageType {
  TEXT = 0, // 文本消息
  IMAGE = 1, // 图片
  VOICE = 2, // 语音
  VIDEO = 3, // 视频
  FILE = 4, // 文件
  EMOJI = 5, // 表情包/贴纸
  SYSTEM = 6, // 系统消息（入群/退群/撤回等）
  OTHER = 99, // 其他
}

/**
 * 聊天平台枚举
 */
export enum ChatPlatform {
  QQ = 'qq',
  WECHAT = 'wechat',
  TELEGRAM = 'telegram',
  DISCORD = 'discord',
  UNKNOWN = 'unknown',
}

/**
 * 聊天类型枚举
 */
export enum ChatType {
  GROUP = 'group', // 群聊
  PRIVATE = 'private', // 私聊
}

// ==================== 数据库模型 ====================

/**
 * 元信息（数据库中存储的格式）
 */
export interface DbMeta {
  name: string // 群名/对话名
  platform: ChatPlatform // 平台
  type: ChatType // 聊天类型
  imported_at: number // 导入时间戳（秒）
}

/**
 * 成员（数据库中存储的格式）
 */
export interface DbMember {
  id: number // 自增ID
  platform_id: string // 平台标识（QQ号等）
  name: string // 最新昵称
}

/**
 * 消息（数据库中存储的格式）
 */
export interface DbMessage {
  id: number // 自增ID
  sender_id: number // FK -> member.id
  ts: number // 时间戳（秒）
  type: MessageType // 消息类型
  content: string | null // 纯文本内容
}

// ==================== Parser 解析结果 ====================

/**
 * 解析后的成员信息
 */
export interface ParsedMember {
  platformId: string // 平台标识
  name: string // 昵称
}

/**
 * 解析后的消息
 */
export interface ParsedMessage {
  senderPlatformId: string // 发送者平台ID
  senderName: string // 发送者在该消息时的昵称
  timestamp: number // 时间戳（秒）
  type: MessageType // 消息类型
  content: string | null // 内容
}

/**
 * Parser 解析结果
 */
export interface ParseResult {
  meta: {
    name: string
    platform: ChatPlatform
    type: ChatType
  }
  members: ParsedMember[]
  messages: ParsedMessage[]
}

// ==================== 分析结果类型 ====================

/**
 * 成员活跃度统计
 */
export interface MemberActivity {
  memberId: number
  platformId: string
  name: string
  messageCount: number
  percentage: number // 占总消息的百分比
}

/**
 * 时段活跃度统计
 */
export interface HourlyActivity {
  hour: number // 0-23
  messageCount: number
}

/**
 * 日期活跃度统计
 */
export interface DailyActivity {
  date: string // YYYY-MM-DD
  messageCount: number
}

/**
 * 星期活跃度统计
 */
export interface WeekdayActivity {
  weekday: number // 1-7，1=周一，7=周日
  messageCount: number
}

// ==================== 夜猫分析类型 ====================

/**
 * 夜猫称号等级
 */
export type NightOwlTitle =
  | '养生达人'
  | '偶尔失眠'
  | '夜猫子'
  | '秃头预备役'
  | '修仙练习生'
  | '守夜冠军'
  | '不睡觉の神'

/**
 * 修仙排行榜项
 */
export interface NightOwlRankItem {
  memberId: number
  platformId: string
  name: string
  totalNightMessages: number // 深夜发言总数
  title: NightOwlTitle // 称号
  hourlyBreakdown: {
    // 各时段分布
    h23: number // 23:00-24:00
    h0: number // 00:00-01:00
    h1: number // 01:00-02:00
    h2: number // 02:00-03:00
    h3to4: number // 03:00-05:00
  }
  percentage: number // 占该用户总发言的百分比
}

/**
 * 最晚/最早发言排行项
 */
export interface TimeRankItem {
  memberId: number
  platformId: string
  name: string
  count: number // 成为最晚/最早发言者的次数
  avgTime: string // 平均时间，格式 "HH:MM"
  extremeTime: string // 最极端时间，格式 "HH:MM"
  percentage: number // 占总天数的百分比
}

/**
 * 连续修仙记录
 */
export interface ConsecutiveNightRecord {
  memberId: number
  platformId: string
  name: string
  maxConsecutiveDays: number // 最长连续修仙天数
  currentStreak: number // 当前连续天数（如果还在持续）
}

/**
 * 修仙王者项（综合排名）
 */
export interface NightOwlChampion {
  memberId: number
  platformId: string
  name: string
  score: number // 综合得分
  nightMessages: number // 深夜发言数
  lastSpeakerCount: number // 最晚下班次数
  consecutiveDays: number // 最长连续天数
}

/**
 * 龙王排名项（每天发言最多的人）
 */
export interface DragonKingRankItem {
  memberId: number
  platformId: string
  name: string
  count: number // 成为龙王的天数
  percentage: number // 占总天数的百分比
}

/**
 * 龙王分析结果
 */
export interface DragonKingAnalysis {
  rank: DragonKingRankItem[]
  totalDays: number // 统计的总天数
}

/**
 * 潜水排名项（最后发言时间）
 */
export interface DivingRankItem {
  memberId: number
  platformId: string
  name: string
  lastMessageTs: number // 最后发言时间戳（秒）
  daysSinceLastMessage: number // 距离最后发言的天数
}

/**
 * 潜水分析结果
 */
export interface DivingAnalysis {
  rank: DivingRankItem[]
}

/**
 * 夜猫分析完整结果
 */
export interface NightOwlAnalysis {
  /** 修仙排行榜 */
  nightOwlRank: NightOwlRankItem[]
  /** 最晚下班排名 */
  lastSpeakerRank: TimeRankItem[]
  /** 最早上班排名 */
  firstSpeakerRank: TimeRankItem[]
  /** 连续修仙记录 */
  consecutiveRecords: ConsecutiveNightRecord[]
  /** 修仙王者（综合排名） */
  champions: NightOwlChampion[]
  /** 统计的总天数 */
  totalDays: number
}

/**
 * 分析会话信息（用于会话列表展示）
 */
export interface AnalysisSession {
  id: string // 数据库文件名（不含扩展名）
  name: string // 群名/对话名
  platform: ChatPlatform
  type: ChatType
  importedAt: number // 导入时间戳
  messageCount: number // 消息总数
  memberCount: number // 成员数
  dbPath: string // 数据库文件完整路径
}

/**
 * 成员历史昵称记录
 */
export interface MemberNameHistory {
  name: string // 昵称
  startTs: number // 开始使用时间戳（秒）
  endTs: number | null // 停止使用时间戳（秒），null 表示当前昵称
}

// ==================== IPC 通信类型 ====================

/**
 * 导入进度回调
 */
export interface ImportProgress {
  stage: 'reading' | 'parsing' | 'saving' | 'done' | 'error'
  progress: number // 0-100
  message?: string
}

/**
 * 导入结果
 */
export interface ImportResult {
  success: boolean
  sessionId?: string // 成功时返回会话ID
  error?: string // 失败时返回错误信息
}

// ==================== 复读分析类型 ====================

/**
 * 复读统计项（单个成员）- 绝对次数
 */
export interface RepeatStatItem {
  memberId: number
  platformId: string
  name: string
  count: number // 统计次数
  percentage: number // 占总复读链的百分比
}

/**
 * 复读率统计项（单个成员）- 相对比例
 */
export interface RepeatRateItem {
  memberId: number
  platformId: string
  name: string
  count: number // 复读相关次数
  totalMessages: number // 该成员总发言数
  rate: number // 复读率（百分比）
}

/**
 * 复读链长度分布项
 */
export interface ChainLengthDistribution {
  length: number // 复读链长度（参与人数）
  count: number // 出现次数
}

/**
 * 热门复读内容项
 */
export interface HotRepeatContent {
  content: string // 复读内容
  count: number // 被复读次数
  maxChainLength: number // 最长复读链长度
  originatorName: string // 最长链的原创者名称
  lastTs: number // 最近一次发生的时间戳（秒）
}

/**
 * 成员口头禅项
 */
export interface MemberCatchphrase {
  memberId: number
  platformId: string
  name: string
  catchphrases: Array<{
    content: string
    count: number
  }>
}

/**
 * 口头禅分析结果
 */
export interface CatchphraseAnalysis {
  members: MemberCatchphrase[]
}

/**
 * 复读分析结果
 */
export interface RepeatAnalysis {
  /** 谁的聊天最容易产生复读（原创者）- 绝对次数 */
  originators: RepeatStatItem[]
  /** 谁最喜欢挑起复读（第二个复读的人）- 绝对次数 */
  initiators: RepeatStatItem[]
  /** 谁喜欢打断复读（终结者）- 绝对次数 */
  breakers: RepeatStatItem[]

  /** 被复读率排名（相对比例） */
  originatorRates: RepeatRateItem[]
  /** 挑起复读率排名（相对比例） */
  initiatorRates: RepeatRateItem[]
  /** 打断复读率排名（相对比例） */
  breakerRates: RepeatRateItem[]

  /** 复读链长度分布 */
  chainLengthDistribution: ChainLengthDistribution[]
  /** 最火复读内容 TOP 10 */
  hotContents: HotRepeatContent[]
  /** 平均复读链长度 */
  avgChainLength: number

  /** 复读链总数 */
  totalRepeatChains: number
}
