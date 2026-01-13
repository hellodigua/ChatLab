<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePromptStore, type RemotePresetData } from '@/stores/prompt'

const { t, locale } = useI18n()
const promptStore = usePromptStore()

// Props
const props = defineProps<{
  open: boolean
}>()

// Emits
const emit = defineEmits<{
  'update:open': [value: boolean]
  'preset-added': []
}>()

// 状态
const isLoading = ref(false)
const error = ref('')
const remotePresets = ref<RemotePresetData[]>([])

// 预设分组配置
const presetGroups = computed(() => [
  {
    key: 'common',
    icon: 'i-heroicons-squares-2x2',
    iconColor: 'text-emerald-500',
    titleKey: 'importPreset.commonPresets',
    presets: remotePresets.value.filter((p) => p.chatType === 'common' || !p.chatType),
  },
  {
    key: 'group',
    icon: 'i-heroicons-chat-bubble-left-right',
    iconColor: 'text-violet-500',
    titleKey: 'importPreset.groupPresets',
    presets: remotePresets.value.filter((p) => p.chatType === 'group'),
  },
  {
    key: 'private',
    icon: 'i-heroicons-user',
    iconColor: 'text-blue-500',
    titleKey: 'importPreset.privatePresets',
    presets: remotePresets.value.filter((p) => p.chatType === 'private'),
  },
])

// 加载远程预设
async function loadRemotePresets() {
  isLoading.value = true
  error.value = ''

  try {
    const presets = await promptStore.fetchRemotePresets(locale.value)
    remotePresets.value = presets

    if (presets.length === 0) {
      error.value = t('importPreset.noPresets')
    }
  } catch (e) {
    error.value = t('importPreset.loadError')
  } finally {
    isLoading.value = false
  }
}

// 添加预设
function handleAddPreset(preset: RemotePresetData) {
  const success = promptStore.addRemotePreset(preset)
  if (success) {
    emit('preset-added')
  }
}

// 关闭弹窗
function closeModal() {
  emit('update:open', false)
}

// 监听打开状态，打开时加载数据
watch(
  () => props.open,
  (newVal) => {
    if (newVal) {
      loadRemotePresets()
    }
  }
)
</script>

<template>
  <UModal :open="open" @update:open="emit('update:open', $event)" :ui="{ content: 'md:w-full max-w-lg' }">
    <template #content>
      <div class="p-6">
        <!-- Header -->
        <div class="mb-4 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <UIcon name="i-heroicons-cloud-arrow-down" class="h-5 w-5 text-primary-500" />
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('importPreset.title') }}</h2>
          </div>
          <UButton icon="i-heroicons-x-mark" variant="ghost" size="sm" @click="closeModal" />
        </div>

        <!-- 描述 -->
        <p class="mb-4 text-sm text-gray-500 dark:text-gray-400">{{ t('importPreset.description') }}</p>

        <!-- 内容区域 -->
        <div class="max-h-[400px] overflow-y-auto">
          <!-- 加载中 -->
          <div v-if="isLoading" class="flex flex-col items-center justify-center py-12">
            <UIcon name="i-heroicons-arrow-path" class="h-8 w-8 animate-spin text-primary-500" />
            <p class="mt-2 text-sm text-gray-500">{{ t('importPreset.loading') }}</p>
          </div>

          <!-- 错误状态 -->
          <div v-else-if="error" class="flex flex-col items-center justify-center py-12">
            <UIcon name="i-heroicons-exclamation-circle" class="h-8 w-8 text-red-500" />
            <p class="mt-2 text-sm text-gray-500">{{ error }}</p>
            <UButton variant="soft" size="sm" class="mt-4" @click="loadRemotePresets">
              {{ t('importPreset.retry') }}
            </UButton>
          </div>

          <!-- 预设列表 -->
          <div v-else class="space-y-4">
            <!-- 预设分组 -->
            <div v-for="group in presetGroups" :key="group.key">
              <div v-if="group.presets.length > 0">
                <h4 class="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                  <UIcon :name="group.icon" class="h-4 w-4" :class="group.iconColor" />
                  {{ t(group.titleKey) }}
                </h4>
                <div class="space-y-2">
                  <div
                    v-for="preset in group.presets"
                    :key="preset.id"
                    class="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800"
                  >
                    <div class="flex-1 min-w-0">
                      <p class="text-sm font-medium text-gray-900 dark:text-white">{{ preset.name }}</p>
                      <p class="mt-0.5 line-clamp-1 text-xs text-gray-500 dark:text-gray-400">
                        {{ preset.roleDefinition.slice(0, 50) }}...
                      </p>
                    </div>
                    <div class="flex items-center gap-1.5 ml-2 shrink-0">
                      <!-- 预览按钮 -->
                      <UPopover :popper="{ placement: 'left' }">
                        <UButton color="gray" size="xs">
                          <UIcon name="i-heroicons-eye" class="mr-1 h-3.5 w-3.5" />
                          {{ t('importPreset.preview') }}
                        </UButton>
                        <template #content>
                          <div class="w-80 max-h-96 overflow-y-auto p-3">
                            <div class="mb-3">
                              <p class="mb-1 text-xs font-semibold text-gray-600 dark:text-gray-300">
                                {{ t('importPreset.roleDefinition') }}
                              </p>
                              <p class="whitespace-pre-wrap text-xs text-gray-600 dark:text-gray-400">
                                {{ preset.roleDefinition }}
                              </p>
                            </div>
                            <div>
                              <p class="mb-1 text-xs font-semibold text-gray-600 dark:text-gray-300">
                                {{ t('importPreset.responseRules') }}
                              </p>
                              <p class="whitespace-pre-wrap text-xs text-gray-600 dark:text-gray-400">
                                {{ preset.responseRules }}
                              </p>
                            </div>
                          </div>
                        </template>
                      </UPopover>
                      <!-- 添加按钮 -->
                      <UButton
                        v-if="promptStore.isRemotePresetAdded(preset.id)"
                        variant="soft"
                        color="gray"
                        size="xs"
                        disabled
                      >
                        <UIcon name="i-heroicons-check" class="mr-1 h-3.5 w-3.5" />
                        {{ t('importPreset.added') }}
                      </UButton>
                      <UButton v-else variant="soft" color="primary" size="xs" @click="handleAddPreset(preset)">
                        <UIcon name="i-heroicons-plus" class="mr-1 h-3.5 w-3.5" />
                        {{ t('importPreset.add') }}
                      </UButton>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>

<i18n>
{
  "zh-CN": {
    "importPreset": {
      "title": "导入预设",
      "description": "从远程获取推荐的系统提示词预设",
      "loading": "正在加载远程预设...",
      "loadError": "加载远程预设失败",
      "noPresets": "暂无可用的远程预设",
      "retry": "重试",
      "commonPresets": "通用预设",
      "groupPresets": "群聊专用预设",
      "privatePresets": "私聊专用预设",
      "add": "添加",
      "added": "已添加",
      "preview": "预览",
      "roleDefinition": "角色定义",
      "responseRules": "回复规则"
    }
  },
  "en-US": {
    "importPreset": {
      "title": "Import Presets",
      "description": "Get recommended system prompt presets from remote",
      "loading": "Loading remote presets...",
      "loadError": "Failed to load remote presets",
      "noPresets": "No remote presets available",
      "retry": "Retry",
      "commonPresets": "Universal Presets",
      "groupPresets": "Group Chat Only",
      "privatePresets": "Private Chat Only",
      "add": "Add",
      "added": "Added",
      "preview": "Preview",
      "roleDefinition": "Role Definition",
      "responseRules": "Response Rules"
    }
  }
}
</i18n>
