import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { AnalysisSession, ImportProgress } from '@/types/base'
import { chatApi, mergeApi, sessionApi } from '@/services'

/** 迁移信息 */
export interface MigrationInfo {
  version: number
  /** 技术描述（面向开发者） */
  description: string
  /** 用户可读的升级原因（显示在弹窗中） */
  userMessage: string
}

/** 迁移检查结果 */
export interface MigrationCheckResult {
  needsMigration: boolean
  count: number
  currentVersion: number
  pendingMigrations: MigrationInfo[]
}

/** 批量导入文件状态 */
export type BatchFileStatus = 'pending' | 'importing' | 'success' | 'failed' | 'cancelled'

/** 批量导入单个文件信息 */
export interface BatchFileInfo {
  file: File
  name: string
  status: BatchFileStatus
  progress?: ImportProgress
  error?: string
  diagnosisSuggestion?: string
  sessionId?: string
}

/** 批量导入结果 */
export interface BatchImportResult {
  total: number
  success: number
  failed: number
  cancelled: number
  files: BatchFileInfo[]
}

/** 合并导入文件状态 */
export type MergeFileStatus = 'pending' | 'parsing' | 'done'

/** 合并导入单个文件信息 */
export interface MergeFileInfo {
  file: File
  name: string
  status: MergeFileStatus
  fileKey?: string
  info?: {
    name: string
    format: string
    platform: string
    messageCount: number
    memberCount: number
    fileSize?: number
  }
}

/** 合并导入阶段 */
export type MergeImportStage = 'parsing' | 'merging' | 'done' | 'error'

/** 合并导入结果 */
export interface MergeImportResult {
  success: boolean
  sessionId?: string
  error?: string
}

/**
 * 会话与导入相关的全局状态
 */
export const useSessionStore = defineStore(
  'session',
  () => {
    // 会话列表
    const sessions = ref<AnalysisSession[]>([])
    // 当前会话 ID
    const currentSessionId = ref<string | null>(null)
    // 导入状态
    const isImporting = ref(false)
    const importProgress = ref<ImportProgress | null>(null)
    // 是否初始化完成
    const isInitialized = ref(false)

    // 批量导入状态
    const isBatchImporting = ref(false)
    const batchFiles = ref<BatchFileInfo[]>([])
    const batchImportCancelled = ref(false)
    const batchImportResult = ref<BatchImportResult | null>(null)

    // 合并导入状态
    const isMergeImporting = ref(false)
    const mergeFiles = ref<MergeFileInfo[]>([])
    const mergeStage = ref<MergeImportStage>('parsing')
    const mergeError = ref<string | null>(null)
    const mergeResult = ref<MergeImportResult | null>(null)

    // 当前选中的会话
    const currentSession = computed(() => {
      if (!currentSessionId.value) return null
      return sessions.value.find((s) => s.id === currentSessionId.value) || null
    })

    // 迁移相关状态
    const migrationNeeded = ref(false)
    const migrationCount = ref(0)
    const pendingMigrations = ref<MigrationInfo[]>([])
    const isMigrating = ref(false)

    /**
     * 检查是否需要数据库迁移
     */
    async function checkMigration(): Promise<MigrationCheckResult> {
      try {
        const result = await chatApi.checkMigration()
        migrationNeeded.value = result.needsMigration
        migrationCount.value = result.count
        pendingMigrations.value = result.pendingMigrations || []
        return result
      } catch (error) {
        console.error('检查迁移失败:', error)
        return { needsMigration: false, count: 0, currentVersion: 0, pendingMigrations: [] }
      }
    }

    /**
     * 执行数据库迁移
     */
    async function runMigration(): Promise<{ success: boolean; error?: string }> {
      isMigrating.value = true
      try {
        const result = await chatApi.runMigration()
        if (result.success) {
          migrationNeeded.value = false
          migrationCount.value = 0
        }
        return result
      } catch (error) {
        console.error('执行迁移失败:', error)
        return { success: false, error: String(error) }
      } finally {
        isMigrating.value = false
      }
    }

    /**
     * 从数据库加载会话列表
     */
    async function loadSessions() {
      try {
        const list = await chatApi.getSessions()
        sessions.value = list
        // 如果当前选中的会话不存在了，清除选中状态
        if (currentSessionId.value && !list.find((s) => s.id === currentSessionId.value)) {
          currentSessionId.value = null
        }
        isInitialized.value = true
      } catch (error) {
        console.error('加载会话列表失败:', error)
        isInitialized.value = true
      }
    }

    /**
     * 打开浏览器文件选择对话框并导入
     */
    async function importFile(): Promise<{
      success: boolean
      error?: string
      diagnosisSuggestion?: string
    }> {
      try {
        // Use browser file picker instead of Electron dialog
        const file = await pickFile()
        if (!file) {
          return { success: false, error: 'error.no_file_selected' }
        }

        // Detect format first
        const formatResult = await chatApi.detectFormat(file)
        if (!formatResult) {
          return { success: false, error: 'error.unsupported_format' }
        }

        return await importFileFromFile(file)
      } catch (error) {
        return { success: false, error: String(error) }
      }
    }

    /**
     * Open a browser file picker and return the selected File (or null if cancelled).
     */
    function pickFile(accept?: string): Promise<File | null> {
      return new Promise((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        if (accept) input.accept = accept
        input.onchange = () => {
          resolve(input.files?.[0] ?? null)
        }
        // Handle cancel — the input never fires change if user cancels
        // Use a focus listener to detect dialog close without selection
        const onFocus = () => {
          window.removeEventListener('focus', onFocus)
          // Small delay to let change fire first if file was selected
          setTimeout(() => {
            if (!input.files || input.files.length === 0) {
              resolve(null)
            }
          }, 300)
        }
        window.addEventListener('focus', onFocus)
        input.click()
      })
    }

    /** 导入诊断信息类型 */
    interface ImportDiagnosticsInfo {
      logFile: string | null
      detectedFormat: string | null
      messagesReceived: number
      messagesWritten: number
      messagesSkipped: number
      skipReasons: {
        noSenderId: number
        noAccountName: number
        invalidTimestamp: number
        noType: number
      }
    }

    /**
     * 从 File 对象执行导入（支持拖拽和文件选择）
     */
    async function importFileFromFile(file: File): Promise<{
      success: boolean
      error?: string
      diagnosisSuggestion?: string
      diagnostics?: ImportDiagnosticsInfo
    }> {
      try {
        isImporting.value = true
        importProgress.value = {
          stage: 'detecting',
          progress: 0,
          message: '',
        }

        // Stage progression for web: we simulate stages since we don't get IPC progress events
        const stages = ['detecting', 'reading', 'parsing', 'writing'] as const
        let stageIndex = 0
        const stageInterval = setInterval(() => {
          if (stageIndex < stages.length - 1) {
            stageIndex++
            if (importProgress.value) {
              importProgress.value = {
                stage: stages[stageIndex],
                progress: Math.min(90, (stageIndex / stages.length) * 100),
                message: '',
              }
            }
          }
        }, 800)

        const importResult = await chatApi.import(file)

        clearInterval(stageInterval)

        if (importProgress.value) {
          importProgress.value.progress = 100
        }
        await new Promise((resolve) => setTimeout(resolve, 300))

        if (importResult.success && importResult.sessionId) {
          await loadSessions()
          currentSessionId.value = importResult.sessionId

          // 自动生成会话索引
          try {
            const savedThreshold = localStorage.getItem('sessionGapThreshold')
            const gapThreshold = savedThreshold ? parseInt(savedThreshold, 10) : 1800
            await sessionApi.generate(importResult.sessionId, gapThreshold)
          } catch (error) {
            console.error('自动生成会话索引失败:', error)
          }

          return { success: true, diagnostics: importResult.diagnostics }
        } else {
          const diagnosisSuggestion = importResult.diagnosis?.suggestion
          return {
            success: false,
            error: importResult.error || 'error.import_failed',
            diagnosisSuggestion,
            diagnostics: importResult.diagnostics,
          }
        }
      } catch (error) {
        return { success: false, error: String(error) }
      } finally {
        isImporting.value = false
        setTimeout(() => {
          importProgress.value = null
        }, 500)
      }
    }

    /**
     * Legacy path-based import — redirects to file-based import.
     * Kept for backward compatibility with components that may still call it.
     */
    async function importFileFromPath(_filePath: string): Promise<{
      success: boolean
      error?: string
      diagnosisSuggestion?: string
      diagnostics?: ImportDiagnosticsInfo
    }> {
      // In the web app, we can't import from file paths.
      // Components should be updated to pass File objects instead.
      return { success: false, error: 'File path imports are not supported in the web app. Use File objects.' }
    }

    /**
     * 批量导入多个文件（串行执行）
     */
    async function importFilesFromFiles(files: File[]): Promise<BatchImportResult> {
      if (files.length === 0) {
        return { total: 0, success: 0, failed: 0, cancelled: 0, files: [] }
      }

      // 初始化批量导入状态
      isBatchImporting.value = true
      batchImportCancelled.value = false
      batchImportResult.value = null

      // 初始化文件列表
      batchFiles.value = files.map((file) => ({
        file,
        name: file.name,
        status: 'pending' as BatchFileStatus,
      }))

      let successCount = 0
      let failedCount = 0
      let cancelledCount = 0

      const markRemainingAsCancelled = (startIndex: number) => {
        for (let j = startIndex; j < batchFiles.value.length; j++) {
          if (batchFiles.value[j].status === 'pending') {
            batchFiles.value[j].status = 'cancelled'
            cancelledCount++
          }
        }
      }

      for (let i = 0; i < batchFiles.value.length; i++) {
        if (batchImportCancelled.value) {
          markRemainingAsCancelled(i)
          break
        }

        const fileInfo = batchFiles.value[i]
        fileInfo.status = 'importing'
        fileInfo.progress = {
          stage: 'detecting',
          progress: 0,
          message: '',
        }

        try {
          const importResult = await chatApi.import(fileInfo.file)

          if (batchImportCancelled.value) {
            if (importResult.success && importResult.sessionId) {
              fileInfo.status = 'success'
              fileInfo.sessionId = importResult.sessionId
              successCount++
              try {
                const savedThreshold = localStorage.getItem('sessionGapThreshold')
                const gapThreshold = savedThreshold ? parseInt(savedThreshold, 10) : 1800
                await sessionApi.generate(importResult.sessionId, gapThreshold)
              } catch (error) {
                console.error('自动生成会话索引失败:', error)
              }
            } else {
              fileInfo.status = 'failed'
              fileInfo.error = importResult.error || 'error.import_failed'
              failedCount++
            }
            markRemainingAsCancelled(i + 1)
            break
          }

          if (importResult.success && importResult.sessionId) {
            fileInfo.status = 'success'
            fileInfo.sessionId = importResult.sessionId
            successCount++
            if (!batchImportCancelled.value) {
              try {
                const savedThreshold = localStorage.getItem('sessionGapThreshold')
                const gapThreshold = savedThreshold ? parseInt(savedThreshold, 10) : 1800
                await sessionApi.generate(importResult.sessionId, gapThreshold)
              } catch (error) {
                console.error('自动生成会话索引失败:', error)
              }
            }
          } else {
            fileInfo.status = 'failed'
            fileInfo.error = importResult.error || 'error.import_failed'
            fileInfo.diagnosisSuggestion = importResult.diagnosis?.suggestion
            failedCount++
          }
        } catch (error) {
          fileInfo.status = 'failed'
          fileInfo.error = String(error)
          failedCount++
        }
      }

      await loadSessions()

      const result: BatchImportResult = {
        total: files.length,
        success: successCount,
        failed: failedCount,
        cancelled: cancelledCount,
        files: [...batchFiles.value],
      }

      batchImportResult.value = result
      isBatchImporting.value = false

      return result
    }

    /**
     * Legacy path-based batch import — kept for API compat.
     */
    async function importFilesFromPaths(_filePaths: string[]): Promise<BatchImportResult> {
      return { total: 0, success: 0, failed: 0, cancelled: 0, files: [] }
    }

    /**
     * 取消批量导入（跳过剩余文件）
     */
    function cancelBatchImport() {
      batchImportCancelled.value = true
    }

    /**
     * 清除批量导入结果
     */
    function clearBatchImportResult() {
      batchImportResult.value = null
      batchFiles.value = []
    }

    /**
     * 合并导入多个文件为一个会话
     * Now accepts File objects instead of file paths.
     */
    async function mergeImportFiles(files: File[]): Promise<MergeImportResult> {
      if (files.length < 2) {
        return { success: false, error: '合并导入至少需要2个文件' }
      }

      const MIN_STAGE_TIME = 800

      isMergeImporting.value = true
      mergeError.value = null
      mergeResult.value = null
      mergeStage.value = 'parsing'

      mergeFiles.value = files.map((file) => ({
        file,
        name: file.name,
        status: 'pending' as MergeFileStatus,
      }))

      let stageStartTime = Date.now()

      try {
        // 阶段1：串行解析所有文件 (upload each file to get a fileKey)
        const fileKeys: string[] = []

        for (let i = 0; i < mergeFiles.value.length; i++) {
          const fileInfo = mergeFiles.value[i]
          const fileStartTime = Date.now()
          fileInfo.status = 'parsing'

          try {
            const result = await mergeApi.parseFileInfo(fileInfo.file)
            fileInfo.info = {
              name: result.name,
              format: result.format,
              platform: result.platform,
              messageCount: result.messageCount,
              memberCount: result.memberCount,
            }
            fileInfo.fileKey = result.fileKey
            fileKeys.push(result.fileKey)

            const elapsed = Date.now() - fileStartTime
            const minFileTime = Math.max(300, MIN_STAGE_TIME / files.length)
            if (elapsed < minFileTime) {
              await new Promise((resolve) => setTimeout(resolve, minFileTime - elapsed))
            }

            fileInfo.status = 'done'
          } catch (err) {
            throw new Error(`解析文件失败: ${fileInfo.name} - ${err instanceof Error ? err.message : String(err)}`)
          }
        }

        const parsingElapsed = Date.now() - stageStartTime
        if (parsingElapsed < MIN_STAGE_TIME) {
          await new Promise((resolve) => setTimeout(resolve, MIN_STAGE_TIME - parsingElapsed))
        }

        // 阶段2：执行合并
        stageStartTime = Date.now()
        mergeStage.value = 'merging'

        const names = mergeFiles.value.map((f) => f.info?.name).filter(Boolean)
        const uniqueNames = [...new Set(names)]
        const outputName = uniqueNames.length === 1 ? uniqueNames[0]! : names[0] || '合并记录'

        const result = await mergeApi.mergeFiles({
          filePaths: [], // Not used in web API; fileKeys are used instead
          fileKeys,
          outputName,
          conflictResolutions: [],
          andAnalyze: true,
        })

        if (!result.success) {
          throw new Error(result.error || '合并失败')
        }

        await mergeApi.clearCache()

        const mergingElapsed = Date.now() - stageStartTime
        if (mergingElapsed < MIN_STAGE_TIME) {
          await new Promise((resolve) => setTimeout(resolve, MIN_STAGE_TIME - mergingElapsed))
        }

        mergeStage.value = 'done'
        mergeResult.value = { success: true, sessionId: result.sessionId }

        await loadSessions()

        if (result.sessionId) {
          try {
            const savedThreshold = localStorage.getItem('sessionGapThreshold')
            const gapThreshold = savedThreshold ? parseInt(savedThreshold, 10) : 1800
            await sessionApi.generate(result.sessionId, gapThreshold)
          } catch (error) {
            console.error('自动生成会话索引失败:', error)
          }
        }

        return { success: true, sessionId: result.sessionId }
      } catch (err) {
        mergeStage.value = 'error'
        const errorMessage = err instanceof Error ? err.message : String(err)
        mergeError.value = errorMessage
        mergeResult.value = { success: false, error: errorMessage }
        await mergeApi.clearCache()
        return { success: false, error: errorMessage }
      }
    }

    /**
     * 清除合并导入结果
     */
    function clearMergeImportResult() {
      isMergeImporting.value = false
      mergeFiles.value = []
      mergeResult.value = null
      mergeError.value = null
    }

    /**
     * 选择指定会话
     */
    function selectSession(id: string) {
      currentSessionId.value = id
    }

    /**
     * 删除会话
     */
    async function deleteSession(id: string): Promise<boolean> {
      try {
        const success = await chatApi.deleteSession(id)
        if (success) {
          const index = sessions.value.findIndex((s) => s.id === id)
          if (index !== -1) {
            sessions.value.splice(index, 1)
          }
          if (currentSessionId.value === id) {
            currentSessionId.value = null
          }
          await loadSessions()
        }
        return success
      } catch (error) {
        console.error('删除会话失败:', error)
        return false
      }
    }

    /**
     * 重命名会话
     */
    async function renameSession(id: string, newName: string): Promise<boolean> {
      try {
        const success = await chatApi.renameSession(id, newName)
        if (success) {
          const session = sessions.value.find((s) => s.id === id)
          if (session) {
            session.name = newName
          }
        }
        return success
      } catch (error) {
        console.error('重命名会话失败:', error)
        return false
      }
    }

    /**
     * 清空当前选中会话
     */
    function clearSelection() {
      currentSessionId.value = null
    }

    /**
     * 更新会话的所有者
     */
    async function updateSessionOwnerId(id: string, ownerId: string | null): Promise<boolean> {
      try {
        const success = await chatApi.updateSessionOwnerId(id, ownerId)
        if (success) {
          const session = sessions.value.find((s) => s.id === id)
          if (session) {
            session.ownerId = ownerId
          }
        }
        return success
      } catch (error) {
        console.error('更新会话所有者失败:', error)
        return false
      }
    }

    // 置顶会话 ID 列表
    const pinnedSessionIds = ref<string[]>([])

    // 排序后的会话列表
    const sortedSessions = computed(() => {
      const pinIndexMap = new Map(pinnedSessionIds.value.map((id, index) => [id, index]))

      return [...sessions.value].sort((a, b) => {
        const aPinIndex = pinIndexMap.get(a.id)
        const bPinIndex = pinIndexMap.get(b.id)
        const aPinned = aPinIndex !== undefined
        const bPinned = bPinIndex !== undefined

        if (aPinned && bPinned) {
          return bPinIndex! - aPinIndex!
        }
        if (aPinned && !bPinned) return -1
        if (!aPinned && bPinned) return 1

        return 0
      })
    })

    function togglePinSession(id: string) {
      const index = pinnedSessionIds.value.indexOf(id)
      if (index !== -1) {
        pinnedSessionIds.value.splice(index, 1)
      } else {
        pinnedSessionIds.value.push(id)
      }
    }

    function isPinned(id: string): boolean {
      return pinnedSessionIds.value.includes(id)
    }

    return {
      sessions,
      sortedSessions,
      pinnedSessionIds,
      currentSessionId,
      isImporting,
      importProgress,
      isInitialized,
      currentSession,
      // 迁移相关
      migrationNeeded,
      migrationCount,
      pendingMigrations,
      isMigrating,
      checkMigration,
      runMigration,
      // 会话操作
      loadSessions,
      importFile,
      importFileFromFile,
      importFileFromPath,
      selectSession,
      deleteSession,
      renameSession,
      clearSelection,
      updateSessionOwnerId,
      togglePinSession,
      isPinned,
      // 批量导入
      isBatchImporting,
      batchFiles,
      batchImportCancelled,
      batchImportResult,
      importFilesFromFiles,
      importFilesFromPaths,
      cancelBatchImport,
      clearBatchImportResult,
      // 合并导入
      isMergeImporting,
      mergeFiles,
      mergeStage,
      mergeError,
      mergeResult,
      mergeImportFiles,
      clearMergeImportResult,
    }
  },
  {
    persist: [
      {
        pick: ['currentSessionId'],
        storage: sessionStorage,
      },
      {
        pick: ['pinnedSessionIds'],
        storage: localStorage,
      },
    ],
  }
)
