<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

// 代理配置
const proxyEnabled = ref(false)
const proxyUrl = ref('')
const proxyUrlError = ref('')
const isSavingProxy = ref(false)
const isTestingProxy = ref(false)
const proxyTestResult = ref<{ success: boolean; message: string } | null>(null)

// 加载代理配置
async function loadProxyConfig() {
  try {
    const config = await window.networkApi.getProxyConfig()
    proxyEnabled.value = config.enabled
    proxyUrl.value = config.url
  } catch (error) {
    console.error('获取代理配置失败:', error)
  }
}

// 验证代理 URL 格式
function validateProxyUrl(url: string): boolean {
  if (!url) {
    proxyUrlError.value = ''
    return true
  }

  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      proxyUrlError.value = t('settings.basic.network.onlyHttpSupported')
      return false
    }
    proxyUrlError.value = ''
    return true
  } catch {
    proxyUrlError.value = t('settings.basic.network.invalidProxyUrl')
    return false
  }
}

// 保存代理配置
async function saveProxyConfig() {
  // 清除测试结果
  proxyTestResult.value = null

  // 如果启用了代理但没填地址
  if (proxyEnabled.value && !proxyUrl.value.trim()) {
    proxyUrlError.value = t('settings.basic.network.enterProxyFirst')
    return
  }

  // 验证格式
  if (proxyEnabled.value && !validateProxyUrl(proxyUrl.value)) {
    return
  }

  isSavingProxy.value = true
  try {
    const result = await window.networkApi.saveProxyConfig({
      enabled: proxyEnabled.value,
      url: proxyUrl.value.trim(),
    })

    if (!result.success) {
      proxyUrlError.value = result.error || t('settings.basic.network.saveFailed')
    }
  } catch (error) {
    console.error('保存代理配置失败:', error)
    proxyUrlError.value = t('settings.basic.network.saveFailed')
  } finally {
    isSavingProxy.value = false
  }
}

// 切换代理开关
async function toggleProxy(enabled: boolean) {
  proxyEnabled.value = enabled
  proxyTestResult.value = null

  // 如果关闭代理，立即保存
  if (!enabled) {
    await saveProxyConfig()
  }
}

// 代理地址输入处理
function handleProxyUrlInput() {
  proxyTestResult.value = null
  if (proxyUrl.value) {
    validateProxyUrl(proxyUrl.value)
  } else {
    proxyUrlError.value = ''
  }
}

// 代理地址失去焦点时保存
async function handleProxyUrlBlur() {
  if (proxyEnabled.value && proxyUrl.value.trim()) {
    await saveProxyConfig()
  }
}

// 测试代理连接
async function testProxyConnection() {
  if (!proxyUrl.value.trim()) {
    proxyUrlError.value = t('settings.basic.network.enterProxyFirst')
    return
  }

  if (!validateProxyUrl(proxyUrl.value)) {
    return
  }

  isTestingProxy.value = true
  proxyTestResult.value = null

  try {
    const result = await window.networkApi.testProxyConnection(proxyUrl.value.trim())
    proxyTestResult.value = {
      success: result.success,
      message: result.success ? t('settings.basic.network.connectionSuccess') : result.error || t('settings.basic.network.connectionFailed'),
    }
  } catch (error) {
    proxyTestResult.value = {
      success: false,
      message: t('settings.basic.network.connectionFailed') + ': ' + (error instanceof Error ? error.message : String(error)),
    }
  } finally {
    isTestingProxy.value = false
  }
}

// 组件挂载时加载数据
onMounted(() => {
  loadProxyConfig()
})
</script>

<template>
  <div>
    <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
      <UIcon name="i-heroicons-globe-alt" class="h-4 w-4 text-cyan-500" />
      {{ t('settings.basic.network.title') }}
    </h3>
    <div class="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
      <!-- 代理开关 -->
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm font-medium text-gray-900 dark:text-white">{{ t('settings.basic.network.enableProxy') }}</p>
          <p class="text-xs text-gray-500 dark:text-gray-400">{{ t('settings.basic.network.enableProxyDesc') }}</p>
        </div>
        <USwitch :model-value="proxyEnabled" @update:model-value="toggleProxy" />
      </div>

      <!-- 代理地址输入 -->
      <div v-if="proxyEnabled" class="mt-4 space-y-3">
        <div>
          <label class="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"> {{ t('settings.basic.network.proxyAddress') }} </label>
          <UInput
            v-model="proxyUrl"
            :placeholder="t('settings.basic.network.proxyPlaceholder')"
            :color="proxyUrlError ? 'error' : 'neutral'"
            size="sm"
            class="w-full"
            @input="handleProxyUrlInput"
            @blur="handleProxyUrlBlur"
          />
          <p v-if="proxyUrlError" class="mt-1 text-xs text-red-500">
            {{ proxyUrlError }}
          </p>
          <p v-else class="mt-1 text-xs text-gray-400">{{ t('settings.basic.network.proxyHelp') }}</p>
        </div>

        <!-- 测试连接按钮和结果 -->
        <div class="flex items-center gap-3">
          <UButton
            :loading="isTestingProxy"
            :disabled="isTestingProxy || !proxyUrl.trim()"
            color="neutral"
            variant="soft"
            size="sm"
            @click="testProxyConnection"
          >
            <UIcon name="i-heroicons-signal" class="mr-1 h-4 w-4" />
            {{ isTestingProxy ? t('settings.basic.network.testing') : t('settings.basic.network.testConnection') }}
          </UButton>

          <div v-if="proxyTestResult" class="flex items-center gap-1.5">
            <UIcon
              :name="proxyTestResult.success ? 'i-heroicons-check-circle' : 'i-heroicons-x-circle'"
              :class="['h-4 w-4', proxyTestResult.success ? 'text-green-500' : 'text-red-500']"
            />
            <span
              :class="[
                'text-xs',
                proxyTestResult.success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400',
              ]"
            >
              {{ proxyTestResult.message }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

