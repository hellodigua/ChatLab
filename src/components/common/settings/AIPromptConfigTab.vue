<script setup lang="ts">
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import type { PromptPreset } from '@/types/ai'
import AIPromptEditModal from './AIPromptEditModal.vue'
import { usePromptStore } from '@/stores/prompt'

// Store
const promptStore = usePromptStore()
const { groupPresets, privatePresets, aiPromptSettings, aiGlobalSettings } = storeToRefs(promptStore)

// Emits
const emit = defineEmits<{
  'config-changed': []
}>()

// 弹窗状态
const showEditModal = ref(false)
const editMode = ref<'add' | 'edit'>('add')
const editingPreset = ref<PromptPreset | null>(null)
const defaultChatType = ref<'group' | 'private'>('group')

// 发送条数限制
const globalMaxMessages = computed({
  get: () => aiGlobalSettings.value.maxMessagesPerRequest,
  set: (val: number) => {
    const clampedVal = Math.max(10, Math.min(5000, val || 200))
    promptStore.updateAIGlobalSettings({ maxMessagesPerRequest: clampedVal })
    emit('config-changed')
  },
})

// AI上下文限制
const globalMaxHistoryRounds = computed({
  get: () => aiGlobalSettings.value.maxHistoryRounds ?? 10,
  set: (val: number) => {
    const clampedVal = Math.max(1, Math.min(50, val || 10))
    promptStore.updateAIGlobalSettings({ maxHistoryRounds: clampedVal })
    emit('config-changed')
  },
})

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
</script>

<template>
  <div class="space-y-6">
    <!-- 对话设置 -->
    <div>
      <h4 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <UIcon name="i-heroicons-adjustments-horizontal" class="h-4 w-4 text-green-500" />
        对话设置
      </h4>
      <div class="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
        <!-- 发送条数限制 -->
        <div class="flex items-center justify-between">
          <div class="flex-1 pr-4">
            <p class="text-sm font-medium text-gray-900 dark:text-white">发送条数限制</p>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              每次发送给 AI 的最大消息条数，数值越大 Token 消耗越多，回复也更准确
            </p>
          </div>
          <UInput v-model.number="globalMaxMessages" type="number" min="1" max="5000" class="w-24" />
        </div>

        <!-- AI上下文限制 -->
        <div class="flex items-center justify-between">
          <div class="flex-1 pr-4">
            <p class="text-sm font-medium text-gray-900 dark:text-white">AI上下文限制</p>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              每次对话保留最近的对话轮数（1轮 = 用户提问 + AI回复），防止上下文过长消耗 Token
            </p>
          </div>
          <UInput v-model.number="globalMaxHistoryRounds" type="number" min="1" max="50" class="w-24" />
        </div>
      </div>
    </div>

    <!-- 分隔线 -->
    <div class="border-t border-gray-200 dark:border-gray-700"></div>

    <!-- 群聊预设组 -->
    <div>
      <div class="mb-3 flex items-center justify-between">
        <h4 class="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
          <UIcon name="i-heroicons-chat-bubble-left-right" class="h-4 w-4 text-violet-500" />
          群聊系统提示词
        </h4>
        <UButton variant="ghost" color="gray" @click="openAddModal('group')">
          <UIcon name="i-heroicons-plus" class="mr-1 h-3.5 w-3.5" />
          添加
        </UButton>
      </div>
      <div class="space-y-2">
        <div
          v-for="preset in groupPresets"
          :key="preset.id"
          class="group flex cursor-pointer items-center justify-between rounded-lg border p-3 transition-colors"
          :class="[
            isActivePreset(preset.id, 'group')
              ? 'border-primary-300 bg-primary-50 dark:border-primary-700 dark:bg-primary-900/20'
              : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800',
          ]"
          @click="setActivePreset(preset.id, 'group')"
        >
          <!-- 预设信息 -->
          <div class="flex items-center gap-3">
            <div
              class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
              :class="[
                isActivePreset(preset.id, 'group')
                  ? 'bg-primary-500 text-white'
                  : 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
              ]"
            >
              <UIcon
                :name="isActivePreset(preset.id, 'group') ? 'i-heroicons-check' : 'i-heroicons-document-text'"
                class="h-3.5 w-3.5"
              />
            </div>
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium text-gray-900 dark:text-white">{{ preset.name }}</span>
              <UBadge v-if="preset.isBuiltIn" color="gray" variant="soft">内置</UBadge>
            </div>
          </div>

          <!-- 操作按钮 -->
          <div class="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100" @click.stop>
            <UButton color="gray" variant="ghost" @click="openEditModal(preset)">
              {{ preset.isBuiltIn ? '查看' : '编辑' }}
            </UButton>
            <UButton color="gray" variant="ghost" @click="duplicatePreset(preset.id)">复制</UButton>
            <UButton v-if="!preset.isBuiltIn" color="error" variant="ghost" @click="deletePreset(preset.id)">
              删除
            </UButton>
          </div>
        </div>
      </div>
    </div>

    <!-- 分隔线 -->
    <div class="border-t border-gray-200 dark:border-gray-700"></div>

    <!-- 私聊系统提示词 -->
    <div>
      <div class="mb-3 flex items-center justify-between">
        <h4 class="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
          <UIcon name="i-heroicons-user" class="h-4 w-4 text-blue-500" />
          私聊系统提示词
        </h4>
        <UButton variant="ghost" color="gray" @click="openAddModal('private')">
          <UIcon name="i-heroicons-plus" class="mr-1 h-3.5 w-3.5" />
          添加
        </UButton>
      </div>
      <div class="space-y-2">
        <div
          v-for="preset in privatePresets"
          :key="preset.id"
          class="group flex cursor-pointer items-center justify-between rounded-lg border p-3 transition-colors"
          :class="[
            isActivePreset(preset.id, 'private')
              ? 'border-primary-300 bg-primary-50 dark:border-primary-700 dark:bg-primary-900/20'
              : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800',
          ]"
          @click="setActivePreset(preset.id, 'private')"
        >
          <!-- 预设信息 -->
          <div class="flex items-center gap-3">
            <div
              class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
              :class="[
                isActivePreset(preset.id, 'private')
                  ? 'bg-primary-500 text-white'
                  : 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
              ]"
            >
              <UIcon
                :name="isActivePreset(preset.id, 'private') ? 'i-heroicons-check' : 'i-heroicons-document-text'"
                class="h-3.5 w-3.5"
              />
            </div>
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium text-gray-900 dark:text-white">{{ preset.name }}</span>
              <UBadge v-if="preset.isBuiltIn" color="gray" variant="soft">内置</UBadge>
            </div>
          </div>

          <!-- 操作按钮 -->
          <div class="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100" @click.stop>
            <UButton color="gray" variant="ghost" @click="openEditModal(preset)">
              {{ preset.isBuiltIn ? '查看' : '编辑' }}
            </UButton>
            <UButton color="gray" variant="ghost" @click="duplicatePreset(preset.id)">复制</UButton>
            <UButton v-if="!preset.isBuiltIn" color="error" variant="ghost" @click="deletePreset(preset.id)">
              删除
            </UButton>
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
</template>
