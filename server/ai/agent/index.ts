/**
 * AI Agent executor (server-side)
 * Orchestrates PiAgentCore conversation flow (tool calls, streaming, abort control).
 * Ported from electron/main/ai/agent/index.ts — no Electron/i18n imports.
 */

import { getActiveConfig, buildPiModel } from '../llm/index.js'
import { getAllTools } from '../tools/index.js'
import type { ToolContext, OwnerInfo } from '../tools/types.js'
import { getHistoryForAgent } from '../conversations.js'
import { aiLogger, isDebugMode } from '../logger.js'
import { Agent as PiAgentCore } from '@mariozechner/pi-agent-core'
import {
  type AssistantMessage as PiAssistantMessage,
  type Message as PiMessage,
  type Usage as PiUsage,
} from '@mariozechner/pi-ai'

import type { AgentConfig, AgentStreamChunk, AgentResult, PromptConfig, TokenUsage } from './types.js'
import { buildSystemPrompt, getAnswerWithoutToolsPrompt } from './prompt-builder.js'
import { extractThinkingContent, stripToolCallTags } from './content-parser.js'
import { AgentEventHandler } from './event-handler.js'

type SimpleHistoryMessage = { role: 'user' | 'assistant'; content: string }

// Re-export types for external consumers
export type { AgentConfig, AgentStreamChunk, AgentResult, PromptConfig, TokenUsage, AgentRuntimeStatus } from './types.js'

/**
 * Agent executor class.
 * Handles conversation flow with Function Calling.
 */
export class Agent {
  private context: ToolContext
  private config: AgentConfig
  private piModel: import('@mariozechner/pi-ai').Model<any>
  private apiKey: string
  private abortSignal?: AbortSignal
  private chatType: 'group' | 'private' = 'group'
  private promptConfig?: PromptConfig
  private locale: string = 'zh-CN'

  constructor(
    context: ToolContext,
    piModel: import('@mariozechner/pi-ai').Model<any>,
    apiKey: string,
    config: AgentConfig = {},
    chatType: 'group' | 'private' = 'group',
    promptConfig?: PromptConfig,
    locale: string = 'zh-CN',
  ) {
    this.context = context
    this.piModel = piModel
    this.apiKey = apiKey
    this.abortSignal = config.abortSignal
    this.chatType = chatType
    this.promptConfig = promptConfig
    this.locale = locale
    this.config = {
      maxToolRounds: config.maxToolRounds ?? 5,
      contextHistoryLimit: config.contextHistoryLimit ?? 48,
    }
  }

  private isAborted(): boolean {
    return this.abortSignal?.aborted ?? false
  }

  async execute(userMessage: string): Promise<AgentResult> {
    return this.executeStream(userMessage, () => {})
  }

  async executeStream(userMessage: string, onChunk: (chunk: AgentStreamChunk) => void): Promise<AgentResult> {
    aiLogger.info('Agent', 'User question', userMessage)

    const maxToolRounds = Math.max(0, this.config.maxToolRounds ?? 0)
    const systemPrompt = buildSystemPrompt(this.chatType, this.promptConfig, this.context.ownerInfo, this.locale)
    const answerWithoutToolsPrompt = getAnswerWithoutToolsPrompt(this.locale)

    const handler = new AgentEventHandler({
      onChunk,
      context: this.context,
      systemPrompt,
    })

    if (this.isAborted()) {
      handler.emitStatus('aborted', [], { force: true })
      onChunk({ type: 'done', isFinished: true, usage: handler.cloneUsage() })
      return { content: '', toolsUsed: [], toolRounds: 0, totalUsage: handler.cloneUsage() }
    }

    let debugLastLoggedCount = 0
    let debugLlmRound = 1

    const coreAgent = new PiAgentCore({
      initialState: {
        model: this.piModel,
        thinkingLevel: this.piModel.reasoning ? 'medium' : 'off',
      },
      getApiKey: () => this.apiKey,
      convertToLlm: (messages) => {
        const filtered = messages.filter(
          (msg): msg is PiMessage => msg.role === 'user' || msg.role === 'assistant' || msg.role === 'toolResult',
        )
        if (isDebugMode()) {
          const newMessages = filtered.slice(debugLastLoggedCount)
          if (newMessages.length > 0) {
            const parts: string[] = []
            for (const m of newMessages) {
              const msg = m as unknown as Record<string, unknown>
              parts.push(`--- ${msg.role} ---`)
              const content = msg.content as
                | Array<{ type: string; text?: string; name?: string; arguments?: unknown }>
                | undefined
              if (Array.isArray(content)) {
                for (const block of content) {
                  if (block.type === 'text' && block.text) {
                    parts.push(block.text)
                  } else if (block.type === 'toolCall') {
                    parts.push(`[Tool Call] ${block.name}(${JSON.stringify(block.arguments)})`)
                  }
                }
              }
            }
            aiLogger.debug(
              'Agent',
              `[DEBUG] LLM round ${debugLlmRound} - ${newMessages.length} new, total ${filtered.length}\n${parts.join('\n')}`,
            )
          }
          debugLastLoggedCount = filtered.length
          debugLlmRound++
        }
        return filtered
      },
    })

    coreAgent.setSystemPrompt(systemPrompt)
    const piTools = getAllTools({ ...this.context, locale: this.locale })
    coreAgent.setTools(maxToolRounds > 0 ? piTools : [])

    const limit = this.config.contextHistoryLimit ?? 48
    const historyMessages = this.loadHistory(limit)
    coreAgent.replaceMessages(this.toPiHistoryMessages(historyMessages))

    handler.emitStatus('preparing', coreAgent.state.messages, {
      pendingUserMessage: userMessage,
      force: true,
    })

    const subscriber = handler.createSubscriber(coreAgent, maxToolRounds, answerWithoutToolsPrompt)
    const unsubscribe = coreAgent.subscribe(subscriber)

    const forwardAbort = () => coreAgent.abort()
    if (this.abortSignal) {
      this.abortSignal.addEventListener('abort', forwardAbort, { once: true })
    }

    try {
      if (isDebugMode()) {
        aiLogger.debug('Agent', `[DEBUG] System prompt`, systemPrompt)
      }

      await coreAgent.prompt(userMessage)

      if (this.isAborted()) {
        handler.emitStatus('aborted', coreAgent.state.messages, { force: true })
        onChunk({ type: 'done', isFinished: true, usage: handler.cloneUsage() })
        return {
          content: '',
          toolsUsed: [...handler.toolsUsed],
          toolRounds: handler.toolRounds,
          totalUsage: handler.cloneUsage(),
        }
      }

      if (coreAgent.state.error) {
        throw new Error(coreAgent.state.error)
      }

      const finalAssistant = [...coreAgent.state.messages]
        .reverse()
        .find((msg): msg is PiAssistantMessage => msg.role === 'assistant')

      const finalRawContent =
        finalAssistant?.content
          .filter((item) => item.type === 'text')
          .map((item) => item.text)
          .join('') || ''

      const finalContent = stripToolCallTags(extractThinkingContent(finalRawContent).cleanContent)

      if (isDebugMode() && finalContent) {
        aiLogger.debug('Agent', `[DEBUG] Final response\n${finalContent}`)
      }

      handler.emitStatus('completed', coreAgent.state.messages, { force: true })
      onChunk({ type: 'done', isFinished: true, usage: handler.cloneUsage() })

      return {
        content: finalContent,
        toolsUsed: [...handler.toolsUsed],
        toolRounds: handler.toolRounds,
        totalUsage: handler.cloneUsage(),
      }
    } catch (error) {
      const phase = this.isAborted() ? 'aborted' : 'error'
      handler.emitStatus(phase, coreAgent.state.messages, { force: true })
      throw error
    } finally {
      unsubscribe()
      if (this.abortSignal) {
        this.abortSignal.removeEventListener('abort', forwardAbort)
      }
    }
  }

  private loadHistory(limit: number): SimpleHistoryMessage[] {
    const { conversationId } = this.context
    if (!conversationId) {
      return []
    }
    try {
      return getHistoryForAgent(conversationId, limit > 0 ? limit : undefined)
    } catch (error) {
      aiLogger.warn('Agent', 'Failed to load history from DB, using empty history', { conversationId, error })
      return []
    }
  }

  private createEmptyPiUsage(): PiUsage {
    return {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    }
  }

  private toPiHistoryMessages(messages: SimpleHistoryMessage[]): PiMessage[] {
    return messages.map((msg): PiMessage => {
      if (msg.role === 'user') {
        return {
          role: 'user',
          content: [{ type: 'text', text: msg.content || '' }],
          timestamp: Date.now(),
        }
      }

      return {
        role: 'assistant',
        content: [{ type: 'text', text: msg.content || '' }],
        api: 'openai-completions',
        provider: 'chatlab',
        model: 'unknown',
        usage: this.createEmptyPiUsage(),
        stopReason: 'stop',
        timestamp: Date.now(),
      }
    })
  }
}

/**
 * Convenience function: create Agent and execute conversation.
 */
export async function runAgent(
  userMessage: string,
  context: ToolContext,
  config?: AgentConfig,
  chatType?: 'group' | 'private',
): Promise<AgentResult> {
  const activeConfig = getActiveConfig()
  if (!activeConfig) throw new Error('LLM service not configured')
  const piModel = buildPiModel(activeConfig)
  const agent = new Agent(context, piModel, activeConfig.apiKey, config, chatType)
  return agent.execute(userMessage)
}

/**
 * Convenience function: create Agent and stream conversation.
 */
export async function runAgentStream(
  userMessage: string,
  context: ToolContext,
  onChunk: (chunk: AgentStreamChunk) => void,
  config?: AgentConfig,
  chatType?: 'group' | 'private',
): Promise<AgentResult> {
  const activeConfig = getActiveConfig()
  if (!activeConfig) throw new Error('LLM service not configured')
  const piModel = buildPiModel(activeConfig)
  const agent = new Agent(context, piModel, activeConfig.apiKey, config, chatType)
  return agent.executeStream(userMessage, onChunk)
}
