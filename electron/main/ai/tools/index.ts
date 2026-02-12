/**
 * AI Tools 模块入口
 * 工具注册与管理
 */

import type { ToolDefinition, ToolCall } from '../llm/types'
import type { ToolRegistry, RegisteredTool, ToolContext, ToolExecutionResult, ToolExecutor } from './types'
import { isEmbeddingEnabled } from '../rag'
import { t as i18nT } from '../../i18n'

// 导出类型
export * from './types'

// 全局工具注册表
const toolRegistry: ToolRegistry = new Map()

// 工具是否已初始化
let toolsInitialized = false
let initPromise: Promise<void> | null = null

/**
 * 注册一个工具
 * @param definition 工具定义
 * @param executor 执行函数
 */
export function registerTool(definition: ToolDefinition, executor: ToolExecutor): void {
  const name = definition.function.name
  toolRegistry.set(name, { definition, executor })
}

/**
 * 初始化所有工具（确保工具已注册）
 * 使用动态 import 避免循环依赖
 */
export async function ensureToolsInitialized(): Promise<void> {
  if (toolsInitialized) return
  if (initPromise) return initPromise

  initPromise = (async () => {
    // 动态导入 registry 模块
    await import('./registry')
    toolsInitialized = true
  })()

  return initPromise
}

/**
 * 翻译工具定义的 description 和参数 description
 * 使用 i18next 查找翻译，如果未找到则保留原始文本（中文）
 *
 * i18n 键命名规则：
 * - 工具描述：ai.tools.{toolName}.desc
 * - 参数描述：ai.tools.{toolName}.params.{paramName}
 */
function translateToolDefinition(tool: ToolDefinition): ToolDefinition {
  const name = tool.function.name
  const descKey = `ai.tools.${name}.desc`
  const translatedDesc = i18nT(descKey)

  // 深拷贝并翻译参数描述
  const translatedProperties: typeof tool.function.parameters.properties = {}
  for (const [paramName, param] of Object.entries(tool.function.parameters.properties)) {
    const paramKey = `ai.tools.${name}.params.${paramName}`
    const translatedParamDesc = i18nT(paramKey)
    translatedProperties[paramName] = {
      ...param,
      // 如果 i18next 返回的是 key 本身，说明没有找到翻译，保留原始文本
      description: translatedParamDesc !== paramKey ? translatedParamDesc : param.description,
    }
  }

  return {
    type: tool.type,
    function: {
      name: tool.function.name,
      // 如果 i18next 返回的是 key 本身，说明没有找到翻译，保留原始文本
      description: translatedDesc !== descKey ? translatedDesc : tool.function.description,
      parameters: {
        type: tool.function.parameters.type,
        properties: translatedProperties,
        required: tool.function.parameters.required,
      },
    },
  }
}

/**
 * 获取所有已注册的工具定义
 * 根据配置动态过滤工具（如：语义搜索工具仅在启用 Embedding 时可用）
 * 根据当前 locale 动态翻译工具描述（解决"响应式"陷阱：每次调用时实时翻译）
 * @returns 工具定义数组（用于传给 LLM）
 */
export async function getAllToolDefinitions(): Promise<ToolDefinition[]> {
  await ensureToolsInitialized()

  const allTools = Array.from(toolRegistry.values()).map((reg) => reg.definition)

  // 根据 Embedding 配置决定是否包含语义搜索工具
  const embeddingEnabled = isEmbeddingEnabled()
  const filteredTools = embeddingEnabled
    ? allTools
    : allTools.filter((tool) => tool.function.name !== 'semantic_search_messages')

  // 所有 locale 统一走翻译层，确保 locale 文件同构
  return filteredTools.map(translateToolDefinition)
}

/**
 * 获取指定工具
 * @param name 工具名称
 */
export async function getTool(name: string): Promise<RegisteredTool | undefined> {
  await ensureToolsInitialized()
  return toolRegistry.get(name)
}

/**
 * 执行单个工具调用
 * @param toolCall LLM 返回的 tool_call
 * @param context 执行上下文
 */
export async function executeToolCall(toolCall: ToolCall, context: ToolContext): Promise<ToolExecutionResult> {
  await ensureToolsInitialized()
  const toolName = toolCall.function.name

  // 查找工具
  const tool = toolRegistry.get(toolName)
  if (!tool) {
    return {
      toolName,
      success: false,
      error: i18nT('tools.notRegistered', { toolName }),
    }
  }

  try {
    // 解析参数
    const params = JSON.parse(toolCall.function.arguments || '{}')

    // 执行工具
    const result = await tool.executor(params, context)

    return {
      toolName,
      success: true,
      result,
    }
  } catch (error) {
    return {
      toolName,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * 批量执行工具调用
 * @param toolCalls LLM 返回的 tool_calls 数组
 * @param context 执行上下文
 */
export async function executeToolCalls(toolCalls: ToolCall[], context: ToolContext): Promise<ToolExecutionResult[]> {
  // 并行执行所有工具调用
  return Promise.all(toolCalls.map((tc) => executeToolCall(tc, context)))
}

/**
 * 检查工具是否已注册
 */
export async function hasToolsRegistered(): Promise<boolean> {
  await ensureToolsInitialized()
  return toolRegistry.size > 0
}

/**
 * 获取已注册工具数量
 */
export async function getRegisteredToolCount(): Promise<number> {
  await ensureToolsInitialized()
  return toolRegistry.size
}
