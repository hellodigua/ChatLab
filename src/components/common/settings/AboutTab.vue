<script setup lang="ts">
import { ref, onMounted } from 'vue'

// 版本信息
const appVersion = ref('加载中...')
const isCheckingUpdate = ref(false)

// 匿名统计开关
const analyticsEnabled = ref(true)

// 获取应用版本
async function loadAppVersion() {
  try {
    appVersion.value = await window.api.app.getVersion()
  } catch (error) {
    console.error('获取版本号失败:', error)
    appVersion.value = '未知'
  }
}

// 加载统计开关状态
async function loadAnalyticsEnabled() {
  try {
    analyticsEnabled.value = await window.api.app.getAnalyticsEnabled()
  } catch (error) {
    console.error('获取统计开关状态失败:', error)
  }
}

// 切换统计开关
async function toggleAnalytics(enabled: boolean) {
  try {
    await window.api.app.setAnalyticsEnabled(enabled)
    analyticsEnabled.value = enabled
  } catch (error) {
    console.error('设置统计开关失败:', error)
  }
}

// 检查更新
function checkUpdate() {
  isCheckingUpdate.value = true
  window.api.app.checkUpdate()
  // 3 秒后恢复按钮状态（实际检查结果由主进程 dialog 显示）
  setTimeout(() => {
    isCheckingUpdate.value = false
  }, 3000)
}

// 组件挂载时加载数据
onMounted(() => {
  loadAppVersion()
  loadAnalyticsEnabled()
})
</script>

<template>
  <div class="space-y-6 pr-1">
    <!-- 关于 -->
    <div>
      <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <UIcon name="i-heroicons-information-circle" class="h-4 w-4 text-blue-500" />
        关于 ChatLab
      </h3>
      <div class="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div
              class="flex h-12 w-12 items-center justify-center rounded-xl bg-linear-to-br from-pink-500 to-pink-600"
            >
              <UIcon name="i-heroicons-chat-bubble-left-right" class="h-6 w-6 text-white" />
            </div>
            <div>
              <p class="text-sm font-semibold text-gray-900 dark:text-white">ChatLab</p>
              <p class="text-xs text-gray-500 dark:text-gray-400">聊天记录分析工具</p>
              <p class="mt-1 text-xs text-gray-400">版本 {{ appVersion }}</p>
            </div>
          </div>
          <UButton
            :loading="isCheckingUpdate"
            :disabled="isCheckingUpdate"
            color="primary"
            variant="soft"
            size="sm"
            @click="checkUpdate"
          >
            <UIcon name="i-heroicons-arrow-path" class="mr-1 h-4 w-4" />
            {{ isCheckingUpdate ? '检查中...' : '检查更新' }}
          </UButton>
        </div>
      </div>
      <!-- 更新策略提示 -->
      <UAlert
        class="mt-3"
        color="info"
        variant="subtle"
        icon="i-heroicons-light-bulb"
        title="更新策略"
        description="项目前期更新频繁，为避免打扰，小版本不会自动提醒，仅中版本以上才会推送。如需获取小版本更新，需手动点击检查更新。"
      />
    </div>

    <!-- 隐私设置 -->
    <div>
      <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <UIcon name="i-heroicons-shield-check" class="h-4 w-4 text-purple-500" />
        隐私设置
      </h3>
      <div class="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-gray-900 dark:text-white">匿名使用统计</p>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              开启后，软件会收集版本号、操作系统版本等非敏感数据，用于帮助优化产品(●'◡'●)ﾉ♥
            </p>
          </div>
          <USwitch :model-value="analyticsEnabled" @update:model-value="toggleAnalytics" />
        </div>
      </div>
    </div>
  </div>
</template>
