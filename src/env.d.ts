/// <reference types="vite/client" />
/// <reference path="../electron/preload/index.d.ts" />

// 显式引入 preload 的全局类型声明，确保 TS 插件能识别 window.chatApi 等注入 API。

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}
