/**
 * NLP module type definitions (server-side)
 *
 * Ported from electron/main/nlp/types.ts — no Electron dependencies.
 */

/** Supported languages */
export type SupportedLocale = 'zh-CN' | 'en-US'

/** Segmentation result */
export interface SegmentResult {
  /** Word list after segmentation */
  words: string[]
  /** Original text */
  original: string
}

/** Word frequency item */
export interface WordFrequencyItem {
  /** Word */
  word: string
  /** Occurrence count */
  count: number
  /** Percentage */
  percentage: number
}

/** POS tag statistics item */
export interface PosTagStat {
  /** POS tag */
  tag: string
  /** Number of words with this POS tag */
  count: number
}

/** Word frequency result */
export interface WordFrequencyResult {
  /** Word frequency list (sorted by count descending) */
  words: WordFrequencyItem[]
  /** Total word count */
  totalWords: number
  /** Total message count */
  totalMessages: number
  /** Unique word count */
  uniqueWords: number
  /** POS tag statistics */
  posTagStats?: PosTagStat[]
}

/** POS filter mode */
export type PosFilterMode = 'all' | 'meaningful' | 'custom'

/** Word frequency parameters */
export interface WordFrequencyParams {
  /** Session ID */
  sessionId: string
  /** User locale */
  locale: SupportedLocale
  /** Time filter */
  timeFilter?: {
    startTs?: number
    endTs?: number
  }
  /** Member ID (filter by specific member) */
  memberId?: number
  /** Return top N high-frequency words, default 100 */
  topN?: number
  /** Minimum word length, default: zh 2, en 3 */
  minWordLength?: number
  /** Minimum occurrence count, default 2 */
  minCount?: number
  /** POS filter mode: all=all, meaningful=meaningful only, custom=custom */
  posFilterMode?: PosFilterMode
  /** Custom POS tag filter list (when posFilterMode='custom') */
  customPosTags?: string[]
  /** Whether to enable stopword filtering, default true */
  enableStopwords?: boolean
}

/** POS tag info */
export interface PosTagInfo {
  /** POS tag */
  tag: string
  /** POS name (Chinese) */
  name: string
  /** POS description */
  description: string
  /** Whether this POS is meaningful */
  meaningful: boolean
}

/** Segmenter configuration */
export interface SegmenterConfig {
  /** Language */
  locale: SupportedLocale
  /** Custom dictionary path (reserved for future extension) */
  customDictPath?: string
}
