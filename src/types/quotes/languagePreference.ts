/**
 * 语言偏好分析类型定义（私聊专用）
 */

/** 词性分布（大类合计） */
export interface PosDistribution {
  noun: number
  verb: number
  adjective: number
  adverb: number
  modalParticle: number
  interjection: number
  other: number
}

/** 标点统计 */
export interface PunctuationStats {
  ellipsis: number
  exclamation: number
  question: number
  tilde: number
  period: number
  noPunct: number
  total: number
}

/** 单个成员的语言画像 */
export interface MemberLanguageProfile {
  memberId: number
  name: string
  totalMessages: number
  totalWords: number
  uniqueWords: number
  /** 词汇丰富度 = uniqueWords / totalWords * 100 */
  lexicalDiversity: number
  /** Top 词汇（meaningful POS，去停用词） */
  topWords: Array<{ word: string; count: number }>
  posDistribution: PosDistribution
  /** 语气词 Top N（POS tag y + e） */
  modalParticles: Array<{ word: string; count: number }>
  punctuation: PunctuationStats
  /** 口头禅（整句匹配，复用现有逻辑） */
  catchphrases: Array<{ content: string; count: number }>
}

/** 共同高频词 */
export interface SharedWord {
  word: string
  countA: number
  countB: number
}

/** 语言偏好分析完整结果 */
export interface LanguagePreferenceResult {
  members: MemberLanguageProfile[]
  sharedWords: SharedWord[]
  /** 0-100，基于功能词 POS 分布的余弦相似度 */
  similarityScore: number
}
