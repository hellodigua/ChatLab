/**
 * OpenAI Compatible LLM Provider
 * 支持任何兼容 OpenAI API 格式的服务（如 Ollama、LocalAI、vLLM 等）
 */

import { createOpenAI } from '@ai-sdk/openai'
import { generateText, streamText } from 'ai'
import type { ModelMessage, ToolSet, TypedToolCall } from 'ai'
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

  constructor(
    apiKey: string,
    model?: string,
    baseUrl?: string,
    disableThinking?: boolean,
    providerId?: LLMProvider,
    models?: ProviderInfo['models']
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

    this.provider = createOpenAI({
      apiKey: resolvedApiKey,
      baseURL: normalizedBaseUrl,
      name: 'openai-compatible',
      fetch: createCompatFetch(resolvedDisableThinking),
    })
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
    const model = this.provider.chat(this.model)
    const toolSet = buildToolSet(options?.tools)

    const result = await generateText({
      model,
      messages: this.buildMessages(messages),
      tools: toolSet,
      temperature: options?.temperature ?? 0.7,
      maxTokens: options?.maxTokens ?? 2048,
      abortSignal: options?.abortSignal,
    })

    const toolCalls = result.toolCalls.length > 0 ? this.mapToolCalls(result.toolCalls) : undefined

    return {
      content: result.text,
      finishReason: mapFinishReason(result.finishReason),
      tool_calls: toolCalls,
      usage: mapUsage(result.usage),
    }
  }

  async *chatStream(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<ChatStreamChunk> {
    const model = this.provider.chat(this.model)
    const toolSet = buildToolSet(options?.tools)
    const shouldTrack = this.shouldTrackStreamText()
    let streamedText = ''

    const result = streamText({
      model,
      messages: this.buildMessages(messages),
      tools: toolSet,
      temperature: options?.temperature ?? 0.7,
      maxTokens: options?.maxTokens ?? 2048,
      abortSignal: options?.abortSignal,
    })

    try {
      for await (const chunk of result.textStream) {
        if (options?.abortSignal?.aborted) {
          yield { content: '', isFinished: true, finishReason: 'stop' }
          return
        }
        if (chunk) {
          const { delta, nextText } = this.getStreamChunkDelta(chunk, streamedText)
          if (shouldTrack) {
            streamedText = nextText
          }
          if (delta) {
            yield { content: delta, isFinished: false }
          }
        }
      }

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
      if (error instanceof Error && error.name === 'AbortError') {
        yield { content: '', isFinished: true, finishReason: 'stop' }
        return
      }
      // 使用 providerId 作为日志前缀，便于区分兼容服务来源
      aiLogger.error(this.providerId, '流式请求失败', { error: String(error) })
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
