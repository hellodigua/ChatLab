/**
 * AI Tools 类型定义
 * 定义工具的接口和执行上下文
 */

import type { ToolDefinition } from '../llm/types'

/**
 * 工具执行上下文
 * 包含执行工具时需要的所有上下文信息
 */
/** Owner 信息（当前用户在对话中的身份） */
export interface OwnerInfo {
  /** Owner 的 platformId */
  platformId: string
  /** Owner 的显示名称 */
  displayName: string
}

export interface ToolContext {
  /** 当前会话 ID（数据库文件名） */
  sessionId: string
  /** 时间过滤器 */
  timeFilter?: {
    startTs: number
    endTs: number
  }
  /** 用户配置的消息条数限制（工具获取消息时使用） */
  maxMessagesLimit?: number
  /** Owner 信息（当前用户在对话中的身份） */
  ownerInfo?: OwnerInfo
  /** 语言环境（用于工具返回结果的国际化） */
  locale?: string
}

/**
 * 工具执行函数类型
 * @param params 从 LLM 解析出的参数对象
 * @param context 执行上下文
 * @returns 执行结果（将被序列化为字符串传回 LLM）
 */
export type ToolExecutor<T = Record<string, unknown>> = (
  params: T,
  context: ToolContext
) => Promise<unknown>

/**
 * 注册的工具
 * 包含工具定义和执行函数
 */
export interface RegisteredTool {
  /** 工具定义（OpenAI 格式） */
  definition: ToolDefinition
  /** 执行函数 */
  executor: ToolExecutor
}

/**
 * 工具注册表
 */
export type ToolRegistry = Map<string, RegisteredTool>

/**
 * 工具执行结果
 */
export interface ToolExecutionResult {
  /** 工具名称 */
  toolName: string
  /** 执行是否成功 */
  success: boolean
  /** 执行结果（成功时） */
  result?: unknown
  /** 错误信息（失败时） */
  error?: string
}

