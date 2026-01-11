import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { AnalysisSession, ImportProgress } from '@/types/base'

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
        const result = await window.chatApi.checkMigration()
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
        const result = await window.chatApi.runMigration()
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
        const list = await window.chatApi.getSessions()
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
     * 选择文件并导入
     */
    async function importFile(): Promise<{
      success: boolean
      error?: string
      diagnosisSuggestion?: string
    }> {
      try {
      const result = await window.chatApi.selectFile()
      // 用户取消选择
        if (!result) {
          return { success: false, error: 'error.no_file_selected' }
        }
        // 有错误（如格式不识别）- 优先检查错误，因为此时可能没有 filePath
        if (result.error) {
          const diagnosisSuggestion = result.diagnosis?.suggestion
          return { success: false, error: result.error, diagnosisSuggestion }
        }
        // 没有文件路径（用户取消）
        if (!result.filePath) {
          return { success: false, error: 'error.no_file_selected' }
        }
        return await importFileFromPath(result.filePath)
      } catch (error) {
        return { success: false, error: String(error) }
      }
    }

    /**
     * 从指定路径执行导入（支持拖拽）
     */
    async function importFileFromPath(filePath: string): Promise<{
      success: boolean
      error?: string
      diagnosisSuggestion?: string
    }> {
      try {
        isImporting.value = true
        importProgress.value = {
          stage: 'detecting',
          progress: 0,
          message: '', // Progress text is handled by frontend i18n
        }

        // 进度队列控制
        const queue: ImportProgress[] = []
        let isProcessing = false
        let currentStage = 'reading'
        let lastStageTime = Date.now()
        const MIN_STAGE_TIME = 1000

        /**
         * 处理导入进度队列，确保阶段展示足够时间
         */
        const processQueue = async () => {
          if (isProcessing) return
          isProcessing = true

          while (queue.length > 0) {
            const next = queue[0]

            if (next.stage !== currentStage) {
              const elapsed = Date.now() - lastStageTime
              if (elapsed < MIN_STAGE_TIME) {
                await new Promise((resolve) => setTimeout(resolve, MIN_STAGE_TIME - elapsed))
              }
              currentStage = next.stage
              lastStageTime = Date.now()
            }

            importProgress.value = queue.shift()!
          }
          isProcessing = false
        }

        const unsubscribe = window.chatApi.onImportProgress((progress) => {
          if (progress.stage === 'done') return
          queue.push(progress)
          processQueue()
        })

        const importResult = await window.chatApi.import(filePath)
        unsubscribe()

        while (queue.length > 0 || isProcessing) {
          await new Promise((resolve) => setTimeout(resolve, 100))
        }

        const elapsed = Date.now() - lastStageTime
        if (elapsed < MIN_STAGE_TIME) {
          await new Promise((resolve) => setTimeout(resolve, MIN_STAGE_TIME - elapsed))
        }

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
            const gapThreshold = savedThreshold ? parseInt(savedThreshold, 10) : 1800 // 默认30分钟
            await window.sessionApi.generate(importResult.sessionId, gapThreshold)
          } catch (error) {
            console.error('自动生成会话索引失败:', error)
            // 不阻断导入流程，用户可以手动生成
          }

          return { success: true }
        } else {
          // 传递诊断信息（如果有）
          const diagnosisSuggestion = importResult.diagnosis?.suggestion
          return {
            success: false,
            error: importResult.error || 'error.import_failed',
            diagnosisSuggestion,
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
        const success = await window.chatApi.deleteSession(id)
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
        const success = await window.chatApi.renameSession(id, newName)
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
        const success = await window.chatApi.updateSessionOwnerId(id, ownerId)
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
      // 建立索引映射，index 越大表示越晚置顶
      const pinIndexMap = new Map(pinnedSessionIds.value.map((id, index) => [id, index]))

      return [...sessions.value].sort((a, b) => {
        const aPinIndex = pinIndexMap.get(a.id)
        const bPinIndex = pinIndexMap.get(b.id)
        const aPinned = aPinIndex !== undefined
        const bPinned = bPinIndex !== undefined

        // 两个都置顶：后置顶的（index 大的）排前面
        if (aPinned && bPinned) {
          return bPinIndex! - aPinIndex!
        }
        // 只有一个置顶：置顶的排前面
        if (aPinned && !bPinned) return -1
        if (!aPinned && bPinned) return 1

        // 都不置顶：保持原顺序（通常是按时间倒序）
        return 0
      })
    })

    /**
     * 切换会话置顶状态
     */
    function togglePinSession(id: string) {
      const index = pinnedSessionIds.value.indexOf(id)
      if (index !== -1) {
        pinnedSessionIds.value.splice(index, 1)
      } else {
        pinnedSessionIds.value.push(id)
      }
    }

    /**
     * 检查会话是否已置顶
     */
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
      importFileFromPath,
      selectSession,
      deleteSession,
      renameSession,
      clearSelection,
      updateSessionOwnerId,
      togglePinSession,
      isPinned,
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
