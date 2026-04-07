import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { KeywordTemplate } from '@/types/analysis'

/**
 * AI 配置与关键词模板相关的全局状态
 */
export const usePromptStore = defineStore(
  'prompt',
  () => {
    const aiConfigVersion = ref(0)
    const aiGlobalSettings = ref({
      maxMessagesPerRequest: 1000,
      maxHistoryRounds: 5,
      exportFormat: 'markdown' as 'markdown' | 'txt',
      sqlExportFormat: 'csv' as 'csv' | 'json',
      enableAutoSkill: true,
      searchContextBefore: 2,
      searchContextAfter: 2,
    })
    const customKeywordTemplates = ref<KeywordTemplate[]>([])
    const deletedPresetTemplateIds = ref<string[]>([])

    /**
     * 通知外部 AI 配置已经被修改
     */
    function notifyAIConfigChanged() {
      aiConfigVersion.value++
    }

    /**
     * 更新 AI 全局设置
     */
    function updateAIGlobalSettings(
      settings: Partial<{
        maxMessagesPerRequest: number
        maxHistoryRounds: number
        exportFormat: 'markdown' | 'txt'
        sqlExportFormat: 'csv' | 'json'
        enableAutoSkill: boolean
        searchContextBefore: number
        searchContextAfter: number
      }>
    ) {
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

    return {
      // state
      aiConfigVersion,
      aiGlobalSettings,
      customKeywordTemplates,
      deletedPresetTemplateIds,
      // actions
      notifyAIConfigChanged,
      updateAIGlobalSettings,
      addCustomKeywordTemplate,
      updateCustomKeywordTemplate,
      removeCustomKeywordTemplate,
      addDeletedPresetTemplateId,
    }
  },
  {
    persist: [
      {
        pick: ['customKeywordTemplates', 'deletedPresetTemplateIds', 'aiGlobalSettings'],
        storage: localStorage,
      },
    ],
  }
)
