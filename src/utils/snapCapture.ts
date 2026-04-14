import { snapdom } from '@zumer/snapdom'

export interface CaptureOptions {
  maxExportWidth?: number
  minScale?: number
  backgroundColor?: string
  crossOrigin?: string
  embedFonts?: boolean
  compress?: boolean
  filename?: string
  /** 是否捕获完整的可滚动内容（默认 true） */
  fullContent?: boolean
}

interface RgbaColor {
  r: number
  g: number
  b: number
  a: number
}

const colorProbeCanvas = document.createElement('canvas')
colorProbeCanvas.width = 1
colorProbeCanvas.height = 1
const colorProbeCtx = colorProbeCanvas.getContext('2d', { willReadFrequently: true })

function parseCssColorToRgba(color: string): RgbaColor | null {
  if (!colorProbeCtx) return null

  const ctx = colorProbeCtx
  ctx.clearRect(0, 0, 1, 1)

  // 先写入完全透明作为基底，确保读取到 alpha 信息。
  ctx.fillStyle = 'rgba(0, 0, 0, 0)'
  ctx.fillRect(0, 0, 1, 1)

  try {
    ctx.fillStyle = color
  } catch {
    return null
  }

  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
  if (a === 0) return null

  return {
    r,
    g,
    b,
    a: a / 255,
  }
}

function compositeOver(top: RgbaColor, bottom: RgbaColor): RgbaColor {
  const alpha = top.a + bottom.a * (1 - top.a)
  if (alpha <= 0) {
    return { r: 0, g: 0, b: 0, a: 0 }
  }

  return {
    r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / alpha,
    g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / alpha,
    b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / alpha,
    a: alpha,
  }
}

function toOpaqueRgbString(color: RgbaColor): string {
  return `rgb(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)})`
}

function getEffectiveBackground(el: HTMLElement | null): string {
  const fallbackBackground: RgbaColor = { r: 17, g: 17, b: 17, a: 1 }

  let node: HTMLElement | null = el
  let blended: RgbaColor | null = null

  while (node) {
    const bg = window.getComputedStyle(node).backgroundColor
    const parsed = parseCssColorToRgba(bg)
    if (parsed && parsed.a > 0) {
      blended = blended ? compositeOver(blended, parsed) : parsed
      if (blended.a >= 0.999) {
        return toOpaqueRgbString(blended)
      }
    }
    node = node.parentElement
  }

  if (!blended) {
    return toOpaqueRgbString(fallbackBackground)
  }

  return toOpaqueRgbString(compositeOver(blended, fallbackBackground))
}

function triggerDownload(href: string, filename: string) {
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/**
 * 捕获元素为图片数据，返回 base64 字符串
 * @param rootEl 要捕获的 DOM 元素
 * @param options 捕获选项
 * @returns Promise<string> 图片的 data URL (base64)
 */
export async function captureAsImageData(rootEl: HTMLElement, options?: CaptureOptions): Promise<string> {
  // 提高默认清晰度：maxExportWidth 2160（2K），minScale 1（不缩小）
  const maxExportWidth = options?.maxExportWidth ?? 2160
  const minScale = options?.minScale ?? 1
  const fullContent = options?.fullContent !== false // 默认为 true

  // 获取元素的实际背景色（优先用户指定，否则自动检测）
  const bgColor = options?.backgroundColor ?? getEffectiveBackground(rootEl)

  // 计算元素尺寸：如果需要完整内容，使用 scrollWidth/scrollHeight
  const elementWidth = fullContent ? rootEl.scrollWidth : rootEl.getBoundingClientRect().width
  let captureScale = Math.min(1, maxExportWidth / Math.max(1, elementWidth))
  captureScale = Math.max(minScale, captureScale)

  const snapOptions: Record<string, unknown> = {
    scale: captureScale,
    // 禁用字体嵌入可以避免某些 Unicode 字符导致的 encodeURIComponent 错误
    embedFonts: options?.embedFonts ?? false,
    compress: options?.compress ?? true,
    backgroundColor: bgColor,
    crossOrigin: options?.crossOrigin ?? 'anonymous',
  }

  const result = await (
    snapdom as (
      element: Element,
      options: Record<string, unknown>
    ) => Promise<{
      toCanvas: () => Promise<unknown>
      toPng: (options?: Record<string, unknown>) => Promise<unknown>
      toImg: () => Promise<HTMLImageElement>
    }>
  )(rootEl, snapOptions)

  // Preferred: Canvas path, apply background and scale again if needed, return data URL
  try {
    const canvas: unknown = await result.toCanvas()
    if (canvas && (canvas as HTMLCanvasElement).toDataURL) {
      const srcCanvas = canvas as HTMLCanvasElement
      const outCanvas = document.createElement('canvas')
      const scale2 = srcCanvas.width > maxExportWidth ? maxExportWidth / srcCanvas.width : 1
      outCanvas.width = Math.round(srcCanvas.width * scale2)
      outCanvas.height = Math.round(srcCanvas.height * scale2)
      const ctx = outCanvas.getContext('2d')
      if (ctx) {
        ctx.fillStyle = bgColor
        ctx.fillRect(0, 0, outCanvas.width, outCanvas.height)
        ctx.drawImage(srcCanvas, 0, 0, outCanvas.width, outCanvas.height)
        return outCanvas.toDataURL('image/png')
      }
    }
  } catch {
    // fallback below
  }

  // Fallback: direct PNG export with background
  try {
    const png: unknown = await result.toPng({ backgroundColor: bgColor })

    if (png instanceof HTMLImageElement) {
      return png.src
    }
    if (png instanceof Blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(png)
      })
    }
    if (typeof png === 'string') {
      return png
    }
  } catch {
    // swallow
  }

  // Last Fallback: toImg
  try {
    const img: HTMLImageElement = await result.toImg()
    return img.src
  } catch (e) {
    console.error('captureAsImageData: all export paths failed', e)
    throw new Error('Failed to capture image data')
  }
}

export async function captureAndDownloadPng(rootEl: HTMLElement, options?: CaptureOptions): Promise<void> {
  // 提高默认清晰度：maxExportWidth 2160（2K），minScale 1（不缩小）
  const maxExportWidth = options?.maxExportWidth ?? 2160
  const minScale = options?.minScale ?? 1
  const fullContent = options?.fullContent !== false // 默认为 true

  // 获取元素的实际背景色（优先用户指定，否则自动检测）
  const bgColor = options?.backgroundColor ?? getEffectiveBackground(rootEl)

  // 计算元素尺寸：如果需要完整内容，使用 scrollWidth/scrollHeight
  const elementWidth = fullContent ? rootEl.scrollWidth : rootEl.getBoundingClientRect().width
  let captureScale = Math.min(1, maxExportWidth / Math.max(1, elementWidth))
  captureScale = Math.max(minScale, captureScale)

  const snapOptions: Record<string, unknown> = {
    scale: captureScale,
    // 禁用字体嵌入可以避免某些 Unicode 字符导致的 encodeURIComponent 错误
    embedFonts: options?.embedFonts ?? false,
    compress: options?.compress ?? true,
    backgroundColor: bgColor,
    crossOrigin: options?.crossOrigin ?? 'anonymous',
  }

  const result = await (
    snapdom as (
      element: Element,
      options: Record<string, unknown>
    ) => Promise<{
      toCanvas: () => Promise<unknown>
      toPng: (options?: Record<string, unknown>) => Promise<unknown>
      toImg: () => Promise<HTMLImageElement>
    }>
  )(rootEl, snapOptions)

  // Preferred: Canvas path, apply background and scale again if needed, export PNG
  try {
    const canvas: unknown = await result.toCanvas()
    if (canvas && (canvas as HTMLCanvasElement).toDataURL) {
      const srcCanvas = canvas as HTMLCanvasElement
      const outCanvas = document.createElement('canvas')
      const scale2 = srcCanvas.width > maxExportWidth ? maxExportWidth / srcCanvas.width : 1
      outCanvas.width = Math.round(srcCanvas.width * scale2)
      outCanvas.height = Math.round(srcCanvas.height * scale2)
      const ctx = outCanvas.getContext('2d')
      if (ctx) {
        ctx.fillStyle = bgColor
        ctx.fillRect(0, 0, outCanvas.width, outCanvas.height)
        ctx.drawImage(srcCanvas, 0, 0, outCanvas.width, outCanvas.height)
        const url = outCanvas.toDataURL('image/png')
        const ts = new Date().toISOString().replace(/[:.]/g, '-')
        triggerDownload(url, options?.filename ?? `wlb-report-${ts}.png`)
        return
      }
    }
  } catch {
    // fallback below
  }

  // Fallback: direct PNG export with background
  try {
    const png: unknown = await result.toPng({ backgroundColor: bgColor })
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const name = options?.filename ?? `wlb-report-${ts}.png`

    if (png instanceof HTMLImageElement) {
      triggerDownload(png.src, name)
      return
    }
    if (png instanceof Blob) {
      const url = URL.createObjectURL(png)
      triggerDownload(url, name)
      URL.revokeObjectURL(url)
      return
    }
    if (typeof png === 'string') {
      triggerDownload(png, name)
      return
    }
  } catch {
    // swallow
  }

  // Last Fallback: toImg
  try {
    const img: HTMLImageElement = await result.toImg()
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    triggerDownload(img.src, options?.filename ?? `wlb-report-${ts}.png`)
  } catch (e) {
    // As a last resort, do nothing but log
    console.error('captureAndDownloadPng: all export paths failed', e)
  }
}
