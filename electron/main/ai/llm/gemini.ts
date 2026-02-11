/**
 * Google Gemini LLM Provider
 * 使用 AI SDK 的 Google Generative AI Provider，支持 Function Calling
 */

import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { generateText, streamText } from 'ai'
import type { ContentPart, ModelMessage, ToolSet, TypedToolCall } from 'ai'
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
import { buildModelMessages, buildToolSet, mapFinishReason, mapUsage } from './sdkUtils'

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com'
const DEFAULT_API_VERSION = '/v1beta'
const GEMINI_MAX_RETRIES = 1

const MODELS = [
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview', description: '高速预览版' },
  { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro Preview', description: '专业预览版' },
]

export const GEMINI_INFO: ProviderInfo = {
  id: 'gemini',
  name: 'Gemini',
  description: 'Google Gemini 大语言模型',
  defaultBaseUrl: DEFAULT_BASE_URL,
  models: MODELS,
}

/**
 * 统一处理 Gemini 的 baseUrl，确保包含 /v1beta
 */
function normalizeBaseUrl(baseUrl?: string): string {
  const normalized = (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')

  if (normalized.endsWith(DEFAULT_API_VERSION)) {
    return normalized
  }

  return `${normalized}${DEFAULT_API_VERSION}`
}

const GEMINI_PROVIDER_KEYS = ['google', 'vertex', 'gemini']

/**
 * 从 AI SDK 的 providerMetadata 中提取 thoughtSignature
 */
function getThoughtSignature(metadata?: unknown): string | undefined {
  if (!metadata || typeof metadata !== 'object') {
    return undefined
  }

  const record = metadata as Record<string, unknown>
  for (const key of GEMINI_PROVIDER_KEYS) {
    const providerMeta = record[key]
    if (providerMeta && typeof providerMeta === 'object') {
      const signature = (providerMeta as Record<string, unknown>).thoughtSignature
      if (typeof signature === 'string' && signature) {
        return signature
      }
    }
  }

  const directSignature = record.thoughtSignature
  if (typeof directSignature === 'string' && directSignature) {
    return directSignature
  }

  return undefined
}

/**
 * Gemini 工具调用需要 thoughtSignature
 */
function mapGeminiToolCalls(toolCalls: TypedToolCall<ToolSet>[]): ToolCall[] {
  return toolCalls.map((tc) => ({
    id: tc.toolCallId,
    type: 'function' as const,
    function: {
      name: tc.toolName,
      arguments: JSON.stringify(tc.input ?? {}),
    },
    thoughtSignature: getThoughtSignature(tc.providerMetadata),
  }))
}

/**
 * 构建 Gemini 的模型消息，补充 thoughtSignature
 */
function buildGeminiModelMessages(messages: ChatMessage[]): ModelMessage[] {
  const modelMessages = buildModelMessages(messages)
  const signatureMap = new Map<string, string>()

  for (const message of messages) {
    if (message.role !== 'assistant' || !message.tool_calls) continue
    for (const toolCall of message.tool_calls) {
      if (toolCall.thoughtSignature) {
        signatureMap.set(toolCall.id, toolCall.thoughtSignature)
      }
    }
  }

  if (signatureMap.size === 0) {
    return modelMessages
  }

  return modelMessages.map((message) => {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) {
      return message
    }

    const contentParts = message.content.map((part) => {
      if (part.type !== 'tool-call') {
        return part
      }

      const signature = signatureMap.get(part.toolCallId)
      if (!signature) {
        return part
      }

      const nextPart: ContentPart<ToolSet> & {
        providerOptions?: Record<string, { thoughtSignature?: string }>
      } = {
        ...part,
        providerOptions: {
          google: { thoughtSignature: signature },
        },
      }

      return nextPart
    })

    return {
      ...message,
      content: contentParts,
    }
  })
}

export class GeminiService implements ILLMService {
  private apiKey: string
  private baseUrl: string
  private model: string

  private provider = createGoogleGenerativeAI()

  constructor(apiKey: string, model?: string, baseUrl?: string) {
    this.apiKey = apiKey
    this.baseUrl = normalizeBaseUrl(baseUrl)
    this.model = model || 'gemini-3-flash-preview'
    this.provider = createGoogleGenerativeAI({
      apiKey: this.apiKey,
      baseURL: this.baseUrl,
      name: 'gemini',
    })
  }

  getProvider(): LLMProvider {
    return 'gemini'
  }

  getModels(): string[] {
    return MODELS.map((m) => m.id)
  }

  getDefaultModel(): string {
    return 'gemini-3-flash-preview'
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    const model = this.provider.chat(this.model)
    const toolSet = buildToolSet(options?.tools)

    const result = await generateText({
      model,
      messages: buildGeminiModelMessages(messages),
      tools: toolSet,
      temperature: options?.temperature ?? 0.7,
      maxTokens: options?.maxTokens ?? 2048,
      // 降低 Gemini 自动重试次数，避免触发免费配额限制
      maxRetries: GEMINI_MAX_RETRIES,
      abortSignal: options?.abortSignal,
    })

    const toolCalls = result.toolCalls.length > 0 ? mapGeminiToolCalls(result.toolCalls) : undefined

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

    const result = streamText({
      model,
      messages: buildGeminiModelMessages(messages),
      tools: toolSet,
      temperature: options?.temperature ?? 0.7,
      maxTokens: options?.maxTokens ?? 2048,
      // 降低 Gemini 自动重试次数，避免触发免费配额限制
      maxRetries: GEMINI_MAX_RETRIES,
      abortSignal: options?.abortSignal,
    })

    try {
      for await (const chunk of result.textStream) {
        if (options?.abortSignal?.aborted) {
          yield { content: '', isFinished: true, finishReason: 'stop' }
          return
        }
        if (chunk) {
          yield { content: chunk, isFinished: false }
        }
      }

      const finishReason = mapFinishReason(await result.finishReason)
      const toolCalls = await result.toolCalls
      const usage = mapUsage(await result.totalUsage)

      yield {
        content: '',
        isFinished: true,
        finishReason,
        tool_calls: toolCalls.length > 0 ? mapGeminiToolCalls(toolCalls) : undefined,
        usage,
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        yield { content: '', isFinished: true, finishReason: 'stop' }
        return
      }
      aiLogger.error('Gemini', '流式请求失败', { error: String(error) })
      throw error
    }
  }

  async validateApiKey(): Promise<{ success: boolean; error?: string }> {
    try {
      const model = this.provider.chat(this.model)
      await generateText({
        model,
        prompt: 'Hi',
        maxTokens: 1,
      })
      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  }
}
