/**
 * 活跃度分析模块
 * 包含：夜猫分析、龙王分析、潜水分析、打卡分析
 */

import { openDatabase, buildTimeFilter, buildSystemMessageFilter, type TimeFilter } from '../../core'

// ==================== 夜猫分析 ====================

/**
 * 根据深夜发言数获取称号
 */
function getNightOwlTitleByCount(count: number): string {
  if (count === 0) return '养生达人'
  if (count <= 20) return '偶尔失眠'
  if (count <= 50) return '经常失眠'
  if (count <= 100) return '夜猫子'
  if (count <= 200) return '秃头预备役'
  if (count <= 500) return '修仙练习生'
  return '守夜冠军'
}

/**
 * 将时间戳转换为"调整后的日期"（以凌晨5点为界）
 */
function getAdjustedDate(ts: number): string {
  const date = new Date(ts * 1000)
  const hour = date.getHours()

  if (hour < 5) {
    date.setDate(date.getDate() - 1)
  }

  return date.toISOString().split('T')[0]
}

/**
 * 格式化分钟数为 HH:MM
 */
function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
}

/**
 * 获取夜猫分析数据
 */
export function getNightOwlAnalysis(sessionId: string, filter?: TimeFilter): any {
  const db = openDatabase(sessionId)
  const emptyResult = {
    nightOwlRank: [],
    lastSpeakerRank: [],
    firstSpeakerRank: [],
    consecutiveRecords: [],
    champions: [],
    totalDays: 0,
  }

  if (!db) return emptyResult

  const { clause, params } = buildTimeFilter(filter)
  const clauseWithSystem = buildSystemMessageFilter(clause)

  const messages = db
    .prepare(
      `
        SELECT
          msg.id,
          msg.sender_id as senderId,
          msg.ts,
          m.platform_id as platformId,
          COALESCE(m.group_nickname, m.account_name, m.platform_id) as name
        FROM message msg
        JOIN member m ON msg.sender_id = m.id
        ${clauseWithSystem}
        ORDER BY msg.ts ASC
      `
    )
    .all(...params) as Array<{
    id: number
    senderId: number
    ts: number
    platformId: string
    name: string
  }>

  if (messages.length === 0) return emptyResult

  const memberInfo = new Map<number, { platformId: string; name: string }>()
  const nightStats = new Map<
    number,
    {
      total: number
      h23: number
      h0: number
      h1: number
      h2: number
      h3to4: number
      totalMessages: number
    }
  >()
  const dailyMessages = new Map<string, Array<{ senderId: number; ts: number; hour: number; minute: number }>>()
  const memberNightDays = new Map<number, Set<string>>()

  for (const msg of messages) {
    if (!memberInfo.has(msg.senderId)) {
      memberInfo.set(msg.senderId, { platformId: msg.platformId, name: msg.name })
    }

    const date = new Date(msg.ts * 1000)
    const hour = date.getHours()
    const minute = date.getMinutes()
    const adjustedDate = getAdjustedDate(msg.ts)

    if (!nightStats.has(msg.senderId)) {
      nightStats.set(msg.senderId, { total: 0, h23: 0, h0: 0, h1: 0, h2: 0, h3to4: 0, totalMessages: 0 })
    }
    const stats = nightStats.get(msg.senderId)!
    stats.totalMessages++

    if (hour === 23) {
      stats.h23++
      stats.total++
    } else if (hour === 0) {
      stats.h0++
      stats.total++
    } else if (hour === 1) {
      stats.h1++
      stats.total++
    } else if (hour === 2) {
      stats.h2++
      stats.total++
    } else if (hour >= 3 && hour < 5) {
      stats.h3to4++
      stats.total++
    }

    if (hour >= 23 || hour < 5) {
      if (!memberNightDays.has(msg.senderId)) {
        memberNightDays.set(msg.senderId, new Set())
      }
      memberNightDays.get(msg.senderId)!.add(adjustedDate)
    }

    if (!dailyMessages.has(adjustedDate)) {
      dailyMessages.set(adjustedDate, [])
    }
    dailyMessages.get(adjustedDate)!.push({ senderId: msg.senderId, ts: msg.ts, hour, minute })
  }

  const totalDays = dailyMessages.size

  // 构建修仙排行榜
  const nightOwlRank: any[] = []
  for (const [memberId, stats] of nightStats.entries()) {
    if (stats.total === 0) continue
    const info = memberInfo.get(memberId)!
    nightOwlRank.push({
      memberId,
      platformId: info.platformId,
      name: info.name,
      totalNightMessages: stats.total,
      title: getNightOwlTitleByCount(stats.total),
      hourlyBreakdown: {
        h23: stats.h23,
        h0: stats.h0,
        h1: stats.h1,
        h2: stats.h2,
        h3to4: stats.h3to4,
      },
      percentage: stats.totalMessages > 0 ? Math.round((stats.total / stats.totalMessages) * 10000) / 100 : 0,
    })
  }
  nightOwlRank.sort((a, b) => b.totalNightMessages - a.totalNightMessages)

  // 最晚/最早发言
  const lastSpeakerStats = new Map<number, { count: number; times: number[] }>()
  const firstSpeakerStats = new Map<number, { count: number; times: number[] }>()

  for (const [, dayMessages] of dailyMessages.entries()) {
    if (dayMessages.length === 0) continue

    const lastMsg = dayMessages[dayMessages.length - 1]
    if (!lastSpeakerStats.has(lastMsg.senderId)) {
      lastSpeakerStats.set(lastMsg.senderId, { count: 0, times: [] })
    }
    const lastStats = lastSpeakerStats.get(lastMsg.senderId)!
    lastStats.count++
    lastStats.times.push(lastMsg.hour * 60 + lastMsg.minute)

    const firstMsg = dayMessages[0]
    if (!firstSpeakerStats.has(firstMsg.senderId)) {
      firstSpeakerStats.set(firstMsg.senderId, { count: 0, times: [] })
    }
    const firstStats = firstSpeakerStats.get(firstMsg.senderId)!
    firstStats.count++
    firstStats.times.push(firstMsg.hour * 60 + firstMsg.minute)
  }

  // 构建排行
  const lastSpeakerRank: any[] = []
  for (const [memberId, stats] of lastSpeakerStats.entries()) {
    const info = memberInfo.get(memberId)!
    const avgMinutes = stats.times.reduce((a, b) => a + b, 0) / stats.times.length
    const maxMinutes = Math.max(...stats.times)
    lastSpeakerRank.push({
      memberId,
      platformId: info.platformId,
      name: info.name,
      count: stats.count,
      avgTime: formatMinutes(avgMinutes),
      extremeTime: formatMinutes(maxMinutes),
      percentage: totalDays > 0 ? Math.round((stats.count / totalDays) * 10000) / 100 : 0,
    })
  }
  lastSpeakerRank.sort((a, b) => b.count - a.count)

  const firstSpeakerRank: any[] = []
  for (const [memberId, stats] of firstSpeakerStats.entries()) {
    const info = memberInfo.get(memberId)!
    const avgMinutes = stats.times.reduce((a, b) => a + b, 0) / stats.times.length
    const minMinutes = Math.min(...stats.times)
    firstSpeakerRank.push({
      memberId,
      platformId: info.platformId,
      name: info.name,
      count: stats.count,
      avgTime: formatMinutes(avgMinutes),
      extremeTime: formatMinutes(minMinutes),
      percentage: totalDays > 0 ? Math.round((stats.count / totalDays) * 10000) / 100 : 0,
    })
  }
  firstSpeakerRank.sort((a, b) => b.count - a.count)

  // 连续修仙天数
  const consecutiveRecords: any[] = []

  for (const [memberId, nightDaysSet] of memberNightDays.entries()) {
    if (nightDaysSet.size === 0) continue

    const info = memberInfo.get(memberId)!
    const sortedDays = Array.from(nightDaysSet).sort()

    let maxStreak = 1
    let currentStreak = 1

    for (let i = 1; i < sortedDays.length; i++) {
      const prevDate = new Date(sortedDays[i - 1])
      const currDate = new Date(sortedDays[i])
      const diffDays = (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24)

      if (diffDays === 1) {
        currentStreak++
        maxStreak = Math.max(maxStreak, currentStreak)
      } else {
        currentStreak = 1
      }
    }

    const lastDay = sortedDays[sortedDays.length - 1]
    const today = new Date().toISOString().split('T')[0]
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
    const isCurrentStreak = lastDay === today || lastDay === yesterday

    consecutiveRecords.push({
      memberId,
      platformId: info.platformId,
      name: info.name,
      maxConsecutiveDays: maxStreak,
      currentStreak: isCurrentStreak ? currentStreak : 0,
    })
  }
  consecutiveRecords.sort((a, b) => b.maxConsecutiveDays - a.maxConsecutiveDays)

  // 综合排名
  const championScores = new Map<number, { nightMessages: number; lastSpeakerCount: number; consecutiveDays: number }>()

  for (const item of nightOwlRank) {
    if (!championScores.has(item.memberId)) {
      championScores.set(item.memberId, { nightMessages: 0, lastSpeakerCount: 0, consecutiveDays: 0 })
    }
    championScores.get(item.memberId)!.nightMessages = item.totalNightMessages
  }

  for (const item of lastSpeakerRank) {
    if (!championScores.has(item.memberId)) {
      championScores.set(item.memberId, { nightMessages: 0, lastSpeakerCount: 0, consecutiveDays: 0 })
    }
    championScores.get(item.memberId)!.lastSpeakerCount = item.count
  }

  for (const item of consecutiveRecords) {
    if (!championScores.has(item.memberId)) {
      championScores.set(item.memberId, { nightMessages: 0, lastSpeakerCount: 0, consecutiveDays: 0 })
    }
    championScores.get(item.memberId)!.consecutiveDays = item.maxConsecutiveDays
  }

  const champions: any[] = []
  for (const [memberId, scores] of championScores.entries()) {
    const info = memberInfo.get(memberId)!
    const score = scores.nightMessages * 1 + scores.lastSpeakerCount * 10 + scores.consecutiveDays * 20
    if (score > 0) {
      champions.push({
        memberId,
        platformId: info.platformId,
        name: info.name,
        score,
        nightMessages: scores.nightMessages,
        lastSpeakerCount: scores.lastSpeakerCount,
        consecutiveDays: scores.consecutiveDays,
      })
    }
  }
  champions.sort((a, b) => b.score - a.score)

  return {
    nightOwlRank,
    lastSpeakerRank,
    firstSpeakerRank,
    consecutiveRecords,
    champions,
    totalDays,
  }
}

// ==================== 龙王分析 ====================

/**
 * 获取龙王排名
 */
export function getDragonKingAnalysis(sessionId: string, filter?: TimeFilter): any {
  const db = openDatabase(sessionId)
  const emptyResult = { rank: [], totalDays: 0 }

  if (!db) return emptyResult

  const { clause, params } = buildTimeFilter(filter)
  const clauseWithSystem = buildSystemMessageFilter(clause)

  const dailyTopSpeakers = db
    .prepare(
      `
        WITH daily_counts AS (
          SELECT
            strftime('%Y-%m-%d', msg.ts, 'unixepoch', 'localtime') as date,
            msg.sender_id,
            m.platform_id,
            COALESCE(m.group_nickname, m.account_name, m.platform_id) as name,
            COUNT(*) as msg_count
          FROM message msg
          JOIN member m ON msg.sender_id = m.id
          ${clauseWithSystem}
          GROUP BY date, msg.sender_id
        ),
        daily_max AS (
          SELECT date, MAX(msg_count) as max_count
          FROM daily_counts
          GROUP BY date
        )
        SELECT dc.sender_id, dc.platform_id, dc.name, COUNT(*) as dragon_days
        FROM daily_counts dc
        JOIN daily_max dm ON dc.date = dm.date AND dc.msg_count = dm.max_count
        GROUP BY dc.sender_id
        ORDER BY dragon_days DESC
      `
    )
    .all(...params) as Array<{
    sender_id: number
    platform_id: string
    name: string
    dragon_days: number
  }>

  const totalDaysRow = db
    .prepare(
      `
        SELECT COUNT(DISTINCT strftime('%Y-%m-%d', msg.ts, 'unixepoch', 'localtime')) as total
        FROM message msg
        JOIN member m ON msg.sender_id = m.id
        ${clauseWithSystem}
      `
    )
    .get(...params) as { total: number }

  const totalDays = totalDaysRow.total

  const rank = dailyTopSpeakers.map((item) => ({
    memberId: item.sender_id,
    platformId: item.platform_id,
    name: item.name,
    count: item.dragon_days,
    percentage: totalDays > 0 ? Math.round((item.dragon_days / totalDays) * 10000) / 100 : 0,
  }))

  return { rank, totalDays }
}

// ==================== 潜水分析 ====================

/**
 * 获取潜水排名
 */
export function getDivingAnalysis(sessionId: string, filter?: TimeFilter): any {
  const db = openDatabase(sessionId)
  const emptyResult = { rank: [] }

  if (!db) return emptyResult

  const { clause, params } = buildTimeFilter(filter)
  const clauseWithSystem = buildSystemMessageFilter(clause)

  const lastMessages = db
    .prepare(
      `
        SELECT
          m.id as member_id,
          m.platform_id,
          COALESCE(m.group_nickname, m.account_name, m.platform_id) as name,
          MAX(msg.ts) as last_ts
        FROM member m
        JOIN message msg ON m.id = msg.sender_id
        ${clauseWithSystem.replace('msg.', 'msg.')}
        GROUP BY m.id
        ORDER BY last_ts ASC
      `
    )
    .all(...params) as Array<{
    member_id: number
    platform_id: string
    name: string
    last_ts: number
  }>

  const now = Math.floor(Date.now() / 1000)

  const rank = lastMessages.map((item) => ({
    memberId: item.member_id,
    platformId: item.platform_id,
    name: item.name,
    lastMessageTs: item.last_ts,
    daysSinceLastMessage: Math.floor((now - item.last_ts) / 86400),
  }))

  return { rank }
}

// ==================== 打卡分析 ====================

/**
 * 获取打卡分析数据（火花榜 + 忠臣榜）
 */
export function getCheckInAnalysis(sessionId: string, filter?: TimeFilter): any {
  const db = openDatabase(sessionId)
  const emptyResult = {
    streakRank: [],
    loyaltyRank: [],
    totalDays: 0,
  }

  if (!db) return emptyResult

  const { clause, params } = buildTimeFilter(filter)
  const whereClause = buildSystemMessageFilter(clause)

  // 1. 获取每个成员每天是否发言的数据
  // 检查时间戳格式：如果 ts > 1e12 则是毫秒，否则是秒
  const sampleTs = db.prepare(`SELECT ts FROM message LIMIT 1`).get() as { ts: number } | undefined
  const tsIsMillis = sampleTs?.ts && sampleTs.ts > 1e12
  const tsExpr = tsIsMillis ? 'msg.ts / 1000' : 'msg.ts'

  const dailyActivity = db
    .prepare(
      `
      SELECT
        msg.sender_id as senderId,
        COALESCE(m.group_nickname, m.account_name, m.platform_id) as name,
        DATE(${tsExpr}, 'unixepoch', 'localtime') as day
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
      ${whereClause}
      GROUP BY msg.sender_id, day
      ORDER BY msg.sender_id, day
    `
    )
    .all(...params) as Array<{
    senderId: number
    name: string
    day: string
  }>

  if (dailyActivity.length === 0) return emptyResult

  // 2. 获取群聊总天数
  const allDays = new Set(dailyActivity.map((r) => r.day))
  const totalDays = allDays.size

  // 获取最后一天（用于判断当前连续）
  const sortedDays = Array.from(allDays).sort()
  const lastDay = sortedDays[sortedDays.length - 1]

  // 3. 按成员分组
  const memberDays = new Map<number, { name: string; days: Set<string> }>()
  for (const record of dailyActivity) {
    if (!memberDays.has(record.senderId)) {
      memberDays.set(record.senderId, { name: record.name, days: new Set() })
    }
    memberDays.get(record.senderId)!.days.add(record.day)
  }

  // 4. 计算每个成员的连续发言和累计发言
  const streakData: Array<{
    memberId: number
    name: string
    maxStreak: number
    maxStreakStart: string
    maxStreakEnd: string
    currentStreak: number
  }> = []

  const loyaltyData: Array<{
    memberId: number
    name: string
    totalDays: number
  }> = []

  for (const [memberId, data] of memberDays) {
    const sortedMemberDays = Array.from(data.days).sort()
    const totalMemberDays = sortedMemberDays.length

    // 计算最长连续
    let maxStreak = 1
    let maxStreakStart = sortedMemberDays[0]
    let maxStreakEnd = sortedMemberDays[0]

    let currentStreakCount = 1
    let currentStreakStart = sortedMemberDays[0]

    for (let i = 1; i < sortedMemberDays.length; i++) {
      const prevDate = new Date(sortedMemberDays[i - 1])
      const currDate = new Date(sortedMemberDays[i])
      const diffDays = Math.round((currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24))

      if (diffDays === 1) {
        // 连续
        currentStreakCount++
      } else {
        // 中断，检查是否更新最大值
        if (currentStreakCount > maxStreak) {
          maxStreak = currentStreakCount
          maxStreakStart = currentStreakStart
          maxStreakEnd = sortedMemberDays[i - 1]
        }
        currentStreakCount = 1
        currentStreakStart = sortedMemberDays[i]
      }
    }

    // 检查最后一段连续
    if (currentStreakCount > maxStreak) {
      maxStreak = currentStreakCount
      maxStreakStart = currentStreakStart
      maxStreakEnd = sortedMemberDays[sortedMemberDays.length - 1]
    }

    // 计算当前连续（是否以最后一天结束）
    let finalCurrentStreak = 0
    if (sortedMemberDays[sortedMemberDays.length - 1] === lastDay) {
      // 从最后一天往前数
      finalCurrentStreak = 1
      for (let i = sortedMemberDays.length - 2; i >= 0; i--) {
        const currDate = new Date(sortedMemberDays[i + 1])
        const prevDate = new Date(sortedMemberDays[i])
        const diffDays = Math.round((currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24))
        if (diffDays === 1) {
          finalCurrentStreak++
        } else {
          break
        }
      }
    }

    streakData.push({
      memberId,
      name: data.name,
      maxStreak,
      maxStreakStart,
      maxStreakEnd,
      currentStreak: finalCurrentStreak,
    })

    loyaltyData.push({
      memberId,
      name: data.name,
      totalDays: totalMemberDays,
    })
  }

  // 5. 排序
  const streakRank = streakData.sort((a, b) => b.maxStreak - a.maxStreak)

  const sortedLoyalty = loyaltyData.sort((a, b) => b.totalDays - a.totalDays)
  const maxLoyaltyDays = sortedLoyalty.length > 0 ? sortedLoyalty[0].totalDays : 1
  const loyaltyRank = sortedLoyalty.map((item) => ({
    ...item,
    percentage: Math.round((item.totalDays / maxLoyaltyDays) * 100),
  }))

  return {
    streakRank,
    loyaltyRank,
    totalDays,
  }
}
