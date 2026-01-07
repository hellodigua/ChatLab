<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

// Props
const props = defineProps<{
  disabled?: boolean
  placeholder?: string
  status?: 'ready' | 'submitted' | 'streaming' | 'error'
}>()

// Emits
const emit = defineEmits<{
  send: [content: string]
  stop: []
}>()

// 输入内容
const inputValue = ref('')

// 计算 status
const chatStatus = computed(() => {
  if (props.disabled) {
    return props.status || 'submitted'
  }
  return 'ready'
})

// 发送消息
function handleSubmit() {
  if (!inputValue.value.trim() || props.disabled) return

  emit('send', inputValue.value.trim())
  inputValue.value = ''
}

// 停止生成
function handleStop() {
  emit('stop')
}
</script>

<template>
  <div class="shrink-0 border-t border-gray-200 pt-4 pb-2 dark:border-gray-800">
    <div class="w-full">
      <UChatPrompt
        v-model="inputValue"
        :placeholder="placeholder || t('chatInput.placeholder')"
        :disabled="disabled"
        variant="subtle"
        @submit="handleSubmit"
      >
        <UButton
          v-if="chatStatus === 'streaming'"
          icon="i-heroicons-stop-20-solid"
          color="primary"
          variant="solid"
          class="rounded-full"
          @click="handleStop"
        />
        <UChatPromptSubmit v-else :status="chatStatus" class="rounded-full" color="primary" @stop="handleStop" />
      </UChatPrompt>
    </div>
  </div>
</template>

<i18n>
{
  "zh-CN": {
    "chatInput": {
      "placeholder": "输入你的问题..."
    }
  },
  "en-US": {
    "chatInput": {
      "placeholder": "Enter your question..."
    }
  }
}
</i18n>
