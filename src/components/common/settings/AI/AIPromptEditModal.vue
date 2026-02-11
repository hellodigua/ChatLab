<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PromptPreset, PresetApplicableType } from '@/types/ai'
import {
  getDefaultRoleDefinition,
  getDefaultResponseRules,
  getLockedPromptSectionPreview,
  getOriginalBuiltinPreset,
  type LocaleType,
} from '@/config/prompts'
import { usePromptStore } from '@/stores/prompt'

const { t, locale } = useI18n()

// Props
const props = defineProps<{
  open: boolean
  mode: 'add' | 'edit'
  preset: PromptPreset | null
}>()

// Emits
const emit = defineEmits<{
  'update:open': [value: boolean]
  saved: []
}>()

// Store
const promptStore = usePromptStore()

// 表单数据
const formData = ref({
  name: '',
  roleDefinition: '',
  responseRules: '',
  supportGroup: true,
  supportPrivate: true,
})

// 计算属性
const isBuiltIn = computed(() => props.preset?.isBuiltIn ?? false)
const isEditMode = computed(() => props.mode === 'edit')
const isModified = computed(() => {
  if (!isBuiltIn.value || !props.preset) return false
  return promptStore.isBuiltinPresetModified(props.preset.id)
})

const modalTitle = computed(() => {
  if (isBuiltIn.value) return t('settings.aiPrompt.modal.editBuiltin')
  return isEditMode.value ? t('settings.aiPrompt.modal.editCustom') : t('settings.aiPrompt.modal.addCustom')
})

const canSave = computed(() => {
  return formData.value.name.trim() && formData.value.roleDefinition.trim() && formData.value.responseRules.trim()
})

/**
 * 将 applicableTo 转换为勾选状态
 */
function applicableToCheckboxes(applicableTo?: PresetApplicableType): { group: boolean; private: boolean } {
  if (!applicableTo || applicableTo === 'common') {
    return { group: true, private: true }
  }
  return {
    group: applicableTo === 'group',
    private: applicableTo === 'private',
  }
}

/**
 * 将勾选状态转换为 applicableTo
 */
function checkboxesToApplicableTo(group: boolean, private_: boolean): PresetApplicableType {
  if (group && private_) return 'common'
  if (group) return 'group'
  if (private_) return 'private'
  return 'common' // 默认全选
}

// 监听打开状态，初始化表单
watch(
  () => props.open,
  (newVal) => {
    if (newVal) {
      if (props.preset) {
        // 编辑模式：加载现有预设
        const checkboxes = applicableToCheckboxes(props.preset.applicableTo)
        formData.value = {
          name: props.preset.name,
          roleDefinition: props.preset.roleDefinition,
          responseRules: props.preset.responseRules,
          supportGroup: checkboxes.group,
          supportPrivate: checkboxes.private,
        }
      } else {
        // 添加模式：重置为默认
        formData.value = {
          name: '',
          roleDefinition: getDefaultRoleDefinition(locale.value as LocaleType),
          responseRules: getDefaultResponseRules(locale.value as LocaleType),
          supportGroup: true,
          supportPrivate: true,
        }
      }
    }
  }
)

/** 关闭弹窗 */
function closeModal() {
  emit('update:open', false)
}

/** 保存提示词预设 */
function handleSave() {
  if (!canSave.value) return

  const applicableTo = checkboxesToApplicableTo(formData.value.supportGroup, formData.value.supportPrivate)

  if (isEditMode.value && props.preset) {
    // 更新现有预设（支持内置和自定义）
    const updates: {
      name: string
      roleDefinition: string
      responseRules: string
      applicableTo?: PresetApplicableType
    } = {
      name: formData.value.name.trim(),
      roleDefinition: formData.value.roleDefinition.trim(),
      responseRules: formData.value.responseRules.trim(),
    }
    // 内置预设不更新 applicableTo
    if (!isBuiltIn.value) {
      updates.applicableTo = applicableTo
    }
    promptStore.updatePromptPreset(props.preset.id, updates)
  } else {
    // 添加新预设
    promptStore.addPromptPreset({
      name: formData.value.name.trim(),
      roleDefinition: formData.value.roleDefinition.trim(),
      responseRules: formData.value.responseRules.trim(),
      applicableTo,
    })
  }

  emit('saved')
  closeModal()
}

/** 重置内置预设为原始值 */
function handleReset() {
  if (!props.preset || !isBuiltIn.value) return

  const original = getOriginalBuiltinPreset(props.preset.id, locale.value as LocaleType)
  if (original) {
    // 重置表单为原始值
    formData.value = {
      name: original.name,
      roleDefinition: original.roleDefinition,
      responseRules: original.responseRules,
      supportGroup: true,
      supportPrivate: true,
    }
    // 清除覆盖
    promptStore.resetBuiltinPreset(props.preset.id)
  }
}

// 完整提示词预览（使用群聊模式作为示例）
const previewContent = computed(() => {
  // 获取锁定的系统部分（用于预览，默认使用群聊模式）
  const lockedSection = getLockedPromptSectionPreview('group', undefined, locale.value as LocaleType)

  // 组合完整提示词
  const responseRulesLabel = locale.value === 'zh-CN' ? '回答要求：' : 'Response requirements:'
  return `${formData.value.roleDefinition}

${lockedSection}

${responseRulesLabel}
${formData.value.responseRules}`
})
</script>

<template>
  <UModal :open="open" @update:open="emit('update:open', $event)" :ui="{ content: 'md:w-full max-w-2xl' }">
    <template #content>
      <div class="p-6">
        <!-- Header -->
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ modalTitle }}</h2>
          <UButton icon="i-heroicons-x-mark" variant="ghost" size="sm" @click="closeModal" />
        </div>

        <!-- 表单 -->
        <div class="max-h-[500px] space-y-4 overflow-y-auto pr-1">
          <!-- 预设名称 -->
          <div>
            <label class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {{ t('settings.aiPrompt.modal.presetName') }}
            </label>
            <UInput v-model="formData.name" :placeholder="t('settings.aiPrompt.modal.presetNamePlaceholder')" class="w-60" />
          </div>

          <!-- 适用场景（仅自定义预设显示） -->
          <div v-if="!isBuiltIn">
            <label class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {{ t('settings.aiPrompt.modal.applicableTo') }}
              <span class="font-normal text-gray-500">{{ t('settings.aiPrompt.modal.applicableToHint') }}</span>
            </label>
            <div class="flex items-center gap-4">
              <label class="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  v-model="formData.supportGroup"
                  class="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span class="text-sm text-gray-700 dark:text-gray-300">{{ t('settings.aiPrompt.modal.groupChat') }}</span>
              </label>
              <label class="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  v-model="formData.supportPrivate"
                  class="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span class="text-sm text-gray-700 dark:text-gray-300">{{ t('settings.aiPrompt.modal.privateChat') }}</span>
              </label>
            </div>
          </div>

          <!-- 角色定义 -->
          <div>
            <label class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {{ t('settings.aiPrompt.modal.roleDefinition') }}
            </label>
            <UTextarea
              v-model="formData.roleDefinition"
              :rows="8"
              :placeholder="t('settings.aiPrompt.modal.roleDefinitionPlaceholder')"
              class="w-120 font-mono text-sm"
            />
          </div>

          <!-- 回答要求 -->
          <div>
            <label class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {{ t('settings.aiPrompt.modal.responseRules') }}
              <span class="font-normal text-gray-500">{{ t('settings.aiPrompt.modal.responseRulesHint') }}</span>
            </label>
            <UTextarea
              v-model="formData.responseRules"
              :rows="5"
              :placeholder="t('settings.aiPrompt.modal.responseRulesPlaceholder')"
              class="w-120 font-mono text-sm"
            />
          </div>

          <!-- 完整提示词预览 -->
          <div>
            <label class="mb-1.5 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              <UIcon name="i-heroicons-eye" class="h-4 w-4 text-violet-500" />
              {{ t('settings.aiPrompt.modal.preview') }}
              <span class="font-normal text-gray-500">{{ t('settings.aiPrompt.modal.previewHint') }}</span>
            </label>
            <div class="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
              <pre class="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">{{ previewContent }}</pre>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="mt-6 flex justify-end gap-2">
          <!-- 内置预设：显示重置按钮 -->
          <UButton v-if="isBuiltIn && isModified" variant="outline" color="warning" @click="handleReset">
            <UIcon name="i-heroicons-arrow-path" class="mr-1 h-4 w-4" />
            {{ t('settings.aiPrompt.modal.resetToDefault') }}
          </UButton>
          <UButton variant="ghost" @click="closeModal">{{ t('common.cancel') }}</UButton>
          <UButton color="primary" :disabled="!canSave" @click="handleSave">
            {{ isEditMode ? t('settings.aiPrompt.modal.saveChanges') : t('settings.aiPrompt.modal.addPreset') }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
