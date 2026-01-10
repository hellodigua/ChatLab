<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import AIModelConfigTab from './AI/AIModelConfigTab.vue'
import AIPromptConfigTab from './AI/AIPromptConfigTab.vue'
import AIPromptPresetTab from './AI/AIPromptPresetTab.vue'
import SubTabs from '@/components/UI/SubTabs.vue'

const { t } = useI18n()

// Emits
const emit = defineEmits<{
  'config-changed': []
}>()

// 导航配置
const navItems = computed(() => [
  { id: 'model', label: t('settings.tabs.aiConfig') },
  { id: 'chat', label: t('settings.tabs.aiPrompt') },
  { id: 'preset', label: t('settings.tabs.aiPreset') },
])

// 当前激活的导航项
const activeNav = ref('model')

// 是否由用户点击触发（用于区分点击滚动和手动滚动）
const isUserClick = ref(false)

// 滚动容器引用
const scrollContainerRef = ref<HTMLElement | null>(null)

// Section 引用
const sectionRefs = ref<Record<string, HTMLElement | null>>({
  model: null,
  chat: null,
  preset: null,
})

// AI 配置变更回调
function handleAIConfigChanged() {
  emit('config-changed')
}

// 处理导航点击（通过 @change 事件）
function handleNavChange(id: string) {
  const section = sectionRefs.value[id]
  if (section && scrollContainerRef.value) {
    // 标记为用户点击触发
    isUserClick.value = true
    section.scrollIntoView({ behavior: 'smooth', block: 'start' })
    // 滚动动画结束后恢复
    setTimeout(() => {
      isUserClick.value = false
    }, 500)
  }
}

// 监听滚动更新当前激活项
function handleScroll() {
  // 如果是用户点击触发的滚动，不更新 activeNav（避免冲突）
  if (isUserClick.value || !scrollContainerRef.value) return

  const container = scrollContainerRef.value
  const containerRect = container.getBoundingClientRect()
  const offset = 50 // 偏移量，提前触发

  // 检查是否滚动到底部（误差范围 5px）
  const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 5
  if (isAtBottom) {
    // 滚动到底部时，激活最后一个导航项
    const lastItem = navItems.value[navItems.value.length - 1]
    if (lastItem) {
      activeNav.value = lastItem.id
    }
    return
  }

  // 检查每个 section 的位置
  for (const item of navItems.value) {
    const section = sectionRefs.value[item.id]
    if (section) {
      const rect = section.getBoundingClientRect()
      // 如果 section 顶部在容器可视区域内
      if (rect.top <= containerRect.top + offset && rect.bottom > containerRect.top + offset) {
        activeNav.value = item.id
        break
      }
    }
  }
}

// Template refs
const aiModelConfigRef = ref<InstanceType<typeof AIModelConfigTab> | null>(null)
void aiModelConfigRef

onMounted(() => {
  scrollContainerRef.value?.addEventListener('scroll', handleScroll)
})

onUnmounted(() => {
  scrollContainerRef.value?.removeEventListener('scroll', handleScroll)
})
</script>

<template>
  <div class="flex h-full gap-6">
    <!-- 左侧锚点导航 -->
    <div class="w-28 shrink-0">
      <SubTabs v-model="activeNav" :items="navItems" orientation="vertical" @change="handleNavChange" />
    </div>

    <!-- 右侧内容区域 -->
    <div ref="scrollContainerRef" class="min-w-0 flex-1 overflow-y-auto">
      <div class="space-y-8">
        <!-- 模型配置 -->
        <div :ref="(el) => (sectionRefs.model = el as HTMLElement)">
          <AIModelConfigTab ref="aiModelConfigRef" @config-changed="handleAIConfigChanged" />
        </div>

        <!-- 分隔线 -->
        <div class="border-t border-gray-200 dark:border-gray-700" />

        <!-- 对话配置 -->
        <div :ref="(el) => (sectionRefs.chat = el as HTMLElement)">
          <AIPromptConfigTab @config-changed="handleAIConfigChanged" />
        </div>

        <!-- 分隔线 -->
        <div class="border-t border-gray-200 dark:border-gray-700" />

        <!-- 提示词配置 -->
        <div :ref="(el) => (sectionRefs.preset = el as HTMLElement)">
          <AIPromptPresetTab @config-changed="handleAIConfigChanged" />
        </div>
      </div>
    </div>
  </div>
</template>
