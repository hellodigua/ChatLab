<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { SubTabs } from '@/components/UI'
import MergeTab from './components/MergeTab.vue'
import PageHeader from '@/components/layout/PageHeader.vue'

const { t } = useI18n()

// Tab 配置
const tabs = computed(() => [
  { id: 'merge', label: t('tools.tabs.merge'), icon: 'i-heroicons-document-duplicate' },
])

const activeTab = ref('merge')
</script>

<template>
  <div class="flex h-full flex-col bg-gray-50 dark:bg-gray-950">
    <!-- Header -->
    <PageHeader
      :title="t('tools.title')"
      :description="t('tools.description')"
      icon="i-heroicons-wrench-screwdriver"
    />

    <!-- Tabs -->
    <SubTabs v-model="activeTab" :items="tabs" persist-key="toolTab" />

    <!-- Tab Content -->
    <div class="flex-1 overflow-auto p-6">
      <MergeTab v-if="activeTab === 'merge'" />
    </div>
  </div>
</template>
