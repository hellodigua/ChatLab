/**
 * App utility API — replaces window.api.app, window.api.dialog, etc.
 *
 * Provides web-compatible replacements for Electron-specific APIs
 * (version info, remote config fetching, dialogs, clipboard, etc.)
 */

import { get, post } from './client'

// ─────────────────────────── appApi ───────────────────────────

export const appApi = {
  /**
   * Get app version from server.
   */
  getVersion: () =>
    get<{ version: string }>('/app/version')
      .then((r) => r.version)
      .catch(() => '0.0.0'),

  /**
   * Fetch remote config (proxy through server to avoid CORS).
   */
  fetchRemoteConfig: async (url: string): Promise<{ success: boolean; data?: unknown }> => {
    try {
      const result = await post<{ success: boolean; data?: unknown }>('/app/fetch-remote', { url })
      return result
    } catch {
      // If the server endpoint doesn't exist yet, try fetching directly
      try {
        const res = await fetch(url)
        if (!res.ok) return { success: false }
        const contentType = res.headers.get('content-type') || ''
        if (contentType.includes('json')) {
          return { success: true, data: await res.json() }
        }
        return { success: true, data: await res.text() }
      } catch {
        return { success: false }
      }
    }
  },

  /**
   * Check for updates — no-op in web app.
   */
  checkUpdate: (): void => {
    // Updates don't apply to web apps
  },

  /**
   * Get analytics enabled state — always false in web app.
   */
  getAnalyticsEnabled: (): Promise<boolean> => Promise.resolve(false),

  /**
   * Set analytics enabled — no-op in web app.
   */
  setAnalyticsEnabled: (_enabled: boolean): Promise<void> => Promise.resolve(),

  /**
   * Relaunch the app — reload the page in web app.
   */
  relaunch: (): Promise<void> => {
    window.location.reload()
    return Promise.resolve()
  },

  /**
   * Set theme source — no-op, theme is handled client-side.
   */
  setThemeSource: (_mode: string): void => {},

  /**
   * Send IPC message — no-op in web app.
   */
  send: (_channel: string, ..._args: unknown[]): void => {},
}

// ─────────────────────────── dialogApi ───────────────────────────

export const dialogApi = {
  /**
   * Show open file dialog — uses browser file picker.
   * Returns selected files info.
   */
  showOpenDialog: async (options?: {
    filters?: Array<{ name: string; extensions: string[] }>
    properties?: string[]
  }): Promise<{ canceled: boolean; filePaths: string[]; files?: File[] }> => {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'

      if (options?.properties?.includes('multiSelections')) {
        input.multiple = true
      }

      if (options?.properties?.includes('openDirectory')) {
        input.setAttribute('webkitdirectory', '')
      }

      if (options?.filters?.length) {
        const extensions = options.filters.flatMap((f) => f.extensions.map((ext) => `.${ext}`))
        input.accept = extensions.join(',')
      }

      input.onchange = () => {
        if (!input.files || input.files.length === 0) {
          resolve({ canceled: true, filePaths: [] })
          return
        }

        const files = Array.from(input.files)
        const filePaths = files.map((f) => f.name)
        resolve({ canceled: false, filePaths, files })
      }

      input.oncancel = () => {
        resolve({ canceled: true, filePaths: [] })
      }

      input.click()
    })
  },
}

// ─────────────────────────── clipboardApi ───────────────────────────

export const clipboardApi = {
  /**
   * Copy image to clipboard using browser Clipboard API.
   */
  copyImage: async (imageData: string): Promise<{ success: boolean; error?: string }> => {
    try {
      // Convert base64 data URL to blob
      const res = await fetch(imageData)
      const blob = await res.blob()

      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob }),
      ])
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  },
}
