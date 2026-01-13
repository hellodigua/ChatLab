/**
 * IPC 主入口文件
 * 模块化结构，各功能模块位于 ./ipc/ 目录下
 */
import { BrowserWindow } from 'electron'
import type { IpcContext } from './ipc/types'

// 导入各功能模块
import { registerWindowHandlers } from './ipc/window'
import { registerChatHandlers } from './ipc/chat'
import { registerMergeHandlers, initMergeModule, cleanupTempDbs } from './ipc/merge'
import { registerAIHandlers } from './ipc/ai'
import { registerMessagesHandlers } from './ipc/messages'
import { registerCacheHandlers } from './ipc/cache'
import { registerNetworkHandlers } from './ipc/network'
import { registerAnalyticsHandlers } from './analytics'
// 导入 Worker 模块（用于异步分析查询和流式导入）
import * as worker from './worker/workerManager'

/**
 * 初始化所有 IPC 处理器
 * @param win - 主窗口实例
 */
const mainIpcMain = (win: BrowserWindow) => {
  console.log('[IpcMain] Registering IPC handlers...')

  // 初始化合并模块（清理残留的临时数据库）
  initMergeModule()

  // 初始化 Worker
  try {
    worker.initWorker()
    console.log('[IpcMain] Worker initialized successfully')
  } catch (error) {
    console.error('[IpcMain] Failed to initialize worker:', error)
  }

  const context: IpcContext = { win }

  // 注册各模块的处理器
  registerWindowHandlers(context)
  registerChatHandlers(context)
  registerMergeHandlers(context)
  registerAIHandlers(context)
  registerMessagesHandlers(context)
  registerCacheHandlers(context)
  registerNetworkHandlers(context)
  registerAnalyticsHandlers()

  console.log('[IpcMain] All IPC handlers registered successfully')
}

export const cleanup = () => {
  console.log('[IpcMain] Cleaning up resources...')
  try {
    // 关闭 Worker
    worker.closeWorker()
    // 清理临时数据库
    cleanupTempDbs()
  } catch (error) {
    console.error('[IpcMain] Error during cleanup:', error)
  }
}

export default mainIpcMain
