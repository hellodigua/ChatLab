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

// 分组预设（common 类型单独展示，group 和 private 分别展示）
const commonRemotePresets = computed(() =>
  remotePresets.value.filter((p) => p.chatType === 'common' || !p.chatType)
)
const groupRemotePresets = computed(() => remotePresets.value.filter((p) => p.chatType === 'group'))
const privateRemotePresets = computed(() => remotePresets.value.filter((p) => p.chatType === 'private'))

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
            <!-- 通用预设（群聊私聊都适用） -->
            <div v-if="commonRemotePresets.length > 0">
              <h4 class="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                <UIcon name="i-heroicons-squares-2x2" class="h-4 w-4 text-emerald-500" />
                {{ t('importPreset.commonPresets') }}
              </h4>
              <div class="space-y-2">
                <div
                  v-for="preset in commonRemotePresets"
                  :key="preset.id"
                  class="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800"
                >
                  <div class="flex-1">
                    <p class="text-sm font-medium text-gray-900 dark:text-white">{{ preset.name }}</p>
                    <p class="mt-0.5 line-clamp-1 text-xs text-gray-500 dark:text-gray-400">
                      {{ preset.roleDefinition.slice(0, 50) }}...
                    </p>
                  </div>
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

            <!-- 群聊预设 -->
            <div v-if="groupRemotePresets.length > 0">
              <h4 class="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                <UIcon name="i-heroicons-chat-bubble-left-right" class="h-4 w-4 text-violet-500" />
                {{ t('importPreset.groupPresets') }}
              </h4>
              <div class="space-y-2">
                <div
                  v-for="preset in groupRemotePresets"
                  :key="preset.id"
                  class="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800"
                >
                  <div class="flex-1">
                    <p class="text-sm font-medium text-gray-900 dark:text-white">{{ preset.name }}</p>
                    <p class="mt-0.5 line-clamp-1 text-xs text-gray-500 dark:text-gray-400">
                      {{ preset.roleDefinition.slice(0, 50) }}...
                    </p>
                  </div>
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

            <!-- 私聊预设 -->
            <div v-if="privateRemotePresets.length > 0">
              <h4 class="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                <UIcon name="i-heroicons-user" class="h-4 w-4 text-blue-500" />
                {{ t('importPreset.privatePresets') }}
              </h4>
              <div class="space-y-2">
                <div
                  v-for="preset in privateRemotePresets"
                  :key="preset.id"
                  class="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800"
                >
                  <div class="flex-1">
                    <p class="text-sm font-medium text-gray-900 dark:text-white">{{ preset.name }}</p>
                    <p class="mt-0.5 line-clamp-1 text-xs text-gray-500 dark:text-gray-400">
                      {{ preset.roleDefinition.slice(0, 50) }}...
                    </p>
                  </div>
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
      "added": "已添加"
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
      "added": "Added"
    }
  }
}
</i18n>
