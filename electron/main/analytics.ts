/**
 * 应用分析模块
 * 使用 Aptabase 进行匿名使用统计
 */

import { app, ipcMain } from 'electron'
import { initialize, trackEvent } from '@aptabase/electron/main'
import * as fs from 'fs'
import * as path from 'path'

// 分析数据存储路径
function getAnalyticsPath(): string {
  return path.join(app.getPath('userData'), 'analytics.json')
}

// 分析数据结构
interface AnalyticsData {
  lastReportDate: string | null
  firstReportDate: string | null // 用于判断新老用户
  enabled: boolean // 是否启用统计
}

// 默认配置
const defaultAnalyticsData: AnalyticsData = {
  lastReportDate: null,
  firstReportDate: null,
  enabled: true, // 默认启用
}

// 读取分析数据
function loadAnalyticsData(): AnalyticsData {
  try {
    const filePath = getAnalyticsPath()
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8')
      return { ...defaultAnalyticsData, ...JSON.parse(data) }
    }
  } catch (error) {
    console.error('[Analytics] 读取分析数据失败:', error)
  }
  return { ...defaultAnalyticsData }
}

// 保存分析数据
function saveAnalyticsData(data: AnalyticsData): void {
  try {
    const filePath = getAnalyticsPath()
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
  } catch (error) {
    console.error('[Analytics] 保存分析数据失败:', error)
  }
}

// 获取今天的日期字符串 (YYYY-MM-DD)
function getTodayString(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/**
 * 检查统计是否启用
 */
export function isAnalyticsEnabled(): boolean {
  return loadAnalyticsData().enabled
}

/**
 * 初始化分析模块
 * 必须在 app.whenReady() 之前调用
 */
export function initAnalytics(): void {
  const appKey = process.env.APTABASE_APP_KEY

  if (!appKey) {
    return
  }

  try {
    initialize(appKey)
    console.log('[Analytics] Aptabase 初始化成功')
  } catch (error) {
    console.error('[Analytics] Aptabase 初始化失败:', error)
  }
}

/**
 * 注册 Analytics IPC 处理器
 */
export function registerAnalyticsHandlers(): void {
  // 获取统计启用状态
  ipcMain.handle('analytics:getEnabled', () => {
    return loadAnalyticsData().enabled
  })

  // 设置统计启用状态
  ipcMain.handle('analytics:setEnabled', (_, enabled: boolean) => {
    const data = loadAnalyticsData()
    data.enabled = enabled
    saveAnalyticsData(data)
    return { success: true }
  })
}

/**
 * 上报每日活跃事件
 */
export function trackDailyActive(): void {
  const appKey = process.env.APTABASE_APP_KEY
  if (!appKey) {
    return
  }

  try {
    const data = loadAnalyticsData()

    // 检查是否启用统计
    if (!data.enabled) {
      return
    }

    const today = getTodayString()
    const isNew = data.firstReportDate === null

    // 新用户记录首次使用日期
    if (isNew) {
      data.firstReportDate = today
    }

    // 检查今天是否已经上报过
    if (data.lastReportDate === today) {
      if (isNew) {
        saveAnalyticsData(data)
      }
      return
    }

    // 上报每日活跃事件
    trackEvent(isNew ? 'app_active_new' : 'app_active')

    data.lastReportDate = today
    saveAnalyticsData(data)
  } catch (error) {
    console.error('[Analytics] 上报每日活跃失败:', error)
  }
}

/**
 * 事件上报
 */
export function trackAppEvent(eventName: string, properties?: Record<string, string | number>): void {
  const appKey = process.env.APTABASE_APP_KEY
  if (!appKey) {
    return
  }

  // 检查是否启用统计
  if (!isAnalyticsEnabled()) {
    return
  }

  try {
    trackEvent(eventName, properties)
  } catch (error) {
    console.error(`[Analytics] 上报事件 ${eventName} 失败:`, error)
  }
}
