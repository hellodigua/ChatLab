/**
 * 性能日志模块
 * 实时记录导入过程的性能指标
 */

import * as fs from 'fs'
import * as path from 'path'
import { getDbDir } from './dbCore'

// 状态
let lastLogTime = Date.now()
let lastMessageCount = 0
let currentLogFile: string | null = null

/**
 * 获取性能日志目录
 */
function getLogDir(): string {
  const dbDir = getDbDir()
  const logDir = path.join(path.dirname(dbDir), 'logs')
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true })
  }
  return logDir
}

/**
 * 初始化日志文件（实时写入）
 */
export function initPerfLog(sessionId: string): void {
  try {
    const logDir = getLogDir()
    currentLogFile = path.join(logDir, `import_${sessionId}_${Date.now()}.log`)
    // 写入头部
    fs.writeFileSync(currentLogFile, `=== 导入性能日志 ===\n开始时间: ${new Date().toISOString()}\n\n`, 'utf-8')
    console.log(`[PerfLog] 日志文件: ${currentLogFile}`)
  } catch (e) {
    console.error('[PerfLog] 初始化日志文件失败:', e)
  }
}

/**
 * 实时记录性能日志（每次追加写入文件）
 */
export function logPerf(event: string, messagesProcessed: number, batchSize?: number): void {
  const now = Date.now()
  const duration = now - lastLogTime
  const messagesDelta = messagesProcessed - lastMessageCount
  const speed = duration > 0 ? Math.round((messagesDelta / duration) * 1000) : 0

  // 获取内存使用
  let memory = 0
  try {
    const used = process.memoryUsage()
    memory = Math.round(used.heapUsed / 1024 / 1024)
  } catch {
    // 忽略
  }

  const logLine =
    `[${new Date().toISOString()}] ${event} | ` +
    `消息: ${messagesProcessed.toLocaleString()} | ` +
    `耗时: ${duration}ms | ` +
    `速度: ${speed.toLocaleString()}/秒 | ` +
    `内存: ${memory}MB` +
    (batchSize ? ` | 批次: ${batchSize}` : '') +
    '\n'

  // 控制台输出
  console.log(`[PerfLog] ${logLine.trim()}`)

  // 实时写入文件
  if (currentLogFile) {
    try {
      fs.appendFileSync(currentLogFile, logLine, 'utf-8')
    } catch (e) {
      console.error('[PerfLog] 写入日志失败:', e)
    }
  }

  lastLogTime = now
  lastMessageCount = messagesProcessed
}

/**
 * 追加详细日志（分阶段耗时）
 */
export function logPerfDetail(detail: string): void {
  if (currentLogFile) {
    try {
      fs.appendFileSync(currentLogFile, `  ${detail}\n`, 'utf-8')
    } catch {
      // 忽略
    }
  }
}

/**
 * 重置性能日志状态
 */
export function resetPerfLog(): void {
  lastLogTime = Date.now()
  lastMessageCount = 0
  currentLogFile = null
}

/**
 * 获取当前日志文件路径
 */
export function getCurrentLogFile(): string | null {
  return currentLogFile
}
