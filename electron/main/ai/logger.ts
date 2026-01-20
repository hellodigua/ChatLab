/**
 * AI 日志模块
 * 将 AI 相关操作日志写入本地文件
 */

import * as fs from 'fs'
import * as path from 'path'
import { getLogsDir, ensureDir } from '../paths'

// 日志目录
let LOG_DIR: string | null = null
let LOG_FILE: string | null = null
let logStream: fs.WriteStream | null = null

/**
 * 获取日志目录
 */
function getLogDir(): string {
  if (LOG_DIR) return LOG_DIR
  LOG_DIR = path.join(getLogsDir(), 'ai')
  return LOG_DIR
}

/**
 * 确保日志目录存在
 */
function ensureLogDir(): void {
  const dir = getLogDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/**
 * 获取当前日志文件路径
 * 日志文件名格式：ai_YYYY-MM-DD_HH-mm.log
 */
function getLogFilePath(): string {
  if (LOG_FILE) return LOG_FILE

  ensureLogDir()
  const now = new Date()
  const date = now.toISOString().split('T')[0]
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  LOG_FILE = path.join(getLogDir(), `ai_${date}_${hours}-${minutes}.log`)

  return LOG_FILE
}

/**
 * 获取已存在的日志文件路径（不会创建新文件）
 */
function getExistingLogPath(): string | null {
  if (LOG_FILE && fs.existsSync(LOG_FILE)) {
    return LOG_FILE
  }
  return null
}

/**
 * 获取日志写入流
 */
function getLogStream(): fs.WriteStream {
  if (logStream) return logStream

  const filePath = getLogFilePath()
  logStream = fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf-8' })

  return logStream
}

/**
 * 格式化时间戳
 */
function formatTimestamp(): string {
  return new Date().toISOString()
}

/**
 * 日志级别
 */
type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

/**
 * 写入日志
 * @param level 日志级别
 * @param category 分类
 * @param message 消息
 * @param data 附加数据
 * @param toConsole 是否输出到控制台（默认只有 WARN/ERROR 输出）
 */
function writeLog(level: LogLevel, category: string, message: string, data?: any, toConsole: boolean = false): void {
  const timestamp = formatTimestamp()
  let logLine = `[${timestamp}] [${level}] [${category}] ${message}`

  if (data !== undefined) {
    try {
      const dataStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
      // 限制数据长度，避免日志过大
      const maxLength = 2000
      if (dataStr.length > maxLength) {
        logLine += `\n${dataStr.slice(0, maxLength)}...[截断，共 ${dataStr.length} 字符]`
      } else {
        logLine += `\n${dataStr}`
      }
    } catch {
      logLine += `\n[无法序列化的数据]`
    }
  }

  logLine += '\n'

  // 写入文件
  try {
    const stream = getLogStream()
    stream.write(logLine)
  } catch (error) {
    console.error('[AILogger] 写入日志失败：', error)
  }

  // 只在需要时输出到控制台（WARN/ERROR 或明确指定）
  if (toConsole || level === 'WARN' || level === 'ERROR') {
    console.log(`[AI] ${message}`)
  }
}

/**
 * AI 日志对象
 */
export const aiLogger = {
  debug(category: string, message: string, data?: any) {
    writeLog('DEBUG', category, message, data)
  },

  info(category: string, message: string, data?: any) {
    writeLog('INFO', category, message, data)
  },

  warn(category: string, message: string, data?: any) {
    writeLog('WARN', category, message, data)
  },

  error(category: string, message: string, data?: any) {
    writeLog('ERROR', category, message, data)
  },

  /**
   * 关闭日志流
   */
  close() {
    if (logStream) {
      logStream.end()
      logStream = null
    }
  },

  /**
   * 获取日志文件路径
   */
  getLogPath(): string {
    return getLogFilePath()
  },

  /**
   * 获取已存在的日志文件路径（无日志时返回空）
   */
  getExistingLogPath(): string | null {
    return getExistingLogPath()
  },
}

// 导出便捷函数
export function logAI(message: string, data?: any) {
  aiLogger.info('AI', message, data)
}

export function logLLM(message: string, data?: any) {
  aiLogger.info('LLM', message, data)
}

export function logSearch(message: string, data?: any) {
  aiLogger.info('Search', message, data)
}

export function logRAG(message: string, data?: any) {
  aiLogger.info('RAG', message, data)
}
