/**
 * 平台检测工具
 *
 * 通过编译时注入的 __IS_ELECTRON__ 常量区分运行环境。
 * Electron renderer 构建时注入 true，未来 Web 版构建时不定义或为 false。
 */

declare const __IS_ELECTRON__: boolean | undefined

export const IS_ELECTRON = typeof __IS_ELECTRON__ !== 'undefined' && __IS_ELECTRON__
