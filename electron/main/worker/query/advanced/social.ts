/**
 * 社交分析模块
 * 包含：@ 互动分析、成员关系模型、含笑量分析
 */

import { openDatabase, buildTimeFilter, type TimeFilter } from '../../core'

// ==================== @ 互动分析 ====================

/**
 * 获取 @ 互动分析数据
 */
export function getMentionAnalysis(sessionId: string, filter?: TimeFilter): any {
  const db = openDatabase(sessionId)
  const emptyResult = {
    topMentioners: [],
    topMentioned: [],
    oneWay: [],
    twoWay: [],
    totalMentions: 0,
    memberDetails: [],
  }

  if (!db) return emptyResult

  // 1. 查询所有成员信息
  const members = db
    .prepare(
      `
      SELECT id, platform_id as platformId, COALESCE(group_nickname, account_name, platform_id) as name
      FROM member
      WHERE COALESCE(account_name, '') != '系统消息'
    `
    )
    .all() as Array<{ id: number; platformId: string; name: string }>

  if (members.length === 0) return emptyResult

  // 2. 构建昵称到成员ID的映射（包括历史昵称）
  const nameToMemberId = new Map<string, number>()
  const memberIdToInfo = new Map<number, { platformId: string; name: string }>()

  for (const member of members) {
    memberIdToInfo.set(member.id, { platformId: member.platformId, name: member.name })
    // 当前昵称
    nameToMemberId.set(member.name, member.id)

    // 查询历史昵称
    const history = db
      .prepare(
        `
        SELECT name FROM member_name_history
        WHERE member_id = ?
      `
      )
      .all(member.id) as Array<{ name: string }>

    for (const h of history) {
      if (!nameToMemberId.has(h.name)) {
        nameToMemberId.set(h.name, member.id)
      }
    }
  }

  // 3. 查询所有消息（带时间过滤）
  const { clause, params } = buildTimeFilter(filter)

  let whereClause = clause
  if (whereClause.includes('WHERE')) {
    whereClause +=
      " AND COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL AND msg.content LIKE '%@%'"
  } else {
    whereClause =
      " WHERE COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL AND msg.content LIKE '%@%'"
  }

  const messages = db
    .prepare(
      `
      SELECT
        msg.sender_id as senderId,
        msg.content
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
      ${whereClause}
    `
    )
    .all(...params) as Array<{ senderId: number; content: string }>

  // 4. 解析 @ 并构建关系矩阵
  // mentionMatrix[fromId][toId] = count
  const mentionMatrix = new Map<number, Map<number, number>>()
  const mentionedCount = new Map<number, number>() // 被 @ 的次数
  const mentionerCount = new Map<number, number>() // 发起 @ 的次数
  let totalMentions = 0

  // @ 正则：匹配 @昵称（昵称不含空格和@）
  const mentionRegex = /@([^\s@]+)/g

  for (const msg of messages) {
    const matches = msg.content.matchAll(mentionRegex)
    const mentionedInThisMsg = new Set<number>() // 避免同一消息重复计数同一人

    for (const match of matches) {
      const mentionedName = match[1]
      const mentionedId = nameToMemberId.get(mentionedName)

      // 只统计能匹配到成员的 @，且不能 @ 自己
      if (mentionedId && mentionedId !== msg.senderId && !mentionedInThisMsg.has(mentionedId)) {
        mentionedInThisMsg.add(mentionedId)
        totalMentions++

        // 更新矩阵
        if (!mentionMatrix.has(msg.senderId)) {
          mentionMatrix.set(msg.senderId, new Map())
        }
        const fromMap = mentionMatrix.get(msg.senderId)!
        fromMap.set(mentionedId, (fromMap.get(mentionedId) || 0) + 1)

        // 更新计数
        mentionerCount.set(msg.senderId, (mentionerCount.get(msg.senderId) || 0) + 1)
        mentionedCount.set(mentionedId, (mentionedCount.get(mentionedId) || 0) + 1)
      }
    }
  }

  if (totalMentions === 0) return emptyResult

  // 5. 构建排行榜
  const topMentioners: any[] = []
  for (const [memberId, count] of mentionerCount.entries()) {
    const info = memberIdToInfo.get(memberId)!
    topMentioners.push({
      memberId,
      platformId: info.platformId,
      name: info.name,
      count,
      percentage: Math.round((count / totalMentions) * 10000) / 100,
    })
  }
  topMentioners.sort((a, b) => b.count - a.count)

  const topMentioned: any[] = []
  for (const [memberId, count] of mentionedCount.entries()) {
    const info = memberIdToInfo.get(memberId)!
    topMentioned.push({
      memberId,
      platformId: info.platformId,
      name: info.name,
      count,
      percentage: Math.round((count / totalMentions) * 10000) / 100,
    })
  }
  topMentioned.sort((a, b) => b.count - a.count)

  // 6. 检测单向关注
  // 条件：A @ B 的比例 >= 80%（即 B @ A / A @ B < 20%）
  const oneWay: any[] = []
  const processedPairs = new Set<string>()

  for (const [fromId, toMap] of mentionMatrix.entries()) {
    for (const [toId, fromToCount] of toMap.entries()) {
      const pairKey = `${Math.min(fromId, toId)}-${Math.max(fromId, toId)}`
      if (processedPairs.has(pairKey)) continue
      processedPairs.add(pairKey)

      const toFromCount = mentionMatrix.get(toId)?.get(fromId) || 0
      const total = fromToCount + toFromCount

      // 只有总互动 >= 3 次才考虑
      if (total < 3) continue

      const ratio = fromToCount / total

      // 单向关注：一方占比 >= 80%
      if (ratio >= 0.8) {
        const fromInfo = memberIdToInfo.get(fromId)!
        const toInfo = memberIdToInfo.get(toId)!
        oneWay.push({
          fromMemberId: fromId,
          fromName: fromInfo.name,
          toMemberId: toId,
          toName: toInfo.name,
          fromToCount,
          toFromCount,
          ratio: Math.round(ratio * 100) / 100,
        })
      } else if (ratio <= 0.2) {
        // 反向单向关注
        const fromInfo = memberIdToInfo.get(fromId)!
        const toInfo = memberIdToInfo.get(toId)!
        oneWay.push({
          fromMemberId: toId,
          fromName: toInfo.name,
          toMemberId: fromId,
          toName: fromInfo.name,
          fromToCount: toFromCount,
          toFromCount: fromToCount,
          ratio: Math.round((1 - ratio) * 100) / 100,
        })
      }
    }
  }
  oneWay.sort((a, b) => b.fromToCount - a.fromToCount)

  // 7. 检测双向奔赴（CP检测）
  // 条件：双方互相 @ 总次数 >= 5 次，且比例在 30%-70% 之间
  const twoWay: any[] = []
  processedPairs.clear()

  for (const [fromId, toMap] of mentionMatrix.entries()) {
    for (const [toId, fromToCount] of toMap.entries()) {
      const pairKey = `${Math.min(fromId, toId)}-${Math.max(fromId, toId)}`
      if (processedPairs.has(pairKey)) continue
      processedPairs.add(pairKey)

      const toFromCount = mentionMatrix.get(toId)?.get(fromId) || 0
      const total = fromToCount + toFromCount

      // 总互动 >= 5 次
      if (total < 5) continue

      // 必须双方都有 @
      if (toFromCount === 0 || fromToCount === 0) continue

      const ratio = Math.min(fromToCount, toFromCount) / Math.max(fromToCount, toFromCount)

      // 平衡度 >= 30%（即 30%-100%）
      if (ratio >= 0.3) {
        const member1Info = memberIdToInfo.get(fromId)!
        const member2Info = memberIdToInfo.get(toId)!
        twoWay.push({
          member1Id: fromId,
          member1Name: member1Info.name,
          member2Id: toId,
          member2Name: member2Info.name,
          member1To2: fromToCount,
          member2To1: toFromCount,
          total,
          balance: Math.round(ratio * 100) / 100,
        })
      }
    }
  }
  twoWay.sort((a, b) => b.total - a.total)

  // 8. 构建成员详情（每个成员的 @ 关系 TOP 5）
  const memberDetails: any[] = []

  for (const member of members) {
    const memberId = member.id
    const info = memberIdToInfo.get(memberId)!

    // 该成员最常 @ 的人
    const topMentionedByThis: any[] = []
    const toMap = mentionMatrix.get(memberId)
    if (toMap) {
      for (const [toId, count] of toMap.entries()) {
        const toInfo = memberIdToInfo.get(toId)!
        topMentionedByThis.push({
          fromMemberId: memberId,
          fromName: info.name,
          toMemberId: toId,
          toName: toInfo.name,
          count,
        })
      }
      topMentionedByThis.sort((a, b) => b.count - a.count)
    }

    // 最常 @ 该成员的人
    const topMentionersOfThis: any[] = []
    for (const [fromId, toMap] of mentionMatrix.entries()) {
      const count = toMap.get(memberId)
      if (count) {
        const fromInfo = memberIdToInfo.get(fromId)!
        topMentionersOfThis.push({
          fromMemberId: fromId,
          fromName: fromInfo.name,
          toMemberId: memberId,
          toName: info.name,
          count,
        })
      }
    }
    topMentionersOfThis.sort((a, b) => b.count - a.count)

    // 只有有数据的成员才添加
    if (topMentionedByThis.length > 0 || topMentionersOfThis.length > 0) {
      memberDetails.push({
        memberId,
        name: info.name,
        topMentioned: topMentionedByThis.slice(0, 5),
        topMentioners: topMentionersOfThis.slice(0, 5),
      })
    }
  }

  return {
    topMentioners,
    topMentioned,
    oneWay,
    twoWay,
    totalMentions,
    memberDetails,
  }
}

// ==================== @ 互动关系图数据 ====================

export interface MentionGraphNode {
  id: number
  name: string
  value: number // 消息数量（用于节点大小）
  symbolSize: number // 节点大小
}

export interface MentionGraphLink {
  source: string // 发起者名称
  target: string // 被艾特者名称
  value: number // @ 次数
}

export interface MentionGraphData {
  nodes: MentionGraphNode[]
  links: MentionGraphLink[]
  maxLinkValue: number // 最大边权重（用于归一化）
}

/**
 * 获取 @ 互动关系图数据（用于 ECharts Graph）
 */
export function getMentionGraph(sessionId: string, filter?: TimeFilter): MentionGraphData {
  const db = openDatabase(sessionId)
  const emptyResult: MentionGraphData = { nodes: [], links: [], maxLinkValue: 0 }

  if (!db) return emptyResult

  // 1. 查询所有成员信息和消息数量（不过滤消息数为 0 的成员，因为可能被 @ 但没发消息）
  const { clause, params } = buildTimeFilter(filter)
  const msgFilterBase = clause ? clause.replace('WHERE', 'AND') : ''
  const msgFilterWithSystem = msgFilterBase + " AND COALESCE(m.account_name, '') != '系统消息'"

  const members = db
    .prepare(
      `
      SELECT
        m.id,
        m.platform_id as platformId,
        COALESCE(m.group_nickname, m.account_name, m.platform_id) as name,
        COUNT(msg.id) as messageCount
      FROM member m
      LEFT JOIN message msg ON m.id = msg.sender_id ${msgFilterWithSystem}
      WHERE COALESCE(m.account_name, '') != '系统消息'
      GROUP BY m.id
    `
    )
    .all(...params) as Array<{ id: number; platformId: string; name: string; messageCount: number }>

  if (members.length === 0) return emptyResult

  // 2. 构建昵称到成员ID的映射
  const nameToMemberId = new Map<string, number>()
  const memberIdToInfo = new Map<number, { name: string; messageCount: number }>()

  for (const member of members) {
    memberIdToInfo.set(member.id, { name: member.name, messageCount: member.messageCount })
    nameToMemberId.set(member.name, member.id)

    // 查询历史昵称
    const history = db.prepare(`SELECT name FROM member_name_history WHERE member_id = ?`).all(member.id) as Array<{
      name: string
    }>

    for (const h of history) {
      if (!nameToMemberId.has(h.name)) {
        nameToMemberId.set(h.name, member.id)
      }
    }
  }

  // 3. 查询包含 @ 的消息
  let whereClause = clause
  if (whereClause.includes('WHERE')) {
    whereClause +=
      " AND COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL AND msg.content LIKE '%@%'"
  } else {
    whereClause =
      " WHERE COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL AND msg.content LIKE '%@%'"
  }

  const messages = db
    .prepare(
      `
      SELECT msg.sender_id as senderId, msg.content
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
      ${whereClause}
    `
    )
    .all(...params) as Array<{ senderId: number; content: string }>

  // 4. 解析 @ 并构建关系矩阵
  const mentionMatrix = new Map<number, Map<number, number>>()
  const mentionRegex = /@([^\s@]+)/g

  for (const msg of messages) {
    const matches = msg.content.matchAll(mentionRegex)
    const mentionedInThisMsg = new Set<number>()

    for (const match of matches) {
      const mentionedName = match[1]
      const mentionedId = nameToMemberId.get(mentionedName)

      if (mentionedId && mentionedId !== msg.senderId && !mentionedInThisMsg.has(mentionedId)) {
        mentionedInThisMsg.add(mentionedId)

        if (!mentionMatrix.has(msg.senderId)) {
          mentionMatrix.set(msg.senderId, new Map())
        }
        const fromMap = mentionMatrix.get(msg.senderId)!
        fromMap.set(mentionedId, (fromMap.get(mentionedId) || 0) + 1)
      }
    }
  }

  // 5. 构建 nodes（只包含有互动的成员）
  const involvedMemberIds = new Set<number>()
  for (const [fromId, toMap] of mentionMatrix.entries()) {
    involvedMemberIds.add(fromId)
    for (const toId of toMap.keys()) {
      involvedMemberIds.add(toId)
    }
  }

  const maxMessageCount = Math.max(...members.filter((m) => involvedMemberIds.has(m.id)).map((m) => m.messageCount), 1)

  const nodes: MentionGraphNode[] = []
  for (const memberId of involvedMemberIds) {
    const info = memberIdToInfo.get(memberId)
    if (info) {
      // 节点大小根据消息数量计算（20-60 范围）
      const symbolSize = 20 + (info.messageCount / maxMessageCount) * 40
      nodes.push({
        id: memberId,
        name: info.name,
        value: info.messageCount,
        symbolSize: Math.round(symbolSize),
      })
    }
  }

  // 6. 构建 links（使用 name 而非 ID，便于前端 ECharts 匹配）
  const links: MentionGraphLink[] = []
  let maxLinkValue = 0

  for (const [fromId, toMap] of mentionMatrix.entries()) {
    const fromInfo = memberIdToInfo.get(fromId)
    if (!fromInfo) continue

    for (const [toId, count] of toMap.entries()) {
      const toInfo = memberIdToInfo.get(toId)
      if (!toInfo) continue

      links.push({
        source: fromInfo.name,
        target: toInfo.name,
        value: count,
      })
      maxLinkValue = Math.max(maxLinkValue, count)
    }
  }

  return { nodes, links, maxLinkValue }
}

// ==================== 成员关系模型（@ + 时间共现） ====================

export interface RelationshipGraphOptions {
  mentionWeight?: number
  temporalWeight?: number
  reciprocityWeight?: number
  windowSeconds?: number
  decaySeconds?: number
  minScore?: number
  minTemporalTurns?: number
  topEdges?: number
}

interface NormalizedRelationshipGraphOptions {
  mentionWeight: number
  temporalWeight: number
  reciprocityWeight: number
  windowSeconds: number
  decaySeconds: number
  minScore: number
  minTemporalTurns: number
  topEdges: number
}

interface RelationshipPairStat {
  aId: number
  bId: number
  mentionAB: number
  mentionBA: number
  mentionTotal: number
  temporalTurns: number
  temporalScore: number
  temporalDeltaSum: number
}

export interface RelationshipGraphNode {
  id: number
  name: string
  value: number
  symbolSize: number
  category: number
  messageCount: number
  weightedDegree: number
  totalMentions: number
  communitySize: number
}

export interface RelationshipGraphLink {
  source: string
  target: string
  value: number
  mentionCount: number
  temporalTurns: number
  temporalScore: number
  reciprocity: number
  avgDeltaSec: number | null
}

export interface RelationshipGraphData {
  nodes: RelationshipGraphNode[]
  links: RelationshipGraphLink[]
  maxLinkValue: number
  communities: Array<{ id: number; name: string; size: number }>
  stats: {
    totalMembers: number
    involvedMembers: number
    rawEdgeCount: number
    keptEdges: number
    maxMentionCount: number
    maxTemporalScore: number
  }
  options: NormalizedRelationshipGraphOptions
}

const DEFAULT_RELATIONSHIP_OPTIONS: NormalizedRelationshipGraphOptions = {
  mentionWeight: 0.45,
  temporalWeight: 0.4,
  reciprocityWeight: 0.15,
  windowSeconds: 300,
  decaySeconds: 120,
  minScore: 0.12,
  minTemporalTurns: 2,
  topEdges: 120,
}

function roundNumber(value: number, digits = 4): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function normalizeRelationshipOptions(options?: RelationshipGraphOptions): NormalizedRelationshipGraphOptions {
  const merged = {
    ...DEFAULT_RELATIONSHIP_OPTIONS,
    ...(options || {}),
  }

  const mentionWeight = Number(merged.mentionWeight)
  const temporalWeight = Number(merged.temporalWeight)
  const reciprocityWeight = Number(merged.reciprocityWeight)
  const totalWeight = mentionWeight + temporalWeight + reciprocityWeight

  const normalizedWeights =
    totalWeight > 0
      ? {
          mentionWeight: mentionWeight / totalWeight,
          temporalWeight: temporalWeight / totalWeight,
          reciprocityWeight: reciprocityWeight / totalWeight,
        }
      : {
          mentionWeight: DEFAULT_RELATIONSHIP_OPTIONS.mentionWeight,
          temporalWeight: DEFAULT_RELATIONSHIP_OPTIONS.temporalWeight,
          reciprocityWeight: DEFAULT_RELATIONSHIP_OPTIONS.reciprocityWeight,
        }

  return {
    ...normalizedWeights,
    windowSeconds:
      Number.isFinite(Number(merged.windowSeconds)) && Number(merged.windowSeconds) > 0
        ? Number(merged.windowSeconds)
        : DEFAULT_RELATIONSHIP_OPTIONS.windowSeconds,
    decaySeconds:
      Number.isFinite(Number(merged.decaySeconds)) && Number(merged.decaySeconds) > 0
        ? Number(merged.decaySeconds)
        : DEFAULT_RELATIONSHIP_OPTIONS.decaySeconds,
    minScore:
      Number.isFinite(Number(merged.minScore)) && Number(merged.minScore) >= 0
        ? Number(merged.minScore)
        : DEFAULT_RELATIONSHIP_OPTIONS.minScore,
    minTemporalTurns:
      Number.isFinite(Number(merged.minTemporalTurns)) && Number(merged.minTemporalTurns) >= 0
        ? Math.floor(Number(merged.minTemporalTurns))
        : DEFAULT_RELATIONSHIP_OPTIONS.minTemporalTurns,
    topEdges:
      Number.isFinite(Number(merged.topEdges)) && Number(merged.topEdges) > 0
        ? Math.floor(Number(merged.topEdges))
        : DEFAULT_RELATIONSHIP_OPTIONS.topEdges,
  }
}

function parseAliases(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter(Boolean)
    }
  } catch {
    // ignore parse failures
  }
  return []
}

function cleanMentionToken(token: string): string {
  return token.trim().replace(/[),.:;!?，。！？、）】》」]+$/g, '')
}

function pairKey(aId: number, bId: number): string {
  const left = Math.min(aId, bId)
  const right = Math.max(aId, bId)
  return `${left}-${right}`
}

function getOrCreatePair(store: Map<string, RelationshipPairStat>, aId: number, bId: number): RelationshipPairStat {
  const key = pairKey(aId, bId)
  let pair = store.get(key)
  if (!pair) {
    pair = {
      aId: Math.min(aId, bId),
      bId: Math.max(aId, bId),
      mentionAB: 0,
      mentionBA: 0,
      mentionTotal: 0,
      temporalTurns: 0,
      temporalScore: 0,
      temporalDeltaSum: 0,
    }
    store.set(key, pair)
  }
  return pair
}

function runWeightedLabelPropagation(
  nodeIds: number[],
  weightedEdges: Array<{ sourceId: number; targetId: number; weight: number }>
): {
  nodeToCommunity: Map<number, number>
  communities: Array<{ id: number; name: string; size: number }>
} {
  const adjacency = new Map<number, Map<number, number>>()
  const weightedDegree = new Map<number, number>()

  for (const nodeId of nodeIds) {
    adjacency.set(nodeId, new Map())
    weightedDegree.set(nodeId, 0)
  }

  for (const edge of weightedEdges) {
    if (!adjacency.has(edge.sourceId) || !adjacency.has(edge.targetId)) continue
    adjacency.get(edge.sourceId)!.set(edge.targetId, (adjacency.get(edge.sourceId)!.get(edge.targetId) || 0) + edge.weight)
    adjacency.get(edge.targetId)!.set(edge.sourceId, (adjacency.get(edge.targetId)!.get(edge.sourceId) || 0) + edge.weight)
    weightedDegree.set(edge.sourceId, (weightedDegree.get(edge.sourceId) || 0) + edge.weight)
    weightedDegree.set(edge.targetId, (weightedDegree.get(edge.targetId) || 0) + edge.weight)
  }

  const labels = new Map<number, string>()
  for (const nodeId of nodeIds) labels.set(nodeId, String(nodeId))

  const iterationOrder = [...nodeIds].sort((a, b) => (weightedDegree.get(b) || 0) - (weightedDegree.get(a) || 0))
  const maxIterations = 25
  for (let i = 0; i < maxIterations; i++) {
    let changed = false

    for (const nodeId of iterationOrder) {
      const neighbors = adjacency.get(nodeId)
      if (!neighbors || neighbors.size === 0) continue

      const labelScores = new Map<string, number>()
      for (const [neighborId, w] of neighbors.entries()) {
        const neighborLabel = labels.get(neighborId)
        if (!neighborLabel) continue
        labelScores.set(neighborLabel, (labelScores.get(neighborLabel) || 0) + w)
      }

      let bestLabel = labels.get(nodeId)!
      let bestScore = -1
      for (const [label, score] of labelScores.entries()) {
        if (score > bestScore || (score === bestScore && label < bestLabel)) {
          bestScore = score
          bestLabel = label
        }
      }

      if (bestLabel !== labels.get(nodeId)) {
        labels.set(nodeId, bestLabel)
        changed = true
      }
    }

    if (!changed) break
  }

  const communitySizeByLabel = new Map<string, number>()
  for (const label of labels.values()) {
    communitySizeByLabel.set(label, (communitySizeByLabel.get(label) || 0) + 1)
  }

  const sortedLabels = [...communitySizeByLabel.entries()].sort((a, b) => b[1] - a[1])
  const labelToCategoryId = new Map<string, number>()
  sortedLabels.forEach(([label], index) => labelToCategoryId.set(label, index))

  const nodeToCommunity = new Map<number, number>()
  for (const [nodeId, label] of labels.entries()) {
    nodeToCommunity.set(nodeId, labelToCategoryId.get(label) || 0)
  }

  const communities = sortedLabels.map(([label, size], index) => ({
    id: index,
    name: `Community ${index + 1}`,
    size,
  }))

  return { nodeToCommunity, communities }
}

function uniqueDisplayNames(
  memberIds: number[],
  memberInfo: Map<number, { name: string; platformId: string }>
): Map<number, string> {
  const nameCount = new Map<string, number>()
  for (const memberId of memberIds) {
    const baseName = memberInfo.get(memberId)?.name || String(memberId)
    nameCount.set(baseName, (nameCount.get(baseName) || 0) + 1)
  }

  const result = new Map<number, string>()
  for (const memberId of memberIds) {
    const info = memberInfo.get(memberId)
    const baseName = info?.name || String(memberId)
    if ((nameCount.get(baseName) || 0) > 1) {
      const suffix = (info?.platformId || String(memberId)).slice(-4)
      result.set(memberId, `${baseName}#${suffix}`)
    } else {
      result.set(memberId, baseName)
    }
  }
  return result
}

/**
 * 获取成员关系图（融合 @ 互动 + 时间相邻共现 + 互惠度）
 *
 * 设计依据：
 * 1) Granovetter 的弱连接观点（弱连接作为桥梁）
 * 2) 关系强度可由互动频率、时间模式、互惠性联合估计
 */
export function getRelationshipGraph(
  sessionId: string,
  filter?: TimeFilter,
  options?: RelationshipGraphOptions
): RelationshipGraphData {
  const db = openDatabase(sessionId)
  const normalizedOptions = normalizeRelationshipOptions(options)
  const selectedMemberId = typeof filter?.memberId === 'number' ? filter.memberId : null

  const emptyResult: RelationshipGraphData = {
    nodes: [],
    links: [],
    maxLinkValue: 0,
    communities: [],
    stats: {
      totalMembers: 0,
      involvedMembers: 0,
      rawEdgeCount: 0,
      keptEdges: 0,
      maxMentionCount: 0,
      maxTemporalScore: 0,
    },
    options: normalizedOptions,
  }

  if (!db) return emptyResult

  // 关系模型中的 memberId 表示“关系聚焦对象”，不应限制消息源查询
  const timeRangeFilter: TimeFilter | undefined =
    filter && (filter.startTs !== undefined || filter.endTs !== undefined)
      ? { startTs: filter.startTs, endTs: filter.endTs }
      : undefined
  const { clause, params } = buildTimeFilter(timeRangeFilter, 'msg')
  const msgFilterBase = clause ? clause.replace('WHERE', 'AND') : ''
  const msgFilterWithSystem = msgFilterBase + " AND COALESCE(m.account_name, '') != '系统消息'"

  const members = db
    .prepare(
      `
      SELECT
        m.id,
        m.platform_id as platformId,
        COALESCE(m.group_nickname, m.account_name, m.platform_id) as name,
        COALESCE(m.aliases, '[]') as aliases,
        COUNT(msg.id) as messageCount
      FROM member m
      LEFT JOIN message msg ON m.id = msg.sender_id ${msgFilterWithSystem}
      WHERE COALESCE(m.account_name, '') != '系统消息'
      GROUP BY m.id
    `
    )
    .all(...params) as Array<{
    id: number
    platformId: string
    name: string
    aliases: string
    messageCount: number
  }>

  if (members.length === 0) return emptyResult

  emptyResult.stats.totalMembers = members.length

  const memberInfoById = new Map<number, { name: string; platformId: string; messageCount: number }>()

  const historyRows = db.prepare(`SELECT member_id as memberId, name FROM member_name_history`).all() as Array<{
    memberId: number
    name: string | null
  }>
  const historyNamesByMemberId = new Map<number, string[]>()
  for (const row of historyRows) {
    if (!historyNamesByMemberId.has(row.memberId)) {
      historyNamesByMemberId.set(row.memberId, [])
    }
    historyNamesByMemberId.get(row.memberId)!.push(row.name)
  }

  // 名称歧义会导致误判，这里只保留“唯一可映射”名称
  const nameBuckets = new Map<string, Set<number>>()
  const addNameCandidate = (name: string | null | undefined, memberId: number) => {
    if (typeof name !== 'string') return
    const normalizedName = name.trim().toLowerCase()
    if (!normalizedName) return
    if (!nameBuckets.has(normalizedName)) {
      nameBuckets.set(normalizedName, new Set())
    }
    nameBuckets.get(normalizedName)!.add(memberId)
  }

  for (const member of members) {
    memberInfoById.set(member.id, {
      name: member.name,
      platformId: member.platformId,
      messageCount: member.messageCount,
    })
    addNameCandidate(member.name, member.id)

    const historyNames = historyNamesByMemberId.get(member.id) || []
    for (const historyName of historyNames) {
      addNameCandidate(historyName, member.id)
    }

    const aliases = parseAliases(member.aliases)
    for (const alias of aliases) {
      addNameCandidate(alias, member.id)
    }
  }

  const nameToMemberId = new Map<string, number>()
  for (const [name, memberIds] of nameBuckets.entries()) {
    if (memberIds.size !== 1) continue
    const memberId = memberIds.values().next().value as number
    nameToMemberId.set(name, memberId)
  }

  let whereClause = clause
  if (whereClause.includes('WHERE')) {
    whereClause += " AND COALESCE(m.account_name, '') != '系统消息'"
  } else {
    whereClause = " WHERE COALESCE(m.account_name, '') != '系统消息'"
  }

  const messages = db
    .prepare(
      `
      SELECT
        msg.id as id,
        msg.sender_id as senderId,
        msg.ts as ts,
        msg.content as content
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
      ${whereClause}
      ORDER BY msg.ts ASC, msg.id ASC
    `
    )
    .all(...params) as Array<{
    id: number
    senderId: number
    ts: number
    content: string | null
  }>

  if (messages.length === 0) return emptyResult

  const pairStats = new Map<string, RelationshipPairStat>()
  const mentionRegex = /@([^\s@]+)/g

  for (const msg of messages) {
    const content = msg.content || ''
    if (!content.includes('@')) continue

    const mentionedInThisMessage = new Set<number>()
    for (const match of content.matchAll(mentionRegex)) {
      const rawName = match[1]
      const mentionedName = cleanMentionToken(rawName).toLowerCase()
      const mentionedId = nameToMemberId.get(mentionedName)
      if (!mentionedId || mentionedId === msg.senderId || mentionedInThisMessage.has(mentionedId)) continue
      mentionedInThisMessage.add(mentionedId)

      const pair = getOrCreatePair(pairStats, msg.senderId, mentionedId)
      if (msg.senderId === pair.aId && mentionedId === pair.bId) {
        pair.mentionAB += 1
      } else {
        pair.mentionBA += 1
      }
      pair.mentionTotal += 1
    }
  }

  for (let i = 0; i < messages.length - 1; i++) {
    const anchor = messages[i]
    const seenPartner = new Set<number>()

    for (let j = i + 1; j < messages.length; j++) {
      const candidate = messages[j]
      const deltaSeconds = candidate.ts - anchor.ts
      if (deltaSeconds <= 0) continue
      if (deltaSeconds > normalizedOptions.windowSeconds) break
      if (anchor.senderId === candidate.senderId || seenPartner.has(candidate.senderId)) continue

      seenPartner.add(candidate.senderId)
      const pair = getOrCreatePair(pairStats, anchor.senderId, candidate.senderId)
      const temporalWeight = Math.exp(-deltaSeconds / normalizedOptions.decaySeconds)
      pair.temporalTurns += 1
      pair.temporalScore += temporalWeight
      pair.temporalDeltaSum += deltaSeconds
    }
  }

  const allPairs = [...pairStats.values()]
  const maxMentionCount = Math.max(...allPairs.map((p) => p.mentionTotal), 0)
  const maxTemporalScore = Math.max(...allPairs.map((p) => p.temporalScore), 0)

  const rawEdges: Array<{
    sourceId: number
    targetId: number
    score: number
    mentionCount: number
    temporalTurns: number
    temporalScore: number
    reciprocity: number
    avgDeltaSec: number | null
  }> = []

  for (const pair of allPairs) {
    const mentionNorm =
      maxMentionCount > 0 ? Math.log1p(pair.mentionTotal) / Math.log1p(maxMentionCount) : 0
    const temporalNorm =
      maxTemporalScore > 0 ? Math.log1p(pair.temporalScore) / Math.log1p(maxTemporalScore) : 0
    const reciprocity =
      pair.mentionTotal > 0 ? Math.min(pair.mentionAB, pair.mentionBA) / Math.max(pair.mentionAB, pair.mentionBA) : 0

    const score =
      normalizedOptions.mentionWeight * mentionNorm +
      normalizedOptions.temporalWeight * temporalNorm +
      normalizedOptions.reciprocityWeight * reciprocity

    const hasSignal = pair.mentionTotal > 0 || pair.temporalTurns >= normalizedOptions.minTemporalTurns
    if (!hasSignal || score < normalizedOptions.minScore) continue

    rawEdges.push({
      sourceId: pair.aId,
      targetId: pair.bId,
      score,
      mentionCount: pair.mentionTotal,
      temporalTurns: pair.temporalTurns,
      temporalScore: pair.temporalScore,
      reciprocity,
      avgDeltaSec: pair.temporalTurns > 0 ? pair.temporalDeltaSum / pair.temporalTurns : null,
    })
  }

  rawEdges.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (b.mentionCount !== a.mentionCount) return b.mentionCount - a.mentionCount
    return b.temporalScore - a.temporalScore
  })

  const scopedEdges =
    selectedMemberId !== null
      ? rawEdges.filter((edge) => edge.sourceId === selectedMemberId || edge.targetId === selectedMemberId)
      : rawEdges

  const keptEdges = scopedEdges.slice(0, normalizedOptions.topEdges)
  if (keptEdges.length === 0) {
    return {
      ...emptyResult,
      stats: {
        ...emptyResult.stats,
        rawEdgeCount: scopedEdges.length,
        maxMentionCount,
        maxTemporalScore: roundNumber(maxTemporalScore),
      },
    }
  }

  const involvedMemberIdSet = new Set<number>()
  const weightedDegree = new Map<number, number>()
  const totalMentionsByMember = new Map<number, number>()
  let maxEdgeScore = 0

  for (const edge of keptEdges) {
    involvedMemberIdSet.add(edge.sourceId)
    involvedMemberIdSet.add(edge.targetId)
    weightedDegree.set(edge.sourceId, (weightedDegree.get(edge.sourceId) || 0) + edge.score)
    weightedDegree.set(edge.targetId, (weightedDegree.get(edge.targetId) || 0) + edge.score)
    totalMentionsByMember.set(edge.sourceId, (totalMentionsByMember.get(edge.sourceId) || 0) + edge.mentionCount)
    totalMentionsByMember.set(edge.targetId, (totalMentionsByMember.get(edge.targetId) || 0) + edge.mentionCount)
    maxEdgeScore = Math.max(maxEdgeScore, edge.score)
  }

  const involvedMemberIds = [...involvedMemberIdSet]
  const maxWeightedDegree = Math.max(...[...weightedDegree.values()], 1)
  const maxMessageCount = Math.max(
    ...involvedMemberIds.map((memberId) => memberInfoById.get(memberId)?.messageCount || 0),
    1
  )

  const displayNames = uniqueDisplayNames(
    involvedMemberIds,
    new Map(
      [...memberInfoById.entries()].map(([id, info]) => [id, { name: info.name, platformId: info.platformId }])
    )
  )

  const { nodeToCommunity, communities } = runWeightedLabelPropagation(
    involvedMemberIds,
    keptEdges.map((edge) => ({
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      weight: edge.score,
    }))
  )

  const communitySize = new Map<number, number>()
  for (const [_, categoryId] of nodeToCommunity.entries()) {
    communitySize.set(categoryId, (communitySize.get(categoryId) || 0) + 1)
  }

  const nodes: RelationshipGraphNode[] = involvedMemberIds
    .map((memberId) => {
      const info = memberInfoById.get(memberId)
      if (!info) return null
      const degree = weightedDegree.get(memberId) || 0
      const degreeNorm = degree / maxWeightedDegree
      const messageNorm = info.messageCount / maxMessageCount
      const symbolSize = 20 + (0.65 * degreeNorm + 0.35 * messageNorm) * 38
      const category = nodeToCommunity.get(memberId) || 0
      return {
        id: memberId,
        name: displayNames.get(memberId) || info.name,
        value: roundNumber(degree, 4),
        symbolSize: Math.round(symbolSize),
        category,
        messageCount: info.messageCount,
        weightedDegree: roundNumber(degree, 4),
        totalMentions: totalMentionsByMember.get(memberId) || 0,
        communitySize: communitySize.get(category) || 1,
      }
    })
    .filter((item): item is RelationshipGraphNode => item !== null)
    .sort((a, b) => b.weightedDegree - a.weightedDegree)

  const links: RelationshipGraphLink[] = keptEdges.map((edge) => ({
    source: displayNames.get(edge.sourceId) || String(edge.sourceId),
    target: displayNames.get(edge.targetId) || String(edge.targetId),
    value: roundNumber(edge.score, 4),
    mentionCount: edge.mentionCount,
    temporalTurns: edge.temporalTurns,
    temporalScore: roundNumber(edge.temporalScore, 4),
    reciprocity: roundNumber(edge.reciprocity, 4),
    avgDeltaSec: edge.avgDeltaSec === null ? null : roundNumber(edge.avgDeltaSec, 2),
  }))

  return {
    nodes,
    links,
    maxLinkValue: roundNumber(maxEdgeScore, 4),
    communities: communities.map((community) => ({
      id: community.id,
      name: community.name,
      size: community.size,
    })),
    stats: {
      totalMembers: members.length,
      involvedMembers: involvedMemberIds.length,
      rawEdgeCount: scopedEdges.length,
      keptEdges: keptEdges.length,
      maxMentionCount,
      maxTemporalScore: roundNumber(maxTemporalScore, 4),
    },
    options: normalizedOptions,
  }
}

// ==================== 含笑量分析 ====================

/**
 * 将关键词转换为正则表达式模式
 */
function keywordToPattern(keyword: string): string {
  // 转义特殊字符
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  // 特殊处理一些关键词的变体
  if (keyword === '哈哈') {
    return '哈哈+'
  }

  return escaped
}

/**
 * 获取含笑量分析数据
 * @param sessionId 会话ID
 * @param filter 时间过滤
 * @param keywords 自定义关键词列表（可选，默认使用内置列表）
 */
export function getLaughAnalysis(sessionId: string, filter?: TimeFilter, keywords?: string[]): any {
  const db = openDatabase(sessionId)
  const emptyResult = {
    rankByRate: [],
    rankByCount: [],
    typeDistribution: [],
    totalLaughs: 0,
    totalMessages: 0,
    groupLaughRate: 0,
  }

  if (!db) return emptyResult

  // 使用传入的关键词或默认关键词
  const laughKeywords = keywords && keywords.length > 0 ? keywords : []

  // 构建正则表达式
  const patterns = laughKeywords.map(keywordToPattern)
  const laughRegex = new RegExp(`(${patterns.join('|')})`, 'gi')

  // 查询所有消息
  const { clause, params } = buildTimeFilter(filter)

  let whereClause = clause
  if (whereClause.includes('WHERE')) {
    whereClause += " AND COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL"
  } else {
    whereClause = " WHERE COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL"
  }

  const messages = db
    .prepare(
      `
      SELECT
        msg.sender_id as senderId,
        msg.content,
        m.platform_id as platformId,
        COALESCE(m.group_nickname, m.account_name, m.platform_id) as name
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
      ${whereClause}
    `
    )
    .all(...params) as Array<{
    senderId: number
    content: string
    platformId: string
    name: string
  }>

  if (messages.length === 0) return emptyResult

  // 统计数据
  const memberStats = new Map<
    number,
    {
      platformId: string
      name: string
      laughCount: number
      messageCount: number
      keywordCounts: Map<string, number> // 每个关键词的计数
    }
  >()
  const typeCount = new Map<string, number>()
  let totalLaughs = 0

  for (const msg of messages) {
    // 初始化成员统计
    if (!memberStats.has(msg.senderId)) {
      memberStats.set(msg.senderId, {
        platformId: msg.platformId,
        name: msg.name,
        laughCount: 0,
        messageCount: 0,
        keywordCounts: new Map(),
      })
    }

    const stats = memberStats.get(msg.senderId)!
    stats.messageCount++

    // 匹配笑声关键词
    const matches = msg.content.match(laughRegex)
    if (matches) {
      stats.laughCount += matches.length
      totalLaughs += matches.length

      // 统计类型分布
      for (const match of matches) {
        // 归类到对应的关键词类型
        let matchedType = '其他'
        for (const keyword of laughKeywords) {
          const pattern = new RegExp(`^${keywordToPattern(keyword)}$`, 'i')
          if (pattern.test(match)) {
            matchedType = keyword
            break
          }
        }
        typeCount.set(matchedType, (typeCount.get(matchedType) || 0) + 1)
        // 记录到成员的关键词计数
        stats.keywordCounts.set(matchedType, (stats.keywordCounts.get(matchedType) || 0) + 1)
      }
    }
  }

  const totalMessages = messages.length

  if (totalLaughs === 0) return emptyResult

  // 构建排行榜
  const rankItems: any[] = []
  for (const [memberId, stats] of memberStats.entries()) {
    if (stats.laughCount > 0) {
      // 构建该成员的关键词分布（按原始关键词顺序）
      const keywordDistribution: Array<{ keyword: string; count: number; percentage: number }> = []
      for (const keyword of laughKeywords) {
        const count = stats.keywordCounts.get(keyword) || 0
        if (count > 0) {
          keywordDistribution.push({
            keyword,
            count,
            percentage: Math.round((count / stats.laughCount) * 10000) / 100,
          })
        }
      }
      // 处理"其他"类型
      const otherCount = stats.keywordCounts.get('其他') || 0
      if (otherCount > 0) {
        keywordDistribution.push({
          keyword: '其他',
          count: otherCount,
          percentage: Math.round((otherCount / stats.laughCount) * 10000) / 100,
        })
      }

      rankItems.push({
        memberId,
        platformId: stats.platformId,
        name: stats.name,
        laughCount: stats.laughCount,
        messageCount: stats.messageCount,
        laughRate: Math.round((stats.laughCount / stats.messageCount) * 10000) / 100,
        percentage: Math.round((stats.laughCount / totalLaughs) * 10000) / 100,
        keywordDistribution,
      })
    }
  }

  // 按含笑率排序
  const rankByRate = [...rankItems].sort((a, b) => b.laughRate - a.laughRate)
  // 按贡献度（绝对数量）排序
  const rankByCount = [...rankItems].sort((a, b) => b.laughCount - a.laughCount)

  // 构建类型分布
  const typeDistribution: any[] = []
  for (const [type, count] of typeCount.entries()) {
    typeDistribution.push({
      type,
      count,
      percentage: Math.round((count / totalLaughs) * 10000) / 100,
    })
  }
  typeDistribution.sort((a, b) => b.count - a.count)

  return {
    rankByRate,
    rankByCount,
    typeDistribution,
    totalLaughs,
    totalMessages,
    groupLaughRate: Math.round((totalLaughs / totalMessages) * 10000) / 100,
  }
}
