import { defineStore } from 'pinia'
import { ref } from 'vue'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import 'dayjs/locale/en'
import { type LocaleType, setLocale as setI18nLocale, getLocale } from '@/i18n'

// 用于标记用户是否明确设置过语言的 key
const LOCALE_SET_KEY = 'chatlab_locale_set_by_user'

/**
 * 全局设置 Store
 * 管理语言偏好、外观设置等
 */
export const useSettingsStore = defineStore(
  'settings',
  () => {
    // 语言设置：从 i18n 获取（i18n 在更早的时候已经检测了系统语言）
    const locale = ref<LocaleType>(getLocale())

    /**
     * 切换语言
     */
    function setLocale(newLocale: LocaleType) {
      locale.value = newLocale

      // 标记用户已明确设置过语言
      localStorage.setItem(LOCALE_SET_KEY, 'true')

      // 同步更新 vue-i18n
      setI18nLocale(newLocale)

      // 同步更新 dayjs
      dayjs.locale(newLocale === 'zh-CN' ? 'zh-cn' : 'en')

      // 通知主进程（用于对话框等）
      window.electron?.ipcRenderer.send('locale:change', newLocale)
    }

    /**
     * 初始化语言设置
     * 应在应用启动时调用
     * 注意：语言检测已在 i18n 创建时完成，这里主要是同步 dayjs
     */
    function initLocale() {
      // 同步 Pinia store 与 i18n（Pinia persist 可能恢复了旧值）
      const i18nLocale = getLocale()
      if (locale.value !== i18nLocale) {
        // 如果 Pinia 恢复的值与 i18n 不同，以 i18n 为准（它有更早的检测逻辑）
        const hasUserSetLocale = localStorage.getItem(LOCALE_SET_KEY)
        if (!hasUserSetLocale) {
          // 首次启动，i18n 已检测系统语言
          locale.value = i18nLocale
        } else {
          // 用户设置过，同步 i18n 到 Pinia 的值
          setI18nLocale(locale.value)
        }
      }

      // 同步 dayjs 到当前语言
      dayjs.locale(locale.value === 'zh-CN' ? 'zh-cn' : 'en')
    }

    return {
      locale,
      setLocale,
      initLocale,
    }
  },
  {
    persist: true, // 持久化到 localStorage
  }
)
