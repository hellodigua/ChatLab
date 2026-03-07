/**
 * Export queries (server-side)
 * Ported from electron/main/worker/query/session/export.ts
 * — no worker_threads, no parentPort.
 *
 * Progress is reported via an optional callback instead of parentPort.
 */

import * as fs from 'fs'
import * as path from 'path'
import { openReadonlyDatabase } from '../db-pool'
import type { ExportFilterParams, ExportProgress } from './types'

/**
 * Export filter results to a Markdown file.
 * Uses streaming write to avoid memory overflow.
 *
 * @param params Export parameters
 * @param onProgress Optional progress callback (replaces parentPort messages)
 */
export function exportFilterResultToFile(
  params: ExportFilterParams,
  onProgress?: (progress: ExportProgress) => void,
): { success: boolean; filePath?: string; error?: string } {
  const db = openReadonlyDatabase(params.sessionId)
  if (!db) return { success: false, error: 'Cannot open database' }

  try {
    const timestamp = Date.now()
    const fileName = `${params.sessionName}_筛选结果_${timestamp}.md`
    const filePath = path.join(params.outputDir, fileName)

    const writeStream = fs.createWriteStream(filePath, { encoding: 'utf8' })
    writeStream.write(`# ${params.sessionName} - 聊天记录筛选结果\n\n`)
    writeStream.write(`> 导出时间: ${new Date().toLocaleString()}\n\n`)
    writeStream.write(`## 筛选条件\n\n`)

    if (params.filterMode === 'condition') {
      if (params.keywords && params.keywords.length > 0) writeStream.write(`- 关键词: ${params.keywords.join(', ')}\n`)
      if (params.timeFilter) {
        writeStream.write(`- 时间范围: ${new Date(params.timeFilter.startTs * 1000).toLocaleString()} ~ ${new Date(params.timeFilter.endTs * 1000).toLocaleString()}\n`)
      }
      writeStream.write(`- 上下文扩展: ±${params.contextSize || 10} 条消息\n`)
    } else {
      writeStream.write(`- 模式: 会话筛选\n`)
      writeStream.write(`- 选中会话数: ${params.chatSessionIds?.length || 0}\n`)
    }
    writeStream.write('\n')

    let totalMessages = 0
    let totalChars = 0
    let blockIndex = 0

    if (params.filterMode === 'condition') {
      const contextSize = params.contextSize || 10
      const lightweightSql = `SELECT id, ts, sender_id as senderId, content FROM message ${params.timeFilter ? 'WHERE ts >= ? AND ts <= ?' : ''} ORDER BY ts ASC, id ASC`
      const sqlParams: unknown[] = []
      if (params.timeFilter) { sqlParams.push(params.timeFilter.startTs, params.timeFilter.endTs) }

      const hitIndexes: number[] = []
      let msgIndex = 0
      const stmt = db.prepare(lightweightSql)
      for (const row of stmt.iterate(...sqlParams) as Iterable<{ id: number; ts: number; senderId: number; content: string | null }>) {
        let isHit = true
        if (params.keywords && params.keywords.length > 0) {
          const content = (row.content || '').toLowerCase()
          isHit = params.keywords.some((kw) => content.includes(kw.toLowerCase()))
        }
        if (isHit && params.senderIds && params.senderIds.length > 0) isHit = params.senderIds.includes(row.senderId)
        if (isHit) hitIndexes.push(msgIndex)
        msgIndex++
      }

      if (hitIndexes.length === 0) {
        writeStream.write(`## 统计信息\n\n- 无匹配结果\n`)
        writeStream.end()
        onProgress?.({ stage: 'done', currentBlock: 0, totalBlocks: 0, percentage: 100, message: '导出完成（无匹配结果）' })
        return { success: true, filePath }
      }

      const ranges: Array<{ start: number; end: number; hitIndexes: number[] }> = []
      const totalMsgCount = msgIndex
      for (const hitIdx of hitIndexes) {
        const start = Math.max(0, hitIdx - contextSize)
        const end = Math.min(totalMsgCount - 1, hitIdx + contextSize)
        if (ranges.length > 0) {
          const lastRange = ranges[ranges.length - 1]
          if (start <= lastRange.end + 1) { lastRange.end = Math.max(lastRange.end, end); lastRange.hitIndexes.push(hitIdx); continue }
        }
        ranges.push({ start, end, hitIndexes: [hitIdx] })
      }

      const totalBlocks = ranges.length
      writeStream.write(`## 统计信息\n\n- 对话块数: ${totalBlocks}\n- 命中消息: ${hitIndexes.length}\n\n## 对话内容\n\n`)

      for (const range of ranges) {
        blockIndex++
        onProgress?.({ stage: 'exporting', currentBlock: blockIndex, totalBlocks, percentage: Math.round(15 + ((blockIndex - 1) / totalBlocks) * 80), message: `正在导出对话块 ${blockIndex}/${totalBlocks}...` })

        const blockSql = `SELECT msg.id, msg.ts, COALESCE(m.group_nickname, m.account_name, m.platform_id) as senderName, msg.content
          FROM message msg JOIN member m ON msg.sender_id = m.id
          ${params.timeFilter ? 'WHERE msg.ts >= ? AND msg.ts <= ?' : ''} ORDER BY msg.ts ASC, msg.id ASC LIMIT ? OFFSET ?`
        const blockParams: unknown[] = []
        if (params.timeFilter) { blockParams.push(params.timeFilter.startTs, params.timeFilter.endTs) }
        blockParams.push(range.end - range.start + 1, range.start)

        const messages = db.prepare(blockSql).all(...blockParams) as Array<{ id: number; ts: number; senderName: string; content: string | null }>
        if (messages.length === 0) continue

        const hitIndexSet = new Set(range.hitIndexes.map((idx) => idx - range.start))
        writeStream.write(`### 对话块 ${blockIndex} (${new Date(messages[0].ts * 1000).toLocaleString()} ~ ${new Date(messages[messages.length - 1].ts * 1000).toLocaleString()})\n\n`)
        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i]
          const hitMark = hitIndexSet.has(i) ? ' ⭐' : ''
          writeStream.write(`${new Date(msg.ts * 1000).toLocaleTimeString()} ${msg.senderName}${hitMark}: ${msg.content || '[非文本消息]'}\n`)
          totalMessages++
          totalChars += (msg.content || '').length
        }
        writeStream.write('\n')
      }
    } else {
      if (!params.chatSessionIds || params.chatSessionIds.length === 0) {
        writeStream.write(`## 统计信息\n\n- 未选择会话\n`)
        writeStream.end()
        return { success: true, filePath }
      }

      const sessionsSql = `SELECT id, start_ts as startTs, end_ts as endTs FROM chat_session WHERE id IN (${params.chatSessionIds.map(() => '?').join(',')}) ORDER BY start_ts ASC`
      const sessions = db.prepare(sessionsSql).all(...params.chatSessionIds) as Array<{ id: number; startTs: number; endTs: number }>
      const totalBlocks = sessions.length
      writeStream.write(`## 统计信息\n\n- 对话块数: ${totalBlocks}\n\n## 对话内容\n\n`)

      for (const session of sessions) {
        blockIndex++
        onProgress?.({ stage: 'exporting', currentBlock: blockIndex, totalBlocks, percentage: Math.round(15 + ((blockIndex - 1) / totalBlocks) * 80), message: `正在导出会话 ${blockIndex}/${totalBlocks}...` })

        const messages = db.prepare(`
          SELECT msg.id, COALESCE(m.group_nickname, m.account_name, m.platform_id) as senderName, msg.content, msg.ts as timestamp
          FROM message_context mc JOIN message msg ON msg.id = mc.message_id JOIN member m ON msg.sender_id = m.id
          WHERE mc.session_id = ? ORDER BY msg.ts ASC
        `).all(session.id) as Array<{ id: number; senderName: string; content: string | null; timestamp: number }>
        if (messages.length === 0) continue

        writeStream.write(`### 对话块 ${blockIndex} (${new Date(session.startTs * 1000).toLocaleString()} ~ ${new Date(session.endTs * 1000).toLocaleString()})\n\n`)
        for (const msg of messages) {
          writeStream.write(`${new Date(msg.timestamp * 1000).toLocaleTimeString()} ${msg.senderName}: ${msg.content || '[非文本消息]'}\n`)
          totalMessages++
          totalChars += (msg.content || '').length
        }
        writeStream.write('\n')
      }
    }

    writeStream.end()
    onProgress?.({ stage: 'done', currentBlock: blockIndex, totalBlocks: blockIndex, percentage: 100, message: `导出完成，共 ${blockIndex} 个对话块` })
    return { success: true, filePath }
  } catch (error) {
    console.error('exportFilterResultToFile error:', error)
    onProgress?.({ stage: 'error', currentBlock: 0, totalBlocks: 0, percentage: 0, message: `导出失败: ${String(error)}` })
    return { success: false, error: String(error) }
  } finally {
    db.close()
  }
}
