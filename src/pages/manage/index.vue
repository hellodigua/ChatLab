<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import BatchManageTab from './components/BatchManageTab.vue'
import PageHeader from '@/components/layout/PageHeader.vue'

const { t } = useI18n()
</script>

<template>
  <div class="relative z-0 flex h-full flex-col bg-white pt-4 dark:bg-[var(--color-page-dark)]">
    <!-- Header -->
    <PageHeader
      :title="t('tools.title')"
      :description="t('tools.description')"
      icon="i-heroicons-rectangle-stack"
      icon-class="bg-primary-600 dark:bg-primary-500"
    />

    <!-- Content -->
    <div class="flex-1 overflow-auto p-6">
      <BatchManageTab />
    </div>
  </div>
</template>
