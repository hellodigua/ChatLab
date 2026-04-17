/**
 * 语言偏好分析模块（私聊专用）
 *
 * 一次性对两个成员的全部文字消息做 NLP 分析：
 * - 词频 + 词性分布
 * - 语气词画像
 * - 标点性格
 * - 口头禅（整句匹配）
 * - 跨成员：共同高频词、语言同频度
 */

import { openDatabase, buildTimeFilter, type TimeFilter } from '../../core'
import { getJieba, isStopword, MEANINGFUL_POS_TAGS } from '../../../nlp'
import type { SupportedLocale, DictType } from '../../../nlp'

// ---------- 标点 regex ----------

const RE_ELLIPSIS = /\.{2,}|…+|。{2,}/g
const RE_EXCLAMATION = /[!！]+/g
const RE_QUESTION = /[?？]+/g
const RE_TILDE = /[~～]+/g
const RE_PERIOD = /[.。](?![.。])/g
const RE_ENDS_WITH_PUNCT = /[.。!！?？~～…,，;；:：、)\]）】》"'」』\-—]$/

// ---------- POS 归类 ----------

const NOUN_TAGS = new Set(['n', 'nr', 'ns', 'nt', 'nz', 'nw'])
const VERB_TAGS = new Set(['v', 'vn', 'vd', 'vg'])
const ADJ_TAGS = new Set(['a', 'an', 'ad', 'ag'])
const ADV_TAGS = new Set(['d'])
const MODAL_TAGS = new Set(['y', 'e'])

// ---------- URL / Emoji / mention 清理 ----------

const RE_URL = /https?:\/\/[^\s]+/g
const RE_MENTION = /@[^\s@]+/g
const RE_EMOJI =
  /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu
const RE_PUNCTUATION = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~，。！？、；：""''（）【】《》…—～·\s]/g
const RE_PURE_NUMBER = /^\d+$/

function cleanTextForNlp(text: string): string {
  return text
    .replace(RE_URL, ' ')
    .replace(RE_MENTION, ' ')
    .replace(RE_EMOJI, ' ')
    .replace(RE_PUNCTUATION, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ---------- 工具函数 ----------

function countMatches(text: string, regex: RegExp): number {
  regex.lastIndex = 0
  const m = text.match(regex)
  return m ? m.length : 0
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let magA = 0
  let magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB)
  return denom === 0 ? 0 : dot / denom
}

// ---------- 主入口 ----------

interface LanguagePreferenceParams {
  sessionId: string
  locale: string
  timeFilter?: TimeFilter
  dictType?: string
}

export function getLanguagePreferenceAnalysis(params: LanguagePreferenceParams): any {
  const { sessionId, locale, timeFilter, dictType = 'default' } = params
  const db = openDatabase(sessionId)
  if (!db) return { members: [], sharedWords: [], similarityScore: 0 }

  const { clause, params: filterParams } = buildTimeFilter(timeFilter)

  let whereClause = clause
  const textFilter =
    " COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL AND LENGTH(TRIM(msg.content)) >= 2"
  if (whereClause.includes('WHERE')) {
    whereClause += ' AND ' + textFilter
  } else {
    whereClause = ' WHERE ' + textFilter
  }

  // 一次查询取全部文字消息，按 member 分组处理
  const rows = db
    .prepare(
      `
      SELECT
        m.id as memberId,
        COALESCE(m.group_nickname, m.account_name, m.platform_id) as name,
        msg.content as content
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
      ${whereClause}
      ORDER BY m.id
      `
    )
    .all(...filterParams) as Array<{ memberId: number; name: string; content: string }>

  if (rows.length === 0) {
    return { members: [], sharedWords: [], similarityScore: 0 }
  }

  // 按成员分组
  const memberMessages = new Map<number, { name: string; messages: string[] }>()
  for (const row of rows) {
    let entry = memberMessages.get(row.memberId)
    if (!entry) {
      entry = { name: row.name, messages: [] }
      memberMessages.set(row.memberId, entry)
    }
    entry.messages.push(row.content)
  }

  const isChinese = locale.startsWith('zh')
  const effectiveLocale = (locale || 'zh-CN') as SupportedLocale
  const minWordLength = isChinese ? 2 : 3

  const memberProfiles: any[] = []

  for (const [memberId, { name, messages }] of memberMessages) {
    // 词频 + POS
    const wordFreq = new Map<string, number>()
    const posCount = { noun: 0, verb: 0, adjective: 0, adverb: 0, modalParticle: 0, interjection: 0, other: 0 }
    const modalFreq = new Map<string, number>()
    let totalWordCount = 0

    // 标点
    const punct = { ellipsis: 0, exclamation: 0, question: 0, tilde: 0, period: 0, noPunct: 0, total: 0 }

    // 口头禅（整句频率）
    const phraseFreq = new Map<string, number>()

    for (const content of messages) {
      // 标点分析（原始文本）
      punct.ellipsis += countMatches(content, RE_ELLIPSIS)
      punct.exclamation += countMatches(content, RE_EXCLAMATION)
      punct.question += countMatches(content, RE_QUESTION)
      punct.tilde += countMatches(content, RE_TILDE)
      punct.period += countMatches(content, RE_PERIOD)
      const trimmed = content.trim()
      if (trimmed.length > 0 && !RE_ENDS_WITH_PUNCT.test(trimmed)) {
        punct.noPunct++
      }
      punct.total++

      // 口头禅
      const normalised = trimmed
      if (normalised.length >= 2) {
        phraseFreq.set(normalised, (phraseFreq.get(normalised) || 0) + 1)
      }

      // NLP
      const cleaned = cleanTextForNlp(content)
      if (!cleaned) continue

      if (isChinese) {
        try {
          const jieba = getJieba(dictType as DictType)
          const tagged = jieba.tag(cleaned)
          for (const { word, tag } of tagged) {
            if (!word || word.trim().length === 0) continue
            if (RE_PURE_NUMBER.test(word)) continue
            if (word.length < minWordLength && !MODAL_TAGS.has(tag)) continue

            // POS 归类
            if (NOUN_TAGS.has(tag)) posCount.noun++
            else if (VERB_TAGS.has(tag)) posCount.verb++
            else if (ADJ_TAGS.has(tag)) posCount.adjective++
            else if (ADV_TAGS.has(tag)) posCount.adverb++
            else if (tag === 'y') posCount.modalParticle++
            else if (tag === 'e') posCount.interjection++
            else posCount.other++

            // 语气词 / 叹词
            if (MODAL_TAGS.has(tag)) {
              modalFreq.set(word, (modalFreq.get(word) || 0) + 1)
            }

            // 有意义的词 → 词频
            if (MEANINGFUL_POS_TAGS.has(tag) || MODAL_TAGS.has(tag)) {
              if (!isStopword(word, effectiveLocale)) {
                wordFreq.set(word, (wordFreq.get(word) || 0) + 1)
                totalWordCount++
              }
            }
          }
        } catch {
          // jieba 失败时跳过
        }
      } else {
        // 非中文：简单 Intl.Segmenter 分词
        try {
          const segmenter = new Intl.Segmenter(locale, { granularity: 'word' })
          for (const seg of segmenter.segment(cleaned)) {
            if (!seg.isWordLike) continue
            const w = seg.segment.toLowerCase()
            if (w.length < minWordLength) continue
            if (RE_PURE_NUMBER.test(w)) continue
            if (isStopword(w, effectiveLocale)) continue
            wordFreq.set(w, (wordFreq.get(w) || 0) + 1)
            totalWordCount++
            posCount.other++
          }
        } catch {
          // fallback
        }
      }
    }

    // 过滤低频词 & 排序
    const filteredWords = [...wordFreq.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1])
    const uniqueWords = filteredWords.length
    const topWords = filteredWords.slice(0, 100).map(([word, count]) => ({ word, count }))

    const lexicalDiversity = totalWordCount > 0 ? Math.round((uniqueWords / totalWordCount) * 10000) / 100 : 0

    // 语气词 Top 20
    const modalParticles = [...modalFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([word, count]) => ({ word, count }))

    // 口头禅 Top 50（count >= 2）
    const catchphrases = [...phraseFreq.entries()]
      .filter(([, c]) => c >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([content, count]) => ({ content, count }))

    memberProfiles.push({
      memberId,
      name,
      totalMessages: messages.length,
      totalWords: totalWordCount,
      uniqueWords,
      lexicalDiversity,
      topWords,
      posDistribution: posCount,
      modalParticles,
      punctuation: punct,
      catchphrases,
    })
  }

  // 按消息总数降序
  memberProfiles.sort((a, b) => b.totalMessages - a.totalMessages)

  // 跨成员：共同高频词 & 语言同频度
  let sharedWords: any[] = []
  let similarityScore = 0

  if (memberProfiles.length >= 2) {
    const a = memberProfiles[0]
    const b = memberProfiles[1]

    // 共同高频词
    const wordsA = new Map(a.topWords.map((w: any) => [w.word, w.count]))
    const wordsB = new Map(b.topWords.map((w: any) => [w.word, w.count]))
    const shared: Array<{ word: string; countA: number; countB: number }> = []
    for (const [word, countA] of wordsA) {
      const countB = wordsB.get(word)
      if (countB) {
        shared.push({ word, countA, countB })
      }
    }
    shared.sort((x, y) => x.countA + x.countB - (y.countA + y.countB))
    shared.reverse()
    sharedWords = shared.slice(0, 30)

    // 余弦相似度：基于 POS 分布向量
    const posKeys = ['noun', 'verb', 'adjective', 'adverb', 'modalParticle', 'interjection', 'other'] as const
    const vecA = posKeys.map((k) => a.posDistribution[k] as number)
    const vecB = posKeys.map((k) => b.posDistribution[k] as number)
    similarityScore = Math.round(cosineSimilarity(vecA, vecB) * 100)
  }

  return { members: memberProfiles, sharedWords, similarityScore }
}
