/**
 * 窗口和文件系统操作 IPC 处理器
 */

import { ipcMain, app, dialog, clipboard, shell } from 'electron'
import * as fs from 'fs/promises'
import type { IpcContext } from './types'
import { simulateUpdateDialog, manualCheckForUpdates } from '../update'

/**
 * 注册窗口和文件系统操作 IPC 处理器
 */
export function registerWindowHandlers(ctx: IpcContext): void {
  const { win } = ctx

  // ==================== 窗口操作 ====================
  ipcMain.on('window-min', (ev) => {
    ev.preventDefault()
    win.minimize()
  })

  ipcMain.on('window-maxOrRestore', (ev) => {
    const winSizeState = win.isMaximized()
    winSizeState ? win.restore() : win.maximize()
    ev.reply('windowState', win.isMaximized())
  })

  ipcMain.on('window-restore', () => {
    win.restore()
  })

  ipcMain.on('window-hide', () => {
    win.hide()
  })

  ipcMain.on('window-close', () => {
    win.close()
    // @ts-ignore
    app.isQuitting = true
    app.quit()
  })

  ipcMain.on('window-resize', (_, data) => {
    if (data.resize) {
      win.setResizable(true)
    } else {
      win.setSize(1180, 752)
      win.setResizable(false)
    }
  })

  ipcMain.on('open-devtools', () => {
    win.webContents.openDevTools()
  })

  // 设置主题模式
  ipcMain.on('window:setThemeSource', (_, mode: 'system' | 'light' | 'dark') => {
    const { nativeTheme } = require('electron')
    nativeTheme.themeSource = mode
    
    // Windows 上动态更新图标颜色以匹配主题
    if (process.platform === 'win32' && win) {
      const isDark = nativeTheme.shouldUseDarkColors
      win.setTitleBarOverlay({
        color: '#00000000', // 透明背景
        symbolColor: isDark ? '#a1a1aa' : '#52525b', // dark: zinc-400, light: zinc-600
        height: 32,
      })
    }
  })

  // ==================== 应用信息 ====================
  ipcMain.handle('app:getVersion', () => {
    return app.getVersion()
  })

  // 获取动态文案配置
  ipcMain.handle('app:fetchRemoteConfig', async (_, url: string) => {
    try {
      const response = await fetch(url)
      const data = await response.json()
      return { success: true, data }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // ==================== 更新检查 ====================
  ipcMain.on('check-update', () => {
    // 手动检查更新（即使是预发布版本也会提示）
    manualCheckForUpdates()
  })

  // 模拟更新弹窗（仅开发模式使用）
  ipcMain.on('simulate-update', () => {
    if (!app.isPackaged) {
      simulateUpdateDialog(win)
    }
  })

  // ==================== 通用工具 ====================
  ipcMain.handle('show-message', (event, args) => {
    event.sender.send('show-message', args)
  })

  // 复制到剪贴板（文本）
  ipcMain.handle('copyData', async (_, data) => {
    try {
      clipboard.writeText(data)
      return true
    } catch (error) {
      console.error('复制操作出错：', error)
      return false
    }
  })

  // 复制图片到剪贴板（base64 data URL）
  ipcMain.handle('copyImage', async (_, dataUrl: string) => {
    try {
      // 从 data URL 中提取 base64 数据
      const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '')
      const imageBuffer = Buffer.from(base64Data, 'base64')
      // 使用 nativeImage 创建图片并写入剪贴板
      const { nativeImage } = await import('electron')
      const image = nativeImage.createFromBuffer(imageBuffer)
      clipboard.writeImage(image)
      return { success: true }
    } catch (error) {
      console.error('复制图片操作出错：', error)
      return { success: false, error: String(error) }
    }
  })

  // ==================== 文件系统操作 ====================
  // 选择文件夹
  ipcMain.handle('selectDir', async (_, defaultPath = '') => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: '选择目录',
        defaultPath: defaultPath || app.getPath('documents'),
        properties: ['openDirectory', 'createDirectory'],
        buttonLabel: '选择文件夹',
      })
      if (!canceled) {
        return filePaths[0]
      }
      return null
    } catch (err) {
      console.error('选择文件夹时发生错误：', err)
      throw err
    }
  })

  // 检查文件是否存在
  ipcMain.handle('checkFileExist', async (_, filePath) => {
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  })

  // 在文件管理器中打开
  ipcMain.handle('openInFolder', async (_, path) => {
    try {
      await fs.access(path)
      await shell.showItemInFolder(path)
      return true
    } catch (error) {
      console.error('打开目录时出错：', error)
      return false
    }
  })

  // 显示打开对话框（通用）
  ipcMain.handle('dialog:showOpenDialog', async (_, options) => {
    try {
      return await dialog.showOpenDialog(options)
    } catch (error) {
      console.error('显示对话框失败：', error)
      throw error
    }
  })
}
