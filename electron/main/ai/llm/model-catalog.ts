/**
 * Model Catalog — 内置模型目录
 */

import type { ModelDefinition } from './model-types'

// ==================== Helper ====================

type ModelInput = Omit<ModelDefinition, 'builtin' | 'editable'>

function builtin(m: ModelInput): ModelDefinition {
  return { ...m, builtin: true, editable: false }
}

// ==================== OpenAI ====================

const OPENAI_MODELS: ModelDefinition[] = [
  builtin({
    id: 'gpt-5.4-pro',
    providerId: 'openai',
    name: 'GPT-5.4 Pro',
    description: 'Latest flagship, best reasoning & coding',
    capabilities: ['chat', 'reasoning', 'vision', 'function_calling'],
    recommendedFor: ['chat'],
    status: 'stable',
  }),
  builtin({
    id: 'gpt-5.4',
    providerId: 'openai',
    name: 'GPT-5.4',
    description: 'GPT-5.4 standard',
    capabilities: ['chat', 'reasoning', 'vision', 'function_calling'],
    recommendedFor: ['chat'],
    status: 'stable',
  }),
  builtin({
    id: 'gpt-5.2-pro',
    providerId: 'openai',
    name: 'GPT-5.2 Pro',
    description: 'GPT-5.2 Pro',
    capabilities: ['chat', 'reasoning', 'vision', 'function_calling'],
    recommendedFor: [],
    status: 'stable',
  }),
  builtin({
    id: 'gpt-5.2',
    providerId: 'openai',
    name: 'GPT-5.2',
    description: 'GPT-5.2 standard',
    capabilities: ['chat', 'reasoning', 'vision', 'function_calling'],
    recommendedFor: [],
    status: 'stable',
  }),
  builtin({
    id: 'gpt-5.1',
    providerId: 'openai',
    name: 'GPT-5.1',
    description: 'GPT-5.1',
    capabilities: ['chat', 'reasoning', 'vision', 'function_calling'],
    recommendedFor: [],
    status: 'stable',
  }),
  builtin({
    id: 'gpt-5-pro',
    providerId: 'openai',
    name: 'GPT-5 Pro',
    description: 'GPT-5 Pro',
    capabilities: ['chat', 'reasoning', 'vision', 'function_calling'],
    recommendedFor: [],
    status: 'stable',
  }),
  builtin({
    id: 'gpt-5',
    providerId: 'openai',
    name: 'GPT-5',
    description: 'GPT-5 standard',
    capabilities: ['chat', 'reasoning', 'vision', 'function_calling'],
    recommendedFor: [],
    status: 'stable',
  }),
  builtin({
    id: 'gpt-4.1',
    providerId: 'openai',
    name: 'GPT-4.1',
    description: 'Best at coding & instruction following',
    capabilities: ['chat', 'vision', 'function_calling'],
    recommendedFor: ['chat'],
    status: 'stable',
  }),
  builtin({
    id: 'gpt-4.1-mini',
    providerId: 'openai',
    name: 'GPT-4.1 Mini',
    description: 'Cost-effective',
    capabilities: ['chat', 'vision', 'function_calling'],
    recommendedFor: ['chat'],
    status: 'stable',
  }),
  builtin({
    id: 'gpt-4.1-nano',
    providerId: 'openai',
    name: 'GPT-4.1 Nano',
    description: 'Fastest and most affordable',
    capabilities: ['chat', 'vision', 'function_calling'],
    recommendedFor: [],
    status: 'stable',
  }),
  builtin({
    id: 'gpt-4o',
    providerId: 'openai',
    name: 'GPT-4o',
    description: 'Multimodal flagship model',
    capabilities: ['chat', 'vision', 'function_calling'],
    recommendedFor: [],
    status: 'stable',
  }),
  builtin({
    id: 'gpt-4o-mini',
    providerId: 'openai',
    name: 'GPT-4o Mini',
    description: 'Lightweight multimodal model',
    capabilities: ['chat', 'vision', 'function_calling'],
    recommendedFor: [],
    status: 'stable',
  }),
  builtin({
    id: 'o3',
    providerId: 'openai',
    name: 'o3',
    description: 'Advanced reasoning model',
    capabilities: ['chat', 'reasoning', 'vision', 'function_calling'],
    recommendedFor: [],
    status: 'stable',
  }),
  builtin({
    id: 'o4-mini',
    providerId: 'openai',
    name: 'o4-mini',
    description: 'Efficient reasoning model',
    capabilities: ['chat', 'reasoning', 'vision', 'function_calling'],
    recommendedFor: [],
    status: 'stable',
  }),
  builtin({
    id: 'text-embedding-3-small',
    providerId: 'openai',
    name: 'Text Embedding 3 Small',
    description: 'Efficient embedding model',
    capabilities: ['embedding'],
    recommendedFor: ['embedding'],
    status: 'stable',
  }),
  builtin({
    id: 'text-embedding-3-large',
    providerId: 'openai',
    name: 'Text Embedding 3 Large',
    description: 'High-precision embedding model',
    capabilities: ['embedding'],
    recommendedFor: ['embedding'],
    status: 'stable',
  }),
]

// ==================== Anthropic ====================

const ANTHROPIC_MODELS: ModelDefinition[] = [
  builtin({
    id: 'claude-opus-4-6',
    providerId: 'anthropic',
    name: 'Claude Opus 4.6',
    description: 'Latest flagship, adaptive thinking',
    capabilities: ['chat', 'reasoning', 'vision', 'function_calling'],
    recommendedFor: ['chat'],
    status: 'stable',
  }),
  builtin({
    id: 'claude-sonnet-4-6',
    providerId: 'anthropic',
    name: 'Claude Sonnet 4.6',
    description: 'Cost-effective, adaptive thinking',
    capabilities: ['chat', 'reasoning', 'vision', 'function_calling'],
    recommendedFor: ['chat'],
    status: 'stable',
  }),
  builtin({
    id: 'claude-opus-4-5',
    providerId: 'anthropic',
    name: 'Claude Opus 4.5',
    description: 'Previous generation flagship',
    capabilities: ['chat', 'reasoning', 'vision', 'function_calling'],
    recommendedFor: [],
    status: 'stable',
  }),
  builtin({
    id: 'claude-sonnet-4-5',
    providerId: 'anthropic',
    name: 'Claude Sonnet 4.5',
    description: 'Previous generation cost-effective',
    capabilities: ['chat', 'vision', 'function_calling'],
    recommendedFor: [],
    status: 'stable',
  }),
  builtin({
    id: 'claude-haiku-4-5',
    providerId: 'anthropic',
    name: 'Claude Haiku 4.5',
    description: 'Fast and lightweight',
    capabilities: ['chat', 'vision', 'function_calling'],
    recommendedFor: [],
    status: 'stable',
  }),
  builtin({
    id: 'claude-sonnet-4-20250514',
    providerId: 'anthropic',
    name: 'Claude Sonnet 4',
    description: 'Sonnet 4 snapshot',
    capabilities: ['chat', 'vision', 'function_calling'],
    recommendedFor: [],
    status: 'stable',
  }),
  builtin({
    id: 'claude-opus-4-20250514',
    providerId: 'anthropic',
    name: 'Claude Opus 4',
    description: 'Opus 4 snapshot',
    capabilities: ['chat', 'vision', 'function_calling'],
    recommendedFor: [],
    status: 'stable',
  }),
  builtin({
    id: 'claude-haiku-3-5-20241022',
    providerId: 'anthropic',
    name: 'Claude 3.5 Haiku',
    description: '3.5 Haiku snapshot',
    capabilities: ['chat', 'vision', 'function_calling'],
    recommendedFor: [],
    status: 'stable',
  }),
]

// ==================== Gemini ====================

const GEMINI_MODELS: ModelDefinition[] = [
  builtin({
    id: 'gemini-3.1-pro-preview',
    providerId: 'gemini',
    name: 'Gemini 3.1 Pro',
    description: 'Latest Gemini 3.1 Pro preview',
    capabilities: ['chat', 'reasoning', 'vision', 'function_calling'],
    recommendedFor: ['chat'],
    status: 'preview',
  }),
  builtin({
    id: 'gemini-3-pro-preview',
    providerId: 'gemini',
    name: 'Gemini 3 Pro',
    description: 'Gemini 3 Pro preview',
    capabilities: ['chat', 'reasoning', 'vision', 'function_calling'],
    recommendedFor: ['chat'],
    status: 'preview',
  }),
  builtin({
    id: 'gemini-2.5-flash',
    providerId: 'gemini',
    name: 'Gemini 2.5 Flash',
    description: 'Cost-effective, low latency, adaptive thinking',
    capabilities: ['chat', 'reasoning', 'vision', 'function_calling'],
    recommendedFor: ['chat'],
    status: 'stable',
  }),
  builtin({
    id: 'gemini-2.5-pro',
    providerId: 'gemini',
    name: 'Gemini 2.5 Pro',
    description: 'Deep reasoning and complex tasks',
    capabilities: ['chat', 'reasoning', 'vision', 'function_calling'],
    recommendedFor: ['chat'],
    status: 'stable',
  }),
  builtin({
    id: 'gemini-2.0-flash',
    providerId: 'gemini',
    name: 'Gemini 2.0 Flash',
    description: 'Previous generation fast model',
    capabilities: ['chat', 'vision', 'function_calling'],
    recommendedFor: [],
    status: 'stable',
  }),
  builtin({
    id: 'text-embedding-004',
    providerId: 'gemini',
    name: 'Text Embedding 004',
    description: 'Google embedding model',
    capabilities: ['embedding'],
    recommendedFor: ['embedding'],
    status: 'stable',
  }),
]

// ==================== DeepSeek ====================

const DEEPSEEK_MODELS: ModelDefinition[] = [
  builtin({
    id: 'deepseek-v4-pro',
    providerId: 'deepseek',
    name: 'DeepSeek V4 Pro',
    description: 'Flagship model, 1M context, thinking & non-thinking',
    capabilities: ['chat', 'reasoning', 'function_calling'],
    recommendedFor: ['chat'],
    status: 'stable',
  }),
  builtin({
    id: 'deepseek-v4-flash',
    providerId: 'deepseek',
    name: 'DeepSeek V4 Flash',
    description: 'Fast model, 1M context, thinking & non-thinking',
    capabilities: ['chat', 'reasoning', 'function_calling'],
    recommendedFor: ['chat'],
    status: 'stable',
  }),
]

// ==================== 通义千问 ====================

const QWEN_MODELS: ModelDefinition[] = [
  builtin({
    id: 'qwen3.5-plus',
    providerId: 'qwen',
    name: 'Qwen3.5 Plus',
    description: 'Latest Qwen3.5 flagship',
    capabilities: ['chat', 'reasoning', 'vision', 'function_calling'],
    recommendedFor: ['chat'],
    status: 'stable',
  }),
  builtin({
    id: 'qwen3.5-flash',
    providerId: 'qwen',
    name: 'Qwen3.5 Flash',
    description: 'Qwen3.5 fast version',
    capabilities: ['chat', 'reasoning', 'function_calling'],
    recommendedFor: ['chat'],
    status: 'stable',
  }),
  builtin({
    id: 'qwen3-max',
    providerId: 'qwen',
    name: 'Qwen3 Max',
    description: 'Qwen3 massive-scale',
    capabilities: ['chat', 'reasoning', 'vision', 'function_calling'],
    recommendedFor: ['chat'],
    status: 'stable',
  }),
  builtin({
    id: 'qwen-max',
    providerId: 'qwen',
    name: 'Qwen Max',
    description: 'Massive-scale language model',
    capabilities: ['chat', 'vision', 'function_calling'],
    recommendedFor: [],
    status: 'stable',
  }),
  builtin({
    id: 'qwen-plus',
    providerId: 'qwen',
    name: 'Qwen Plus',
    description: 'Good quality, suitable for most scenarios',
    capabilities: ['chat', 'vision', 'function_calling'],
    recommendedFor: [],
    status: 'stable',
  }),
  builtin({
    id: 'qwen-turbo',
    providerId: 'qwen',
    name: 'Qwen Turbo',
    description: 'Fast and cost-effective',
    capabilities: ['chat', 'function_calling'],
    recommendedFor: [],
    status: 'stable',
  }),
  builtin({
    id: 'qwen-long',
    providerId: 'qwen',
    name: 'Qwen Long',
    description: 'Ultra-long context model',
    capabilities: ['chat'],
    recommendedFor: [],
    status: 'stable',
  }),
  builtin({
    id: 'text-embedding-v3',
    providerId: 'qwen',
    name: 'Text Embedding V3',
    description: 'Qwen embedding model',
    capabilities: ['embedding'],
    recommendedFor: ['embedding'],
    status: 'stable',
  }),
]

// ==================== 智谱 GLM ====================

const GLM_MODELS: ModelDefinition[] = [
  builtin({
    id: 'glm-5',
    providerId: 'glm',
    name: 'GLM-5',
    description: 'Latest flagship model',
    capabilities: ['chat', 'reasoning', 'function_calling'],
    recommendedFor: ['chat'],
    status: 'stable',
  }),
  builtin({
    id: 'glm-4.7',
    providerId: 'glm',
    name: 'GLM-4.7',
    description: 'GLM-4.7 high performance',
    capabilities: ['chat', 'function_calling'],
    recommendedFor: ['chat'],
    status: 'stable',
  }),
  builtin({
    id: 'glm-4.6v',
    providerId: 'glm',
    name: 'GLM-4.6V',
    description: '4.6 multimodal model',
    capabilities: ['chat', 'vision', 'function_calling'],
    recommendedFor: ['chat'],
    status: 'stable',
  }),
  builtin({
    id: 'glm-4.6v-flash',
    providerId: 'glm',
    name: 'GLM-4.6V Flash',
    description: '4.6V free multimodal',
    capabilities: ['chat', 'vision', 'function_calling'],
    recommendedFor: [],
    status: 'stable',
  }),
  builtin({
    id: 'glm-4.5',
    providerId: 'glm',
    name: 'GLM-4.5',
    description: 'GLM-4.5 standard',
    capabilities: ['chat', 'function_calling'],
    recommendedFor: [],
    status: 'stable',
  }),
  builtin({
    id: 'glm-4.5-flash',
    providerId: 'glm',
    name: 'GLM-4.5 Flash',
    description: '4.5 free model',
    capabilities: ['chat', 'function_calling'],
    recommendedFor: [],
    status: 'stable',
  }),
  builtin({
    id: 'glm-4-plus',
    providerId: 'glm',
    name: 'GLM-4 Plus',
    description: 'Previous generation flagship',
    capabilities: ['chat', 'function_calling'],
    recommendedFor: [],
    status: 'stable',
  }),
  builtin({
    id: 'glm-4-flash',
    providerId: 'glm',
    name: 'GLM-4 Flash',
    description: 'Fast model',
    capabilities: ['chat', 'function_calling'],
    recommendedFor: [],
    status: 'stable',
  }),
  builtin({
    id: 'embedding-3',
    providerId: 'glm',
    name: 'Embedding-3',
    description: 'Zhipu embedding model',
    capabilities: ['embedding'],
    recommendedFor: ['embedding'],
    status: 'stable',
  }),
]

// ==================== Kimi ====================

const KIMI_MODELS: ModelDefinition[] = [
  builtin({
    id: 'kimi-k2.5',
    providerId: 'kimi',
    name: 'Kimi K2.5',
    description: 'Latest flagship with vision support',
    capabilities: ['chat', 'vision', 'function_calling'],
    recommendedFor: ['chat'],
    status: 'stable',
  }),
  builtin({
    id: 'kimi-k2-thinking',
    providerId: 'kimi',
    name: 'Kimi K2 Thinking',
    description: 'K2 deep reasoning',
    capabilities: ['chat', 'reasoning', 'function_calling'],
    recommendedFor: ['chat'],
    status: 'stable',
  }),
  builtin({
    id: 'kimi-k2-thinking-turbo',
    providerId: 'kimi',
    name: 'Kimi K2 Thinking Turbo',
    description: 'K2 fast reasoning',
    capabilities: ['chat', 'reasoning', 'function_calling'],
    recommendedFor: [],
    status: 'stable',
  }),
  builtin({
    id: 'kimi-k2-0905-Preview',
    providerId: 'kimi',
    name: 'Kimi K2 Preview',
    description: 'K2 preview',
    capabilities: ['chat', 'function_calling'],
    recommendedFor: [],
    status: 'preview',
  }),
  builtin({
    id: 'moonshot-v1-auto',
    providerId: 'kimi',
    name: 'Moonshot V1 Auto',
    description: 'Auto-select context length',
    capabilities: ['chat', 'function_calling'],
    recommendedFor: [],
    status: 'stable',
  }),
]

// ==================== 豆包 ====================

const DOUBAO_MODELS: ModelDefinition[] = [
  builtin({
    id: 'doubao-seed-2-0-pro-260215',
    providerId: 'doubao',
    name: 'Doubao Seed 2.0 Pro',
    description: 'Latest flagship model',
    capabilities: ['chat', 'reasoning', 'vision', 'function_calling'],
    recommendedFor: ['chat'],
    status: 'stable',
  }),
  builtin({
    id: 'doubao-seed-2-0-lite-260215',
    providerId: 'doubao',
    name: 'Doubao Seed 2.0 Lite',
    description: 'Seed 2.0 lightweight',
    capabilities: ['chat', 'reasoning', 'function_calling'],
    recommendedFor: ['chat'],
    status: 'stable',
  }),
  builtin({
    id: 'doubao-seed-2-0-mini-260215',
    providerId: 'doubao',
    name: 'Doubao Seed 2.0 Mini',
    description: 'Seed 2.0 ultra-fast',
    capabilities: ['chat', 'function_calling'],
    recommendedFor: [],
    status: 'stable',
  }),
  builtin({
    id: 'doubao-seed-1-8-251228',
    providerId: 'doubao',
    name: 'Doubao Seed 1.8',
    description: 'Previous generation flagship',
    capabilities: ['chat', 'reasoning', 'vision', 'function_calling'],
    recommendedFor: [],
    status: 'stable',
  }),
  builtin({
    id: 'doubao-seed-1-6-251015',
    providerId: 'doubao',
    name: 'Doubao Seed 1.6',
    description: 'High-performance general model',
    capabilities: ['chat', 'reasoning', 'vision', 'function_calling'],
    recommendedFor: [],
    status: 'stable',
  }),
  builtin({
    id: 'doubao-seed-1-6-lite-251015',
    providerId: 'doubao',
    name: 'Doubao Seed 1.6 Lite',
    description: 'Lightweight and cost-effective',
    capabilities: ['chat', 'function_calling'],
    recommendedFor: [],
    status: 'stable',
  }),
]

// ==================== 硅基流动 ====================

const SILICONFLOW_MODELS: ModelDefinition[] = [
  builtin({
    id: 'deepseek-ai/DeepSeek-V3.2',
    providerId: 'siliconflow',
    name: 'DeepSeek V3.2',
    description: 'DeepSeek V3.2 on SiliconFlow',
    capabilities: ['chat', 'function_calling'],
    recommendedFor: ['chat'],
    status: 'stable',
  }),
  builtin({
    id: 'deepseek-ai/DeepSeek-R1',
    providerId: 'siliconflow',
    name: 'DeepSeek R1',
    description: 'DeepSeek R1 reasoning model',
    capabilities: ['chat', 'reasoning'],
    recommendedFor: ['chat'],
    status: 'stable',
  }),
  builtin({
    id: 'Qwen/Qwen3-8B',
    providerId: 'siliconflow',
    name: 'Qwen3 8B',
    description: 'Qwen3 8B lightweight model',
    capabilities: ['chat'],
    recommendedFor: [],
    status: 'stable',
  }),
]

// ==================== Groq ====================

const GROQ_MODELS: ModelDefinition[] = [
  builtin({
    id: 'llama3-70b-8192',
    providerId: 'groq',
    name: 'LLaMA3 70B',
    description: 'Meta LLaMA3 70B ultra-fast inference',
    capabilities: ['chat', 'function_calling'],
    recommendedFor: ['chat'],
    status: 'stable',
  }),
  builtin({
    id: 'llama3-8b-8192',
    providerId: 'groq',
    name: 'LLaMA3 8B',
    description: 'Meta LLaMA3 8B lightweight ultra-fast',
    capabilities: ['chat'],
    recommendedFor: ['chat'],
    status: 'stable',
  }),
  builtin({
    id: 'mistral-saba-24b',
    providerId: 'groq',
    name: 'Mistral Saba 24B',
    description: 'Mistral Saba 24B',
    capabilities: ['chat'],
    recommendedFor: [],
    status: 'stable',
  }),
  builtin({
    id: 'gemma-9b-it',
    providerId: 'groq',
    name: 'Gemma 9B',
    description: 'Google Gemma 9B',
    capabilities: ['chat'],
    recommendedFor: [],
    status: 'stable',
  }),
]

// ==================== OpenRouter ====================

const OPENROUTER_MODELS: ModelDefinition[] = [
  builtin({
    id: 'deepseek/deepseek-v4-pro',
    providerId: 'openrouter',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek V4 Pro via OpenRouter',
    capabilities: ['chat', 'reasoning', 'function_calling'],
    recommendedFor: ['chat'],
    status: 'stable',
  }),
  builtin({
    id: 'google/gemini-2.5-flash-preview',
    providerId: 'openrouter',
    name: 'Gemini 2.5 Flash',
    description: 'Google Gemini 2.5 Flash via OpenRouter',
    capabilities: ['chat', 'vision', 'function_calling'],
    recommendedFor: ['chat'],
    status: 'stable',
  }),
  builtin({
    id: 'mistralai/mistral-7b-instruct:free',
    providerId: 'openrouter',
    name: 'Mistral 7B (Free)',
    description: 'Mistral 7B free tier',
    capabilities: ['chat'],
    recommendedFor: [],
    status: 'stable',
  }),
]

// ==================== xAI ====================

const XAI_MODELS: ModelDefinition[] = [
  builtin({
    id: 'grok-4',
    providerId: 'xai',
    name: 'Grok 4',
    description: 'Latest flagship model',
    capabilities: ['chat', 'reasoning', 'vision', 'function_calling'],
    recommendedFor: ['chat'],
    status: 'stable',
  }),
  builtin({
    id: 'grok-3',
    providerId: 'xai',
    name: 'Grok 3',
    description: 'Grok 3 standard',
    capabilities: ['chat', 'vision', 'function_calling'],
    recommendedFor: ['chat'],
    status: 'stable',
  }),
  builtin({
    id: 'grok-3-fast',
    providerId: 'xai',
    name: 'Grok 3 Fast',
    description: 'Grok 3 fast version',
    capabilities: ['chat', 'function_calling'],
    recommendedFor: [],
    status: 'stable',
  }),
  builtin({
    id: 'grok-3-mini',
    providerId: 'xai',
    name: 'Grok 3 Mini',
    description: 'Grok 3 small reasoning model',
    capabilities: ['chat', 'reasoning', 'function_calling'],
    recommendedFor: [],
    status: 'stable',
  }),
  builtin({
    id: 'grok-3-mini-fast',
    providerId: 'xai',
    name: 'Grok 3 Mini Fast',
    description: 'Grok 3 Mini fast version',
    capabilities: ['chat', 'reasoning', 'function_calling'],
    recommendedFor: [],
    status: 'stable',
  }),
]

// ==================== MiniMax ====================

const MINIMAX_MODELS: ModelDefinition[] = [
  builtin({
    id: 'MiniMax-M2.7',
    providerId: 'minimax',
    name: 'MiniMax M2.7',
    description: 'Latest flagship model',
    capabilities: ['chat', 'function_calling'],
    recommendedFor: ['chat'],
    status: 'stable',
  }),
  builtin({
    id: 'MiniMax-M2.7-highspeed',
    providerId: 'minimax',
    name: 'MiniMax M2.7 HS',
    description: 'M2.7 high-speed',
    capabilities: ['chat', 'function_calling'],
    recommendedFor: ['chat'],
    status: 'stable',
  }),
  builtin({
    id: 'MiniMax-M2.5',
    providerId: 'minimax',
    name: 'MiniMax M2.5',
    description: 'M2.5 standard',
    capabilities: ['chat', 'function_calling'],
    recommendedFor: [],
    status: 'stable',
  }),
  builtin({
    id: 'MiniMax-M2.5-highspeed',
    providerId: 'minimax',
    name: 'MiniMax M2.5 HS',
    description: 'M2.5 high-speed',
    capabilities: ['chat', 'function_calling'],
    recommendedFor: [],
    status: 'stable',
  }),
]

// ==================== 汇总导出 ====================

export const BUILTIN_MODELS: ModelDefinition[] = [
  ...OPENAI_MODELS,
  ...ANTHROPIC_MODELS,
  ...GEMINI_MODELS,
  ...DEEPSEEK_MODELS,
  ...QWEN_MODELS,
  ...GLM_MODELS,
  ...KIMI_MODELS,
  ...DOUBAO_MODELS,
  ...SILICONFLOW_MODELS,
  ...GROQ_MODELS,
  ...OPENROUTER_MODELS,
  ...XAI_MODELS,
  ...MINIMAX_MODELS,
]

/** 按 provider 筛选内置模型 */
export function getBuiltinModelsByProvider(providerId: string): ModelDefinition[] {
  return BUILTIN_MODELS.filter((m) => m.providerId === providerId)
}

/** 按 id + providerId 查找内置模型 */
export function getBuiltinModelById(providerId: string, modelId: string): ModelDefinition | null {
  return BUILTIN_MODELS.find((m) => m.providerId === providerId && m.id === modelId) || null
}
