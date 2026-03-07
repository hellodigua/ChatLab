/**
 * Segmenter module (server-side)
 *
 * Ported from electron/main/nlp/segmenter.ts — no Electron dependencies.
 * Chinese segmentation uses @node-rs/jieba, other languages use Intl.Segmenter.
 */

import type { SupportedLocale, PosFilterMode, PosTagInfo } from './types'
import { isStopword } from './stopwords'

// Jieba instance type
interface JiebaInstance {
  cut: (text: string, hmm?: boolean) => string[]
  tag: (text: string) => Array<{ tag: string; word: string }>
}

// Lazy-initialized Jieba instance
let jiebaInstance: JiebaInstance | null = null

/**
 * Get Jieba instance (lazy loaded).
 */
function getJieba(): JiebaInstance {
  if (!jiebaInstance) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Jieba } = require('@node-rs/jieba')
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { dict } = require('@node-rs/jieba/dict')
      const instance: JiebaInstance = Jieba.withDict(dict)
      jiebaInstance = instance
      console.log('[NLP] jieba module loaded')
    } catch (error) {
      console.error('[NLP] Failed to load jieba module:', error)
      throw new Error('jieba module failed to load')
    }
  }
  return jiebaInstance!
}

/**
 * POS tag definitions
 */
export const POS_TAG_DEFINITIONS: PosTagInfo[] = [
  // Nouns
  { tag: 'n', name: '名词', description: '普通名词', meaningful: true },
  { tag: 'nr', name: '人名', description: '人名', meaningful: true },
  { tag: 'ns', name: '地名', description: '地名', meaningful: true },
  { tag: 'nt', name: '机构名', description: '机构团体名', meaningful: true },
  { tag: 'nz', name: '其他专名', description: '其他专有名词', meaningful: true },
  { tag: 'nw', name: '作品名', description: '作品名', meaningful: true },
  // Verbs
  { tag: 'v', name: '动词', description: '普通动词', meaningful: false },
  { tag: 'vn', name: '动名词', description: '动名词', meaningful: true },
  { tag: 'vd', name: '副动词', description: '副动词', meaningful: false },
  { tag: 'vg', name: '动语素', description: '动词性语素', meaningful: false },
  // Adjectives
  { tag: 'a', name: '形容词', description: '普通形容词', meaningful: true },
  { tag: 'an', name: '名形词', description: '名形词', meaningful: true },
  { tag: 'ad', name: '副形词', description: '副形词', meaningful: true },
  { tag: 'ag', name: '形语素', description: '形容词性语素', meaningful: true },
  // Other meaningful
  { tag: 'i', name: '成语', description: '成语', meaningful: true },
  { tag: 'l', name: '习用语', description: '习用语', meaningful: true },
  { tag: 'j', name: '简称', description: '简称略语', meaningful: true },
  // Not meaningful
  { tag: 'd', name: '副词', description: '副词', meaningful: false },
  { tag: 'p', name: '介词', description: '介词', meaningful: false },
  { tag: 'c', name: '连词', description: '连词', meaningful: false },
  { tag: 'u', name: '助词', description: '助词', meaningful: false },
  { tag: 'r', name: '代词', description: '代词', meaningful: false },
  { tag: 'm', name: '数词', description: '数词', meaningful: false },
  { tag: 'q', name: '量词', description: '量词', meaningful: false },
  { tag: 'f', name: '方位词', description: '方位词', meaningful: false },
  { tag: 't', name: '时间词', description: '时间词', meaningful: false },
  { tag: 'e', name: '叹词', description: '叹词', meaningful: false },
  { tag: 'y', name: '语气词', description: '语气词', meaningful: false },
  { tag: 'o', name: '拟声词', description: '拟声词', meaningful: false },
  { tag: 'x', name: '非语素字', description: '非语素字', meaningful: false },
  { tag: 'w', name: '标点符号', description: '标点符号', meaningful: false },
]

/** Set of meaningful POS tags */
export const MEANINGFUL_POS_TAGS = new Set(
  POS_TAG_DEFINITIONS.filter((t) => t.meaningful).map((t) => t.tag),
)

/**
 * Get all POS tag definitions.
 */
export function getPosTagDefinitions(): PosTagInfo[] {
  return POS_TAG_DEFINITIONS
}

// Regexes for text cleaning
const EMOJI_REGEX =
  /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu
const PUNCTUATION_REGEX =
  /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~，。！？、；：""''（）【】《》…—～·\s]/g
const URL_REGEX = /https?:\/\/[^\s]+/g
const MENTION_REGEX = /@[^\s@]+/g
const PURE_NUMBER_REGEX = /^\d+$/

/**
 * Clean text by removing emojis, URLs, mentions, punctuation, etc.
 */
function cleanText(text: string): string {
  return text
    .replace(URL_REGEX, ' ')
    .replace(MENTION_REGEX, ' ')
    .replace(EMOJI_REGEX, ' ')
    .replace(PUNCTUATION_REGEX, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Check whether a word is valid.
 */
function isValidWord(
  word: string,
  locale: SupportedLocale,
  minLength: number,
  enableStopwords: boolean = true,
): boolean {
  if (!word || word.trim().length === 0) return false
  if (PURE_NUMBER_REGEX.test(word)) return false
  if (word.length < minLength) return false
  if (enableStopwords && isStopword(word, locale)) return false
  return true
}

/** Chinese segment options */
interface ChineseSegmentOptions {
  posFilterMode?: PosFilterMode
  customPosTags?: string[]
}

/**
 * Collect POS tag stats from texts (Chinese only).
 * Returns a Map of tag -> count.
 */
export function collectPosTagStats(
  texts: string[],
  minWordLength: number = 2,
  enableStopwords: boolean = true,
): Map<string, number> {
  const posStats = new Map<string, number>()

  try {
    const jieba = getJieba()

    for (const text of texts) {
      const cleaned = cleanText(text)
      if (!cleaned) continue

      const tagged = jieba.tag(cleaned)

      for (const item of tagged) {
        if (!isValidWord(item.word, 'zh-CN', minWordLength, enableStopwords)) {
          continue
        }
        posStats.set(item.tag, (posStats.get(item.tag) || 0) + 1)
      }
    }
  } catch (error) {
    console.error('[NLP] Failed to collect POS stats:', error)
  }

  return posStats
}

/**
 * Chinese segmentation using jieba POS tagging.
 */
function segmentChinese(
  text: string,
  options: ChineseSegmentOptions = {},
): string[] {
  const { posFilterMode = 'meaningful', customPosTags } = options
  const cleaned = cleanText(text)
  if (!cleaned) return []

  try {
    const jieba = getJieba()

    if (posFilterMode === 'all') {
      return jieba.cut(cleaned, false)
    }

    const tagged = jieba.tag(cleaned)

    let allowedTags: Set<string>
    if (posFilterMode === 'custom' && customPosTags) {
      allowedTags = new Set(customPosTags)
    } else {
      allowedTags = MEANINGFUL_POS_TAGS
    }

    return tagged
      .filter((item) => allowedTags.has(item.tag))
      .map((item) => item.word)
  } catch (error) {
    console.error('[NLP] Chinese segmentation failed:', error)
    try {
      const jieba = getJieba()
      return jieba.cut(cleaned, false)
    } catch {
      return cleaned.split('')
    }
  }
}

/**
 * English segmentation using Intl.Segmenter.
 */
function segmentEnglish(text: string): string[] {
  const cleaned = cleanText(text)
  if (!cleaned) return []

  try {
    const segmenter = new Intl.Segmenter('en', { granularity: 'word' })
    const segments = segmenter.segment(cleaned)

    return [...segments]
      .filter((segment) => segment.isWordLike)
      .map((segment) => segment.segment.toLowerCase())
  } catch {
    return cleaned
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length > 0)
  }
}

/** Segment options */
export interface SegmentOptions {
  minLength?: number
  posFilterMode?: PosFilterMode
  customPosTags?: string[]
  enableStopwords?: boolean
}

/**
 * General segmentation entry point.
 */
export function segment(
  text: string,
  locale: SupportedLocale,
  options: SegmentOptions = {},
): string[] {
  const {
    minLength,
    posFilterMode = 'meaningful',
    customPosTags,
    enableStopwords = true,
  } = options
  const defaultMinLength = locale === 'zh-CN' ? 2 : 3
  const effectiveMinLength = minLength ?? defaultMinLength

  let words: string[]

  if (locale === 'zh-CN') {
    words = segmentChinese(text, { posFilterMode, customPosTags })
  } else {
    words = segmentEnglish(text)
  }

  return words.filter((word) =>
    isValidWord(word, locale, effectiveMinLength, enableStopwords),
  )
}

/** Batch segment options */
export interface BatchSegmentOptions extends SegmentOptions {
  minCount?: number
  topN?: number
}

/**
 * Batch segment texts and compute word frequencies.
 */
export function batchSegmentWithFrequency(
  texts: string[],
  locale: SupportedLocale,
  options: BatchSegmentOptions = {},
): Map<string, number> {
  const {
    minLength,
    minCount = 2,
    topN = 100,
    posFilterMode,
    customPosTags,
    enableStopwords,
  } = options
  const wordFrequency = new Map<string, number>()

  for (const text of texts) {
    const words = segment(text, locale, {
      minLength,
      posFilterMode,
      customPosTags,
      enableStopwords,
    })
    for (const word of words) {
      wordFrequency.set(word, (wordFrequency.get(word) || 0) + 1)
    }
  }

  // Filter low-frequency words
  const filtered = new Map<string, number>()
  for (const [word, count] of wordFrequency) {
    if (count >= minCount) {
      filtered.set(word, count)
    }
  }

  // Sort and take topN
  const sorted = [...filtered.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)

  return new Map(sorted)
}
