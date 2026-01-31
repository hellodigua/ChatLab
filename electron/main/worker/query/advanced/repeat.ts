/**
 * 复读分析 + 口头禅分析模块
 */

import { openDatabase, buildTimeFilter, type TimeFilter } from '../../core'

// ==================== 复读分析 ====================

/**
 * 获取复读分析数据
 */
export function getRepeatAnalysis(sessionId: string, filter?: TimeFilter): any {
  const db = openDatabase(sessionId)
  const emptyResult = {
    originators: [],
    initiators: [],
    breakers: [],
    originatorRates: [],
    initiatorRates: [],
    breakerRates: [],
    chainLengthDistribution: [],
    hotContents: [],
    avgChainLength: 0,
    totalRepeatChains: 0,
  }

  if (!db) return emptyResult

  const { clause, params } = buildTimeFilter(filter)

  let whereClause = clause
  if (whereClause.includes('WHERE')) {
    whereClause +=
      " AND COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL AND TRIM(msg.content) != ''"
  } else {
    whereClause =
      " WHERE COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL AND TRIM(msg.content) != ''"
  }

  const messages = db
    .prepare(
      `
        SELECT
          msg.id,
          msg.sender_id as senderId,
          msg.content,
          msg.ts,
          m.platform_id as platformId,
          COALESCE(m.group_nickname, m.account_name, m.platform_id) as name
        FROM message msg
        JOIN member m ON msg.sender_id = m.id
        ${whereClause}
        ORDER BY msg.ts ASC, msg.id ASC
      `
    )
    .all(...params) as Array<{
    id: number
    senderId: number
    content: string
    ts: number
    platformId: string
    name: string
  }>

  const originatorCount = new Map<number, number>()
  const initiatorCount = new Map<number, number>()
  const breakerCount = new Map<number, number>()
  const memberMessageCount = new Map<number, number>()
  const memberInfo = new Map<number, { platformId: string; name: string }>()
  const chainLengthCount = new Map<number, number>()
  const contentStats = new Map<
    string,
    { count: number; maxChainLength: number; originatorId: number; lastTs: number; firstMessageId: number }
  >()

  let currentContent: string | null = null
  let repeatChain: Array<{ id: number; senderId: number; content: string; ts: number }> = []
  let totalRepeatChains = 0
  let totalChainLength = 0

  const fastestRepeaterStats = new Map<number, { totalDiff: number; count: number }>()

  const processRepeatChain = (
    chain: Array<{ id: number; senderId: number; content: string; ts: number }>,
    breakerId?: number
  ) => {
    if (chain.length < 3) return

    totalRepeatChains++
    const chainLength = chain.length
    totalChainLength += chainLength

    const originatorId = chain[0].senderId
    originatorCount.set(originatorId, (originatorCount.get(originatorId) || 0) + 1)

    const initiatorId = chain[1].senderId
    initiatorCount.set(initiatorId, (initiatorCount.get(initiatorId) || 0) + 1)

    if (breakerId !== undefined) {
      breakerCount.set(breakerId, (breakerCount.get(breakerId) || 0) + 1)
    }

    chainLengthCount.set(chainLength, (chainLengthCount.get(chainLength) || 0) + 1)

    const content = chain[0].content
    const chainTs = chain[0].ts
    const firstMsgId = chain[0].id
    const existing = contentStats.get(content)
    if (existing) {
      existing.count++
      existing.lastTs = Math.max(existing.lastTs, chainTs)
      if (chainLength > existing.maxChainLength) {
        existing.maxChainLength = chainLength
        existing.originatorId = originatorId
        existing.firstMessageId = firstMsgId
      }
    } else {
      contentStats.set(content, {
        count: 1,
        maxChainLength: chainLength,
        originatorId,
        lastTs: chainTs,
        firstMessageId: firstMsgId,
      })
    }

    // 计算反应时间 (Fastest Follower)
    // 从第二个消息开始，计算与前一条消息的时间差
    for (let i = 1; i < chain.length; i++) {
      const currentMsg = chain[i]
      const prevMsg = chain[i - 1]
      const diff = (currentMsg.ts - prevMsg.ts) * 1000 // 毫秒

      // 只统计 20 秒内的复读，排除间隔过久的"伪复读"
      if (diff <= 20 * 1000) {
        if (!fastestRepeaterStats.has(currentMsg.senderId)) {
          fastestRepeaterStats.set(currentMsg.senderId, { totalDiff: 0, count: 0 })
        }
        const stats = fastestRepeaterStats.get(currentMsg.senderId)!
        stats.totalDiff += diff
        stats.count++
      }
    }
  }

  for (const msg of messages) {
    if (!memberInfo.has(msg.senderId)) {
      memberInfo.set(msg.senderId, { platformId: msg.platformId, name: msg.name })
    }

    memberMessageCount.set(msg.senderId, (memberMessageCount.get(msg.senderId) || 0) + 1)

    const content = msg.content.trim()

    if (content === currentContent) {
      const lastSender = repeatChain[repeatChain.length - 1]?.senderId
      if (lastSender !== msg.senderId) {
        repeatChain.push({ id: msg.id, senderId: msg.senderId, content, ts: msg.ts })
      }
    } else {
      processRepeatChain(repeatChain, msg.senderId)

      currentContent = content
      repeatChain = [{ id: msg.id, senderId: msg.senderId, content, ts: msg.ts }]
    }
  }

  processRepeatChain(repeatChain)

  const buildRankList = (countMap: Map<number, number>, total: number): any[] => {
    const items: any[] = []
    for (const [memberId, count] of countMap.entries()) {
      const info = memberInfo.get(memberId)
      if (info) {
        items.push({
          memberId,
          platformId: info.platformId,
          name: info.name,
          count,
          percentage: total > 0 ? Math.round((count / total) * 10000) / 100 : 0,
        })
      }
    }
    return items.sort((a, b) => b.count - a.count)
  }

  const buildRateList = (countMap: Map<number, number>): any[] => {
    const items: any[] = []
    for (const [memberId, count] of countMap.entries()) {
      const info = memberInfo.get(memberId)
      const totalMessages = memberMessageCount.get(memberId) || 0
      if (info && totalMessages > 0) {
        items.push({
          memberId,
          platformId: info.platformId,
          name: info.name,
          count,
          totalMessages,
          rate: Math.round((count / totalMessages) * 10000) / 100,
        })
      }
    }
    return items.sort((a, b) => b.rate - a.rate)
  }

  const buildFastestList = (): any[] => {
    const items: any[] = []
    for (const [memberId, stats] of fastestRepeaterStats.entries()) {
      // 过滤掉偶尔复读的人，至少参与5次复读才统计，避免数据偏差
      if (stats.count < 5) continue

      const info = memberInfo.get(memberId)
      if (info) {
        items.push({
          memberId,
          platformId: info.platformId,
          name: info.name,
          count: stats.count,
          avgTimeDiff: Math.round(stats.totalDiff / stats.count),
        })
      }
    }
    return items.sort((a, b) => a.avgTimeDiff - b.avgTimeDiff) // 越快越好
  }

  const chainLengthDistribution: any[] = []
  for (const [length, count] of chainLengthCount.entries()) {
    chainLengthDistribution.push({ length, count })
  }
  chainLengthDistribution.sort((a, b) => a.length - b.length)

  const hotContents: any[] = []
  for (const [content, stats] of contentStats.entries()) {
    const originatorInfo = memberInfo.get(stats.originatorId)
    hotContents.push({
      content,
      count: stats.count,
      maxChainLength: stats.maxChainLength,
      originatorName: originatorInfo?.name || '未知',
      lastTs: stats.lastTs,
      firstMessageId: stats.firstMessageId,
    })
  }
  hotContents.sort((a, b) => b.maxChainLength - a.maxChainLength)
  const top50HotContents = hotContents.slice(0, 100)

  return {
    originators: buildRankList(originatorCount, totalRepeatChains),
    initiators: buildRankList(initiatorCount, totalRepeatChains),
    breakers: buildRankList(breakerCount, totalRepeatChains),
    fastestRepeaters: buildFastestList(),
    originatorRates: buildRateList(originatorCount),
    initiatorRates: buildRateList(initiatorCount),
    breakerRates: buildRateList(breakerCount),
    chainLengthDistribution,
    hotContents: top50HotContents,
    avgChainLength: totalRepeatChains > 0 ? Math.round((totalChainLength / totalRepeatChains) * 100) / 100 : 0,
    totalRepeatChains,
  }
}

// ==================== 口头禅分析 ====================

/**
 * 获取口头禅分析数据
 */
export function getCatchphraseAnalysis(sessionId: string, filter?: TimeFilter): any {
  const db = openDatabase(sessionId)
  if (!db) return { members: [] }

  const { clause, params } = buildTimeFilter(filter)

  let whereClause = clause
  if (whereClause.includes('WHERE')) {
    whereClause +=
      " AND COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL AND LENGTH(TRIM(msg.content)) >= 2"
  } else {
    whereClause =
      " WHERE COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL AND LENGTH(TRIM(msg.content)) >= 2"
  }

  const rows = db
    .prepare(
      `
        SELECT
          m.id as memberId,
          m.platform_id as platformId,
          COALESCE(m.group_nickname, m.account_name, m.platform_id) as name,
          TRIM(msg.content) as content,
          COUNT(*) as count
        FROM message msg
        JOIN member m ON msg.sender_id = m.id
        ${whereClause}
        GROUP BY m.id, TRIM(msg.content)
        ORDER BY m.id, count DESC
      `
    )
    .all(...params) as Array<{
    memberId: number
    platformId: string
    name: string
    content: string
    count: number
  }>

  const memberMap = new Map<
    number,
    {
      memberId: number
      platformId: string
      name: string
      catchphrases: Array<{ content: string; count: number }>
    }
  >()

  for (const row of rows) {
    if (!memberMap.has(row.memberId)) {
      memberMap.set(row.memberId, {
        memberId: row.memberId,
        platformId: row.platformId,
        name: row.name,
        catchphrases: [],
      })
    }

    const member = memberMap.get(row.memberId)!
    if (member.catchphrases.length < 10) {
      member.catchphrases.push({
        content: row.content,
        count: row.count,
      })
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
