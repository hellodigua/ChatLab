/**
 * Network/proxy configuration API routes
 *
 * Replaces Electron IPC handlers for network/proxy settings:
 *   GET  /api/network/proxy       - get proxy config
 *   PUT  /api/network/proxy       - save proxy config
 *   POST /api/network/proxy/test  - test proxy connection
 *
 * Electron-specific features removed:
 *   - session.defaultSession.setProxy (Electron session API)
 *   - net.request (Electron net module)
 * Web alternatives:
 *   - Proxy config saved to JSON file; server-side HTTP_PROXY env var
 *   - Connection test uses Node.js native fetch with AbortController timeout
 */

import { Router } from 'express'
import * as fs from 'fs'
import * as path from 'path'
import { getSettingsDir, ensureDir } from '../paths.js'

// ==================== Types ====================

export type ProxyMode = 'off' | 'system' | 'manual'

export interface ProxyConfig {
  mode: ProxyMode
  url: string
}

const DEFAULT_CONFIG: ProxyConfig = {
  mode: 'system',
  url: '',
}

// ==================== Config persistence ====================

let CONFIG_PATH: string | null = null

function getConfigPath(): string {
  if (CONFIG_PATH) return CONFIG_PATH
  CONFIG_PATH = path.join(getSettingsDir(), 'proxy.json')
  return CONFIG_PATH
}

/** Reset cached config path (for test isolation) */
export function _resetConfigPath(): void {
  CONFIG_PATH = null
}

/**
 * Migrate legacy config format.
 * Old: { enabled: boolean, url: string }
 * New: { mode: ProxyMode, url: string }
 */
function migrateOldConfig(data: Record<string, unknown>): ProxyConfig {
  if ('enabled' in data && !('mode' in data)) {
    const enabled = Boolean(data.enabled)
    const url = String(data.url || '')
    return { mode: enabled && url ? 'manual' : 'system', url }
  }
  const mode = data.mode as ProxyMode
  if (!['off', 'system', 'manual'].includes(mode)) {
    return { ...DEFAULT_CONFIG }
  }
  return { mode, url: String(data.url || '') }
}

export function loadProxyConfig(): ProxyConfig {
  const configPath = getConfigPath()
  if (!fs.existsSync(configPath)) return { ...DEFAULT_CONFIG }
  try {
    const content = fs.readFileSync(configPath, 'utf-8')
    return migrateOldConfig(JSON.parse(content))
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function saveProxyConfig(config: ProxyConfig): void {
  const configPath = getConfigPath()
  const dir = path.dirname(configPath)
  ensureDir(dir)
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
}

export function validateProxyUrl(url: string): { valid: boolean; error?: string } {
  if (!url) return { valid: false, error: 'Proxy URL cannot be empty' }
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { valid: false, error: 'Only http:// and https:// protocols are supported' }
    }
    if (!parsed.hostname) {
      return { valid: false, error: 'Invalid proxy URL format' }
    }
    return { valid: true }
  } catch {
    return { valid: false, error: 'Invalid proxy URL format, use http://host:port' }
  }
}

/**
 * Get the currently active proxy URL (only when mode is manual and URL is valid).
 */
export function getActiveProxyUrl(): string | undefined {
  const config = loadProxyConfig()
  if (config.mode === 'manual' && config.url) {
    const validation = validateProxyUrl(config.url)
    if (validation.valid) return config.url
  }
  return undefined
}

/**
 * Test proxy connectivity by making an HTTP request through it.
 * Uses Node.js native fetch with timeout.
 */
async function testProxyConnection(proxyUrl: string): Promise<{ success: boolean; error?: string }> {
  const validation = validateProxyUrl(proxyUrl)
  if (!validation.valid) return { success: false, error: validation.error }

  const testUrls = ['https://www.google.com', 'https://www.cloudflare.com']
  let lastError = ''

  for (const testUrl of testUrls) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)

      const response = await fetch(testUrl, {
        method: 'HEAD',
        signal: controller.signal,
      })

      clearTimeout(timeout)

      if (response.status < 500) {
        return { success: true }
      }
      lastError = `HTTP ${response.status}`
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        lastError = 'Connection timeout'
      } else {
        lastError = e instanceof Error ? e.message : String(e)
      }
    }
  }

  // Friendly error messages
  if (lastError.includes('ECONNREFUSED')) {
    return { success: false, error: 'Connection refused — is the proxy server running?' }
  }
  if (lastError.includes('ETIMEDOUT') || lastError.includes('timeout')) {
    return { success: false, error: 'Connection timed out — check proxy address and port' }
  }
  if (lastError.includes('ENOTFOUND')) {
    return { success: false, error: 'Cannot resolve proxy server address' }
  }

  return { success: false, error: lastError || 'Cannot reach test servers through proxy' }
}

// ==================== Router ====================

const router = Router()

/**
 * GET /api/network/proxy
 * Returns current proxy configuration.
 */
router.get('/proxy', (_req, res) => {
  res.json(loadProxyConfig())
})

/**
 * PUT /api/network/proxy
 * Save proxy configuration. Expects { mode, url } in body.
 */
router.put('/proxy', (req, res) => {
  const config = req.body as ProxyConfig

  if (!config || !config.mode) {
    res.status(400).json({ success: false, error: 'mode is required' })
    return
  }

  if (!['off', 'system', 'manual'].includes(config.mode)) {
    res.status(400).json({ success: false, error: 'mode must be off, system, or manual' })
    return
  }

  // Validate URL if manual mode
  if (config.mode === 'manual' && config.url) {
    const validation = validateProxyUrl(config.url)
    if (!validation.valid) {
      res.status(400).json({ success: false, error: validation.error })
      return
    }
  }

  try {
    saveProxyConfig({ mode: config.mode, url: config.url || '' })
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ success: false, error: `Failed to save config: ${String(error)}` })
  }
})

/**
 * POST /api/network/proxy/test
 * Test proxy connectivity. Expects { url } in body.
 */
router.post('/proxy/test', async (req, res) => {
  const { url } = req.body as { url?: string }

  if (!url) {
    res.status(400).json({ success: false, error: 'url is required' })
    return
  }

  const result = await testProxyConnection(url)
  res.json(result)
})

export default router
