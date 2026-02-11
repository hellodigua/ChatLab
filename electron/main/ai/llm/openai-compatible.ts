/**
 * OpenAI Compatible LLM Provider
 * 支持任何兼容 OpenAI API 格式的服务（如 Ollama、LocalAI、vLLM 等）
 */

import { createOpenAI } from '@ai-sdk/openai'
import { generateText, streamText, wrapLanguageModel, extractReasoningMiddleware } from 'ai'
import type { ModelMessage, ToolSet, TypedToolCall, LanguageModel } from 'ai'
import type {
  ILLMService,
  LLMProvider,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  ChatStreamChunk,
  ToolCall,
  ProviderInfo,
} from './types'
import { aiLogger } from '../logger'
import { buildModelMessages, buildToolSet, mapFinishReason, mapToolCalls, mapUsage } from './sdkUtils'

/**
 * 从 AI SDK 错误中提取详细信息
 * 特别是从 responseBody 中获取模型/服务端返回的错误消息
 */
interface DetailedError {
  message: string
  statusCode?: number
  responseBody?: string
  originalMessage?: string
}

function extractDetailedError(error: unknown): DetailedError {
  const result: DetailedError = {
    message: '未知错误',
  }

  if (!error) {
    return result
  }

  // 处理 Error 对象
  if (error instanceof Error) {
    result.originalMessage = error.message
    result.message = error.message

    // 尝试从错误对象中提取更多信息
    const anyError = error as Record<string, unknown>

    // 检查状态码
    if (typeof anyError.statusCode === 'number') {
      result.statusCode = anyError.statusCode
    }

    // 检查是否有 responseBody（API 错误通常包含）- 直接使用原始内容
    if (typeof anyError.responseBody === 'string') {
      result.responseBody = anyError.responseBody
      result.message = anyError.responseBody
    }

    // 检查是否是 RetryError（包含多个错误）
    if (Array.isArray(anyError.errors)) {
      const errors = anyError.errors as Array<Record<string, unknown>>
      for (const innerError of errors) {
        // 提取状态码
        if (typeof innerError.statusCode === 'number' && !result.statusCode) {
          result.statusCode = innerError.statusCode
        }
        // 提取 responseBody - 直接使用原始内容
        if (typeof innerError.responseBody === 'string') {
          result.responseBody = innerError.responseBody
          result.message = innerError.responseBody
          break
        }
      }
    }
  } else if (typeof error === 'string') {
    result.message = error
  } else {
    result.message = String(error)
  }

  return result
}

const DEFAULT_BASE_URL = 'http://localhost:11434/v1'
const DEFAULT_THOUGHT_SIGNATURE = 'context_engineering_is_the_way_to_go'

export const OPENAI_COMPATIBLE_INFO: ProviderInfo = {
  id: 'openai-compatible',
  name: 'OpenAI 兼容',
  description: '支持任何兼容 OpenAI API 的服务（如 Ollama、LocalAI、vLLM 等）',
  defaultBaseUrl: DEFAULT_BASE_URL,
  models: [
    { id: 'llama3.2', name: 'Llama 3.2', description: 'Meta Llama 3.2 模型' },
    { id: 'qwen2.5', name: 'Qwen 2.5', description: '通义千问 2.5 模型' },
    { id: 'deepseek-r1', name: 'DeepSeek R1', description: 'DeepSeek R1 推理模型' },
  ],
}

/**
 * 统一处理 baseUrl：去掉尾部斜杠和多余路径
 */
function normalizeBaseUrl(baseUrl?: string): string {
  let processed = baseUrl || DEFAULT_BASE_URL
  processed = processed.replace(/\/+$/, '')
  if (processed.endsWith('/chat/completions')) {
    processed = processed.slice(0, -'/chat/completions'.length)
  }
  return processed
}

/**
 * MiniMax 流式返回可能是累计文本，这里按前缀增量去重
 */
function dedupeCumulativeStreamChunk(chunk: string, previousText: string): { delta: string; nextText: string } {
  if (!previousText) {
    return { delta: chunk, nextText: chunk }
  }

  if (chunk.startsWith(previousText)) {
    return { delta: chunk.slice(previousText.length), nextText: chunk }
  }

  if (previousText.startsWith(chunk)) {
    // 偶发回退或重复帧，保持已输出内容
    return { delta: '', nextText: previousText }
  }

  // 无法判定为累计时，退化为增量追加
  return { delta: chunk, nextText: previousText + chunk }
}

/**
 * 包装 fetch：注入思考开关和 thought_signature
 */
function createCompatFetch(disableThinking: boolean): typeof fetch {
  return async (input, init) => {
    if (!init?.body || typeof init.body !== 'string') {
      return fetch(input, init)
    }

    let parsedBody: Record<string, unknown> | null = null
    try {
      parsedBody = JSON.parse(init.body) as Record<string, unknown>
    } catch {
      return fetch(input, init)
    }

    if (!parsedBody) {
      return fetch(input, init)
    }

    let changed = false

    if (Array.isArray(parsedBody.messages)) {
      const messages = parsedBody.messages as Array<Record<string, unknown>>
      // 为 Gemini 兼容后端补充 thought_signature
      for (const message of messages) {
        if (
          message &&
          typeof message === 'object' &&
          (message as { role?: string }).role === 'assistant' &&
          Array.isArray((message as { tool_calls?: unknown[] }).tool_calls)
        ) {
          const toolCalls = (message as { tool_calls: Array<Record<string, unknown>> }).tool_calls
          for (const toolCall of toolCalls) {
            const typedCall = toolCall as Record<string, unknown> & {
              thought_signature?: string
              thoughtSignature?: string
            }
            if (!typedCall.thought_signature && !typedCall.thoughtSignature) {
              typedCall.thought_signature = DEFAULT_THOUGHT_SIGNATURE
              changed = true
            }
          }
        }
      }

      // 禁用思考模式（用于本地模型）
      if (disableThinking) {
        const chatTemplate = parsedBody.chat_template_kwargs
        if (!chatTemplate || typeof chatTemplate !== 'object') {
          parsedBody.chat_template_kwargs = { enable_thinking: false }
          changed = true
        } else if (!(chatTemplate as { enable_thinking?: boolean }).enable_thinking) {
          parsedBody.chat_template_kwargs = {
            ...(chatTemplate as Record<string, unknown>),
            enable_thinking: false,
          }
          changed = true
        }
      }
    }

    if (!changed) {
      return fetch(input, init)
    }

    const nextInit: RequestInit = {
      ...init,
      body: JSON.stringify(parsedBody),
    }

    return fetch(input, nextInit)
  }
}

export class OpenAICompatibleService implements ILLMService {
  private apiKey: string
  private baseUrl: string
  private model: string
  private providerId: LLMProvider
  private models: ProviderInfo['models']
  private defaultModel: string
  private provider = createOpenAI()
  private isReasoning: boolean = false

  constructor(
    apiKey: string,
    model?: string,
    baseUrl?: string,
    disableThinking?: boolean,
    providerId?: LLMProvider,
    models?: ProviderInfo['models'],
    isReasoningModelConfig?: boolean
  ) {
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
    const resolvedApiKey = apiKey || 'sk-no-key-required'
    const resolvedDisableThinking = disableThinking ?? true
    const resolvedProviderId = providerId ?? 'openai-compatible'
    const resolvedModels = models && models.length > 0 ? models : OPENAI_COMPATIBLE_INFO.models
    const defaultModel = resolvedModels[0]?.id || 'llama3.2'
    const resolvedModel = model || defaultModel

    this.apiKey = resolvedApiKey
    this.baseUrl = normalizedBaseUrl
    this.providerId = resolvedProviderId
    this.models = resolvedModels
    this.defaultModel = defaultModel
    this.model = resolvedModel

    // 推理模型判断：完全依赖用户配置
    this.isReasoning = isReasoningModelConfig ?? false
    if (this.isReasoning) {
      aiLogger.info(this.providerId, `用户配置为推理模型: ${resolvedModel}`)
    }

    this.provider = createOpenAI({
      apiKey: resolvedApiKey,
      baseURL: normalizedBaseUrl,
      name: 'openai-compatible',
      fetch: createCompatFetch(resolvedDisableThinking),
    })
  }

  /**
   * 获取语言模型实例
   * 对于推理模型，会应用 extractReasoningMiddleware 中间件
   */
  private getModel(): LanguageModel {
    const baseModel = this.provider.chat(this.model)

    if (this.isReasoning) {
      // 对推理模型应用中间件，提取 <think> 标签中的思考内容
      // startWithReasoning: true - 因为 Ollama 上的 DeepSeek-R1 响应总是以思考开始
      return wrapLanguageModel({
        model: baseModel,
        middleware: extractReasoningMiddleware({
          tagName: 'think',
          startWithReasoning: true,
        }),
      })
    }

    return baseModel
  }

  getProvider(): LLMProvider {
    return this.providerId
  }

  getModels(): string[] {
    return this.models.map((m) => m.id)
  }

  getDefaultModel(): string {
    return this.defaultModel
  }

  // 统一处理消息映射，保持与旧实现一致
  private buildMessages(messages: ChatMessage[]): ModelMessage[] {
    return buildModelMessages(messages)
  }

  // 统一映射工具调用结果
  private mapToolCalls(toolCalls: TypedToolCall<ToolSet>[]): ToolCall[] {
    return mapToolCalls(toolCalls)
  }

  // 仅 MiniMax 需要累计去重，避免其他模型缓存全文
  private shouldTrackStreamText(): boolean {
    return this.providerId === 'minimax'
  }

  // MiniMax 流式返回可能是累计文本，按前缀增量去重
  private getStreamChunkDelta(chunk: string, previousText: string): { delta: string; nextText: string } {
    if (this.providerId !== 'minimax') {
      return { delta: chunk, nextText: previousText + chunk }
    }
    return dedupeCumulativeStreamChunk(chunk, previousText)
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    const model = this.getModel()
    // 推理模型（如 DeepSeek-R1）不支持 tool-calling，需要禁用 tools
    const toolSet = this.isReasoning ? undefined : buildToolSet(options?.tools)

    aiLogger.info(this.providerId, '开始非流式请求', {
      model: this.model,
      isReasoning: this.isReasoning,
      hasTools: !!toolSet,
      messagesCount: messages.length,
    })

    const result = await generateText({
      model,
      messages: this.buildMessages(messages),
      tools: toolSet,
      temperature: options?.temperature ?? 0.7,
      maxTokens: options?.maxTokens ?? 2048,
      abortSignal: options?.abortSignal,
    })

    const toolCalls = result.toolCalls.length > 0 ? this.mapToolCalls(result.toolCalls) : undefined

    // 对于推理模型，reasoningText 包含思考内容
    if (this.isReasoning && result.reasoningText) {
      aiLogger.info(this.providerId, '推理模型返回思考内容', {
        reasoningLength: result.reasoningText.length,
        textLength: result.text.length,
      })
    }

    return {
      content: result.text,
      finishReason: mapFinishReason(result.finishReason),
      tool_calls: toolCalls,
      usage: mapUsage(result.usage),
    }
  }

  async *chatStream(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<ChatStreamChunk> {
    const model = this.getModel()
    const shouldTrack = this.shouldTrackStreamText()
    let streamedText = ''

    // 推理模型（如 DeepSeek-R1）不支持 tool-calling，需要禁用 tools
    // 参考: https://sdk.vercel.ai/docs/guides/r1#limitations
    const toolSet = this.isReasoning ? undefined : buildToolSet(options?.tools)

    aiLogger.info(this.providerId, '开始流式请求', {
      model: this.model,
      isReasoning: this.isReasoning,
      hasTools: !!toolSet,
      messagesCount: messages.length,
    })

    const result = streamText({
      model,
      messages: this.buildMessages(messages),
      tools: toolSet,
      temperature: options?.temperature ?? 0.7,
      maxTokens: options?.maxTokens ?? 2048,
      abortSignal: options?.abortSignal,
    })

    let partCount = 0
    let textChunkCount = 0
    let reasoningChunkCount = 0

    try {
      // 使用 fullStream 替代 textStream，以支持 reasoning 模型（如 DeepSeek-R1）
      // fullStream 包含 text/reasoning/tool-call 等多种类型的 chunk
      for await (const part of result.fullStream) {
        partCount++

        if (options?.abortSignal?.aborted) {
          yield { content: '', isFinished: true, finishReason: 'stop' }
          return
        }

        // 记录每个 part 的类型（用于调试）
        if (partCount <= 5 || partCount % 50 === 0) {
          aiLogger.info(this.providerId, `Stream part #${partCount}`, { type: part.type })
        }

        // 处理 error part - 获取详细错误信息并抛出更有意义的错误
        if (part.type === 'error') {
          const errorPart = part as { type: 'error'; error: unknown }
          const detailedError = extractDetailedError(errorPart.error)

          aiLogger.error(this.providerId, 'Stream 收到 error part', {
            detailedError,
            originalError: String(errorPart.error),
          })

          // 抛出包含详细信息的错误，让前端能够显示
          throw new Error(detailedError.message)
        }

        // 处理不同类型的 stream part
        // 注意：fullStream 返回的文本增量类型可能是 'text' 或 'text-delta'
        const textPart = part as { type: string; text?: string; textDelta?: string }
        if (part.type === 'text' || part.type === 'text-delta') {
          // 普通文本内容
          textChunkCount++
          const chunk = textPart.text || textPart.textDelta
          if (chunk) {
            const { delta, nextText } = this.getStreamChunkDelta(chunk, streamedText)
            if (shouldTrack) {
              streamedText = nextText
            }
            if (delta) {
              yield { content: delta, isFinished: false }
            }
          }
        } else if (part.type === 'reasoning') {
          // 推理内容（DeepSeek-R1 等推理模型）
          // 包装为 <think> 标签，让 Agent 的 createStreamParser 能够正确解析
          reasoningChunkCount++
          const reasoningText = part.text
          if (reasoningText) {
            yield { content: `<think>${reasoningText}</think>`, isFinished: false }
          }
        } else if (part.type === 'finish') {
          // 流结束
          const finishReason = mapFinishReason(part.finishReason)
          const toolCalls = await result.toolCalls
          const usage = mapUsage(part.totalUsage)

          // 详细记录流式请求完成信息，包括工具调用
          aiLogger.info(this.providerId, '流式请求完成', {
            partCount,
            textChunkCount,
            reasoningChunkCount,
            finishReason: part.finishReason,
            mappedFinishReason: finishReason,
            toolCallsCount: toolCalls.length,
            toolCallNames: toolCalls.map((tc) => tc.toolName),
          })

          yield {
            content: '',
            isFinished: true,
            finishReason,
            tool_calls: toolCalls.length > 0 ? this.mapToolCalls(toolCalls) : undefined,
            usage,
          }
          return
        }
        // 其他类型（tool-call, tool-result, start, start-step, finish-step 等）暂时忽略
      }

      // 兜底：如果没有收到 finish 事件，手动获取结果
      aiLogger.warn(this.providerId, '流结束但未收到 finish 事件', {
        partCount,
        textChunkCount,
        reasoningChunkCount,
      })

      const finishReason = mapFinishReason(await result.finishReason)
      const toolCalls = await result.toolCalls
      const usage = mapUsage(await result.totalUsage)

      yield {
        content: '',
        isFinished: true,
        finishReason,
        tool_calls: toolCalls.length > 0 ? this.mapToolCalls(toolCalls) : undefined,
        usage,
      }
    } catch (error) {
      aiLogger.error(this.providerId, '流式请求异常', {
        partCount,
        textChunkCount,
        reasoningChunkCount,
        error: String(error),
      })

      if (error instanceof Error && error.name === 'AbortError') {
        yield { content: '', isFinished: true, finishReason: 'stop' }
        return
      }
      throw error
    }
  }

  async validateApiKey(): Promise<{ success: boolean; error?: string }> {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (this.apiKey && this.apiKey !== 'sk-no-key-required') {
        headers['Authorization'] = `Bearer ${this.apiKey}`
      }

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 1,
        }),
      })

      if (response.ok) {
        return { success: true }
      }

      const errorText = await response.text()
      let errorMessage = `HTTP ${response.status}`
      try {
        const errorJson = JSON.parse(errorText) as { error?: { message?: string }; message?: string }
        errorMessage = errorJson.error?.message || errorJson.message || errorMessage
      } catch {
        if (errorText) {
          errorMessage = errorText.slice(0, 200)
        }
      }

      if (response.status === 401 || response.status === 403) {
        return { success: false, error: errorMessage }
      }

      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  }
}
