/**
 * Advanced analysis queries (server-side)
 * Ported from electron/main/worker/query/advanced/ — no worker_threads.
 *
 * Includes: catchphrase analysis, mention analysis, mention graph,
 * laugh analysis, cluster graph.
 */

import { openDatabase, buildTimeFilter, type TimeFilter } from '../db-pool'
import type {
  ClusterGraphData,
  ClusterGraphNode,
  ClusterGraphLink,
  ClusterGraphOptions,
  MentionGraphData,
  MentionGraphNode,
  MentionGraphLink,
} from './types'

// ============================================================================
// Catchphrase analysis (from advanced/repeat.ts)
// ============================================================================

export function getCatchphraseAnalysis(sessionId: string, filter?: TimeFilter): any {
  const db = openDatabase(sessionId)
  if (!db) return { members: [] }
  const { clause, params } = buildTimeFilter(filter)
  let whereClause = clause
  if (whereClause.includes('WHERE')) {
    whereClause += " AND COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL AND LENGTH(TRIM(msg.content)) >= 2"
  } else {
    whereClause = " WHERE COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL AND LENGTH(TRIM(msg.content)) >= 2"
  }
  const rows = db.prepare(
    `SELECT m.id as memberId, m.platform_id as platformId,
            COALESCE(m.group_nickname, m.account_name, m.platform_id) as name,
            TRIM(msg.content) as content, COUNT(*) as count
     FROM message msg JOIN member m ON msg.sender_id = m.id
     ${whereClause} GROUP BY m.id, TRIM(msg.content) ORDER BY m.id, count DESC`,
  ).all(...params) as Array<{ memberId: number; platformId: string; name: string; content: string; count: number }>

  const memberMap = new Map<number, { memberId: number; platformId: string; name: string; catchphrases: Array<{ content: string; count: number }> }>()
  for (const row of rows) {
    if (!memberMap.has(row.memberId)) {
      memberMap.set(row.memberId, { memberId: row.memberId, platformId: row.platformId, name: row.name, catchphrases: [] })
    }
    const member = memberMap.get(row.memberId)!
    if (member.catchphrases.length < 10) {
      member.catchphrases.push({ content: row.content, count: row.count })
    }
  }
  const members = Array.from(memberMap.values())
  members.sort((a, b) => {
    const aTotal = a.catchphrases.reduce((sum, c) => sum + c.count, 0)
    const bTotal = b.catchphrases.reduce((sum, c) => sum + c.count, 0)
    return bTotal - aTotal
  })
  return { members }
}

// ============================================================================
// Mention (@ interaction) analysis (from advanced/social.ts)
// ============================================================================

export function getMentionAnalysis(sessionId: string, filter?: TimeFilter): any {
  const db = openDatabase(sessionId)
  const emptyResult = { topMentioners: [], topMentioned: [], oneWay: [], twoWay: [], totalMentions: 0, memberDetails: [] }
  if (!db) return emptyResult

  const members = db.prepare(
    `SELECT id, platform_id as platformId, COALESCE(group_nickname, account_name, platform_id) as name
     FROM member WHERE COALESCE(account_name, '') != '系统消息'`,
  ).all() as Array<{ id: number; platformId: string; name: string }>
  if (members.length === 0) return emptyResult

  const nameToMemberId = new Map<string, number>()
  const memberIdToInfo = new Map<number, { platformId: string; name: string }>()
  for (const member of members) {
    memberIdToInfo.set(member.id, { platformId: member.platformId, name: member.name })
    nameToMemberId.set(member.name, member.id)
    const history = db.prepare('SELECT name FROM member_name_history WHERE member_id = ?').all(member.id) as Array<{ name: string }>
    for (const h of history) { if (!nameToMemberId.has(h.name)) nameToMemberId.set(h.name, member.id) }
  }

  const { clause, params } = buildTimeFilter(filter)
  let whereClause = clause
  if (whereClause.includes('WHERE')) {
    whereClause += " AND COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL AND msg.content LIKE '%@%'"
  } else {
    whereClause = " WHERE COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL AND msg.content LIKE '%@%'"
  }

  const messages = db.prepare(
    `SELECT msg.sender_id as senderId, msg.content FROM message msg
     JOIN member m ON msg.sender_id = m.id ${whereClause}`,
  ).all(...params) as Array<{ senderId: number; content: string }>

  const mentionMatrix = new Map<number, Map<number, number>>()
  const mentionedCount = new Map<number, number>()
  const mentionerCount = new Map<number, number>()
  let totalMentions = 0
  const mentionRegex = /@([^\s@]+)/g

  for (const msg of messages) {
    const matches = msg.content.matchAll(mentionRegex)
    const mentionedInThisMsg = new Set<number>()
    for (const match of matches) {
      const mentionedId = nameToMemberId.get(match[1])
      if (mentionedId && mentionedId !== msg.senderId && !mentionedInThisMsg.has(mentionedId)) {
        mentionedInThisMsg.add(mentionedId)
        totalMentions++
        if (!mentionMatrix.has(msg.senderId)) mentionMatrix.set(msg.senderId, new Map())
        const fromMap = mentionMatrix.get(msg.senderId)!
        fromMap.set(mentionedId, (fromMap.get(mentionedId) || 0) + 1)
        mentionerCount.set(msg.senderId, (mentionerCount.get(msg.senderId) || 0) + 1)
        mentionedCount.set(mentionedId, (mentionedCount.get(mentionedId) || 0) + 1)
      }
    }
  }
  if (totalMentions === 0) return emptyResult

  const buildRank = (countMap: Map<number, number>) => {
    const items: any[] = []
    for (const [memberId, count] of countMap.entries()) {
      const info = memberIdToInfo.get(memberId)!
      items.push({ memberId, platformId: info.platformId, name: info.name, count, percentage: Math.round((count / totalMentions) * 10000) / 100 })
    }
    return items.sort((a, b) => b.count - a.count)
  }

  const topMentioners = buildRank(mentionerCount)
  const topMentioned = buildRank(mentionedCount)

  // One-way and two-way detection (simplified)
  const oneWay: any[] = []
  const twoWay: any[] = []
  const processedPairs = new Set<string>()

  for (const [fromId, toMap] of mentionMatrix.entries()) {
    for (const [toId, fromToCount] of toMap.entries()) {
      const pairKey = `${Math.min(fromId, toId)}-${Math.max(fromId, toId)}`
      if (processedPairs.has(pairKey)) continue
      processedPairs.add(pairKey)
      const toFromCount = mentionMatrix.get(toId)?.get(fromId) || 0
      const total = fromToCount + toFromCount
      if (total < 3) continue
      const ratio = fromToCount / total
      if (ratio >= 0.8) {
        oneWay.push({ fromMemberId: fromId, fromName: memberIdToInfo.get(fromId)!.name, toMemberId: toId, toName: memberIdToInfo.get(toId)!.name, fromToCount, toFromCount, ratio: Math.round(ratio * 100) / 100 })
      } else if (ratio <= 0.2) {
        oneWay.push({ fromMemberId: toId, fromName: memberIdToInfo.get(toId)!.name, toMemberId: fromId, toName: memberIdToInfo.get(fromId)!.name, fromToCount: toFromCount, toFromCount: fromToCount, ratio: Math.round((1 - ratio) * 100) / 100 })
      }
      if (total >= 5 && toFromCount > 0 && fromToCount > 0) {
        const balance = Math.min(fromToCount, toFromCount) / Math.max(fromToCount, toFromCount)
        if (balance >= 0.3) {
          twoWay.push({ member1Id: fromId, member1Name: memberIdToInfo.get(fromId)!.name, member2Id: toId, member2Name: memberIdToInfo.get(toId)!.name, member1To2: fromToCount, member2To1: toFromCount, total, balance: Math.round(balance * 100) / 100 })
        }
      }
    }
  }
  oneWay.sort((a, b) => b.fromToCount - a.fromToCount)
  twoWay.sort((a, b) => b.total - a.total)

  // Member details
  const memberDetails: any[] = []
  for (const member of members) {
    const topMentionedByThis: any[] = []
    const toMap = mentionMatrix.get(member.id)
    if (toMap) {
      for (const [toId, count] of toMap.entries()) {
        topMentionedByThis.push({ fromMemberId: member.id, fromName: memberIdToInfo.get(member.id)!.name, toMemberId: toId, toName: memberIdToInfo.get(toId)!.name, count })
      }
      topMentionedByThis.sort((a, b) => b.count - a.count)
    }
    const topMentionersOfThis: any[] = []
    for (const [fromId, toMap2] of mentionMatrix.entries()) {
      const count = toMap2.get(member.id)
      if (count) {
        topMentionersOfThis.push({ fromMemberId: fromId, fromName: memberIdToInfo.get(fromId)!.name, toMemberId: member.id, toName: memberIdToInfo.get(member.id)!.name, count })
      }
    }
    topMentionersOfThis.sort((a, b) => b.count - a.count)
    if (topMentionedByThis.length > 0 || topMentionersOfThis.length > 0) {
      memberDetails.push({ memberId: member.id, name: memberIdToInfo.get(member.id)!.name, topMentioned: topMentionedByThis.slice(0, 5), topMentioners: topMentionersOfThis.slice(0, 5) })
    }
  }

  return { topMentioners, topMentioned, oneWay, twoWay, totalMentions, memberDetails }
}

// ============================================================================
// Mention graph (from advanced/social.ts)
// ============================================================================

export function getMentionGraph(sessionId: string, filter?: TimeFilter): MentionGraphData {
  const db = openDatabase(sessionId)
  const emptyResult: MentionGraphData = { nodes: [], links: [], maxLinkValue: 0 }
  if (!db) return emptyResult

  const { clause, params } = buildTimeFilter(filter)
  const msgFilterBase = clause ? clause.replace('WHERE', 'AND') : ''
  const msgFilterWithSystem = msgFilterBase + " AND COALESCE(m.account_name, '') != '系统消息'"

  const members = db.prepare(
    `SELECT m.id, m.platform_id as platformId,
            COALESCE(m.group_nickname, m.account_name, m.platform_id) as name,
            COUNT(msg.id) as messageCount
     FROM member m LEFT JOIN message msg ON m.id = msg.sender_id ${msgFilterWithSystem}
     WHERE COALESCE(m.account_name, '') != '系统消息' GROUP BY m.id`,
  ).all(...params) as Array<{ id: number; platformId: string; name: string; messageCount: number }>
  if (members.length === 0) return emptyResult

  const nameToMemberId = new Map<string, number>()
  const memberIdToInfo = new Map<number, { name: string; messageCount: number }>()
  for (const m of members) {
    memberIdToInfo.set(m.id, { name: m.name, messageCount: m.messageCount })
    nameToMemberId.set(m.name, m.id)
    const history = db.prepare('SELECT name FROM member_name_history WHERE member_id = ?').all(m.id) as Array<{ name: string }>
    for (const h of history) { if (!nameToMemberId.has(h.name)) nameToMemberId.set(h.name, m.id) }
  }

  let whereClause = clause
  if (whereClause.includes('WHERE')) {
    whereClause += " AND COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL AND msg.content LIKE '%@%'"
  } else {
    whereClause = " WHERE COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL AND msg.content LIKE '%@%'"
  }

  const messages = db.prepare(
    `SELECT msg.sender_id as senderId, msg.content FROM message msg JOIN member m ON msg.sender_id = m.id ${whereClause}`,
  ).all(...params) as Array<{ senderId: number; content: string }>

  const mentionMatrix = new Map<number, Map<number, number>>()
  const mentionRegex = /@([^\s@]+)/g
  for (const msg of messages) {
    const matches = msg.content.matchAll(mentionRegex)
    const seen = new Set<number>()
    for (const match of matches) {
      const mentionedId = nameToMemberId.get(match[1])
      if (mentionedId && mentionedId !== msg.senderId && !seen.has(mentionedId)) {
        seen.add(mentionedId)
        if (!mentionMatrix.has(msg.senderId)) mentionMatrix.set(msg.senderId, new Map())
        const fromMap = mentionMatrix.get(msg.senderId)!
        fromMap.set(mentionedId, (fromMap.get(mentionedId) || 0) + 1)
      }
    }
  }

  const involvedIds = new Set<number>()
  for (const [fromId, toMap] of mentionMatrix.entries()) {
    involvedIds.add(fromId)
    for (const toId of toMap.keys()) involvedIds.add(toId)
  }
  const maxMsgCount = Math.max(...members.filter((m) => involvedIds.has(m.id)).map((m) => m.messageCount), 1)

  const nodes: MentionGraphNode[] = []
  for (const memberId of involvedIds) {
    const info = memberIdToInfo.get(memberId)
    if (info) {
      const symbolSize = 20 + (info.messageCount / maxMsgCount) * 40
      nodes.push({ id: memberId, name: info.name, value: info.messageCount, symbolSize: Math.round(symbolSize) })
    }
  }

  const links: MentionGraphLink[] = []
  let maxLinkValue = 0
  for (const [fromId, toMap] of mentionMatrix.entries()) {
    const fromInfo = memberIdToInfo.get(fromId)
    if (!fromInfo) continue
    for (const [toId, count] of toMap.entries()) {
      const toInfo = memberIdToInfo.get(toId)
      if (!toInfo) continue
      links.push({ source: fromInfo.name, target: toInfo.name, value: count })
      maxLinkValue = Math.max(maxLinkValue, count)
    }
  }
  return { nodes, links, maxLinkValue }
}

// ============================================================================
// Laugh analysis (from advanced/social.ts)
// ============================================================================

function keywordToPattern(keyword: string): string {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (keyword === '哈哈') return '哈哈+'
  return escaped
}

export function getLaughAnalysis(sessionId: string, filter?: TimeFilter, keywords?: string[]): any {
  const db = openDatabase(sessionId)
  const emptyResult = { rankByRate: [], rankByCount: [], typeDistribution: [], totalLaughs: 0, totalMessages: 0, groupLaughRate: 0 }
  if (!db) return emptyResult

  const laughKeywords = keywords && keywords.length > 0 ? keywords : []
  const patterns = laughKeywords.map(keywordToPattern)
  const laughRegex = new RegExp(`(${patterns.join('|')})`, 'gi')

  const { clause, params } = buildTimeFilter(filter)
  let whereClause = clause
  if (whereClause.includes('WHERE')) {
    whereClause += " AND COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL"
  } else {
    whereClause = " WHERE COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL"
  }

  const messages = db.prepare(
    `SELECT msg.sender_id as senderId, msg.content, m.platform_id as platformId,
            COALESCE(m.group_nickname, m.account_name, m.platform_id) as name
     FROM message msg JOIN member m ON msg.sender_id = m.id ${whereClause}`,
  ).all(...params) as Array<{ senderId: number; content: string; platformId: string; name: string }>
  if (messages.length === 0) return emptyResult

  const memberStats = new Map<number, { platformId: string; name: string; laughCount: number; messageCount: number; keywordCounts: Map<string, number> }>()
  const typeCount = new Map<string, number>()
  let totalLaughs = 0

  for (const msg of messages) {
    if (!memberStats.has(msg.senderId)) {
      memberStats.set(msg.senderId, { platformId: msg.platformId, name: msg.name, laughCount: 0, messageCount: 0, keywordCounts: new Map() })
    }
    const stats = memberStats.get(msg.senderId)!
    stats.messageCount++
    const matches = msg.content.match(laughRegex)
    if (matches) {
      stats.laughCount += matches.length
      totalLaughs += matches.length
      for (const match of matches) {
        let matchedType = '其他'
        for (const keyword of laughKeywords) {
          if (new RegExp(`^${keywordToPattern(keyword)}$`, 'i').test(match)) { matchedType = keyword; break }
        }
        typeCount.set(matchedType, (typeCount.get(matchedType) || 0) + 1)
        stats.keywordCounts.set(matchedType, (stats.keywordCounts.get(matchedType) || 0) + 1)
      }
    }
  }
  if (totalLaughs === 0) return emptyResult

  const rankItems: any[] = []
  for (const [memberId, stats] of memberStats.entries()) {
    if (stats.laughCount > 0) {
      const keywordDistribution: Array<{ keyword: string; count: number; percentage: number }> = []
      for (const keyword of laughKeywords) {
        const count = stats.keywordCounts.get(keyword) || 0
        if (count > 0) keywordDistribution.push({ keyword, count, percentage: Math.round((count / stats.laughCount) * 10000) / 100 })
      }
      const otherCount = stats.keywordCounts.get('其他') || 0
      if (otherCount > 0) keywordDistribution.push({ keyword: '其他', count: otherCount, percentage: Math.round((otherCount / stats.laughCount) * 10000) / 100 })
      rankItems.push({ memberId, platformId: stats.platformId, name: stats.name, laughCount: stats.laughCount, messageCount: stats.messageCount, laughRate: Math.round((stats.laughCount / stats.messageCount) * 10000) / 100, percentage: Math.round((stats.laughCount / totalLaughs) * 10000) / 100, keywordDistribution })
    }
  }

  return {
    rankByRate: [...rankItems].sort((a, b) => b.laughRate - a.laughRate),
    rankByCount: [...rankItems].sort((a, b) => b.laughCount - a.laughCount),
    typeDistribution: [...typeCount.entries()].map(([type, count]) => ({ type, count, percentage: Math.round((count / totalLaughs) * 10000) / 100 })).sort((a, b) => b.count - a.count),
    totalLaughs,
    totalMessages: messages.length,
    groupLaughRate: Math.round((totalLaughs / messages.length) * 10000) / 100,
  }
}

// ============================================================================
// Cluster graph (from advanced/social.ts)
// ============================================================================

const DEFAULT_CLUSTER_OPTIONS = { lookAhead: 3, decaySeconds: 120, topEdges: 100 }

function roundNum(value: number, digits = 4): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function clusterPairKey(aId: number, bId: number): string {
  return aId < bId ? `${aId}-${bId}` : `${bId}-${aId}`
}

export function getClusterGraph(sessionId: string, filter?: TimeFilter, options?: ClusterGraphOptions): ClusterGraphData {
  const db = openDatabase(sessionId)
  const opts = { ...DEFAULT_CLUSTER_OPTIONS, ...options }
  const emptyResult: ClusterGraphData = { nodes: [], links: [], maxLinkValue: 0, communities: [], stats: { totalMembers: 0, totalMessages: 0, involvedMembers: 0, edgeCount: 0, communityCount: 0 } }
  if (!db) return emptyResult

  const members = db.prepare(
    `SELECT id, platform_id as platformId, COALESCE(group_nickname, account_name, platform_id) as name,
            (SELECT COUNT(*) FROM message WHERE sender_id = member.id) as messageCount
     FROM member WHERE COALESCE(account_name, '') != '系统消息'`,
  ).all() as Array<{ id: number; platformId: string; name: string; messageCount: number }>
  if (members.length < 2) return { ...emptyResult, stats: { ...emptyResult.stats, totalMembers: members.length } }

  const memberInfo = new Map<number, { name: string; platformId: string; messageCount: number }>()
  for (const m of members) memberInfo.set(m.id, { name: m.name, platformId: m.platformId, messageCount: m.messageCount })

  const { clause, params } = buildTimeFilter(filter)
  let whereClause = clause
  if (whereClause.includes('WHERE')) whereClause += " AND COALESCE(m.account_name, '') != '系统消息'"
  else whereClause = " WHERE COALESCE(m.account_name, '') != '系统消息'"

  const messages = db.prepare(
    `SELECT msg.sender_id as senderId, msg.ts as ts FROM message msg JOIN member m ON msg.sender_id = m.id ${whereClause} ORDER BY msg.ts ASC, msg.id ASC`,
  ).all(...params) as Array<{ senderId: number; ts: number }>
  if (messages.length < 2) return { ...emptyResult, stats: { ...emptyResult.stats, totalMembers: members.length, totalMessages: messages.length } }

  const memberMsgCount = new Map<number, number>()
  for (const msg of messages) memberMsgCount.set(msg.senderId, (memberMsgCount.get(msg.senderId) || 0) + 1)
  const totalMessages = messages.length

  const pairRawScore = new Map<string, number>()
  const pairCoOccurrence = new Map<string, number>()

  for (let i = 0; i < messages.length - 1; i++) {
    const anchor = messages[i]
    const seenPartners = new Set<number>()
    let partnersFound = 0
    for (let j = i + 1; j < messages.length && partnersFound < opts.lookAhead; j++) {
      const candidate = messages[j]
      if (candidate.senderId === anchor.senderId || seenPartners.has(candidate.senderId)) continue
      seenPartners.add(candidate.senderId)
      partnersFound++
      const deltaSeconds = (candidate.ts - anchor.ts) / 1000
      const decayWeight = Math.exp(-deltaSeconds / opts.decaySeconds)
      const positionWeight = 1 - (partnersFound - 1) * 0.2
      const weight = decayWeight * positionWeight
      const key = clusterPairKey(anchor.senderId, candidate.senderId)
      pairRawScore.set(key, (pairRawScore.get(key) || 0) + weight)
      pairCoOccurrence.set(key, (pairCoOccurrence.get(key) || 0) + 1)
    }
  }

  const lookAheadFactor = opts.lookAhead * 0.8
  const rawEdges: Array<{ sourceId: number; targetId: number; rawScore: number; expectedScore: number; normalizedScore: number; hybridScore: number; coOccurrenceCount: number }> = []

  for (const [key, rawScore] of pairRawScore) {
    const [aIdStr, bIdStr] = key.split('-')
    const aId = parseInt(aIdStr)
    const bId = parseInt(bIdStr)
    const aMsgCount = memberMsgCount.get(aId) || 0
    const bMsgCount = memberMsgCount.get(bId) || 0
    const expectedScore = ((aMsgCount * bMsgCount) / totalMessages) * lookAheadFactor
    const normalizedScore = expectedScore > 0 ? rawScore / expectedScore : 0
    rawEdges.push({ sourceId: aId, targetId: bId, rawScore, expectedScore, normalizedScore, hybridScore: 0, coOccurrenceCount: pairCoOccurrence.get(key) || 0 })
  }

  const maxRawScore = Math.max(...rawEdges.map((e) => e.rawScore), 1)
  const maxNormalizedScore = Math.max(...rawEdges.map((e) => e.normalizedScore), 1)

  const edges = rawEdges.map((e) => ({
    ...e,
    rawScore: roundNum(e.rawScore),
    expectedScore: roundNum(e.expectedScore),
    normalizedScore: roundNum(e.normalizedScore),
    hybridScore: roundNum(0.5 * (e.rawScore / maxRawScore) + 0.5 * (e.normalizedScore / maxNormalizedScore)),
  }))

  edges.sort((a, b) => b.hybridScore - a.hybridScore)
  const keptEdges = edges.slice(0, opts.topEdges)
  if (keptEdges.length === 0) return { ...emptyResult, stats: { ...emptyResult.stats, totalMembers: members.length, totalMessages: messages.length } }

  const involvedIds = new Set<number>()
  for (const edge of keptEdges) { involvedIds.add(edge.sourceId); involvedIds.add(edge.targetId) }

  const nodeDegree = new Map<number, number>()
  for (const edge of keptEdges) {
    nodeDegree.set(edge.sourceId, (nodeDegree.get(edge.sourceId) || 0) + edge.hybridScore)
    nodeDegree.set(edge.targetId, (nodeDegree.get(edge.targetId) || 0) + edge.hybridScore)
  }
  const maxDegree = Math.max(...nodeDegree.values(), 1)

  const nameCount = new Map<string, number>()
  for (const id of involvedIds) { const name = memberInfo.get(id)?.name || String(id); nameCount.set(name, (nameCount.get(name) || 0) + 1) }
  const displayNames = new Map<number, string>()
  for (const id of involvedIds) {
    const info = memberInfo.get(id)
    const baseName = info?.name || String(id)
    displayNames.set(id, (nameCount.get(baseName) || 0) > 1 ? `${baseName}#${(info?.platformId || String(id)).slice(-4)}` : baseName)
  }

  const maxMsgCount = Math.max(...[...involvedIds].map((id) => memberInfo.get(id)?.messageCount || 0), 1)
  const nodes: ClusterGraphNode[] = [...involvedIds].map((id) => {
    const info = memberInfo.get(id)!
    const degree = nodeDegree.get(id) || 0
    const normalizedDegree = degree / maxDegree
    const msgNorm = info.messageCount / maxMsgCount
    return { id, name: displayNames.get(id)!, messageCount: info.messageCount, symbolSize: Math.round(20 + (0.7 * normalizedDegree + 0.3 * msgNorm) * 35), degree: roundNum(degree), normalizedDegree: roundNum(normalizedDegree) }
  }).sort((a, b) => b.degree - a.degree)

  const maxLinkValue = keptEdges.length > 0 ? Math.max(...keptEdges.map((e) => e.hybridScore)) : 0
  const links: ClusterGraphLink[] = keptEdges.map((e) => ({
    source: displayNames.get(e.sourceId)!,
    target: displayNames.get(e.targetId)!,
    value: e.hybridScore,
    rawScore: e.rawScore,
    expectedScore: e.expectedScore,
    coOccurrenceCount: e.coOccurrenceCount,
  }))

  return {
    nodes,
    links,
    maxLinkValue: roundNum(maxLinkValue),
    communities: [],
    stats: {
      totalMembers: members.length,
      totalMessages: messages.length,
      involvedMembers: involvedIds.size,
      edgeCount: keptEdges.length,
      communityCount: 0,
    },
  }
}