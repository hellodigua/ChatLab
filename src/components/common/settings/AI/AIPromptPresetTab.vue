<script setup lang="ts">
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import type { PromptPreset } from '@/types/ai'
import AIPromptEditModal from './AIPromptEditModal.vue'
import ImportPresetModal from './ImportPresetModal.vue'
import { usePromptStore } from '@/stores/prompt'

const { t } = useI18n()

// Store
const promptStore = usePromptStore()
const { groupPresets, privatePresets, aiPromptSettings } = storeToRefs(promptStore)

// Emits
const emit = defineEmits<{
  'config-changed': []
}>()

// 弹窗状态
const showEditModal = ref(false)
const showImportModal = ref(false)
const editMode = ref<'add' | 'edit'>('add')
const editingPreset = ref<PromptPreset | null>(null)
const defaultChatType = ref<'group' | 'private'>('group')

/** 打开新增预设弹窗 */
function openAddModal(chatType: 'group' | 'private') {
  editMode.value = 'add'
  editingPreset.value = null
  defaultChatType.value = chatType
  showEditModal.value = true
}

/** 打开编辑预设弹窗 */
function openEditModal(preset: PromptPreset) {
  editMode.value = 'edit'
  editingPreset.value = preset
  defaultChatType.value = preset.chatType
  showEditModal.value = true
}

/** 处理子弹窗保存后的回调 */
function handleModalSaved() {
  emit('config-changed')
}

/** 设置当前激活的预设 */
function setActivePreset(presetId: string, chatType: 'group' | 'private') {
  if (chatType === 'group') {
    promptStore.setActiveGroupPreset(presetId)
  } else {
    promptStore.setActivePrivatePreset(presetId)
  }
  emit('config-changed')
}

/** 复制选中的预设 */
function duplicatePreset(presetId: string) {
  promptStore.duplicatePromptPreset(presetId)
  emit('config-changed')
}

/** 删除选中的预设 */
function deletePreset(presetId: string) {
  promptStore.removePromptPreset(presetId)
  emit('config-changed')
}

/** 判断预设是否处于激活状态 */
function isActivePreset(presetId: string, chatType: 'group' | 'private'): boolean {
  if (chatType === 'group') {
    return aiPromptSettings.value.activeGroupPresetId === presetId
  }
  return aiPromptSettings.value.activePrivatePresetId === presetId
}

/** 导入预设后的回调 */
function handleImportPresetAdded() {
  emit('config-changed')
}
</script>

<template>
  <div class="space-y-6">
    <!-- 系统提示词标题和导入按钮 -->
    <div class="flex items-center justify-between">
      <h4 class="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <UIcon name="i-heroicons-document-text" class="h-4 w-4 text-amber-500" />
        {{ t('settings.aiPrompt.presets.title') }}
      </h4>
      <UButton variant="soft" color="primary" size="xs" @click="showImportModal = true">
        <UIcon name="i-heroicons-cloud-arrow-down" class="mr-1 h-3.5 w-3.5" />
        {{ t('settings.aiPrompt.presets.import') }}
      </UButton>
    </div>

    <!-- 群聊和私聊系统提示词 -->
    <div class="space-y-6">
      <!-- 群聊预设组 -->
      <div>
        <div class="mb-3 flex items-center justify-between">
          <h4 class="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
            <UIcon name="i-heroicons-chat-bubble-left-right" class="h-4 w-4 text-violet-500" />
            {{ t('settings.aiPrompt.group.title') }}
          </h4>
          <UButton variant="ghost" color="gray" size="xs" @click="openAddModal('group')">
            <UIcon name="i-heroicons-plus" class="mr-1 h-3.5 w-3.5" />
            {{ t('settings.aiPrompt.group.add') }}
          </UButton>
        </div>
        <div class="space-y-2">
          <div
            v-for="preset in groupPresets"
            :key="preset.id"
            class="group flex cursor-pointer items-center justify-between rounded-lg border p-2.5 transition-colors"
            :class="[
              isActivePreset(preset.id, 'group')
                ? 'border-primary-300 bg-primary-50 dark:border-primary-700 dark:bg-primary-900/20'
                : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800',
            ]"
            @click="setActivePreset(preset.id, 'group')"
          >
            <!-- 预设信息 -->
            <div class="flex items-center gap-2">
              <div
                class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                :class="[
                  isActivePreset(preset.id, 'group')
                    ? 'bg-primary-500 text-white'
                    : 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
                ]"
              >
                <UIcon
                  :name="isActivePreset(preset.id, 'group') ? 'i-heroicons-check' : 'i-heroicons-document-text'"
                  class="h-3 w-3"
                />
              </div>
              <div class="flex items-center gap-1.5">
                <span class="text-xs font-medium text-gray-900 dark:text-white">{{ preset.name }}</span>
                <UBadge v-if="preset.isBuiltIn" color="gray" variant="soft" size="xs">
                  {{ t('settings.aiPrompt.preset.builtIn') }}
                </UBadge>
              </div>
            </div>

            <!-- 操作按钮 -->
            <div class="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100" @click.stop>
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                :icon="preset.isBuiltIn ? 'i-heroicons-eye' : 'i-heroicons-pencil-square'"
                @click="openEditModal(preset)"
              />
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-heroicons-document-duplicate"
                @click="duplicatePreset(preset.id)"
              />
              <UButton
                v-if="!preset.isBuiltIn"
                color="error"
                variant="ghost"
                size="xs"
                icon="i-heroicons-trash"
                @click="deletePreset(preset.id)"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- 私聊系统提示词 -->
      <div>
        <div class="mb-3 flex items-center justify-between">
          <h4 class="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
            <UIcon name="i-heroicons-user" class="h-4 w-4 text-blue-500" />
            {{ t('settings.aiPrompt.private.title') }}
          </h4>
          <UButton variant="ghost" color="gray" size="xs" @click="openAddModal('private')">
            <UIcon name="i-heroicons-plus" class="mr-1 h-3.5 w-3.5" />
            {{ t('settings.aiPrompt.private.add') }}
          </UButton>
        </div>
        <div class="space-y-2">
          <div
            v-for="preset in privatePresets"
            :key="preset.id"
            class="group flex cursor-pointer items-center justify-between rounded-lg border p-2.5 transition-colors"
            :class="[
              isActivePreset(preset.id, 'private')
                ? 'border-primary-300 bg-primary-50 dark:border-primary-700 dark:bg-primary-900/20'
                : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800',
            ]"
            @click="setActivePreset(preset.id, 'private')"
          >
            <!-- 预设信息 -->
            <div class="flex items-center gap-2">
              <div
                class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                :class="[
                  isActivePreset(preset.id, 'private')
                    ? 'bg-primary-500 text-white'
                    : 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
                ]"
              >
                <UIcon
                  :name="isActivePreset(preset.id, 'private') ? 'i-heroicons-check' : 'i-heroicons-document-text'"
                  class="h-3 w-3"
                />
              </div>
              <div class="flex items-center gap-1.5">
                <span class="text-xs font-medium text-gray-900 dark:text-white">{{ preset.name }}</span>
                <UBadge v-if="preset.isBuiltIn" color="gray" variant="soft" size="xs">
                  {{ t('settings.aiPrompt.preset.builtIn') }}
                </UBadge>
              </div>
            </div>

            <!-- 操作按钮 -->
            <div class="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100" @click.stop>
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                :icon="preset.isBuiltIn ? 'i-heroicons-eye' : 'i-heroicons-pencil-square'"
                @click="openEditModal(preset)"
              />
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-heroicons-document-duplicate"
                @click="duplicatePreset(preset.id)"
              />
              <UButton
                v-if="!preset.isBuiltIn"
                color="error"
                variant="ghost"
                size="xs"
                icon="i-heroicons-trash"
                @click="deletePreset(preset.id)"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 编辑/添加弹窗 -->
  <AIPromptEditModal
    v-model:open="showEditModal"
    :mode="editMode"
    :preset="editingPreset"
    :default-chat-type="defaultChatType"
    @saved="handleModalSaved"
  />

  <!-- 导入预设弹窗 -->
  <ImportPresetModal v-model:open="showImportModal" @preset-added="handleImportPresetAdded" />
</template>
