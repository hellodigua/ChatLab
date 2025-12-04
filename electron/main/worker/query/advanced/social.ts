/**
 * 社交分析模块
 * 包含：@ 互动分析、含笑量分析
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
    whereClause += " AND COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL AND msg.content LIKE '%@%'"
  } else {
    whereClause = " WHERE COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL AND msg.content LIKE '%@%'"
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

  // 6. 检测单向关注（舔狗检测）
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

