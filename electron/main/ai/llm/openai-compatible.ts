/**
 * OpenAI Compatible LLM Provider
 * 支持任何兼容 OpenAI API 格式的服务（如 Ollama、LocalAI、vLLM 等）
 */

import type {
  ILLMService,
  LLMProvider,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  ChatStreamChunk,
  ProviderInfo,
  ToolCall,
} from './types'
import { aiLogger } from '../logger'

const DEFAULT_BASE_URL = 'http://localhost:11434/v1'

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

export class OpenAICompatibleService implements ILLMService {
  private apiKey: string
  private baseUrl: string
  private model: string
  private disableThinking: boolean

  constructor(apiKey: string, model?: string, baseUrl?: string, disableThinking?: boolean) {
    this.apiKey = apiKey || 'sk-no-key-required' // 本地服务可能不需要 API Key
    // 智能处理 baseUrl：如果用户已经包含 /chat/completions，则去掉它
    let processedBaseUrl = baseUrl || DEFAULT_BASE_URL
    processedBaseUrl = processedBaseUrl.replace(/\/+$/, '') // 去掉尾部斜杠
    if (processedBaseUrl.endsWith('/chat/completions')) {
      processedBaseUrl = processedBaseUrl.slice(0, -'/chat/completions'.length)
    }
    this.baseUrl = processedBaseUrl
    this.model = model || 'llama3.2'
    this.disableThinking = disableThinking ?? true // 默认禁用思考模式
  }

  /**
   * 设置 Bearer Token 认证头
   */
  private setAuthHeaders(headers: Record<string, string>): void {
    if (this.apiKey && this.apiKey !== 'sk-no-key-required') {
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }
  }

  getProvider(): LLMProvider {
    return 'openai-compatible'
  }

  getModels(): string[] {
    return OPENAI_COMPATIBLE_INFO.models.map((m) => m.id)
  }

  getDefaultModel(): string {
    return 'llama3.2'
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    const requestBody: Record<string, unknown> = {
      model: this.model,
      messages: messages.map((m) => {
        const msg: Record<string, unknown> = { role: m.role, content: m.content }
        if (m.role === 'tool' && m.tool_call_id) {
          msg.tool_call_id = m.tool_call_id
        }
        if (m.role === 'assistant' && m.tool_calls) {
          // 确保 thoughtSignature 被传递（Gemini 3+ 通过 OpenAI 兼容 API 需要）
          msg.tool_calls = m.tool_calls.map((tc) => ({
            ...tc,
            // 如果没有签名，使用虚拟签名（用于 Vertex AI/Gemini 后端）
            thought_signature: tc.thoughtSignature || 'context_engineering_is_the_way_to_go',
          }))
        }
        return msg
      }),
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 2048,
      stream: false,
    }

    if (options?.tools && options.tools.length > 0) {
      requestBody.tools = options.tools
    }

    // 禁用思考模式（用于 Qwen3、DeepSeek-R1 等本地模型）
    if (this.disableThinking) {
      requestBody.chat_template_kwargs = { enable_thinking: false }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    this.setAuthHeaders(headers)

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: options?.abortSignal,
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`OpenAI Compatible API error: ${response.status} - ${error}`)
    }

    const data = await response.json()
    const choice = data.choices?.[0]
    const message = choice?.message

    let finishReason: ChatResponse['finishReason'] = 'error'
    if (choice?.finish_reason === 'stop') {
      finishReason = 'stop'
    } else if (choice?.finish_reason === 'length') {
      finishReason = 'length'
    } else if (choice?.finish_reason === 'tool_calls') {
      finishReason = 'tool_calls'
    }

    let toolCalls: ToolCall[] | undefined
    if (message?.tool_calls && Array.isArray(message.tool_calls)) {
      toolCalls = message.tool_calls.map((tc: Record<string, unknown>) => ({
        id: tc.id as string,
        type: 'function' as const,
        function: {
          name: (tc.function as Record<string, unknown>)?.name as string,
          arguments: (tc.function as Record<string, unknown>)?.arguments as string,
        },
        // 提取 thoughtSignature（Gemini 3+ 通过 OpenAI 兼容 API 可能返回此字段）
        thoughtSignature: (tc.thought_signature || tc.thoughtSignature) as string | undefined,
      }))
    }

    return {
      content: message?.content || '',
      finishReason,
      tool_calls: toolCalls,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined,
    }
  }

  async *chatStream(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<ChatStreamChunk> {
    const requestBody: Record<string, unknown> = {
      model: this.model,
      messages: messages.map((m) => {
        const msg: Record<string, unknown> = { role: m.role, content: m.content }
        if (m.role === 'tool' && m.tool_call_id) {
          msg.tool_call_id = m.tool_call_id
        }
        if (m.role === 'assistant' && m.tool_calls) {
          // 确保 thoughtSignature 被传递（Gemini 3+ 通过 OpenAI 兼容 API 需要）
          msg.tool_calls = m.tool_calls.map((tc) => ({
            ...tc,
            // 如果没有签名，使用虚拟签名（用于 Vertex AI/Gemini 后端）
            thought_signature: tc.thoughtSignature || 'context_engineering_is_the_way_to_go',
          }))
        }
        return msg
      }),
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 2048,
      stream: true,
      // 启用流式响应中的 usage 统计（OpenAI API 兼容）
      stream_options: { include_usage: true },
    }

    if (options?.tools && options.tools.length > 0) {
      requestBody.tools = options.tools
    }

    // 禁用思考模式（用于 Qwen3、DeepSeek-R1 等本地模型）
    if (this.disableThinking) {
      requestBody.chat_template_kwargs = { enable_thinking: false }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    this.setAuthHeaders(headers)

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: options?.abortSignal,
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`OpenAI Compatible API error: ${response.status} - ${error}`)
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('Failed to get response reader')
    }

    const decoder = new TextDecoder()
    let buffer = ''
    const toolCallsAccumulator: Map<number, { id: string; name: string; arguments: string }> = new Map()

    let totalChunks = 0
    let totalContent = ''

    try {
      while (true) {
        // 检查是否已中止
        if (options?.abortSignal?.aborted) {
          yield { content: '', isFinished: true, finishReason: 'stop' }
          return
        }

        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data: ')) continue

          const data = trimmed.slice(6)

          if (data === '[DONE]') {
            if (toolCallsAccumulator.size > 0) {
              const toolCalls: ToolCall[] = Array.from(toolCallsAccumulator.values()).map((tc) => ({
                id: tc.id,
                type: 'function' as const,
                function: {
                  name: tc.name,
                  arguments: tc.arguments,
                },
                // 传递 thoughtSignature（如果存在）
                thoughtSignature: tc.thoughtSignature,
              }))
              yield { content: '', isFinished: true, finishReason: 'tool_calls', tool_calls: toolCalls }
            } else {
              yield { content: '', isFinished: true, finishReason: 'stop' }
            }
            return
          }

          try {
            const parsed = JSON.parse(data)
            const delta = parsed.choices?.[0]?.delta
            const finishReason = parsed.choices?.[0]?.finish_reason

            // 调试：如果有 delta 但没有 content，记录其他可能的内容字段（只写日志文件，不输出控制台）
            if (delta && !delta.content && !delta.tool_calls && !finishReason) {
              const deltaKeys = Object.keys(delta)
              if (deltaKeys.length > 0 && !deltaKeys.every((k) => ['role', 'name', 'audio_content'].includes(k))) {
                aiLogger.debug('OpenAI-Compatible', '检测到未处理的 delta 字段', { deltaKeys, delta })
              }
            }

            if (delta?.content) {
              totalChunks++
              totalContent += delta.content
              yield {
                content: delta.content,
                isFinished: false,
              }
            }

            if (delta?.tool_calls && Array.isArray(delta.tool_calls)) {
              for (const tc of delta.tool_calls) {
                const index = tc.index ?? 0
                const existing = toolCallsAccumulator.get(index)
                if (existing) {
                  if (tc.function?.arguments) {
                    existing.arguments += tc.function.arguments
                  }
                  // 更新 thoughtSignature（如果存在）
                  if (tc.thought_signature || tc.thoughtSignature) {
                    existing.thoughtSignature = tc.thought_signature || tc.thoughtSignature
                  }
                } else {
                  toolCallsAccumulator.set(index, {
                    id: tc.id || '',
                    name: tc.function?.name || '',
                    arguments: tc.function?.arguments || '',
                    // 提取 thoughtSignature（Gemini 3+ 通过 OpenAI 兼容 API 可能返回此字段）
                    // 如果 API 不返回，使用 Gemini 文档提供的虚拟签名绕过验证
                    thoughtSignature: tc.thought_signature || tc.thoughtSignature || 'context_engineering_is_the_way_to_go',
                  })
                }
              }
            }

            if (finishReason) {
              let reason: ChatStreamChunk['finishReason'] = 'error'
              if (finishReason === 'stop') {
                reason = 'stop'
              } else if (finishReason === 'length') {
                reason = 'length'
              } else if (finishReason === 'tool_calls') {
                reason = 'tool_calls'
              }

              // 解析 usage 信息
              const usage = parsed.usage
                ? {
                    promptTokens: parsed.usage.prompt_tokens,
                    completionTokens: parsed.usage.completion_tokens,
                    totalTokens: parsed.usage.total_tokens,
                  }
                : undefined

              if (toolCallsAccumulator.size > 0) {
                const toolCalls: ToolCall[] = Array.from(toolCallsAccumulator.values()).map((tc) => ({
                  id: tc.id,
                  type: 'function' as const,
                  function: {
                    name: tc.name,
                    arguments: tc.arguments,
                  },
                  // 传递 thoughtSignature（如果存在）
                  thoughtSignature: tc.thoughtSignature,
                }))
                yield { content: '', isFinished: true, finishReason: reason, tool_calls: toolCalls, usage }
              } else {
                yield { content: '', isFinished: true, finishReason: reason, usage }
              }
              return
            }
          } catch {
            // 忽略解析错误，继续处理下一行
          }
        }
      }

      // 流读取完成后的处理（如果没有收到 [DONE] 或 finish_reason）
      // 这种情况可能发生在某些 API 不发送标准结束标记时
      aiLogger.info('OpenAI-Compatible', '流循环结束，执行兜底处理', {
        totalChunks,
        totalContentLength: totalContent.length,
        toolCallsCount: toolCallsAccumulator.size,
        bufferRemaining: buffer.length,
      })

      // 如果有累积的 tool_calls，发送它们
      if (toolCallsAccumulator.size > 0) {
        const toolCalls: ToolCall[] = Array.from(toolCallsAccumulator.values()).map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: tc.arguments,
          },
          // 传递 thoughtSignature（如果存在）
          thoughtSignature: tc.thoughtSignature,
        }))
        yield { content: '', isFinished: true, finishReason: 'tool_calls', tool_calls: toolCalls }
      } else {
        // 没有 tool_calls，发送普通完成信号
        yield { content: '', isFinished: true, finishReason: 'stop' }
      }
    } catch (error) {
      // 如果是中止错误，正常返回
      if (error instanceof Error && error.name === 'AbortError') {
        yield { content: '', isFinished: true, finishReason: 'stop' }
        return
      }
      aiLogger.error('OpenAI-Compatible', '流处理异常', { error: String(error) })
      throw error
    } finally {
      reader.releaseLock()
    }
  }

  async validateApiKey(): Promise<{ success: boolean; error?: string }> {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      this.setAuthHeaders(headers)

      const url = `${this.baseUrl}/chat/completions`

      // 发送一个简单的测试请求来验证连接和认证
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 1,
        }),
      })

      // 200 表示成功，401/403 表示认证失败，其他状态可能是参数问题但服务可达
      if (response.ok) {
        return { success: true }
      }

      // 尝试获取错误详情
      const errorText = await response.text()
      let errorMessage = `HTTP ${response.status}`
      try {
        const errorJson = JSON.parse(errorText)
        errorMessage = errorJson.error?.message || errorJson.message || errorMessage
      } catch {
        if (errorText) {
          errorMessage = errorText.slice(0, 200)
        }
      }

      // 认证失败
      if (response.status === 401 || response.status === 403) {
        return { success: false, error: errorMessage }
      }

      // 其他错误（如 400 参数错误）但服务可达，认为验证通过
      // 因为这说明认证成功了，只是请求参数有问题
      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  }
}
