/**
 * NLP API routes (US-009)
 *
 * Replaces the Electron IPC handlers for NLP features:
 *   POST /api/sessions/:id/nlp/word-frequency  - word frequency statistics
 *   POST /api/nlp/segment                      - text segmentation
 *   GET  /api/nlp/pos-tags                      - POS tag definitions
 */

import { Router } from 'express'
import { getWordFrequency, segmentText, getPosTags } from '../services/nlp'
import type { SupportedLocale } from '../nlp'

/**
 * Session-scoped NLP routes (mounted under /api/sessions)
 */
export const sessionNlpRouter = Router({ mergeParams: true })

/**
 * POST /api/sessions/:id/nlp/word-frequency - word frequency statistics
 *
 * Body: WordFrequencyParams (minus sessionId, which comes from URL)
 * Returns: WordFrequencyResult
 */
sessionNlpRouter.post('/:id/nlp/word-frequency', (req, res) => {
  try {
    const sessionId = req.params.id
    const {
      locale,
      timeFilter,
      memberId,
      topN,
      minWordLength,
      minCount,
      posFilterMode,
      customPosTags,
      enableStopwords,
    } = req.body

    if (!locale) {
      res.status(400).json({ error: 'locale is required' })
      return
    }

    const result = getWordFrequency({
      sessionId,
      locale,
      timeFilter,
      memberId,
      topN,
      minWordLength,
      minCount,
      posFilterMode,
      customPosTags,
      enableStopwords,
    })

    res.json(result)
  } catch (error) {
    console.error('[API] Failed to get word frequency:', error)
    res.status(500).json({ error: 'Failed to get word frequency' })
  }
})

/**
 * Global NLP routes (mounted under /api/nlp)
 */
export const globalNlpRouter = Router()

/**
 * POST /api/nlp/segment - text segmentation
 *
 * Body: { text: string, locale: SupportedLocale, minLength?: number }
 * Returns: string[]
 */
globalNlpRouter.post('/segment', (req, res) => {
  try {
    const { text, locale, minLength } = req.body

    if (typeof text !== 'string') {
      res.status(400).json({ error: 'text must be a string' })
      return
    }
    if (!locale) {
      res.status(400).json({ error: 'locale is required' })
      return
    }

    const words = segmentText(text, locale as SupportedLocale, minLength)
    res.json(words)
  } catch (error) {
    console.error('[API] Failed to segment text:', error)
    res.status(500).json({ error: 'Failed to segment text' })
  }
})

/**
 * GET /api/nlp/pos-tags - POS tag definitions
 *
 * Returns: PosTagInfo[]
 */
globalNlpRouter.get('/pos-tags', (_req, res) => {
  try {
    const tags = getPosTags()
    res.json(tags)
  } catch (error) {
    console.error('[API] Failed to get POS tags:', error)
    res.status(500).json({ error: 'Failed to get POS tags' })
  }
})
