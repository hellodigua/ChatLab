/**
 * AI SDK 适配通用工具
 */

import { jsonSchema } from 'ai'
import type { ContentPart, FinishReason, LanguageModelUsage, ModelMessage, ToolSet, TypedToolCall, JSONValue } from 'ai'
import type { ChatMessage, ChatResponse, ToolCall, ToolDefinition } from './types'

const UNKNOWN_TOOL_NAME = 'unknown_tool'

/**
 * 将 OpenAI 风格的工具定义转换为 AI SDK ToolSet
 */
export function buildToolSet(tools?: ToolDefinition[]): ToolSet | undefined {
  if (!tools || tools.length === 0) return undefined

  const toolSet: ToolSet = {}
  for (const tool of tools) {
    toolSet[tool.function.name] = {
      description: tool.function.description,
      inputSchema: jsonSchema(tool.function.parameters),
    }
  }

  return toolSet
}

/**
 * 解析 JSON 字符串，失败返回 null
 */
export function safeParseJson(value: string): JSONValue | null {
  try {
    return JSON.parse(value) as JSONValue
  } catch {
    return null
  }
}

/**
 * 将 AI SDK finishReason 映射为现有的 LLM finishReason
 */
export function mapFinishReason(reason: FinishReason): ChatResponse['finishReason'] {
  if (reason === 'stop') return 'stop'
  if (reason === 'length') return 'length'
  if (reason === 'tool-calls') return 'tool_calls'
  return 'error'
}

/**
 * 将 AI SDK usage 映射为现有的 usage 结构
 */
export function mapUsage(usage?: LanguageModelUsage): ChatResponse['usage'] | undefined {
  if (!usage) return undefined

  const promptTokens = usage.inputTokens
  const completionTokens = usage.outputTokens
  const totalTokens = usage.totalTokens

  if (promptTokens == null && completionTokens == null && totalTokens == null) {
    return undefined
  }

  return {
    promptTokens: promptTokens ?? 0,
    completionTokens: completionTokens ?? 0,
    totalTokens: totalTokens ?? 0,
  }
}

/**
 * 将 AI SDK toolCalls 映射为现有 ToolCall 结构
 */
export function mapToolCalls(toolCalls: TypedToolCall<ToolSet>[]): ToolCall[] {
  return toolCalls.map((tc) => ({
    id: tc.toolCallId,
    type: 'function' as const,
    function: {
      name: tc.toolName,
      arguments: JSON.stringify(tc.input ?? {}),
    },
  }))
}

/**
 * 将现有 ChatMessage 转为 AI SDK 的 ModelMessage
 */
export function buildModelMessages(messages: ChatMessage[]): ModelMessage[] {
  const toolCallNameMap = new Map<string, string>()

  // 先建立 tool_call_id 到 toolName 的映射，供 tool 消息使用
  for (const message of messages) {
    if (message.role !== 'assistant' || !message.tool_calls) continue
    for (const toolCall of message.tool_calls) {
      toolCallNameMap.set(toolCall.id, toolCall.function.name)
    }
  }

  return messages.map((message) => {
    if (message.role === 'assistant') {
      if (message.tool_calls && message.tool_calls.length > 0) {
        const contentParts: Array<ContentPart<ToolSet>> = []

        if (message.content) {
          contentParts.push({ type: 'text', text: message.content })
        }

        for (const toolCall of message.tool_calls) {
          const input = safeParseJson(toolCall.function.arguments || '{}') ?? {}
          contentParts.push({
            type: 'tool-call',
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            input,
          })
        }

        return {
          role: 'assistant',
          content: contentParts,
        }
      }

      return { role: 'assistant', content: message.content }
    }

    if (message.role === 'tool') {
      const toolCallId = message.tool_call_id || ''
      const toolName = toolCallNameMap.get(toolCallId) || UNKNOWN_TOOL_NAME
      const parsed = safeParseJson(message.content)

      return {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId,
            toolName,
            // 工具结果只允许 JSON/文本，保持与旧实现一致
            output: parsed ? { type: 'json', value: parsed } : { type: 'text', value: message.content },
          },
        ],
      }
    }

    return {
      role: message.role,
      content: message.content,
    }
  })
}
