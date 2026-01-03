<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useSessionStore } from '@/stores/session'

const { t } = useI18n()
const sessionStore = useSessionStore()
const { migrationCount, pendingMigrations, isMigrating } = storeToRefs(sessionStore)

// 弹窗状态
const showModal = ref(false)
const migrationError = ref<string | null>(null)

// 执行迁移
async function handleMigration() {
  migrationError.value = null
  const result = await sessionStore.runMigration()
  if (result.success) {
    showModal.value = false
    // 迁移完成后重新加载会话列表
    await sessionStore.loadSessions()
  } else {
    migrationError.value = result.error || t('home.migration.failed')
  }
}

// 组件挂载时检查是否需要迁移
onMounted(async () => {
  const result = await sessionStore.checkMigration()
  if (result.needsMigration) {
    showModal.value = true
  }
})
</script>

<template>
  <UModal :open="showModal" :ui="{ content: 'max-w-md' }" :prevent-close="true">
    <template #content>
      <div class="p-6 text-center">
        <div
          class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30"
        >
          <UIcon name="i-heroicons-arrow-up-circle" class="h-7 w-7 text-blue-500" />
        </div>
        <h3 class="mb-2 text-lg font-semibold text-gray-900 dark:text-white">{{ t('home.migration.title') }}</h3>
        <p class="mb-3 text-sm text-gray-500 dark:text-gray-400">
          {{ t('home.migration.description', { count: migrationCount }) }}
          <br />
          {{ t('home.migration.note') }}
        </p>

        <!-- 升级内容列表 -->
        <div v-if="pendingMigrations.length > 0" class="mb-4 rounded-lg bg-gray-50 p-3 text-left dark:bg-gray-800">
          <p class="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">{{ t('home.migration.upgradeContent') }}</p>
          <ul class="space-y-2">
            <li v-for="migration in pendingMigrations" :key="migration.version" class="flex items-start gap-2">
              <UIcon name="i-heroicons-check-circle" class="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
              <div>
                <p class="text-sm text-gray-700 dark:text-gray-300">{{ migration.userMessage }}</p>
                <p class="text-xs text-gray-400 dark:text-gray-500">{{ migration.description }}</p>
              </div>
            </li>
          </ul>
        </div>

        <!-- 错误提示 -->
        <div
          v-if="migrationError"
          class="mb-4 rounded-lg bg-red-50 p-3 text-left text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400"
        >
          <div class="flex items-start gap-2">
            <UIcon name="i-heroicons-exclamation-circle" class="mt-0.5 h-4 w-4 shrink-0" />
            <span>{{ migrationError }}</span>
          </div>
        </div>

        <UButton color="primary" size="lg" :loading="isMigrating" class="w-full" @click="handleMigration">
          {{ isMigrating ? t('home.migration.upgrading') : t('home.migration.upgradeNow') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>


