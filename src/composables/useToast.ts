import { useToast as useNuxtToast } from '@nuxt/ui/composables'

interface AppToastOptions {
  description?: string
  duration?: number
  actions?: Array<{
    label: string
    icon?: string
    onClick: () => void
  }>
}

interface AppToastPayload extends AppToastOptions {
  title: string
  color?: 'primary' | 'success' | 'warning' | 'error' | 'neutral'
}

const DEFAULT_TOAST_DURATION = 2000

export function useToast() {
  const toast = useNuxtToast()

  function add(payload: AppToastPayload) {
    toast.add({
      ...payload,
      duration: payload.duration ?? DEFAULT_TOAST_DURATION,
    })
  }

  function success(title: string, options: AppToastOptions = {}) {
    add({
      title,
      color: 'success',
      ...options,
    })
  }

  function fail(title: string, options: AppToastOptions = {}) {
    add({
      title,
      color: 'error',
      ...options,
    })
  }

  function info(title: string, options: AppToastOptions = {}) {
    add({
      title,
      color: 'primary',
      ...options,
    })
  }

  function warn(title: string, options: AppToastOptions = {}) {
    add({
      title,
      color: 'warning',
      ...options,
    })
  }

  return {
    add,
    success,
    fail,
    info,
    warn,
  }
}
