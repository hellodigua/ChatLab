import { defineStore, storeToRefs } from 'pinia'
import { ref, computed } from 'vue'
import type { PromptPreset, AIPromptSettings } from '@/types/ai'
import type { KeywordTemplate } from '@/types/analysis'
import {
  DEFAULT_GROUP_PRESET_ID,
  DEFAULT_PRIVATE_PRESET_ID,
  getBuiltinPresets,
  getOriginalBuiltinPreset,
  type LocaleType,
} from '@/config/prompts'
import { useSettingsStore } from './settings'

// 远程预设配置 URL 基础地址
const REMOTE_PRESET_BASE_URL = 'https://chatlab.fun'

/**
 * 远程预设的原始数据结构（从 JSON 获取）
 */
export interface RemotePresetData {
  id: string
  name: string
  chatType: 'group' | 'private'
  roleDefinition: string
  responseRules: string
}

/**
 * AI 配置、提示词和关键词模板相关的全局状态
 */
export const usePromptStore = defineStore(
  'prompt',
  () => {
    // 获取当前语言设置
    const settingsStore = useSettingsStore()
    const { locale } = storeToRefs(settingsStore)

    const customPromptPresets = ref<PromptPreset[]>([])
    const builtinPresetOverrides = ref<
      Record<string, { name?: string; roleDefinition?: string; responseRules?: string; updatedAt?: number }>
    >({})
    const aiPromptSettings = ref<AIPromptSettings>({
      activeGroupPresetId: DEFAULT_GROUP_PRESET_ID,
      activePrivatePresetId: DEFAULT_PRIVATE_PRESET_ID,
    })
    const aiConfigVersion = ref(0)
    const aiGlobalSettings = ref({
      maxMessagesPerRequest: 500,
      maxHistoryRounds: 5, // AI上下文会话轮数限制
    })
    const customKeywordTemplates = ref<KeywordTemplate[]>([])
    const deletedPresetTemplateIds = ref<string[]>([])
    /** 已同步的远程预设 ID 列表（避免重复添加） */
    const fetchedRemotePresetIds = ref<string[]>([])

    /** 当前语言的内置预设列表（响应式） */
    const builtinPresets = computed(() => getBuiltinPresets(locale.value as LocaleType))

    /** 获取所有提示词预设（内置 + 覆盖 + 自定义） */
    const allPromptPresets = computed(() => {
      const mergedBuiltins = builtinPresets.value.map((preset) => {
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
      return preset || builtinPresets.value.find((p) => p.id === DEFAULT_GROUP_PRESET_ID)!
    })

    /** 当前激活的私聊预设 */
    const activePrivatePreset = computed(() => {
      const preset = allPromptPresets.value.find((p) => p.id === aiPromptSettings.value.activePrivatePresetId)
      return preset || builtinPresets.value.find((p) => p.id === DEFAULT_PRIVATE_PRESET_ID)!
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
      const isBuiltin = builtinPresets.value.some((p) => p.id === presetId)
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
      const original = getOriginalBuiltinPreset(presetId, locale.value as LocaleType)
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
        const copySuffix = locale.value === 'zh-CN' ? '(副本)' : '(Copy)'
        return addPromptPreset({
          name: `${source.name} ${copySuffix}`,
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

    /**
     * 从远程获取预设列表（仅获取，不自动添加）
     * @param locale 当前语言设置 (如 'zh-CN', 'en-US')
     * @returns 远程预设列表，获取失败返回空数组
     */
    async function fetchRemotePresets(locale: string): Promise<RemotePresetData[]> {
      const langPath = locale === 'zh-CN' ? 'cn' : 'en'
      const url = `${REMOTE_PRESET_BASE_URL}/${langPath}/prompt.json`

      try {
        const result = await window.api.app.fetchRemoteConfig(url)
        if (!result.success || !result.data) {
          return []
        }

        const remotePresets = result.data as RemotePresetData[]
        if (!Array.isArray(remotePresets)) {
          return []
        }

        // 过滤无效数据
        return remotePresets.filter(
          (preset) =>
            preset.id && preset.name && preset.chatType && preset.roleDefinition && preset.responseRules
        )
      } catch {
        return []
      }
    }

    /**
     * 添加远程预设到自定义预设列表
     * @param preset 远程预设数据
     * @returns 是否添加成功
     */
    function addRemotePreset(preset: RemotePresetData): boolean {
      // 检查是否已添加
      if (fetchedRemotePresetIds.value.includes(preset.id)) {
        return false
      }

      const now = Date.now()
      const newPreset: PromptPreset = {
        id: preset.id,
        name: preset.name,
        chatType: preset.chatType,
        roleDefinition: preset.roleDefinition,
        responseRules: preset.responseRules,
        isBuiltIn: false,
        createdAt: now,
        updatedAt: now,
      }

      customPromptPresets.value.push(newPreset)
      fetchedRemotePresetIds.value.push(preset.id)
      return true
    }

    /**
     * 判断远程预设是否已添加
     * @param presetId 预设 ID
     */
    function isRemotePresetAdded(presetId: string): boolean {
      return fetchedRemotePresetIds.value.includes(presetId)
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
      fetchedRemotePresetIds,
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
      fetchRemotePresets,
      addRemotePreset,
      isRemotePresetAdded,
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
          'fetchedRemotePresetIds',
        ],
        storage: localStorage,
      },
    ],
  }
)
