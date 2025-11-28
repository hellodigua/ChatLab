import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AnalysisSession,
  MemberActivity,
  MemberNameHistory,
  HourlyActivity,
  DailyActivity,
  WeekdayActivity,
  MessageType,
  ImportProgress,
  RepeatAnalysis,
  CatchphraseAnalysis,
  NightOwlAnalysis,
  DragonKingAnalysis,
  DivingAnalysis,
} from '../../src/types/chat'

// Custom APIs for renderer
const api = {
  send: (channel: string, data?: unknown) => {
    // whitelist channels
    const validChannels = [
      'show-message',
      'check-update',
      'get-gpu-acceleration',
      'set-gpu-acceleration',
      'save-gpu-acceleration',
    ]
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data)
    }
  },
  receive: (channel: string, func: (...args: unknown[]) => void) => {
    const validChannels = ['show-message', 'chat:importProgress']
    if (validChannels.includes(channel)) {
      // Deliberately strip event as it includes `sender`
      ipcRenderer.on(channel, (_event, ...args) => func(...args))
    }
  },
  removeListener: (channel: string, func: (...args: unknown[]) => void) => {
    ipcRenderer.removeListener(channel, func)
  },
}

// Chat Analysis API
const chatApi = {
  /**
   * 选择聊天记录文件
   */
  selectFile: (): Promise<{ filePath?: string; format?: string; error?: string } | null> => {
    return ipcRenderer.invoke('chat:selectFile')
  },

  /**
   * 导入聊天记录
   */
  import: (filePath: string): Promise<{ success: boolean; sessionId?: string; error?: string }> => {
    return ipcRenderer.invoke('chat:import', filePath)
  },

  /**
   * 获取所有分析会话列表
   */
  getSessions: (): Promise<AnalysisSession[]> => {
    return ipcRenderer.invoke('chat:getSessions')
  },

  /**
   * 获取单个会话信息
   */
  getSession: (sessionId: string): Promise<AnalysisSession | null> => {
    return ipcRenderer.invoke('chat:getSession', sessionId)
  },

  /**
   * 删除会话
   */
  deleteSession: (sessionId: string): Promise<boolean> => {
    return ipcRenderer.invoke('chat:deleteSession', sessionId)
  },

  /**
   * 获取可用年份列表
   */
  getAvailableYears: (sessionId: string): Promise<number[]> => {
    return ipcRenderer.invoke('chat:getAvailableYears', sessionId)
  },

  /**
   * 获取成员活跃度排行
   */
  getMemberActivity: (sessionId: string, filter?: { startTs?: number; endTs?: number }): Promise<MemberActivity[]> => {
    return ipcRenderer.invoke('chat:getMemberActivity', sessionId, filter)
  },

  /**
   * 获取成员历史昵称
   */
  getMemberNameHistory: (sessionId: string, memberId: number): Promise<MemberNameHistory[]> => {
    return ipcRenderer.invoke('chat:getMemberNameHistory', sessionId, memberId)
  },

  /**
   * 获取每小时活跃度分布
   */
  getHourlyActivity: (sessionId: string, filter?: { startTs?: number; endTs?: number }): Promise<HourlyActivity[]> => {
    return ipcRenderer.invoke('chat:getHourlyActivity', sessionId, filter)
  },

  /**
   * 获取每日活跃度趋势
   */
  getDailyActivity: (sessionId: string, filter?: { startTs?: number; endTs?: number }): Promise<DailyActivity[]> => {
    return ipcRenderer.invoke('chat:getDailyActivity', sessionId, filter)
  },

  /**
   * 获取星期活跃度分布
   */
  getWeekdayActivity: (sessionId: string, filter?: { startTs?: number; endTs?: number }): Promise<WeekdayActivity[]> => {
    return ipcRenderer.invoke('chat:getWeekdayActivity', sessionId, filter)
  },

  /**
   * 获取消息类型分布
   */
  getMessageTypeDistribution: (
    sessionId: string,
    filter?: { startTs?: number; endTs?: number }
  ): Promise<Array<{ type: MessageType; count: number }>> => {
    return ipcRenderer.invoke('chat:getMessageTypeDistribution', sessionId, filter)
  },

  /**
   * 获取时间范围
   */
  getTimeRange: (sessionId: string): Promise<{ start: number; end: number } | null> => {
    return ipcRenderer.invoke('chat:getTimeRange', sessionId)
  },

  /**
   * 获取数据库存储目录
   */
  getDbDirectory: (): Promise<string | null> => {
    return ipcRenderer.invoke('chat:getDbDirectory')
  },

  /**
   * 获取支持的格式列表
   */
  getSupportedFormats: (): Promise<Array<{ name: string; platform: string }>> => {
    return ipcRenderer.invoke('chat:getSupportedFormats')
  },

  /**
   * 监听导入进度
   */
  onImportProgress: (callback: (progress: ImportProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: ImportProgress) => {
      callback(progress)
    }
    ipcRenderer.on('chat:importProgress', handler)
    return () => {
      ipcRenderer.removeListener('chat:importProgress', handler)
    }
  },

  /**
   * 获取复读分析数据
   */
  getRepeatAnalysis: (sessionId: string, filter?: { startTs?: number; endTs?: number }): Promise<RepeatAnalysis> => {
    return ipcRenderer.invoke('chat:getRepeatAnalysis', sessionId, filter)
  },

  /**
   * 获取口头禅分析数据
   */
  getCatchphraseAnalysis: (
    sessionId: string,
    filter?: { startTs?: number; endTs?: number }
  ): Promise<CatchphraseAnalysis> => {
    return ipcRenderer.invoke('chat:getCatchphraseAnalysis', sessionId, filter)
  },

  /**
   * 获取夜猫分析数据
   */
  getNightOwlAnalysis: (
    sessionId: string,
    filter?: { startTs?: number; endTs?: number }
  ): Promise<NightOwlAnalysis> => {
    return ipcRenderer.invoke('chat:getNightOwlAnalysis', sessionId, filter)
  },

  /**
   * 获取龙王分析数据
   */
  getDragonKingAnalysis: (
    sessionId: string,
    filter?: { startTs?: number; endTs?: number }
  ): Promise<DragonKingAnalysis> => {
    return ipcRenderer.invoke('chat:getDragonKingAnalysis', sessionId, filter)
  },

  /**
   * 获取潜水分析数据
   */
  getDivingAnalysis: (
    sessionId: string,
    filter?: { startTs?: number; endTs?: number }
  ): Promise<DivingAnalysis> => {
    return ipcRenderer.invoke('chat:getDivingAnalysis', sessionId, filter)
  },
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
    contextBridge.exposeInMainWorld('chatApi', chatApi)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
  // @ts-ignore (define in dts)
  window.chatApi = chatApi
}
