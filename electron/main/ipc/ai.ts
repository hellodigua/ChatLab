// electron/main/ipc/ai.ts
import { ipcMain, BrowserWindow, shell } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as aiConversations from '../ai/conversations'
import * as llm from '../ai/llm'
import * as rag from '../ai/rag'
import { aiLogger } from '../ai/logger'
import { getLogsDir } from '../paths'
import { Agent, type AgentStreamChunk, type PromptConfig } from '../ai/agent'
import { t } from '../i18n'
import type { ToolContext } from '../ai/tools/types'
import type { IpcContext } from './types'

// ==================== AI Agent 请求追踪 ====================
// 用于跟踪活跃的 Agent 请求，支持中止操作
const activeAgentRequests = new Map<string, AbortController>()

/**
 * 格式化 AI 报错信息，输出更友好的提示
 */
function formatAIError(error: unknown): string {
  const candidates: unknown[] = []
  if (error) {
    candidates.push(error)
  }

  const errorObj = error as {
    lastError?: unknown
    errors?: unknown[]
  }

  if (errorObj?.lastError) {
    candidates.push(errorObj.lastError)
  }

  if (Array.isArray(errorObj?.errors)) {
    candidates.push(...errorObj.errors)
  }

  let rawMessage = ''
  let statusCode: number | undefined
  let retrySeconds: number | undefined

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') {
      if (!rawMessage && typeof candidate === 'string') {
        rawMessage = candidate
      }
      continue
    }

    const record = candidate as Record<string, unknown>
    if (typeof record.statusCode === 'number') {
      statusCode = record.statusCode
    }

    if (!rawMessage && typeof record.message === 'string') {
      rawMessage = record.message
    }

    if (!rawMessage && record.data && typeof record.data === 'object') {
      const data = record.data as { error?: { message?: string } }
      if (data.error?.message) {
        rawMessage = data.error.message
      }
    }

    if (record.responseBody && typeof record.responseBody === 'string') {
      const responseBody = record.responseBody
      try {
        const parsed = JSON.parse(responseBody) as { error?: { message?: string } }
        if (!rawMessage && parsed.error?.message) {
          rawMessage = parsed.error.message
        }
      } catch {
        if (!rawMessage) {
          rawMessage = responseBody
        }
      }
    }

    if (rawMessage) {
      const retryMatch = rawMessage.match(/retry in ([0-9.]+)s/i)
      if (retryMatch) {
        retrySeconds = Math.ceil(Number(retryMatch[1]))
      }
    }
  }

  const fallbackMessage = rawMessage || String(error)
  const lowerMessage = fallbackMessage.toLowerCase()

  if (statusCode === 429 || lowerMessage.includes('quota') || lowerMessage.includes('resource_exhausted')) {
    return retrySeconds
      ? `Gemini 配额已用尽，请等待 ${retrySeconds} 秒后重试，或更换/升级配额。`
      : 'Gemini 配额已用尽，请稍后重试或更换/升级配额。'
  }

  if (statusCode === 503 || lowerMessage.includes('overloaded') || lowerMessage.includes('unavailable')) {
    return 'Gemini 模型繁忙，请稍后重试。'
  }

  if (fallbackMessage.length > 300) {
    return `${fallbackMessage.slice(0, 300)}...`
  }

  return fallbackMessage
}

export function registerAIHandlers({ win }: IpcContext): void {
  console.log('[IPC] Registering AI handlers...')

  // ==================== AI 对话管理 ====================

  /**
   * 创建新的 AI 对话
   */
  ipcMain.handle(
    'ai:createConversation',
    async (
      _,
      title: string,
      sessionId?: string,
      dataSource?: { type: 'chat' | 'member'; id: string; name?: string }
    ) => {
      try {
        return aiConversations.createConversation(title, sessionId, dataSource)
      } catch (error) {
        console.error('创建 AI 对话失败：', error)
        throw error
      }
    }
  )

  /**
   * 获取所有 AI 对话列表
   */
  ipcMain.handle('ai:getConversations', async (_, sessionId?: string) => {
    try {
      return aiConversations.getConversations(sessionId)
    } catch (error) {
      console.error('获取 AI 对话列表失败：', error)
      return []
    }
  })

  /**
   * 打开当前 AI 日志文件并定位到文件
   */
  ipcMain.handle('ai:showLogFile', async () => {
    try {
      // 优先使用当前已存在的日志文件，避免创建新的空日志
      const existingLogPath = aiLogger.getExistingLogPath()
      if (existingLogPath) {
        shell.showItemInFolder(existingLogPath)
        return { success: true, path: existingLogPath }
      }

      const logDir = path.join(getLogsDir(), 'ai')
      if (!fs.existsSync(logDir)) {
        return { success: false, error: '暂无 AI 日志文件' }
      }

      const logFiles = fs.readdirSync(logDir).filter((name) => name.startsWith('ai_') && name.endsWith('.log'))

      if (logFiles.length === 0) {
        return { success: false, error: '暂无 AI 日志文件' }
      }

      // 选择最近修改的日志文件
      const latestLog = logFiles
        .map((name) => {
          const filePath = path.join(logDir, name)
          const stat = fs.statSync(filePath)
          return { path: filePath, mtimeMs: stat.mtimeMs }
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]

      shell.showItemInFolder(latestLog.path)
      return { success: true, path: latestLog.path }
    } catch (error) {
      console.error('打开 AI 日志文件失败：', error)
      return { success: false, error: String(error) }
    }
  })

  /**
   * 获取单个对话详情
   */
  ipcMain.handle('ai:getConversation', async (_, conversationId: string) => {
    try {
      return aiConversations.getConversation(conversationId)
    } catch (error) {
      console.error('获取 AI 对话详情失败：', error)
      return null
    }
  })

  /**
   * 更新 AI 对话标题
   */
  ipcMain.handle('ai:updateConversationTitle', async (_, conversationId: string, title: string) => {
    try {
      return aiConversations.updateConversationTitle(conversationId, title)
    } catch (error) {
      console.error('更新 AI 对话标题失败：', error)
      return false
    }
  })

  /**
   * 删除 AI 对话
   */
  ipcMain.handle('ai:deleteConversation', async (_, conversationId: string) => {
    try {
      return aiConversations.deleteConversation(conversationId)
    } catch (error) {
      console.error('删除 AI 对话失败：', error)
      return false
    }
  })

  /**
   * 添加 AI 消息
   */
  ipcMain.handle(
    'ai:addMessage',
    async (
      _,
      conversationId: string,
      role: 'user' | 'assistant',
      content: string,
      dataKeywords?: string[],
      dataMessageCount?: number,
      contentBlocks?: aiConversations.ContentBlock[]
    ) => {
      try {
        return aiConversations.addMessage(conversationId, role, content, dataKeywords, dataMessageCount, contentBlocks)
      } catch (error) {
        console.error('添加 AI 消息失败：', error)
        throw error
      }
    }
  )

  /**
   * 获取 AI 对话的所有消息
   */
  ipcMain.handle('ai:getMessages', async (_, conversationId: string) => {
    try {
      return aiConversations.getMessages(conversationId)
    } catch (error) {
      console.error('获取 AI 消息失败：', error)
      return []
    }
  })

  /**
   * 删除 AI 消息
   */
  ipcMain.handle('ai:deleteMessage', async (_, messageId: string) => {
    try {
      return aiConversations.deleteMessage(messageId)
    } catch (error) {
      console.error('删除 AI 消息失败：', error)
      return false
    }
  })

  // ==================== LLM 服务（多配置管理）====================

  /**
   * 获取所有支持的 LLM 提供商
   */
  ipcMain.handle('llm:getProviders', async () => {
    return llm.PROVIDERS
  })

  /**
   * 获取所有配置列表
   */
  ipcMain.handle('llm:getAllConfigs', async () => {
    const configs = llm.getAllConfigs()
    // 返回 API Key
    return configs.map((c) => ({
      ...c,
      apiKeySet: !!c.apiKey,
    }))
  })

  /**
   * 获取当前激活的配置 ID
   */
  ipcMain.handle('llm:getActiveConfigId', async () => {
    const config = llm.getActiveConfig()
    return config?.id || null
  })

  /**
   * 添加新配置
   */
  ipcMain.handle(
    'llm:addConfig',
    async (
      _,
      config: {
        name: string
        provider: llm.LLMProvider
        apiKey: string
        model?: string
        baseUrl?: string
        maxTokens?: number
      }
    ) => {
      try {
        const result = llm.addConfig(config)
        if (result.success && result.config) {
          return {
            success: true,
            config: {
              ...result.config,
              apiKeySet: !!result.config.apiKey,
            },
          }
        }
        return result
      } catch (error) {
        console.error('添加 LLM 配置失败：', error)
        return { success: false, error: String(error) }
      }
    }
  )

  /**
   * 更新配置
   */
  ipcMain.handle(
    'llm:updateConfig',
    async (
      _,
      id: string,
      updates: {
        name?: string
        provider?: llm.LLMProvider
        apiKey?: string
        model?: string
        baseUrl?: string
        maxTokens?: number
      }
    ) => {
      try {
        // 如果 apiKey 为空字符串，表示不更新 API Key
        const cleanUpdates = { ...updates }
        if (cleanUpdates.apiKey === '') {
          delete cleanUpdates.apiKey
        }

        return llm.updateConfig(id, cleanUpdates)
      } catch (error) {
        console.error('更新 LLM 配置失败：', error)
        return { success: false, error: String(error) }
      }
    }
  )

  /**
   * 删除配置
   */
  ipcMain.handle('llm:deleteConfig', async (_, id?: string) => {
    try {
      // 如果没有传 id，删除当前激活的配置
      if (!id) {
        const activeConfig = llm.getActiveConfig()
        if (activeConfig) {
          return llm.deleteConfig(activeConfig.id)
        }
        return { success: false, error: t('llm.noActiveConfig') }
      }
      return llm.deleteConfig(id)
    } catch (error) {
      console.error('删除 LLM 配置失败：', error)
      return { success: false, error: String(error) }
    }
  })

  /**
   * 设置激活的配置
   */
  ipcMain.handle('llm:setActiveConfig', async (_, id: string) => {
    try {
      return llm.setActiveConfig(id)
    } catch (error) {
      console.error('设置激活配置失败：', error)
      return { success: false, error: String(error) }
    }
  })

  /**
   * 验证 API Key（支持自定义 baseUrl 和 model）
   * 返回对象格式：{ success: boolean, error?: string }
   */
  ipcMain.handle(
    'llm:validateApiKey',
    async (_, provider: llm.LLMProvider, apiKey: string, baseUrl?: string, model?: string) => {
      console.log('[LLM:validateApiKey] 开始验证:', { provider, baseUrl, model, apiKeyLength: apiKey?.length })
      try {
        const service = llm.createLLMService({ provider, apiKey, baseUrl, model })
        const result = await service.validateApiKey()
        console.log('[LLM:validateApiKey] 验证结果:', result)
        return { success: result.success, error: result.error }
      } catch (error) {
        console.error('[LLM:validateApiKey] 验证失败：', error)
        // 提取有意义的错误信息
        const errorMessage = error instanceof Error ? error.message : String(error)
        return { success: false, error: errorMessage }
      }
    }
  )

  /**
   * 检查是否已配置 LLM（是否有激活的配置）
   */
  ipcMain.handle('llm:hasConfig', async () => {
    return llm.hasActiveConfig()
  })

  /**
   * 发送 LLM 聊天请求（非流式）
   */
  ipcMain.handle('llm:chat', async (_, messages: llm.ChatMessage[], options?: llm.ChatOptions) => {
    aiLogger.info('IPC', '收到非流式 LLM 请求', {
      messagesCount: messages.length,
      firstMsgRole: messages[0]?.role,
      firstMsgContentLen: messages[0]?.content?.length,
      options,
    })
    try {
      const response = await llm.chat(messages, options)
      aiLogger.info('IPC', '非流式 LLM 请求成功', { responseLength: response.length })
      return { success: true, content: response }
    } catch (error) {
      aiLogger.error('IPC', '非流式 LLM 请求失败', { error: String(error) })
      console.error('LLM 聊天失败：', error)
      return { success: false, error: String(error) }
    }
  })

  /**
   * 发送 LLM 聊天请求（流式）
   * 使用 IPC 事件发送流式数据
   */
  ipcMain.handle(
    'llm:chatStream',
    async (_, requestId: string, messages: llm.ChatMessage[], options?: llm.ChatOptions) => {
      aiLogger.info('IPC', `收到流式聊天请求: ${requestId}`, {
        messagesCount: messages.length,
        options,
      })

      try {
        const generator = llm.chatStream(messages, options)
        aiLogger.info('IPC', `创建流式生成器: ${requestId}`)

        // 异步处理流式响应
        ;(async () => {
          let chunkIndex = 0
          try {
            aiLogger.info('IPC', `开始迭代流式响应: ${requestId}`)
            for await (const chunk of generator) {
              chunkIndex++
              aiLogger.debug('IPC', `发送 chunk #${chunkIndex}: ${requestId}`, {
                contentLength: chunk.content?.length,
                isFinished: chunk.isFinished,
                finishReason: chunk.finishReason,
              })
              win.webContents.send('llm:streamChunk', { requestId, chunk })
            }
            aiLogger.info('IPC', `流式响应完成: ${requestId}`, { totalChunks: chunkIndex })
          } catch (error) {
            aiLogger.error('IPC', `流式响应出错: ${requestId}`, {
              error: String(error),
              chunkIndex,
            })
            win.webContents.send('llm:streamChunk', {
              requestId,
              chunk: { content: '', isFinished: true, finishReason: 'error' },
              error: String(error),
            })
          }
        })()

        return { success: true }
      } catch (error) {
        aiLogger.error('IPC', `创建流式请求失败: ${requestId}`, { error: String(error) })
        console.error('LLM 流式聊天失败：', error)
        return { success: false, error: String(error) }
      }
    }
  )

  // ==================== AI Agent API ====================

  /**
   * 执行 Agent 对话（流式）
   * Agent 会自动调用工具并返回最终结果
   * @param historyMessages 对话历史（可选，用于上下文关联）
   * @param chatType 聊天类型（'group' | 'private'）
   * @param promptConfig 用户自定义提示词配置（可选）
   * @param locale 语言设置（可选，默认 'zh-CN'）
   */
  ipcMain.handle(
    'agent:runStream',
    async (
      _,
      requestId: string,
      userMessage: string,
      context: ToolContext,
      historyMessages?: Array<{ role: 'user' | 'assistant'; content: string }>,
      chatType?: 'group' | 'private',
      promptConfig?: PromptConfig,
      locale?: string
    ) => {
      aiLogger.info('IPC', `收到 Agent 流式请求: ${requestId}`, {
        userMessage: userMessage.slice(0, 100),
        sessionId: context.sessionId,
        historyLength: historyMessages?.length ?? 0,
        chatType: chatType ?? 'group',
        hasPromptConfig: !!promptConfig,
      })

      try {
        // 创建 AbortController 并存储
        const abortController = new AbortController()
        activeAgentRequests.set(requestId, abortController)

        // 转换历史消息格式
        const formattedHistory =
          historyMessages?.map((msg) => ({
            role: msg.role as 'user' | 'assistant',
            content: msg.content,
          })) ?? []

        const agent = new Agent(
          context,
          { abortSignal: abortController.signal },
          formattedHistory,
          chatType ?? 'group',
          promptConfig,
          locale ?? 'zh-CN'
        )

        // 异步执行，通过事件发送流式数据
        ;(async () => {
          try {
            const result = await agent.executeStream(userMessage, (chunk: AgentStreamChunk) => {
              // 如果已中止，不再发送
              if (abortController.signal.aborted) {
                return
              }
              // 减少日志噪音：只在工具调用时记录
              if (chunk.type === 'tool_start' || chunk.type === 'tool_result') {
                aiLogger.debug('IPC', `Agent chunk: ${requestId}`, {
                  type: chunk.type,
                  toolName: chunk.toolName,
                })
              }
              win.webContents.send('agent:streamChunk', { requestId, chunk })
            })

            // 如果已中止，不发送完成信息
            if (abortController.signal.aborted) {
              aiLogger.info('IPC', `Agent 已中止，跳过完成信息: ${requestId}`)
              return
            }

            // 发送完成信息
            win.webContents.send('agent:complete', {
              requestId,
              result: {
                content: result.content,
                toolsUsed: result.toolsUsed,
                toolRounds: result.toolRounds,
                totalUsage: result.totalUsage,
              },
            })

            aiLogger.info('IPC', `Agent 执行完成: ${requestId}`, {
              toolsUsed: result.toolsUsed,
              toolRounds: result.toolRounds,
              contentLength: result.content.length,
              totalUsage: result.totalUsage,
            })
          } catch (error) {
            // 如果是中止错误，不报告为错误
            if (error instanceof Error && error.name === 'AbortError') {
              aiLogger.info('IPC', `Agent 请求已中止: ${requestId}`)
              return
            }
            const friendlyError = formatAIError(error)
            aiLogger.error('IPC', `Agent 执行出错: ${requestId}`, {
              error: String(error),
              friendlyError,
            })
            // 发送错误 chunk
            win.webContents.send('agent:streamChunk', {
              requestId,
              chunk: { type: 'error', error: friendlyError, isFinished: true },
            })
            // 发送完成事件（带错误信息），确保前端 promise 能 resolve
            win.webContents.send('agent:complete', {
              requestId,
              result: {
                content: '',
                toolsUsed: [],
                toolRounds: 0,
                totalUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                error: friendlyError,
              },
            })
          } finally {
            // 清理请求追踪
            activeAgentRequests.delete(requestId)
          }
        })()

        return { success: true }
      } catch (error) {
        aiLogger.error('IPC', `创建 Agent 请求失败: ${requestId}`, { error: String(error) })
        return { success: false, error: String(error) }
      }
    }
  )

  /**
   * 中止 Agent 请求
   */
  ipcMain.handle('agent:abort', async (_, requestId: string) => {
    aiLogger.info('IPC', `收到中止请求: ${requestId}`)

    const abortController = activeAgentRequests.get(requestId)
    if (abortController) {
      abortController.abort()
      activeAgentRequests.delete(requestId)
      aiLogger.info('IPC', `已中止 Agent 请求: ${requestId}`)
      return { success: true }
    } else {
      aiLogger.warn('IPC', `未找到 Agent 请求: ${requestId}`)
      return { success: false, error: '未找到该请求' }
    }
  })

  // ==================== Embedding 多配置管理 ====================

  /**
   * 获取所有 Embedding 配置（展示用，隐藏 apiKey）
   */
  ipcMain.handle('embedding:getAllConfigs', async () => {
    try {
      const configs = rag.getAllEmbeddingConfigs()
      // 隐藏敏感信息
      return configs.map((c) => ({
        ...c,
        apiKey: undefined,
        apiKeySet: !!c.apiKey,
      }))
    } catch (error) {
      aiLogger.error('IPC', '获取 Embedding 配置失败', error)
      return []
    }
  })

  /**
   * 获取单个 Embedding 配置（用于编辑，包含完整信息）
   */
  ipcMain.handle('embedding:getConfig', async (_, id: string) => {
    try {
      return rag.getEmbeddingConfigById(id)
    } catch (error) {
      aiLogger.error('IPC', '获取 Embedding 配置失败', error)
      return null
    }
  })

  /**
   * 获取激活的 Embedding 配置 ID
   */
  ipcMain.handle('embedding:getActiveConfigId', async () => {
    try {
      return rag.getActiveEmbeddingConfigId()
    } catch (error) {
      return null
    }
  })

  /**
   * 检查语义搜索是否启用
   */
  ipcMain.handle('embedding:isEnabled', async () => {
    try {
      return rag.isEmbeddingEnabled()
    } catch (error) {
      return false
    }
  })

  /**
   * 添加 Embedding 配置
   */
  ipcMain.handle(
    'embedding:addConfig',
    async (_, config: Omit<rag.EmbeddingServiceConfig, 'id' | 'createdAt' | 'updatedAt'>) => {
      try {
        aiLogger.info('IPC', '添加 Embedding 配置', { name: config.name, model: config.model })
        const result = rag.addEmbeddingConfig(config)
        if (result.success) {
          await rag.resetEmbeddingService()
        }
        return result
      } catch (error) {
        aiLogger.error('IPC', '添加 Embedding 配置失败', error)
        return { success: false, error: String(error) }
      }
    }
  )

  /**
   * 更新 Embedding 配置
   */
  ipcMain.handle(
    'embedding:updateConfig',
    async (_, id: string, updates: Partial<Omit<rag.EmbeddingServiceConfig, 'id' | 'createdAt' | 'updatedAt'>>) => {
      try {
        aiLogger.info('IPC', '更新 Embedding 配置', { id })
        const result = rag.updateEmbeddingConfig(id, updates)
        if (result.success) {
          await rag.resetEmbeddingService()
        }
        return result
      } catch (error) {
        aiLogger.error('IPC', '更新 Embedding 配置失败', error)
        return { success: false, error: String(error) }
      }
    }
  )

  /**
   * 删除 Embedding 配置
   */
  ipcMain.handle('embedding:deleteConfig', async (_, id: string) => {
    try {
      aiLogger.info('IPC', '删除 Embedding 配置', { id })
      const result = rag.deleteEmbeddingConfig(id)
      if (result.success) {
        await rag.resetEmbeddingService()
      }
      return result
    } catch (error) {
      aiLogger.error('IPC', '删除 Embedding 配置失败', error)
      return { success: false, error: String(error) }
    }
  })

  /**
   * 设置激活的 Embedding 配置
   */
  ipcMain.handle('embedding:setActiveConfig', async (_, id: string) => {
    try {
      aiLogger.info('IPC', '设置激活 Embedding 配置', { id })
      const result = rag.setActiveEmbeddingConfig(id)
      if (result.success) {
        await rag.resetEmbeddingService()
      }
      return result
    } catch (error) {
      aiLogger.error('IPC', '设置激活 Embedding 配置失败', error)
      return { success: false, error: String(error) }
    }
  })

  /**
   * 验证 Embedding 配置
   */
  ipcMain.handle('embedding:validateConfig', async (_, config: rag.EmbeddingServiceConfig) => {
    try {
      return await rag.validateEmbeddingConfig(config)
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // ==================== 向量存储管理 ====================

  /**
   * 获取向量存储统计信息
   */
  ipcMain.handle('rag:getVectorStoreStats', async () => {
    try {
      return await rag.getVectorStoreStats()
    } catch (error) {
      console.error('获取向量存储统计失败：', error)
      return { enabled: false, error: String(error) }
    }
  })

  /**
   * 清空向量存储
   */
  ipcMain.handle('rag:clearVectorStore', async () => {
    try {
      const store = await rag.getVectorStore()
      if (store) {
        await store.clear()
        return { success: true }
      }
      return { success: false, error: '向量存储未启用' }
    } catch (error) {
      console.error('清空向量存储失败：', error)
      return { success: false, error: String(error) }
    }
  })
}
