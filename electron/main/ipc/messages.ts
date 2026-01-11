/**
 * 聊天记录查询 IPC 处理器
 * 提供通用的消息查询功能：搜索、筛选、上下文、无限滚动等
 */

import { ipcMain } from 'electron'
import type { IpcContext } from './types'
import * as worker from '../worker/workerManager'

export function registerMessagesHandlers({ win }: IpcContext): void {
  console.log('[IPC] Registering Messages handlers...')

  /**
   * 关键词搜索消息
   */
  ipcMain.handle(
    'ai:searchMessages',
    async (
      _,
      sessionId: string,
      keywords: string[],
      filter?: { startTs?: number; endTs?: number },
      limit?: number,
      offset?: number,
      senderId?: number
    ) => {
      try {
        return await worker.searchMessages(sessionId, keywords, filter, limit, offset, senderId)
      } catch (error) {
        console.error('搜索消息失败：', error)
        return { messages: [], total: 0 }
      }
    }
  )

  /**
   * 获取消息上下文
   */
  ipcMain.handle(
    'ai:getMessageContext',
    async (_, sessionId: string, messageIds: number | number[], contextSize?: number) => {
      try {
        return await worker.getMessageContext(sessionId, messageIds, contextSize)
      } catch (error) {
        console.error('获取消息上下文失败：', error)
        return []
      }
    }
  )

  /**
   * 获取最近消息（AI Agent 专用）
   */
  ipcMain.handle(
    'ai:getRecentMessages',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }, limit?: number) => {
      try {
        return await worker.getRecentMessages(sessionId, filter, limit)
      } catch (error) {
        console.error('获取最近消息失败：', error)
        return { messages: [], total: 0 }
      }
    }
  )

  /**
   * 获取所有最近消息（消息查看器专用）
   */
  ipcMain.handle(
    'ai:getAllRecentMessages',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }, limit?: number) => {
      try {
        return await worker.getAllRecentMessages(sessionId, filter, limit)
      } catch (error) {
        console.error('获取所有最近消息失败：', error)
        return { messages: [], total: 0 }
      }
    }
  )

  /**
   * 获取两人之间的对话
   */
  ipcMain.handle(
    'ai:getConversationBetween',
    async (
      _,
      sessionId: string,
      memberId1: number,
      memberId2: number,
      filter?: { startTs?: number; endTs?: number },
      limit?: number
    ) => {
      try {
        return await worker.getConversationBetween(sessionId, memberId1, memberId2, filter, limit)
      } catch (error) {
        console.error('获取对话失败：', error)
        return { messages: [], total: 0, member1Name: '', member2Name: '' }
      }
    }
  )

  /**
   * 获取指定消息之前的 N 条（用于向上无限滚动）
   */
  ipcMain.handle(
    'ai:getMessagesBefore',
    async (
      _,
      sessionId: string,
      beforeId: number,
      limit?: number,
      filter?: { startTs?: number; endTs?: number },
      senderId?: number,
      keywords?: string[]
    ) => {
      try {
        return await worker.getMessagesBefore(sessionId, beforeId, limit, filter, senderId, keywords)
      } catch (error) {
        console.error('获取之前消息失败：', error)
        return { messages: [], hasMore: false }
      }
    }
  )

  /**
   * 获取指定消息之后的 N 条（用于向下无限滚动）
   */
  ipcMain.handle(
    'ai:getMessagesAfter',
    async (
      _,
      sessionId: string,
      afterId: number,
      limit?: number,
      filter?: { startTs?: number; endTs?: number },
      senderId?: number,
      keywords?: string[]
    ) => {
      try {
        return await worker.getMessagesAfter(sessionId, afterId, limit, filter, senderId, keywords)
      } catch (error) {
        console.error('获取之后消息失败：', error)
        return { messages: [], hasMore: false }
      }
    }
  )

  // ==================== 自定义筛选 ====================

  /**
   * 按条件筛选消息并扩充上下文
   */
  ipcMain.handle(
    'ai:filterMessagesWithContext',
    async (
      _,
      sessionId: string,
      keywords?: string[],
      timeFilter?: { startTs: number; endTs: number },
      senderIds?: number[],
      contextSize?: number
    ) => {
      try {
        return await worker.filterMessagesWithContext(sessionId, keywords, timeFilter, senderIds, contextSize)
      } catch (error) {
        console.error('筛选消息失败：', error)
        return { blocks: [], stats: { totalMessages: 0, hitMessages: 0, totalChars: 0 } }
      }
    }
  )

  /**
   * 获取多个会话的完整消息
   */
  ipcMain.handle('ai:getMultipleSessionsMessages', async (_, sessionId: string, chatSessionIds: number[]) => {
    try {
      return await worker.getMultipleSessionsMessages(sessionId, chatSessionIds)
    } catch (error) {
      console.error('获取多个会话消息失败：', error)
      return { blocks: [], stats: { totalMessages: 0, hitMessages: 0, totalChars: 0 } }
    }
  })
}
