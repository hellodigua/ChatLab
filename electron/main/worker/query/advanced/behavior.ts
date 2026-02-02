/**
 * 行为分析模块
 * 包含：斗图分析
 */

import { openDatabase, buildTimeFilter, type TimeFilter } from '../../core'

// ==================== 斗图分析 ====================

/**
 * 获取斗图分析数据
 * 斗图定义：至少2人参与，总共发了3张图（图片或表情），中间无文本打断
 */
export function getMemeBattleAnalysis(sessionId: string, filter?: TimeFilter): any {
  const db = openDatabase(sessionId)
  const emptyResult = {
    topBattles: [],
    rankByCount: [],
    rankByImageCount: [],
    totalBattles: 0,
  }

  if (!db) return emptyResult

  const { clause, params } = buildTimeFilter(filter)

  // 排除系统消息 (type=6)
  // 斗图只看图片(1)和表情(5)，其他类型(如文本0, 语音2等)视为打断
  // 我们查询所有非系统消息，在内存中遍历判断
  let whereClause = clause
  if (whereClause.includes('WHERE')) {
    whereClause += ' AND msg.type != 6'
  } else {
    whereClause = ' WHERE msg.type != 6'
  }

  const messages = db
    .prepare(
      `
        SELECT
          msg.sender_id as senderId,
          msg.type,
          msg.ts,
          m.platform_id as platformId,
          COALESCE(m.group_nickname, m.account_name, m.platform_id) as name
        FROM message msg
        JOIN member m ON msg.sender_id = m.id
        ${whereClause}
        ORDER BY msg.ts ASC
      `
    )
    .all(...params) as Array<{
    senderId: number
    type: number
    ts: number
    platformId: string
    name: string
  }>

  const battles: Array<{
    startTime: number
    endTime: number
    msgs: Array<{ senderId: number; name: string; platformId: string }>
  }> = []

  let currentChain: Array<{ senderId: number; name: string; platformId: string; ts: number }> = []

  // 辅助函数：处理当前链
  const processChain = () => {
    if (currentChain.length >= 3) {
      const senders = new Set(currentChain.map((m) => m.senderId))
      if (senders.size >= 2) {
        // 满足条件：至少3张图，至少2人
        battles.push({
          startTime: currentChain[0].ts,
          endTime: currentChain[currentChain.length - 1].ts,
          msgs: currentChain.map(({ senderId, name, platformId }) => ({ senderId, name, platformId })),
        })
      }
    }
    currentChain = []
  }

  for (const msg of messages) {
    // 1=图片, 5=表情
    if (msg.type === 1 || msg.type === 5) {
      currentChain.push({
        senderId: msg.senderId,
        name: msg.name,
        platformId: msg.platformId,
        ts: msg.ts,
      })
    } else {
      // 其他类型消息（文本、语音等）打断斗图
      processChain()
    }
  }
  // 处理最后一条链
  processChain()

  if (battles.length === 0) return emptyResult

  // 1. 史诗级斗图榜（前30）
  const topBattles = battles
    .map((battle) => ({
      startTime: battle.startTime,
      endTime: battle.endTime,
      totalImages: battle.msgs.length,
      participantCount: new Set(battle.msgs.map((m) => m.senderId)).size,
      participants: Object.values(
        battle.msgs.reduce(
          (acc, curr) => {
            if (!acc[curr.senderId]) {
              acc[curr.senderId] = { memberId: curr.senderId, name: curr.name, imageCount: 0 }
            }
            acc[curr.senderId].imageCount++
            return acc
          },
          {} as Record<number, { memberId: number; name: string; imageCount: number }>
        )
      ).sort((a, b) => b.imageCount - a.imageCount),
    }))
    .sort((a, b) => b.totalImages - a.totalImages)
    .slice(0, 30)

  // 2. 统计达人榜
  const memberStats = new Map<
    number,
    {
      memberId: number
      platformId: string
      name: string
      battleCount: number // 参与场次
      imageCount: number // 发图总数
    }
  >()

  for (const battle of battles) {
    const participantsInBattle = new Set<number>()

    for (const msg of battle.msgs) {
      if (!memberStats.has(msg.senderId)) {
        memberStats.set(msg.senderId, {
          memberId: msg.senderId,
          platformId: msg.platformId,
          name: msg.name,
          battleCount: 0,
          imageCount: 0,
        })
      }
      const stats = memberStats.get(msg.senderId)!
      stats.imageCount++
      participantsInBattle.add(msg.senderId)
    }

    // 参与场次+1
    for (const memberId of participantsInBattle) {
      const stats = memberStats.get(memberId)!
      stats.battleCount++
    }
  }

  const allStats = Array.from(memberStats.values())

  // 按参与场次排名
  const rankByCount = [...allStats]
    .sort((a, b) => b.battleCount - a.battleCount)
    .map((item) => ({
      memberId: item.memberId,
      platformId: item.platformId,
      name: item.name,
      count: item.battleCount,
      percentage: battles.length > 0 ? Math.round((item.battleCount / battles.length) * 10000) / 100 : 0,
    }))

  // 按图片总数排名
  const totalBattleImages = battles.reduce((sum, b) => sum + b.msgs.length, 0)
  const rankByImageCount = [...allStats]
    .sort((a, b) => b.imageCount - a.imageCount)
    .map((item) => ({
      memberId: item.memberId,
      platformId: item.platformId,
      name: item.name,
      count: item.imageCount,
      percentage: totalBattleImages > 0 ? Math.round((item.imageCount / totalBattleImages) * 10000) / 100 : 0,
    }))

  return {
    topBattles,
    rankByCount,
    rankByImageCount,
    totalBattles: battles.length,
  }
}
