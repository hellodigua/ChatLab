import { dialog, app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { platform } from '@electron-toolkit/utils'
import { logger } from './logger'
import { getActiveProxyUrl } from './network/proxy'

/**
 * 配置自动更新的代理设置
 * electron-updater 通过环境变量读取代理配置
 */
function configureUpdateProxy(): void {
  const proxyUrl = getActiveProxyUrl()

  if (proxyUrl) {
    // 设置环境变量，electron-updater 会自动读取
    process.env.HTTPS_PROXY = proxyUrl
    process.env.HTTP_PROXY = proxyUrl
    logger.info(`[Update] 使用代理: ${proxyUrl}`)
  } else {
    // 清除代理环境变量
    delete process.env.HTTPS_PROXY
    delete process.env.HTTP_PROXY
  }
}

/**
 * 判断版本号是否为预发布版本
 * 预发布版本格式：0.3.0-beta.1, 0.4.2-alpha.23, 1.0.0-rc.1 等
 * 标准版本格式：0.3.0, 1.0.0, 2.1.3 等
 */
function isPreReleaseVersion(version: string): boolean {
  // 预发布版本包含连字符后跟预发布标识（alpha, beta, rc, dev, canary 等）
  return /-/.test(version)
}

let isFirstShow = true
// 标记是否为手动检查更新（手动检查时即使是预发布版本也显示弹窗）
let isManualCheck = false
const checkUpdate = (win) => {
  // 配置代理
  configureUpdateProxy()

  autoUpdater.autoDownload = false // 自动下载
  autoUpdater.autoInstallOnAppQuit = true // 应用退出后自动安装

  // 开发模式下模拟更新检测（需要创建 dev-app-update.yml 文件）
  // 取消下面的注释来启用开发模式更新测试
  // if (!app.isPackaged) {
  //   Object.defineProperty(app, 'isPackaged', {
  //     get() {
  //       return true
  //     },
  //   })
  // }

  let showUpdateMessageBox = false
  autoUpdater.on('update-available', (info) => {
    // win.webContents.send('show-message', 'electron:发现新版本')
    if (showUpdateMessageBox) return

    // 检查是否为预发布版本
    const isPreRelease = isPreReleaseVersion(info.version)

    // 预发布版本仅在手动检查时显示更新弹窗
    if (isPreRelease && !isManualCheck) {
      console.log(`[Update] 发现预发布版本 ${info.version}，跳过自动更新提示`)
      logger.info(`[Update] 发现预发布版本 ${info.version}，跳过自动更新提示（需手动检查更新）`)
      return
    }

    showUpdateMessageBox = true

    // 解析更新日志
    let releaseNotes = ''
    if (info.releaseNotes) {
      if (typeof info.releaseNotes === 'string') {
        releaseNotes = info.releaseNotes
      } else if (Array.isArray(info.releaseNotes)) {
        releaseNotes = info.releaseNotes.map((note) => note.note || note).join('\n')
      }
      // 简单清理 HTML 标签，合并连续空行，截断下载说明
      releaseNotes = releaseNotes
        .replace(/<[^>]*>/g, '')
        .replace(/\n{2,}/g, '\n')
        .trim()

      // 如果包含下载说明章节，截断该部分及之后的内容（匹配二级标题，支持中英文）
      const downloadGuideIndex = Math.min(
        ...[releaseNotes.indexOf('## Download'), releaseNotes.indexOf('## 下载说明')]
          .filter((i) => i > 0)
          .concat([Infinity])
      )
      if (downloadGuideIndex < Infinity) {
        releaseNotes = releaseNotes.substring(0, downloadGuideIndex).trim()
      }
    }

    const detail = releaseNotes
      ? `更新内容：\n${releaseNotes}\n\n是否立即下载并安装新版本？`
      : '是否立即下载并安装新版本？'

    dialog
      .showMessageBox({
        title: '发现新版本 v' + info.version,
        message: '发现新版本 v' + info.version,
        detail,
        buttons: ['立即下载', '取消'],
        defaultId: 0,
        cancelId: 1,
        type: 'question',
        noLink: true,
      })
      .then((result) => {
        showUpdateMessageBox = false
        if (result.response === 0) {
          autoUpdater
            .downloadUpdate()
            .then(() => {
              console.log('wait for post download operation')
            })
            .catch((downloadError) => {
              // 下载失败记录到日志，不显示给用户
              logger.error(`[Update] 下载更新失败: ${downloadError}`)
            })
        }
      })
  })

  // 监听下载进度事件
  autoUpdater.on('download-progress', (progressObj) => {
    console.log(`更新下载进度: ${progressObj.percent}%`)
    win.webContents.send('update-download-progress', progressObj.percent)
  })

  // 下载完成
  autoUpdater.on('update-downloaded', () => {
    dialog
      .showMessageBox({
        title: '下载完成',
        message: '新版本已准备就绪，是否现在安装？',
        buttons: ['安装', platform.isMacOS ? '之后提醒' : '稍后（应用退出后自动安装）'],
        defaultId: 1,
        cancelId: 2,
        type: 'question',
      })
      .then((result) => {
        if (result.response === 0) {
          win.webContents.send('begin-install')
          // @ts-ignore
          app.isQuiting = true
          setTimeout(() => {
            setImmediate(() => {
              autoUpdater.quitAndInstall()
            })
          }, 100)
        }
      })
  })

  // 不需要更新
  autoUpdater.on('update-not-available', (info) => {
    // 客户端打开会默认弹一次，用isFirstShow来控制不弹
    if (isFirstShow) {
      isFirstShow = false
    } else {
      win.webContents.send('show-message', {
        type: 'success',
        message: '已是最新版本',
      })
    }
  })

  // 错误处理（静默处理，记录到日志）
  autoUpdater.on('error', (err) => {
    // 更新错误记录到日志，不显示给用户
    logger.error(`[Update] 更新错误: ${err.message || err}`)
  })

  // 等待 3 秒再检查更新，确保窗口准备完成，用户进入系统
  setTimeout(() => {
    isManualCheck = false // 自动检查
    autoUpdater.checkForUpdates().catch((err) => {
      console.log('[Update] 检查更新失败:', err)
    })
  }, 3000)
}

/**
 * 手动检查更新
 * 手动检查时，即使是预发布版本也会显示更新弹窗
 */
const manualCheckForUpdates = () => {
  // 配置代理
  configureUpdateProxy()

  isManualCheck = true // 手动检查
  isFirstShow = false // 手动检查时，无论结果都显示提示

  autoUpdater.checkForUpdates().catch((err) => {
    console.log('[Update] 手动检查更新失败:', err)
    logger.error(`[Update] 手动检查更新失败: ${err}`)
  })
}

/**
 * 模拟更新弹窗（仅用于开发测试）
 * 控制台通过：window.api.app.simulateUpdate() 测试
 */
const simulateUpdateDialog = (win) => {
  const mockInfo = {
    version: '9.9.9',
    releaseNotes: `## 更新内容\n\n- 🎉 新增聊天记录查看器\n- 🔧 修复已知问题\n- ⚡️ 性能优化`,
  }

  // 解析更新日志
  let releaseNotes = mockInfo.releaseNotes.replace(/<[^>]*>/g, '').trim()

  const detail = releaseNotes
    ? `更新内容：\n${releaseNotes}\n\n是否立即下载并安装新版本？`
    : '是否立即下载并安装新版本？'

  dialog.showMessageBox({
    title: '发现新版本 v' + mockInfo.version,
    message: '发现新版本 v' + mockInfo.version,
    detail,
    buttons: ['立即下载', '取消'],
    defaultId: 0,
    cancelId: 1,
    type: 'question',
    noLink: true,
  })
}

export { checkUpdate, simulateUpdateDialog, manualCheckForUpdates }
