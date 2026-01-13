import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ChatRecordQuery } from '@/types/format'

/**
 * 全局界面状态（侧边栏、弹窗、聊天记录抽屉等）
 */
export const useLayoutStore = defineStore(
  'layout',
  () => {
    const isSidebarCollapsed = ref(false)
    const showSettingModal = ref(false)
    const showScreenCaptureModal = ref(false)
    const screenCaptureImage = ref<string | null>(null)
    const showChatRecordDrawer = ref(false)
    const chatRecordQuery = ref<ChatRecordQuery | null>(null)

    // 设置弹窗定位目标（用于从外部跳转到设置的特定位置）
    const settingTarget = ref<{
      tab: 'settings' | 'ai' | 'storage' | 'about'
      section?: string // AI tab 下的子锚点，如 'model', 'chat', 'preset'
    } | null>(null)

    // 截图设置
    const screenshotMobileAdapt = ref(true) // 截图时开启移动端适配，默认开启

    /**
     * 切换侧边栏展开/折叠状态
     */
    function toggleSidebar() {
      isSidebarCollapsed.value = !isSidebarCollapsed.value
    }

    /**
     * 打开截屏预览弹窗
     */
    function openScreenCaptureModal(imageData: string) {
      screenCaptureImage.value = imageData
      showScreenCaptureModal.value = true
    }

    /**
     * 关闭截屏预览弹窗
     */
    function closeScreenCaptureModal() {
      showScreenCaptureModal.value = false
      setTimeout(() => {
        screenCaptureImage.value = null
      }, 300)
    }

    /**
     * 打开聊天记录抽屉并设置查询参数
     */
    function openChatRecordDrawer(query: ChatRecordQuery) {
      chatRecordQuery.value = query
      showChatRecordDrawer.value = true
    }

    /**
     * 关闭聊天记录抽屉并重置查询
     */
    function closeChatRecordDrawer() {
      showChatRecordDrawer.value = false
      setTimeout(() => {
        chatRecordQuery.value = null
      }, 300)
    }

    /**
     * 打开设置弹窗并定位到指定位置
     * @param tab 要跳转的 Tab（settings, ai, storage, about）
     * @param section 子锚点（仅 ai tab 支持：model, chat, preset）
     */
    function openSettingAt(tab: 'settings' | 'ai' | 'storage' | 'about', section?: string) {
      settingTarget.value = { tab, section }
      showSettingModal.value = true
    }

    /**
     * 清空设置目标（弹窗关闭后调用）
     */
    function clearSettingTarget() {
      settingTarget.value = null
    }

    return {
      isSidebarCollapsed,
      showSettingModal,
      showScreenCaptureModal,
      screenCaptureImage,
      showChatRecordDrawer,
      chatRecordQuery,
      settingTarget,
      screenshotMobileAdapt,
      toggleSidebar,
      openScreenCaptureModal,
      closeScreenCaptureModal,
      openChatRecordDrawer,
      closeChatRecordDrawer,
      openSettingAt,
      clearSettingTarget,
    }
  },
  {
    persist: [
      {
        pick: ['isSidebarCollapsed'],
        storage: sessionStorage,
      },
      {
        pick: ['screenshotMobileAdapt'],
        storage: localStorage,
      },
    ],
  }
)
