/**
 * NLP query service (server-side)
 *
 * Ported from electron/main/worker/query/nlp.ts — no Electron dependencies.
 * Provides word frequency stats, text segmentation, and POS tag definitions.
 */

import { openDatabase, buildTimeFilter, type TimeFilter } from './db-pool'
import {
  segment,
  batchSegmentWithFrequency,
  getPosTagDefinitions,
  collectPosTagStats,
} from '../nlp'
import type {
  SupportedLocale,
  WordFrequencyResult,
  WordFrequencyParams,
  PosTagInfo,
  PosTagStat,
} from '../nlp'

/**
 * Get word frequency statistics for a session.
 * Used by word-cloud display.
 */
export function getWordFrequency(
  params: WordFrequencyParams,
): WordFrequencyResult {
  const {
    sessionId,
    locale,
    timeFilter,
    memberId,
    topN = 100,
    minWordLength,
    minCount = 2,
    posFilterMode = 'meaningful',
    customPosTags,
    enableStopwords = true,
  } = params

  const db = openDatabase(sessionId)
  if (!db) {
    return {
      words: [],
      totalWords: 0,
      totalMessages: 0,
      uniqueWords: 0,
    }
  }

  // Build time and member filters
  const filter: TimeFilter = {
    ...timeFilter,
    memberId,
  }
  const { clause, params: filterParams } = buildTimeFilter(filter, 'msg')

  // Append system-message and content-validity filters
  let whereClause = clause
  if (whereClause.includes('WHERE')) {
    whereClause +=
      " AND COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL AND TRIM(msg.content) != ''"
  } else {
    whereClause =
      " WHERE COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL AND TRIM(msg.content) != ''"
  }

  // Query message contents
  const messages = db
    .prepare(
      `
      SELECT msg.content
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
      ${whereClause}
      `,
    )
    .all(...filterParams) as Array<{ content: string }>

  if (messages.length === 0) {
    return {
      words: [],
      totalWords: 0,
      totalMessages: 0,
      uniqueWords: 0,
    }
  }

  const texts = messages.map((m) => m.content)

  // POS tag stats (Chinese only)
  let posTagStats: PosTagStat[] | undefined
  if ((locale as SupportedLocale) === 'zh-CN') {
    const posStatsMap = collectPosTagStats(
      texts,
      minWordLength ?? 2,
      enableStopwords,
    )
    posTagStats = [...posStatsMap.entries()].map(([tag, count]) => ({
      tag,
      count,
    }))
  }

  // Batch segment and compute word frequency
  const wordFrequency = batchSegmentWithFrequency(
    texts,
    locale as SupportedLocale,
    {
      minLength: minWordLength,
      minCount,
      topN,
      posFilterMode,
      customPosTags,
      enableStopwords,
    },
  )

  // Total word count (for percentage calculation)
  let totalWords = 0
  for (const count of wordFrequency.values()) {
    totalWords += count
  }

  const words = [...wordFrequency.entries()].map(([word, count]) => ({
    word,
    count,
    percentage:
      totalWords > 0 ? Math.round((count / totalWords) * 10000) / 100 : 0,
  }))

  return {
    words,
    totalWords,
    totalMessages: messages.length,
    uniqueWords: wordFrequency.size,
    posTagStats,
  }
}

/**
 * Segment a single text (for debugging or other uses).
 */
export function segmentText(
  text: string,
  locale: SupportedLocale,
  minLength?: number,
): string[] {
  return segment(text, locale, { minLength })
}

/**
 * Get POS tag definitions.
 */
export function getPosTags(): PosTagInfo[] {
  return getPosTagDefinitions()
}
