/**
 * AI Agent 执行器
 * 处理 Function Calling 循环，支持多轮工具调用
 */

import type { ChatMessage, ChatOptions, ChatStreamChunk, ToolCall } from './llm/types'
import { chatStream, chat } from './llm'
import { getAllToolDefinitions, executeToolCalls } from './tools'
import type { ToolContext, OwnerInfo } from './tools/types'
import { aiLogger } from './logger'
import { randomUUID } from 'crypto'
import { t as i18nT } from '../i18n'

// 思考类标签列表（可按需扩展）
const THINK_TAGS = ['think', 'analysis', 'reasoning', 'reflection', 'thought', 'thinking']
const THINK_START_TAGS = THINK_TAGS.map((tag) => `<${tag}>`)
const TOOL_CALL_START_TAG = '<tool_call>'
const TOOL_CALL_END_TAG = '</tool_call>'

// ==================== Fallback 解析器 ====================

/**
 * 从文本内容中提取思考类标签内容
 */
function extractThinkingContent(content: string): { thinking: string; cleanContent: string } {
  if (!content) {
    return { thinking: '', cleanContent: '' }
  }

  const tagPattern = THINK_TAGS.join('|')
  const thinkRegex = new RegExp(`<(${tagPattern})>([\\s\\S]*?)<\\/\\1>`, 'gi')
  const thinkingParts: string[] = []
  let cleanContent = content

  const matches = content.matchAll(thinkRegex)
  for (const match of matches) {
    const thinkText = match[2].trim()
    if (thinkText) {
      thinkingParts.push(thinkText)
    }
    cleanContent = cleanContent.replace(match[0], '')
  }

  return { thinking: thinkingParts.join('\n').trim(), cleanContent: cleanContent.trim() }
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
 * 清理 <tool_call> 标签内容，避免将工具调用文本展示给用户
 */
function stripToolCallTags(content: string): string {
  return content.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '').trim()
}

type StreamMode = 'text' | 'think' | 'tool_call'

/**
 * 创建流式解析器：将文本按 content/think/tool_call 分流
 */
function createStreamParser(handlers: {
  onText: (text: string) => void
  onThink: (text: string, tag: string) => void
  onThinkStart?: (tag: string) => void
  onThinkEnd?: (tag: string) => void
}): { push: (text: string) => void; flush: () => void } {
  let buffer = ''
  let mode: StreamMode = 'text'
  let currentThinkTag = ''

  const startTags = [...THINK_START_TAGS, TOOL_CALL_START_TAG]
  const startTagsLower = startTags.map((tag) => tag.toLowerCase())
  const toolCallStartLower = TOOL_CALL_START_TAG.toLowerCase()
  const toolCallEndLower = TOOL_CALL_END_TAG.toLowerCase()
  const maxStartTagLength = Math.max(...startTags.map((tag) => tag.length))

  const findNextTagIndex = (lowerBuffer: string): { index: number; tag: string } | null => {
    let hitIndex = -1
    let hitTag = ''
    for (const tag of startTagsLower) {
      const index = lowerBuffer.indexOf(tag)
      if (index !== -1 && (hitIndex === -1 || index < hitIndex)) {
        hitIndex = index
        hitTag = tag
      }
    }
    return hitIndex === -1 ? null : { index: hitIndex, tag: hitTag }
  }

  const emitText = (text: string) => {
    if (text) {
      handlers.onText(text)
    }
  }

  const emitThink = (text: string) => {
    if (text) {
      handlers.onThink(text, currentThinkTag || 'think')
    }
  }

  const processBuffer = () => {
    let safety = 0
    while (buffer && safety < 10000) {
      safety += 1
      if (mode === 'text') {
        const lowerBuffer = buffer.toLowerCase()
        const hit = findNextTagIndex(lowerBuffer)
        if (!hit) {
          // 保留一段尾部，避免标签被截断
          const keepLength = Math.max(1, maxStartTagLength - 1)
          if (buffer.length > keepLength) {
            emitText(buffer.slice(0, buffer.length - keepLength))
            buffer = buffer.slice(buffer.length - keepLength)
          }
          break
        }

        if (hit.index > 0) {
          emitText(buffer.slice(0, hit.index))
          buffer = buffer.slice(hit.index)
        }

        const lowerHead = buffer.toLowerCase()
        if (lowerHead.startsWith(hit.tag)) {
          if (hit.tag === toolCallStartLower) {
            mode = 'tool_call'
            buffer = buffer.slice(TOOL_CALL_START_TAG.length)
            continue
          }

          // 进入思考模式
          currentThinkTag = hit.tag.slice(1, -1)
          mode = 'think'
          handlers.onThinkStart?.(currentThinkTag)
          buffer = buffer.slice(startTags[startTagsLower.indexOf(hit.tag)].length)
          continue
        }

        // 未识别的 < 视为普通文本
        emitText(buffer.slice(0, 1))
        buffer = buffer.slice(1)
        continue
      }

      if (mode === 'think') {
        const endTag = `</${currentThinkTag}>`
        const lowerBuffer = buffer.toLowerCase()
        const endIndex = lowerBuffer.indexOf(endTag)
        if (endIndex === -1) {
          const keepLength = Math.max(1, endTag.length - 1)
          if (buffer.length > keepLength) {
            emitThink(buffer.slice(0, buffer.length - keepLength))
            buffer = buffer.slice(buffer.length - keepLength)
          }
          break
        }

        if (endIndex > 0) {
          emitThink(buffer.slice(0, endIndex))
        }

        buffer = buffer.slice(endIndex + endTag.length)
        mode = 'text'
        handlers.onThinkEnd?.(currentThinkTag)
        currentThinkTag = ''
        continue
      }

      if (mode === 'tool_call') {
        const lowerBuffer = buffer.toLowerCase()
        const endIndex = lowerBuffer.indexOf(toolCallEndLower)
        if (endIndex === -1) {
          const keepLength = Math.max(1, TOOL_CALL_END_TAG.length - 1)
          if (buffer.length > keepLength) {
            buffer = buffer.slice(buffer.length - keepLength)
          }
          break
        }

        buffer = buffer.slice(endIndex + TOOL_CALL_END_TAG.length)
        mode = 'text'
        continue
      }
    }
  }

  return {
    push(text: string) {
      if (!text) return
      buffer += text
      processBuffer()
    },
    flush() {
      if (!buffer) return
      if (mode === 'text') {
        emitText(buffer)
      } else if (mode === 'think') {
        emitThink(buffer)
      }
      buffer = ''
    },
  }
}

/**
 * Agent 配置
 */
export interface AgentConfig {
  /** 最大工具调用轮数（防止无限循环） */
  maxToolRounds?: number
  /** LLM 选项 */
  llmOptions?: ChatOptions
  /** 中止信号，用于取消执行 */
  abortSignal?: AbortSignal
}

/**
 * Token 使用量
 */
export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/**
 * Agent 流式响应 chunk
 */
export interface AgentStreamChunk {
  /** chunk 类型 */
  type: 'content' | 'think' | 'tool_start' | 'tool_result' | 'done' | 'error'
  /** 文本内容（type=content 时） */
  content?: string
  /** 思考标签名称（type=think 时） */
  thinkTag?: string
  /** 思考耗时（毫秒，type=think 时可选） */
  thinkDurationMs?: number
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
  /** Token 使用量（type=done 时返回累计值） */
  usage?: TokenUsage
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
  /** 总 Token 使用量（累计所有 LLM 调用） */
  totalUsage?: TokenUsage
}

// ==================== 提示词配置类型 ====================

/**
 * 用户自定义提示词配置
 */
export interface PromptConfig {
  /** 角色定义（可编辑区） */
  roleDefinition: string
  /** 回答要求（可编辑区） */
  responseRules: string
}

// ==================== 国际化辅助（使用 i18next） ====================

/** 获取 Agent 翻译，根据传入的 locale 参数 */
function agentT(key: string, locale: string, options?: Record<string, unknown>): string {
  return i18nT(key, { lng: locale, ...options })
}

/**
 * 获取系统锁定部分的提示词（策略说明、时间处理等）
 *
 * 注意：工具定义通过 Function Calling 的 tools 参数传递给 LLM，
 * 无需在 System Prompt 中重复描述，以节省 Token。
 *
 * @param chatType 聊天类型 ('group' | 'private')
 * @param ownerInfo Owner 信息（当前用户在对话中的身份）
 * @param locale 语言设置
 */
function getLockedPromptSection(
  chatType: 'group' | 'private',
  ownerInfo?: OwnerInfo,
  locale: string = 'zh-CN'
): string {
  const now = new Date()
  const dateLocale = locale.startsWith('zh') ? 'zh-CN' : 'en-US'
  const currentDate = now.toLocaleDateString(dateLocale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  })

  const isPrivate = chatType === 'private'
  const chatContext = agentT(`ai.agent.chatContext.${chatType}`, locale)

  // Owner 说明（当用户设置了"我是谁"时）
  const ownerNote = ownerInfo
    ? agentT('ai.agent.ownerNote', locale, {
        displayName: ownerInfo.displayName,
        platformId: ownerInfo.platformId,
        chatContext,
      })
    : ''

  // 成员说明（私聊只有2人）
  const memberNote = isPrivate
    ? agentT('ai.agent.memberNotePrivate', locale)
    : agentT('ai.agent.memberNoteGroup', locale)

  const year = now.getFullYear()
  const prevYear = year - 1

  return `${agentT('ai.agent.currentDateIs', locale)} ${currentDate}。
${ownerNote}
${memberNote}
${agentT('ai.agent.timeParamsIntro', locale)}
- ${agentT('ai.agent.timeParamExample1', locale, { year })}
- ${agentT('ai.agent.timeParamExample2', locale, { year })}
- ${agentT('ai.agent.timeParamExample3', locale, { year })}
${agentT('ai.agent.defaultYearNote', locale, { year, prevYear })}

${agentT('ai.agent.responseInstruction', locale)}`
}

/**
 * 获取 Fallback 角色定义（主要配置来自前端 src/config/prompts.ts）
 * 仅在前端未传递 promptConfig 时使用
 */
function getFallbackRoleDefinition(chatType: 'group' | 'private', locale: string = 'zh-CN'): string {
  return agentT(`ai.agent.fallbackRoleDefinition.${chatType}`, locale)
}

/**
 * 获取 Fallback 回答要求（主要配置来自前端 src/config/prompts.ts）
 * 仅在前端未传递 promptConfig 时使用
 */
function getFallbackResponseRules(locale: string = 'zh-CN'): string {
  return agentT('ai.agent.fallbackResponseRules', locale)
}

/**
 * 构建完整的系统提示词
 *
 * 提示词配置主要来自前端 src/config/prompts.ts，通过 promptConfig 参数传递。
 * Fallback 仅在前端未传递配置时使用（一般不会发生）。
 *
 * @param chatType 聊天类型 ('group' | 'private')
 * @param promptConfig 用户自定义提示词配置（来自前端激活的预设）
 * @param ownerInfo Owner 信息（当前用户在对话中的身份）
 * @param locale 语言设置
 */
function buildSystemPrompt(
  chatType: 'group' | 'private' = 'group',
  promptConfig?: PromptConfig,
  ownerInfo?: OwnerInfo,
  locale: string = 'zh-CN'
): string {
  // 使用用户配置或 fallback
  const roleDefinition = promptConfig?.roleDefinition || getFallbackRoleDefinition(chatType, locale)
  const responseRules = promptConfig?.responseRules || getFallbackResponseRules(locale)

  // 获取锁定的系统部分（包含动态日期、工具说明和 Owner 信息）
  const lockedSection = getLockedPromptSection(chatType, ownerInfo, locale)

  // 组合完整提示词
  return `${roleDefinition}

${lockedSection}

${agentT('ai.agent.responseRulesTitle', locale)}
${responseRules}`
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
  private abortSignal?: AbortSignal
  private historyMessages: ChatMessage[] = []
  private chatType: 'group' | 'private' = 'group'
  private promptConfig?: PromptConfig
  private locale: string = 'zh-CN'
  /** 累计 Token 使用量 */
  private totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

  constructor(
    context: ToolContext,
    config: AgentConfig = {},
    historyMessages: ChatMessage[] = [],
    chatType: 'group' | 'private' = 'group',
    promptConfig?: PromptConfig,
    locale: string = 'zh-CN'
  ) {
    this.context = context
    this.abortSignal = config.abortSignal
    this.historyMessages = historyMessages
    this.chatType = chatType
    this.promptConfig = promptConfig
    this.locale = locale
    this.config = {
      maxToolRounds: config.maxToolRounds ?? 5,
      llmOptions: config.llmOptions ?? { temperature: 0.7, maxTokens: 2048 },
    }
  }

  /**
   * 检查是否已中止
   */
  private isAborted(): boolean {
    return this.abortSignal?.aborted ?? false
  }

  /**
   * 累加 Token 使用量
   */
  private addUsage(usage?: { promptTokens: number; completionTokens: number; totalTokens: number }): void {
    if (usage) {
      this.totalUsage.promptTokens += usage.promptTokens
      this.totalUsage.completionTokens += usage.completionTokens
      this.totalUsage.totalTokens += usage.totalTokens
    }
  }

  /**
   * 执行对话（非流式）
   * @param userMessage 用户消息
   */
  async execute(userMessage: string): Promise<AgentResult> {
    aiLogger.info('Agent', '用户问题', userMessage)

    // 检查是否已中止
    if (this.isAborted()) {
      return { content: '', toolsUsed: [], toolRounds: 0, totalUsage: this.totalUsage }
    }

    // 初始化消息（包含历史记录）
    const systemPrompt = buildSystemPrompt(this.chatType, this.promptConfig, this.context.ownerInfo, this.locale)
    this.messages = [
      { role: 'system', content: systemPrompt },
      ...this.historyMessages, // 插入历史对话
      { role: 'user', content: userMessage },
    ]
    this.toolsUsed = []
    this.toolRounds = 0

    // 获取所有工具定义
    const tools = await getAllToolDefinitions()

    // 执行循环
    while (this.toolRounds < this.config.maxToolRounds!) {
      // 每轮开始时检查是否中止
      if (this.isAborted()) {
        return {
          content: '',
          toolsUsed: this.toolsUsed,
          toolRounds: this.toolRounds,
          totalUsage: this.totalUsage,
        }
      }

      const response = await chat(this.messages, {
        ...this.config.llmOptions,
        tools,
        abortSignal: this.abortSignal,
      })

      // 累加 Token 使用量
      this.addUsage(response.usage)

      const { cleanContent } = extractThinkingContent(response.content)
      let toolCallsToProcess = response.tool_calls

      // 如果没有标准 tool_calls，尝试 fallback 解析
      if (response.finishReason !== 'tool_calls' || !response.tool_calls) {
        // Fallback: 检查内容中是否有 <tool_call> 标签
        if (hasToolCallTags(response.content)) {
          // 解析 tool_call 标签
          const fallbackToolCalls = parseToolCallTags(response.content)
          if (fallbackToolCalls && fallbackToolCalls.length > 0) {
            toolCallsToProcess = fallbackToolCalls
          } else {
            // 解析失败，返回清理后的内容
            const sanitizedContent = stripToolCallTags(cleanContent)
            aiLogger.info('Agent', 'AI 回复', sanitizedContent)
            return {
              content: sanitizedContent,
              toolsUsed: this.toolsUsed,
              toolRounds: this.toolRounds,
              totalUsage: this.totalUsage,
            }
          }
        } else {
          // 没有 tool_call 标签，正常完成
          aiLogger.info('Agent', 'AI 回复', cleanContent)
          return {
            content: cleanContent,
            toolsUsed: this.toolsUsed,
            toolRounds: this.toolRounds,
            totalUsage: this.totalUsage,
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
      content: agentT('ai.agent.answerWithoutTools', this.locale),
    })

    const finalResponse = await chat(this.messages, this.config.llmOptions)
    this.addUsage(finalResponse.usage)
    const finalCleanContent = stripToolCallTags(extractThinkingContent(finalResponse.content).cleanContent)
    return {
      content: finalCleanContent,
      toolsUsed: this.toolsUsed,
      toolRounds: this.toolRounds,
      totalUsage: this.totalUsage,
    }
  }

  /**
   * 执行对话（流式）
   * @param userMessage 用户消息
   * @param onChunk 流式回调
   */
  async executeStream(userMessage: string, onChunk: (chunk: AgentStreamChunk) => void): Promise<AgentResult> {
    aiLogger.info('Agent', '用户问题', userMessage)

    // 检查是否已中止
    if (this.isAborted()) {
      onChunk({ type: 'done', isFinished: true, usage: this.totalUsage })
      return { content: '', toolsUsed: [], toolRounds: 0, totalUsage: this.totalUsage }
    }

    // 初始化消息（包含历史记录）
    const systemPrompt = buildSystemPrompt(this.chatType, this.promptConfig, this.context.ownerInfo, this.locale)
    this.messages = [
      { role: 'system', content: systemPrompt },
      ...this.historyMessages, // 插入历史对话
      { role: 'user', content: userMessage },
    ]
    this.toolsUsed = []
    this.toolRounds = 0

    const tools = await getAllToolDefinitions()
    let finalContent = ''

    // 执行循环
    while (this.toolRounds < this.config.maxToolRounds!) {
      // 每轮开始时检查是否中止
      if (this.isAborted()) {
        onChunk({ type: 'done', isFinished: true, usage: this.totalUsage })
        return {
          content: finalContent,
          toolsUsed: this.toolsUsed,
          toolRounds: this.toolRounds,
          totalUsage: this.totalUsage,
        }
      }

      let accumulatedContent = ''
      let roundContent = ''
      let toolCalls: ToolCall[] | undefined
      let thinkStartAt: number | null = null // 记录思考开始时间
      const parser = createStreamParser({
        onText: (text) => {
          roundContent += text
          onChunk({ type: 'content', content: text })
        },
        onThinkStart: () => {
          thinkStartAt = Date.now()
        },
        onThink: (text, tag) => {
          onChunk({ type: 'think', content: text, thinkTag: tag })
        },
        onThinkEnd: (tag) => {
          if (thinkStartAt === null) return
          const durationMs = Date.now() - thinkStartAt
          thinkStartAt = null
          onChunk({ type: 'think', content: '', thinkTag: tag, thinkDurationMs: durationMs })
        },
      })

      // 流式调用 LLM（传入 abortSignal）
      for await (const chunk of chatStream(this.messages, {
        ...this.config.llmOptions,
        tools,
        abortSignal: this.abortSignal,
      })) {
        // 每个 chunk 时检查是否中止
        if (this.isAborted()) {
          onChunk({ type: 'done', isFinished: true, usage: this.totalUsage })
          return {
            content: finalContent + roundContent,
            toolsUsed: this.toolsUsed,
            toolRounds: this.toolRounds,
            totalUsage: this.totalUsage,
          }
        }
        if (chunk.content) {
          accumulatedContent += chunk.content
          // 按标签切分后输出到内容/思考区
          parser.push(chunk.content)
        }

        if (chunk.tool_calls) {
          toolCalls = chunk.tool_calls
          aiLogger.info('Agent', '收到 tool_calls', {
            count: chunk.tool_calls.length,
            names: chunk.tool_calls.map((tc) => tc.function.name),
          })
        }

        // 累加 Token 使用量（流式响应在最后一个 chunk 返回 usage）
        if (chunk.usage) {
          this.addUsage(chunk.usage)
        }

        if (chunk.isFinished) {
          aiLogger.info('Agent', '流结束', {
            finishReason: chunk.finishReason,
            hasToolCalls: !!toolCalls,
            toolCallsCount: toolCalls?.length ?? 0,
          })
          // 收尾：清空解析器缓冲
          parser.flush()

          // 只有当 finishReason 不是 tool_calls 且 没有收到 toolCalls 时，才尝试 fallback 解析
          // 修复：某些第三方 API（如 Gemini 中转）返回 finishReason="stop" 但实际有 tool_calls
          if (chunk.finishReason !== 'tool_calls' && !toolCalls) {
            // Fallback: 检查内容中是否有 <tool_call> 标签
            if (hasToolCallTags(accumulatedContent)) {
              // 提取 thinking 内容
              const { cleanContent } = extractThinkingContent(accumulatedContent)

              // 解析 tool_call 标签
              const fallbackToolCalls = parseToolCallTags(accumulatedContent)
              if (fallbackToolCalls && fallbackToolCalls.length > 0) {
                toolCalls = fallbackToolCalls
                // 不返回，继续执行工具调用
              } else {
                // 解析失败，作为普通响应处理
                const sanitizedContent = stripToolCallTags(cleanContent)
                if (sanitizedContent.startsWith(roundContent)) {
                  const remainingContent = sanitizedContent.slice(roundContent.length)
                  if (remainingContent) {
                    onChunk({ type: 'content', content: remainingContent })
                  }
                } else if (sanitizedContent) {
                  aiLogger.warn('Agent', '流式内容与清理结果不一致，跳过补发', {
                    roundContentLength: roundContent.length,
                    sanitizedLength: sanitizedContent.length,
                  })
                }
                finalContent = sanitizedContent
                aiLogger.info('Agent', 'AI 回复', finalContent)
                onChunk({ type: 'done', isFinished: true, usage: this.totalUsage })
                return {
                  content: finalContent,
                  toolsUsed: this.toolsUsed,
                  toolRounds: this.toolRounds,
                  totalUsage: this.totalUsage,
                }
              }
            } else {
              // 没有 tool_call 标签，正常完成
              const sanitizedContent = stripToolCallTags(extractThinkingContent(accumulatedContent).cleanContent)
              if (sanitizedContent.startsWith(roundContent)) {
                const remainingContent = sanitizedContent.slice(roundContent.length)
                if (remainingContent) {
                  onChunk({ type: 'content', content: remainingContent })
                }
              } else if (sanitizedContent) {
                aiLogger.warn('Agent', '流式内容与清理结果不一致，跳过补发', {
                  roundContentLength: roundContent.length,
                  sanitizedLength: sanitizedContent.length,
                })
              }
              finalContent = sanitizedContent
              aiLogger.info('Agent', 'AI 回复', finalContent)
              onChunk({ type: 'done', isFinished: true, usage: this.totalUsage })
              return {
                content: finalContent,
                toolsUsed: this.toolsUsed,
                toolRounds: this.toolRounds,
                totalUsage: this.totalUsage,
              }
            }
          }
        }
      }

      // 兜底收尾：防止未收到 isFinished
      parser.flush()

      // 处理工具调用
      if (toolCalls && toolCalls.length > 0) {
        // 通知前端开始执行工具（包含参数和时间范围）
        for (const tc of toolCalls) {
          let toolParams: Record<string, unknown> | undefined
          try {
            toolParams = JSON.parse(tc.function.arguments || '{}')

            // 对于消息获取类工具，用用户配置的 limit 覆盖 LLM 传递的值（保持显示一致）
            const toolsWithLimit = ['search_messages', 'get_recent_messages', 'get_conversation_between']
            if (this.context.maxMessagesLimit && toolsWithLimit.includes(tc.function.name)) {
              toolParams = {
                ...toolParams,
                limit: this.context.maxMessagesLimit, // 用户配置优先
              }
            }

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

    // 检查是否已中止
    if (this.isAborted()) {
      onChunk({ type: 'done', isFinished: true, usage: this.totalUsage })
      return {
        content: finalContent,
        toolsUsed: this.toolsUsed,
        toolRounds: this.toolRounds,
        totalUsage: this.totalUsage,
      }
    }

    this.messages.push({
      role: 'user',
      content: agentT('ai.agent.answerWithoutTools', this.locale),
    })

    // 最后一轮不带 tools（传入 abortSignal）
    let finalRawContent = ''
    let finalThinkStartAt: number | null = null // 记录最终思考开始时间
    const finalParser = createStreamParser({
      onText: (text) => {
        finalContent += text
        onChunk({ type: 'content', content: text })
      },
      onThinkStart: () => {
        finalThinkStartAt = Date.now()
      },
      onThink: (text, tag) => {
        onChunk({ type: 'think', content: text, thinkTag: tag })
      },
      onThinkEnd: (tag) => {
        if (finalThinkStartAt === null) return
        const durationMs = Date.now() - finalThinkStartAt
        finalThinkStartAt = null
        onChunk({ type: 'think', content: '', thinkTag: tag, thinkDurationMs: durationMs })
      },
    })
    for await (const chunk of chatStream(this.messages, {
      ...this.config.llmOptions,
      abortSignal: this.abortSignal,
    })) {
      if (this.isAborted()) {
        onChunk({ type: 'done', isFinished: true, usage: this.totalUsage })
        break
      }
      if (chunk.content) {
        finalRawContent += chunk.content
        finalParser.push(chunk.content)
      }
      // 累加 Token 使用量
      if (chunk.usage) {
        this.addUsage(chunk.usage)
      }
      if (chunk.isFinished) {
        finalParser.flush()
        const sanitizedContent = stripToolCallTags(extractThinkingContent(finalRawContent).cleanContent)
        if (sanitizedContent.startsWith(finalContent)) {
          const remainingContent = sanitizedContent.slice(finalContent.length)
          if (remainingContent) {
            finalContent += remainingContent
            onChunk({ type: 'content', content: remainingContent })
          }
        } else if (sanitizedContent) {
          aiLogger.warn('Agent', '最终内容与清理结果不一致，跳过补发', {
            finalContentLength: finalContent.length,
            sanitizedLength: sanitizedContent.length,
          })
          finalContent = sanitizedContent
        }
        onChunk({ type: 'done', isFinished: true, usage: this.totalUsage })
      }
    }

    // 兜底收尾：防止未收到 isFinished
    finalParser.flush()

    return {
      content: finalContent,
      toolsUsed: this.toolsUsed,
      toolRounds: this.toolRounds,
      totalUsage: this.totalUsage,
    }
  }

  /**
   * 处理工具调用
   */
  private async handleToolCalls(toolCalls: ToolCall[], onChunk?: (chunk: AgentStreamChunk) => void): Promise<void> {
    // 记录调用的工具及参数
    for (const tc of toolCalls) {
      aiLogger.info('Agent', `工具调用: ${tc.function.name}`, tc.function.arguments)
    }

    // 添加 assistant 消息（包含 tool_calls）
    this.messages.push({
      role: 'assistant',
      content: '',
      tool_calls: toolCalls,
    })

    // 执行工具（传递 locale 用于工具返回结果的国际化）
    const results = await executeToolCalls(toolCalls, { ...this.context, locale: this.locale })

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

      // 记录工具执行结果
      if (result.success) {
        aiLogger.info('Agent', `工具结果: ${tc.function.name}`, result.result)
      } else {
        aiLogger.warn('Agent', `工具失败: ${tc.function.name}`, result.error)
      }

      // 添加工具结果消息
      this.messages.push({
        role: 'tool',
        content: result.success
          ? JSON.stringify(result.result)
          : agentT('ai.agent.toolError', this.locale, { error: result.error }),
        tool_call_id: tc.id,
      })
    }
  }
}

/**
 * 创建 Agent 并执行对话（便捷函数）
 */
export async function runAgent(
  userMessage: string,
  context: ToolContext,
  config?: AgentConfig,
  historyMessages?: ChatMessage[],
  chatType?: 'group' | 'private'
): Promise<AgentResult> {
  const agent = new Agent(context, config, historyMessages, chatType)
  return agent.execute(userMessage)
}

/**
 * 创建 Agent 并流式执行对话（便捷函数）
 */
export async function runAgentStream(
  userMessage: string,
  context: ToolContext,
  onChunk: (chunk: AgentStreamChunk) => void,
  config?: AgentConfig,
  historyMessages?: ChatMessage[],
  chatType?: 'group' | 'private'
): Promise<AgentResult> {
  const agent = new Agent(context, config, historyMessages, chatType)
  return agent.executeStream(userMessage, onChunk)
}
