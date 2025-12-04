/**
 * AI Agent 执行器
 * 处理 Function Calling 循环，支持多轮工具调用
 */

import type { ChatMessage, ChatOptions, ChatStreamChunk, ToolCall } from './llm/types'
import { chatStream, chat } from './llm'
import { getAllToolDefinitions, executeToolCalls } from './tools'
import type { ToolContext } from './tools/types'
import { aiLogger } from './logger'
import { randomUUID } from 'crypto'

// ==================== Fallback 解析器 ====================

/**
 * 从文本内容中提取 <think> 标签内容
 */
function extractThinkingContent(content: string): { thinking: string; cleanContent: string } {
  const thinkRegex = /<think>([\s\S]*?)<\/think>/gi
  let thinking = ''
  let cleanContent = content

  const matches = content.matchAll(thinkRegex)
  for (const match of matches) {
    thinking += match[1].trim() + '\n'
    cleanContent = cleanContent.replace(match[0], '')
  }

  return { thinking: thinking.trim(), cleanContent: cleanContent.trim() }
}

/**
 * 从文本内容中解析 <tool_call> 标签并转换为标准 ToolCall 格式
 */
function parseToolCallTags(content: string): ToolCall[] | null {
  const toolCallRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi
  const toolCalls: ToolCall[] = []

  const matches = content.matchAll(toolCallRegex)
  for (const match of matches) {
    try {
      const jsonStr = match[1].trim()
      const parsed = JSON.parse(jsonStr)

      if (parsed.name && parsed.arguments) {
        toolCalls.push({
          id: `fallback-${randomUUID()}`,
          type: 'function',
          function: {
            name: parsed.name,
            arguments: typeof parsed.arguments === 'string' ? parsed.arguments : JSON.stringify(parsed.arguments),
          },
        })
      }
    } catch (e) {
      aiLogger.warn('Agent', 'Failed to parse tool_call tag', { content: match[1], error: String(e) })
    }
  }

  return toolCalls.length > 0 ? toolCalls : null
}

/**
 * 检测内容是否包含工具调用标签（用于判断是否需要 fallback 解析）
 */
function hasToolCallTags(content: string): boolean {
  return /<tool_call>/i.test(content)
}

/**
 * Agent 配置
 */
export interface AgentConfig {
  /** 最大工具调用轮数（防止无限循环） */
  maxToolRounds?: number
  /** LLM 选项 */
  llmOptions?: ChatOptions
}

/**
 * Agent 流式响应 chunk
 */
export interface AgentStreamChunk {
  /** chunk 类型 */
  type: 'content' | 'tool_start' | 'tool_result' | 'done' | 'error'
  /** 文本内容（type=content 时） */
  content?: string
  /** 工具名称（type=tool_start/tool_result 时） */
  toolName?: string
  /** 工具调用参数（type=tool_start 时） */
  toolParams?: Record<string, unknown>
  /** 工具执行结果（type=tool_result 时） */
  toolResult?: unknown
  /** 错误信息（type=error 时） */
  error?: string
  /** 是否完成 */
  isFinished?: boolean
}

/**
 * Agent 执行结果
 */
export interface AgentResult {
  /** 最终文本响应 */
  content: string
  /** 使用的工具列表 */
  toolsUsed: string[]
  /** 工具调用轮数 */
  toolRounds: number
}

/**
 * 获取系统提示词
 */
function getSystemPrompt(): string {
  const now = new Date()
  const currentDate = now.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  })

  return `你是一个群聊记录分析助手。当前日期是 ${currentDate}。

你可以使用以下工具来获取群聊数据：

1. search_messages - 根据关键词搜索聊天记录，可指定 year/month 筛选时间段，也可指定 sender_id 筛选特定成员的发言
2. get_recent_messages - 获取指定时间段的聊天消息，可指定 year 和 month
3. get_member_stats - 获取成员活跃度统计
4. get_time_stats - 获取时间分布统计
5. get_group_members - 获取群成员列表，包括 id、QQ号、账号名称、群昵称、别名和消息统计
6. get_member_name_history - 获取成员的昵称变更历史，需要先通过 get_group_members 获取成员 ID
7. get_conversation_between - 获取两个成员之间的对话记录，需要先通过 get_group_members 获取两人的成员 ID

成员查询策略：
- 当用户提到特定群成员（如"张三说过什么"、"小明的发言"等）时，应先调用 get_group_members 获取成员列表
- 群成员有三种名称：accountName（QQ原始昵称）、groupNickname（群昵称）、aliases（用户自定义别名）
- 通过 get_group_members 的 search 参数可以模糊搜索这三种名称
- 找到成员后，使用其 id 字段作为 search_messages 的 sender_id 参数来获取该成员的发言

时间处理要求：
- 如果用户提到"X月"但没有指定年份，默认使用当前年份（${now.getFullYear()}年）
- 如果当前月份还没到用户提到的月份，则使用去年
- 例如：现在是${now.getFullYear()}年${now.getMonth() + 1}月，用户问"10月的聊天"应该查询${now.getMonth() + 1 >= 10 ? now.getFullYear() : now.getFullYear() - 1}年10月

根据用户的问题，选择合适的工具获取数据，然后基于数据给出回答。

回答要求：
1. 基于工具返回的数据回答，不要编造信息
2. 如果数据不足以回答问题，请说明
3. 回答要简洁明了，使用 Markdown 格式
4. 可以引用具体的发言作为证据
5. 对于统计数据，可以适当总结趋势和特点`
}

/**
 * Agent 执行器类
 * 处理带 Function Calling 的对话流程
 */
export class Agent {
  private context: ToolContext
  private config: AgentConfig
  private messages: ChatMessage[] = []
  private toolsUsed: string[] = []
  private toolRounds: number = 0

  constructor(context: ToolContext, config: AgentConfig = {}) {
    this.context = context
    this.config = {
      maxToolRounds: config.maxToolRounds ?? 5,
      llmOptions: config.llmOptions ?? { temperature: 0.7, maxTokens: 2048 },
    }
  }

  /**
   * 执行对话（非流式）
   * @param userMessage 用户消息
   */
  async execute(userMessage: string): Promise<AgentResult> {
    aiLogger.info('Agent', '开始执行', { userMessage: userMessage.slice(0, 100) })

    // 初始化消息
    this.messages = [
      { role: 'system', content: getSystemPrompt() },
      { role: 'user', content: userMessage },
    ]
    this.toolsUsed = []
    this.toolRounds = 0

    // 获取所有工具定义
    const tools = await getAllToolDefinitions()
    aiLogger.info('Agent', '可用工具', { count: tools.length, names: tools.map((t) => t.function.name) })

    // 执行循环
    while (this.toolRounds < this.config.maxToolRounds!) {
      const response = await chat(this.messages, {
        ...this.config.llmOptions,
        tools,
      })

      aiLogger.info('Agent', 'LLM 响应', {
        finishReason: response.finishReason,
        hasToolCalls: !!response.tool_calls,
        contentLength: response.content?.length,
      })

      let toolCallsToProcess = response.tool_calls

      // 如果没有标准 tool_calls，尝试 fallback 解析
      if (response.finishReason !== 'tool_calls' || !response.tool_calls) {
        // Fallback: 检查内容中是否有 <tool_call> 标签
        if (hasToolCallTags(response.content)) {
          aiLogger.info('Agent', '检测到 <tool_call> 标签，执行 fallback 解析')

          // 提取 thinking 内容
          const { thinking, cleanContent } = extractThinkingContent(response.content)
          if (thinking) {
            aiLogger.info('Agent', '提取到 thinking 内容', { length: thinking.length })
          }

          // 解析 tool_call 标签
          const fallbackToolCalls = parseToolCallTags(response.content)
          if (fallbackToolCalls && fallbackToolCalls.length > 0) {
            aiLogger.info('Agent', 'Fallback 解析成功', {
              toolCount: fallbackToolCalls.length,
              tools: fallbackToolCalls.map((tc) => tc.function.name),
            })
            toolCallsToProcess = fallbackToolCalls
          } else {
            // 解析失败，返回清理后的内容
            aiLogger.info('Agent', '执行完成', {
              toolsUsed: this.toolsUsed,
              toolRounds: this.toolRounds,
            })
            return {
              content: cleanContent,
              toolsUsed: this.toolsUsed,
              toolRounds: this.toolRounds,
            }
          }
        } else {
          // 没有 tool_call 标签，正常完成
          aiLogger.info('Agent', '执行完成', {
            toolsUsed: this.toolsUsed,
            toolRounds: this.toolRounds,
          })
          return {
            content: response.content,
            toolsUsed: this.toolsUsed,
            toolRounds: this.toolRounds,
          }
        }
      }

      // 处理工具调用
      await this.handleToolCalls(toolCallsToProcess!)
      this.toolRounds++
    }

    // 超过最大轮数，强制让 LLM 总结
    aiLogger.warn('Agent', '达到最大工具调用轮数', { maxRounds: this.config.maxToolRounds })
    this.messages.push({
      role: 'user',
      content: '请根据已获取的信息给出回答，不要再调用工具。',
    })

    const finalResponse = await chat(this.messages, this.config.llmOptions)
    return {
      content: finalResponse.content,
      toolsUsed: this.toolsUsed,
      toolRounds: this.toolRounds,
    }
  }

  /**
   * 执行对话（流式）
   * @param userMessage 用户消息
   * @param onChunk 流式回调
   */
  async executeStream(userMessage: string, onChunk: (chunk: AgentStreamChunk) => void): Promise<AgentResult> {
    aiLogger.info('Agent', '开始流式执行', { userMessage: userMessage.slice(0, 100) })

    // 初始化消息
    this.messages = [
      { role: 'system', content: getSystemPrompt() },
      { role: 'user', content: userMessage },
    ]
    this.toolsUsed = []
    this.toolRounds = 0

    const tools = await getAllToolDefinitions()
    let finalContent = ''

    // 执行循环
    while (this.toolRounds < this.config.maxToolRounds!) {
      let accumulatedContent = ''
      let displayedContent = '' // 已发送给前端的内容
      let toolCalls: ToolCall[] | undefined
      let isBufferingToolCall = false // 是否正在缓冲 tool_call 内容

      // 流式调用 LLM
      for await (const chunk of chatStream(this.messages, {
        ...this.config.llmOptions,
        tools,
      })) {
        if (chunk.content) {
          accumulatedContent += chunk.content

          // 检测是否开始出现 <tool_call> 或 <think> 标签
          // 一旦检测到，停止向前端发送后续内容
          if (!isBufferingToolCall) {
            // 检查累积内容中是否有开始标签
            if (/<tool_call>/i.test(accumulatedContent) || /<think>/i.test(accumulatedContent)) {
              isBufferingToolCall = true
              // 发送标签之前的内容（如果有）
              const tagStart = Math.min(
                accumulatedContent.indexOf('<tool_call>') >= 0 ? accumulatedContent.indexOf('<tool_call>') : Infinity,
                accumulatedContent.indexOf('<think>') >= 0 ? accumulatedContent.indexOf('<think>') : Infinity
              )
              if (tagStart > displayedContent.length) {
                const newContent = accumulatedContent.slice(displayedContent.length, tagStart)
                if (newContent) {
                  onChunk({ type: 'content', content: newContent })
                  displayedContent = accumulatedContent.slice(0, tagStart)
                }
              }
            } else {
              // 正常发送内容
              onChunk({ type: 'content', content: chunk.content })
              displayedContent = accumulatedContent
            }
          }
          // 如果已经在缓冲模式，不发送内容
        }

        if (chunk.tool_calls) {
          toolCalls = chunk.tool_calls
        }

        if (chunk.isFinished) {
          // 如果没有标准 tool_calls，尝试 fallback 解析
          if (chunk.finishReason !== 'tool_calls' || !toolCalls) {
            // Fallback: 检查内容中是否有 <tool_call> 标签
            if (hasToolCallTags(accumulatedContent)) {
              aiLogger.info('Agent', '检测到 <tool_call> 标签，执行 fallback 解析')

              // 提取 thinking 内容
              const { thinking, cleanContent } = extractThinkingContent(accumulatedContent)
              if (thinking) {
                aiLogger.info('Agent', '提取到 thinking 内容', { length: thinking.length })
              }

              // 解析 tool_call 标签
              const fallbackToolCalls = parseToolCallTags(accumulatedContent)
              if (fallbackToolCalls && fallbackToolCalls.length > 0) {
                aiLogger.info('Agent', 'Fallback 解析成功', {
                  toolCount: fallbackToolCalls.length,
                  tools: fallbackToolCalls.map((tc) => tc.function.name),
                })
                toolCalls = fallbackToolCalls
                // 更新累积内容为清理后的内容（移除 think 和 tool_call 标签）
                accumulatedContent = cleanContent.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '').trim()
                // 不返回，继续执行工具调用
              } else {
                // 解析失败，作为普通响应处理（发送清理后的内容）
                const remainingContent = cleanContent.slice(displayedContent.length)
                if (remainingContent) {
                  onChunk({ type: 'content', content: remainingContent })
                }
                finalContent = cleanContent
                onChunk({ type: 'done', isFinished: true })
                return {
                  content: finalContent,
                  toolsUsed: this.toolsUsed,
                  toolRounds: this.toolRounds,
                }
              }
            } else {
              // 没有 tool_call 标签，正常完成
              finalContent = accumulatedContent
              onChunk({ type: 'done', isFinished: true })

              aiLogger.info('Agent', '流式执行完成', {
                toolsUsed: this.toolsUsed,
                toolRounds: this.toolRounds,
              })

              return {
                content: finalContent,
                toolsUsed: this.toolsUsed,
                toolRounds: this.toolRounds,
              }
            }
          }
        }
      }

      // 处理工具调用
      if (toolCalls && toolCalls.length > 0) {
        // 通知前端开始执行工具（包含参数和时间范围）
        for (const tc of toolCalls) {
          let toolParams: Record<string, unknown> | undefined
          try {
            toolParams = JSON.parse(tc.function.arguments || '{}')
            // 对于搜索类工具，添加时间范围信息
            if (
              this.context.timeFilter &&
              (tc.function.name === 'search_messages' || tc.function.name === 'get_recent_messages')
            ) {
              toolParams = {
                ...toolParams,
                _timeFilter: this.context.timeFilter,
              }
            }
          } catch {
            toolParams = undefined
          }
          onChunk({ type: 'tool_start', toolName: tc.function.name, toolParams })
        }

        await this.handleToolCalls(toolCalls, onChunk)
        this.toolRounds++
      }
    }

    // 超过最大轮数
    aiLogger.warn('Agent', '达到最大工具调用轮数', { maxRounds: this.config.maxToolRounds })
    this.messages.push({
      role: 'user',
      content: '请根据已获取的信息给出回答，不要再调用工具。',
    })

    // 最后一轮不带 tools
    for await (const chunk of chatStream(this.messages, this.config.llmOptions)) {
      if (chunk.content) {
        finalContent += chunk.content
        onChunk({ type: 'content', content: chunk.content })
      }
      if (chunk.isFinished) {
        onChunk({ type: 'done', isFinished: true })
      }
    }

    return {
      content: finalContent,
      toolsUsed: this.toolsUsed,
      toolRounds: this.toolRounds,
    }
  }

  /**
   * 处理工具调用
   */
  private async handleToolCalls(toolCalls: ToolCall[], onChunk?: (chunk: AgentStreamChunk) => void): Promise<void> {
    aiLogger.info('Agent', '处理工具调用', {
      tools: toolCalls.map((tc) => tc.function.name),
    })

    // 添加 assistant 消息（包含 tool_calls）
    this.messages.push({
      role: 'assistant',
      content: '',
      tool_calls: toolCalls,
    })

    // 执行工具
    const results = await executeToolCalls(toolCalls, this.context)

    // 添加 tool 消息
    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i]
      const result = results[i]

      this.toolsUsed.push(tc.function.name)

      // 通知前端工具执行结果
      if (onChunk) {
        onChunk({
          type: 'tool_result',
          toolName: tc.function.name,
          toolResult: result.success ? result.result : result.error,
        })
      }

      // 添加工具结果消息
      this.messages.push({
        role: 'tool',
        content: result.success ? JSON.stringify(result.result) : `错误: ${result.error}`,
        tool_call_id: tc.id,
      })

      aiLogger.info('Agent', '工具执行结果', {
        tool: tc.function.name,
        success: result.success,
        resultLength: result.success ? JSON.stringify(result.result).length : result.error?.length,
      })
    }
  }
}

/**
 * 创建 Agent 并执行对话（便捷函数）
 */
export async function runAgent(userMessage: string, context: ToolContext, config?: AgentConfig): Promise<AgentResult> {
  const agent = new Agent(context, config)
  return agent.execute(userMessage)
}

/**
 * 创建 Agent 并流式执行对话（便捷函数）
 */
export async function runAgentStream(
  userMessage: string,
  context: ToolContext,
  onChunk: (chunk: AgentStreamChunk) => void,
  config?: AgentConfig
): Promise<AgentResult> {
  const agent = new Agent(context, config)
  return agent.executeStream(userMessage, onChunk)
}
