import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { PromptPreset, AIPromptSettings } from '@/types/ai'
import type { KeywordTemplate } from '@/types/analysis'
import {
  BUILTIN_PRESETS,
  DEFAULT_GROUP_PRESET_ID,
  DEFAULT_PRIVATE_PRESET_ID,
  CYBER_JUDGE_GROUP_PRESET_ID,
  CYBER_JUDGE_PRIVATE_PRESET_ID,
  getOriginalBuiltinPreset,
} from '@/config/prompts'

/**
 * AI 配置、提示词和关键词模板相关的全局状态
 */
export const usePromptStore = defineStore(
  'prompt',
  () => {
    const customPromptPresets = ref<PromptPreset[]>([])
    const builtinPresetOverrides = ref<
      Record<string, { name?: string; roleDefinition?: string; responseRules?: string; updatedAt?: number }>
    >({})
    const aiPromptSettings = ref<AIPromptSettings>({
      activeGroupPresetId: CYBER_JUDGE_GROUP_PRESET_ID,
      activePrivatePresetId: CYBER_JUDGE_PRIVATE_PRESET_ID,
    })
    const aiConfigVersion = ref(0)
    const aiGlobalSettings = ref({
      maxMessagesPerRequest: 200,
      maxHistoryRounds: 5, // AI上下文会话轮数限制
    })
    const customKeywordTemplates = ref<KeywordTemplate[]>([])
    const deletedPresetTemplateIds = ref<string[]>([])

    /** 获取所有提示词预设（内置 + 覆盖 + 自定义） */
    const allPromptPresets = computed(() => {
      const mergedBuiltins = BUILTIN_PRESETS.map((preset) => {
        const override = builtinPresetOverrides.value[preset.id]
        if (override) {
          return { ...preset, ...override }
        }
        return preset
      })
      return [...mergedBuiltins, ...customPromptPresets.value]
    })

    /** 群聊预设列表 */
    const groupPresets = computed(() => allPromptPresets.value.filter((p) => p.chatType === 'group'))

    /** 私聊预设列表 */
    const privatePresets = computed(() => allPromptPresets.value.filter((p) => p.chatType === 'private'))

    /** 当前激活的群聊预设 */
    const activeGroupPreset = computed(() => {
      const preset = allPromptPresets.value.find((p) => p.id === aiPromptSettings.value.activeGroupPresetId)
      return preset || BUILTIN_PRESETS.find((p) => p.id === DEFAULT_GROUP_PRESET_ID)!
    })

    /** 当前激活的私聊预设 */
    const activePrivatePreset = computed(() => {
      const preset = allPromptPresets.value.find((p) => p.id === aiPromptSettings.value.activePrivatePresetId)
      return preset || BUILTIN_PRESETS.find((p) => p.id === DEFAULT_PRIVATE_PRESET_ID)!
    })

    /**
     * 通知外部 AI 配置已经被修改
     */
    function notifyAIConfigChanged() {
      aiConfigVersion.value++
    }

    /**
     * 更新 AI 全局设置
     */
    function updateAIGlobalSettings(settings: Partial<{ maxMessagesPerRequest: number; maxHistoryRounds: number }>) {
      aiGlobalSettings.value = { ...aiGlobalSettings.value, ...settings }
      notifyAIConfigChanged()
    }

    /**
     * 新增自定义关键词模板
     */
    function addCustomKeywordTemplate(template: KeywordTemplate) {
      customKeywordTemplates.value.push(template)
    }

    /**
     * 更新自定义关键词模板
     */
    function updateCustomKeywordTemplate(templateId: string, updates: Partial<Omit<KeywordTemplate, 'id'>>) {
      const index = customKeywordTemplates.value.findIndex((t) => t.id === templateId)
      if (index !== -1) {
        customKeywordTemplates.value[index] = {
          ...customKeywordTemplates.value[index],
          ...updates,
        }
      }
    }

    /**
     * 删除自定义关键词模板
     */
    function removeCustomKeywordTemplate(templateId: string) {
      const index = customKeywordTemplates.value.findIndex((t) => t.id === templateId)
      if (index !== -1) {
        customKeywordTemplates.value.splice(index, 1)
      }
    }

    /**
     * 标记预设模板为已删除
     */
    function addDeletedPresetTemplateId(id: string) {
      if (!deletedPresetTemplateIds.value.includes(id)) {
        deletedPresetTemplateIds.value.push(id)
      }
    }

    /**
     * 添加新的提示词预设
     */
    function addPromptPreset(preset: {
      name: string
      chatType: PromptPreset['chatType']
      roleDefinition: string
      responseRules: string
    }) {
      const newPreset: PromptPreset = {
        ...preset,
        id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        isBuiltIn: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      customPromptPresets.value.push(newPreset)
      return newPreset.id
    }

    /**
     * 更新提示词预设（含内置覆盖）
     */
    function updatePromptPreset(
      presetId: string,
      updates: { name?: string; chatType?: PromptPreset['chatType']; roleDefinition?: string; responseRules?: string }
    ) {
      const isBuiltin = BUILTIN_PRESETS.some((p) => p.id === presetId)
      if (isBuiltin) {
        builtinPresetOverrides.value[presetId] = {
          ...builtinPresetOverrides.value[presetId],
          name: updates.name,
          roleDefinition: updates.roleDefinition,
          responseRules: updates.responseRules,
          updatedAt: Date.now(),
        }
        return
      }

      const index = customPromptPresets.value.findIndex((p) => p.id === presetId)
      if (index !== -1) {
        customPromptPresets.value[index] = {
          ...customPromptPresets.value[index],
          ...updates,
          updatedAt: Date.now(),
        }
      }
    }

    /**
     * 重置内置预设为初始状态
     */
    function resetBuiltinPreset(presetId: string): boolean {
      const original = getOriginalBuiltinPreset(presetId)
      if (!original) return false
      delete builtinPresetOverrides.value[presetId]
      return true
    }

    /**
     * 判断内置预设是否被自定义过
     */
    function isBuiltinPresetModified(presetId: string): boolean {
      return !!builtinPresetOverrides.value[presetId]
    }

    /**
     * 删除提示词预设（自定义）
     */
    function removePromptPreset(presetId: string) {
      const index = customPromptPresets.value.findIndex((p) => p.id === presetId)
      if (index !== -1) {
        customPromptPresets.value.splice(index, 1)
        if (aiPromptSettings.value.activeGroupPresetId === presetId) {
          aiPromptSettings.value.activeGroupPresetId = DEFAULT_GROUP_PRESET_ID
        }
        if (aiPromptSettings.value.activePrivatePresetId === presetId) {
          aiPromptSettings.value.activePrivatePresetId = DEFAULT_PRIVATE_PRESET_ID
        }
      }
    }

    /**
     * 复制指定提示词预设
     */
    function duplicatePromptPreset(presetId: string) {
      const source = allPromptPresets.value.find((p) => p.id === presetId)
      if (source) {
        return addPromptPreset({
          name: `${source.name} (副本)`,
          chatType: source.chatType,
          roleDefinition: source.roleDefinition,
          responseRules: source.responseRules,
        })
      }
      return null
    }

    /**
     * 设置当前激活的群聊预设
     */
    function setActiveGroupPreset(presetId: string) {
      const preset = allPromptPresets.value.find((p) => p.id === presetId)
      if (preset && preset.chatType === 'group') {
        aiPromptSettings.value.activeGroupPresetId = presetId
        notifyAIConfigChanged()
      }
    }

    /**
     * 设置当前激活的私聊预设
     */
    function setActivePrivatePreset(presetId: string) {
      const preset = allPromptPresets.value.find((p) => p.id === presetId)
      if (preset && preset.chatType === 'private') {
        aiPromptSettings.value.activePrivatePresetId = presetId
        notifyAIConfigChanged()
      }
    }

    /**
     * 获取指定聊天类型对应的激活预设
     */
    function getActivePresetForChatType(chatType: 'group' | 'private'): PromptPreset {
      return chatType === 'group' ? activeGroupPreset.value : activePrivatePreset.value
    }

    return {
      // state
      customPromptPresets,
      builtinPresetOverrides,
      aiPromptSettings,
      aiConfigVersion,
      aiGlobalSettings,
      customKeywordTemplates,
      deletedPresetTemplateIds,
      // getters
      allPromptPresets,
      groupPresets,
      privatePresets,
      activeGroupPreset,
      activePrivatePreset,
      // actions
      notifyAIConfigChanged,
      updateAIGlobalSettings,
      addCustomKeywordTemplate,
      updateCustomKeywordTemplate,
      removeCustomKeywordTemplate,
      addDeletedPresetTemplateId,
      addPromptPreset,
      updatePromptPreset,
      resetBuiltinPreset,
      isBuiltinPresetModified,
      removePromptPreset,
      duplicatePromptPreset,
      setActiveGroupPreset,
      setActivePrivatePreset,
      getActivePresetForChatType,
    }
  },
  {
    persist: [
      {
        pick: [
          'customKeywordTemplates',
          'deletedPresetTemplateIds',
          'aiGlobalSettings',
          'customPromptPresets',
          'builtinPresetOverrides',
          'aiPromptSettings',
        ],
        storage: localStorage,
      },
    ],
  }
)
