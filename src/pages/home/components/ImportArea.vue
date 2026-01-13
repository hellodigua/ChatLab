<script setup lang="ts">
import { FileDropZone } from '@/components/UI'
import { storeToRefs } from 'pinia'
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useSessionStore } from '@/stores/session'

const { t } = useI18n()
const sessionStore = useSessionStore()
const { isImporting, importProgress } = storeToRefs(sessionStore)

const importError = ref<string | null>(null)
const diagnosisSuggestion = ref<string | null>(null)
const hasImportLog = ref(false)

const router = useRouter()

/**
 * Translate error key to localized message
 * Error keys follow format: 'error.{error_name}'
 * Example: 'error.unrecognized_format' -> t('home.import.errors.unrecognized_format')
 */
function translateError(error: string): string {
  if (error.startsWith('error.')) {
    const key = `home.import.errors.${error.slice(6)}` // Remove 'error.' prefix
    const translated = t(key)
    return translated !== key ? translated : error
  }
  // Unknown error format, return as-is
  return error
}

// 根据会话类型导航到对应页面
async function navigateToSession(sessionId: string) {
  const session = await window.chatApi.getSession(sessionId)
  if (session) {
    const routeName = session.type === 'private' ? 'private-chat' : 'group-chat'
    router.push({ name: routeName, params: { id: sessionId } })
  }
}

// 检查是否有导入日志
async function checkImportLog() {
  const result = await window.cacheApi.getLatestImportLog()
  hasImportLog.value = result.success && !!result.path
}

// 处理文件选择（点击选择）
async function handleClickImport() {
  importError.value = null
  diagnosisSuggestion.value = null
  hasImportLog.value = false
  const result = await sessionStore.importFile()
  // Skip showing error if user just cancelled the file dialog
  if (!result.success && result.error && result.error !== 'error.no_file_selected') {
    importError.value = translateError(result.error)
    // 保存诊断建议（如果有）
    if (result.diagnosisSuggestion) {
      diagnosisSuggestion.value = result.diagnosisSuggestion
    }
    await checkImportLog()
  } else if (result.success && sessionStore.currentSessionId) {
    await navigateToSession(sessionStore.currentSessionId)
  }
}

// 处理文件拖拽
async function handleFileDrop({ paths }: { files: File[]; paths: string[] }) {
  if (paths.length === 0) {
    importError.value = t('home.import.cannotReadPath')
    return
  }

  importError.value = null
  diagnosisSuggestion.value = null
  hasImportLog.value = false
  const result = await sessionStore.importFileFromPath(paths[0])
  if (!result.success && result.error) {
    importError.value = translateError(result.error)
    // 保存诊断建议（如果有）
    if (result.diagnosisSuggestion) {
      diagnosisSuggestion.value = result.diagnosisSuggestion
    }
    await checkImportLog()
  } else if (result.success && sessionStore.currentSessionId) {
    await navigateToSession(sessionStore.currentSessionId)
  }
}

function openTutorial() {
  window.open('https://chatlab.fun/usage/how-to-export.html?utm_source=app', '_blank')
}

// 打开最新的导入日志文件
async function openLatestImportLog() {
  const result = await window.cacheApi.getLatestImportLog()
  if (result.success && result.path) {
    await window.cacheApi.showInFolder(result.path)
  } else {
    // 没有日志文件时，打开日志目录
    await window.cacheApi.openDir('logs')
  }
}

function getProgressText(): string {
  if (!importProgress.value) return ''
  switch (importProgress.value.stage) {
    case 'detecting':
      return t('home.import.progress.detecting')
    case 'reading':
      return t('home.import.progress.reading')
    case 'parsing':
      return t('home.import.progress.parsing')
    case 'saving':
      return t('home.import.progress.saving')
    case 'done':
      return t('home.import.progress.done')
    case 'error':
      return t('home.import.progress.error')
    default:
      return ''
  }
}

function getProgressDetail(): string {
  if (!importProgress.value) return ''
  const { messagesProcessed, totalBytes, bytesRead } = importProgress.value

  if (messagesProcessed && messagesProcessed > 0) {
    return t('home.import.processed', { count: messagesProcessed.toLocaleString() })
  }

  if (totalBytes && bytesRead) {
    const percent = Math.round((bytesRead / totalBytes) * 100)
    const mbRead = (bytesRead / 1024 / 1024).toFixed(1)
    const mbTotal = (totalBytes / 1024 / 1024).toFixed(1)
    return `${mbRead} MB / ${mbTotal} MB (${percent}%)`
  }

  return importProgress.value.message || ''
}
</script>

<template>
  <div class="flex flex-col items-center space-y-6">
    <!-- Import Drop Zone -->
    <FileDropZone
      :accept="['.json', '.jsonl', '.txt']"
      :disabled="isImporting"
      class="w-full max-w-4xl"
      @files="handleFileDrop"
    >
      <template #default="{ isDragOver }">
        <div
          class="group relative flex w-full cursor-pointer flex-col items-center justify-center rounded-3xl border border-gray-200/50 bg-white/40 px-8 py-10 backdrop-blur-md transition-all duration-300 hover:border-pink-500/30 hover:bg-white/60 hover:shadow-2xl hover:shadow-pink-500/10 focus:outline-none focus:ring-4 focus:ring-pink-500/20 sm:px-12 sm:py-14 dark:border-white/10 dark:bg-white/5 dark:hover:border-pink-500/30 dark:hover:bg-white/10"
          :class="{
            'border-pink-500/50 bg-pink-50/50 dark:border-pink-400/50 dark:bg-pink-500/10': isDragOver && !isImporting,
            'cursor-not-allowed opacity-70': isImporting,
            'hover:scale-[1.01]': !isImporting,
          }"
          @click="!isImporting && handleClickImport()"
        >
          <!-- Icon -->
          <div
            class="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-pink-50 transition-transform duration-300 group-hover:scale-110 dark:bg-pink-500/10"
            :class="{ 'scale-110': isDragOver && !isImporting, 'animate-pulse': isImporting }"
          >
            <UIcon
              v-if="!isImporting"
              name="i-heroicons-arrow-up-tray"
              class="h-10 w-10 text-pink-600 transition-transform duration-200 group-hover:-translate-y-1 dark:text-pink-400"
            />
            <UIcon
              v-else
              name="i-heroicons-arrow-path"
              class="h-10 w-10 animate-spin text-pink-600 dark:text-pink-400"
            />
          </div>

          <!-- Text -->
          <div class="w-full min-w-80 text-center">
            <template v-if="isImporting && importProgress">
              <!-- 导入中显示进度 -->
              <p class="mb-4 text-lg font-semibold text-gray-900 dark:text-white">{{ getProgressText() }}</p>
              <div class="mx-auto w-full max-w-md">
                <UProgress v-model="importProgress.progress" size="md" />
              </div>
              <p class="mt-3 text-sm text-gray-500 dark:text-gray-400">
                {{ getProgressDetail() }}
              </p>
            </template>
            <template v-else>
              <!-- 默认状态 -->
              <p class="text-lg font-semibold text-gray-900 dark:text-white">
                {{ isDragOver ? t('home.import.dropHint') : t('home.import.clickHint') }}
              </p>
            </template>
          </div>
        </div>
      </template>
    </FileDropZone>

    <!-- Error Message -->
    <div
      v-if="importError"
      class="flex max-w-lg flex-col items-center gap-3 rounded-lg bg-red-50 px-4 py-4 dark:bg-red-900/20"
    >
      <div class="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
        <UIcon name="i-heroicons-exclamation-circle" class="h-5 w-5 shrink-0" />
        <span>{{ importError }}</span>
      </div>
      <!-- 诊断建议（如果有） -->
      <div
        v-if="diagnosisSuggestion"
        class="w-full rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
      >
        <div class="flex items-start gap-2">
          <UIcon name="i-heroicons-light-bulb" class="mt-0.5 h-4 w-4 shrink-0" />
          <span>{{ diagnosisSuggestion }}</span>
        </div>
      </div>
      <UButton v-if="hasImportLog" size="xs" @click="openLatestImportLog">{{ t('home.import.viewLog') }}</UButton>
    </div>

    <UButton @click="openTutorial" trailing-icon="i-heroicons-chevron-right-20-solid">
      {{ t('home.import.tutorial') }}
    </UButton>
  </div>
</template>
