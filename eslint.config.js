// 使用现代模块解析，避免插件解析失败
require('@rushstack/eslint-patch/modern-module-resolution')

const { FlatCompat } = require('@eslint/eslintrc')

// 使用 FlatCompat 兼容旧版 extends 配置
const compat = new FlatCompat({
  baseDirectory: __dirname,
})

module.exports = [
  // 迁移 .eslintignore 到 flat config 的 ignores
  {
    ignores: ['node_modules', 'dist', 'out', '.gitignore'],
  },
  ...compat.extends(
    'eslint:recommended',
    'plugin:vue/vue3-recommended',
    '@electron-toolkit',
    '@electron-toolkit/eslint-config-ts/eslint-recommended',
    '@vue/eslint-config-typescript/recommended',
    '@vue/eslint-config-prettier'
  ),
  {
    rules: {
      'vue/require-default-prop': 'off',
      'vue/multi-word-component-names': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
]
