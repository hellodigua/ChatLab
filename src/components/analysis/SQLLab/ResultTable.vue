<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import MarkdownIt from 'markdown-it'
import type { SQLResult } from './types'
import { COLUMN_LABELS } from './types'

const { t, locale } = useI18n()

// 创建 markdown-it 实例
const md = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
  typographer: true,
})

// Props
const props = defineProps<{
  result: SQLResult | null
  error: string | null
  sql?: string // 当前 SQL 语句
  prompt?: string // 用户提示词（AI 生成时）
}>()

// Emits
const emit = defineEmits<{
  copyCSV: []
}>()

// 表格排序
const sortColumn = ref<string | null>(null)
const sortDirection = ref<'asc' | 'desc'>('asc')

// AI 总结相关状态
const showSummaryModal = ref(false)
const isSummarizing = ref(false)
const summaryContent = ref('')
const summaryError = ref<string | null>(null)
const streamingContent = ref('')

// 获取列的标签（尝试匹配所有表的列）
function getColumnLabelLocal(columnName: string): string | null {
  // 处理带表名前缀的情况，如 "message.sender_id" 或 "m.sender_id"
  const parts = columnName.split('.')
  const colName = parts.length > 1 ? parts[parts.length - 1] : columnName

  // 获取当前语言的标签
  const localeLabels = COLUMN_LABELS[locale.value as 'zh-CN' | 'en-US'] || COLUMN_LABELS['zh-CN']

  // 遍历所有表查找匹配
  for (const tableColumns of Object.values(localeLabels)) {
    if (tableColumns[colName]) {
      return tableColumns[colName]
    }
  }
  return null
}

// 排序后的行数据
const sortedRows = computed(() => {
  if (!props.result || !sortColumn.value) {
    return props.result?.rows || []
  }

  const columnIndex = props.result.columns.indexOf(sortColumn.value)
  if (columnIndex === -1) return props.result.rows

  return [...props.result.rows].sort((a, b) => {
    const aVal = a[columnIndex]
    const bVal = b[columnIndex]

    if (aVal === null) return 1
    if (bVal === null) return -1

    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return sortDirection.value === 'asc' ? aVal - bVal : bVal - aVal
    }

    const comparison = String(aVal).localeCompare(String(bVal))
    return sortDirection.value === 'asc' ? comparison : -comparison
  })
})

// 处理列排序
function handleSort(column: string) {
  if (sortColumn.value === column) {
    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortColumn.value = column
    sortDirection.value = 'asc'
  }
}

// 格式化单元格值
function formatCellValue(value: any): string {
  if (value === null) return 'NULL'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

// 复制结果到剪贴板（CSV 格式）
async function copyAsCSV() {
  if (!props.result) return

  const header = props.result.columns.join(',')
  const rows = props.result.rows.map((row) =>
    row.map((cell) => (cell === null ? '' : `"${String(cell).replace(/"/g, '""')}"`)).join(',')
  )

  const csv = [header, ...rows].join('\n')

  try {
    await navigator.clipboard.writeText(csv)
    emit('copyCSV')
  } catch (err) {
    console.error('复制失败:', err)
  }
}

// 重置排序状态（供父组件调用）
function resetSort() {
  sortColumn.value = null
  sortDirection.value = 'asc'
}

// ==================== AI 总结功能 ====================

// 构建总结结果的数据（取前 50 行避免 token 过多）
function buildResultSummary(): string {
  if (!props.result) return ''

  const maxRows = 50
  const rows = props.result.rows.slice(0, maxRows)

  // 构建表格形式的结果
  const header = props.result.columns.join(' | ')
  const separator = props.result.columns.map(() => '---').join(' | ')
  const dataRows = rows.map((row) =>
    row.map((cell) => (cell === null ? 'NULL' : String(cell).slice(0, 50))).join(' | ')
  )

  let resultText = `| ${header} |\n| ${separator} |\n`
  resultText += dataRows.map((r) => `| ${r} |`).join('\n')

  if (props.result.rows.length > maxRows) {
    resultText += `\n\n（仅展示前 ${maxRows} 行，共 ${props.result.rowCount} 行）`
  }

  return resultText
}

// 打开总结弹窗并开始总结
async function openSummaryModal() {
  showSummaryModal.value = true
  summaryContent.value = ''
  summaryError.value = null
  streamingContent.value = ''
  await generateSummary()
}

// AI 总结
async function generateSummary() {
  const hasConfig = await window.llmApi.hasConfig()
  if (!hasConfig) {
    summaryError.value = t('errorNoAIConfig')
    return
  }

  isSummarizing.value = true
  summaryError.value = null
  streamingContent.value = ''

  try {
    const resultSummary = buildResultSummary()

    let contextInfo = ''
    if (props.prompt) {
      contextInfo = `用户的查询意图：${props.prompt}\n\n`
    }
    if (props.sql) {
      contextInfo += `执行的 SQL 语句：\n\`\`\`sql\n${props.sql}\n\`\`\`\n\n`
    }

    const prompt = `请分析以下 SQL 查询结果，用简洁的中文总结关键发现和洞察。

${contextInfo}查询结果（共 ${props.result?.rowCount || 0} 行）：

${resultSummary}

请提供：
1. 结果概述（一句话总结）
2. 关键发现（2-4 个要点）
3. 如有明显的趋势或异常，请指出`

    const result = await window.llmApi.chatStream(
      [
        { role: 'system', content: '你是一个数据分析专家，擅长从查询结果中提取关键信息和洞察。请用简洁清晰的中文回答。' },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.3, maxTokens: 1000 },
      (chunk) => {
        if (chunk.content) {
          streamingContent.value += chunk.content
        }
      }
    )

    if (result.success) {
      summaryContent.value = streamingContent.value
    } else {
      summaryError.value = result.error || t('errorSummary')
    }
  } catch (err: any) {
    summaryError.value = err.message || String(err)
  } finally {
    isSummarizing.value = false
  }
}

// 关闭总结弹窗
function closeSummaryModal() {
  showSummaryModal.value = false
  summaryContent.value = ''
  summaryError.value = null
  streamingContent.value = ''
}

defineExpose({ resetSort })
</script>

<template>
  <div class="flex flex-1 flex-col overflow-hidden">
    <!-- 错误提示 -->
    <div v-if="error" class="border-b border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
      <div class="flex items-start gap-2">
        <UIcon name="i-heroicons-exclamation-circle" class="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-red-800 dark:text-red-200">{{ t('queryError') }}</p>
          <p class="mt-1 break-all font-mono text-xs text-red-600 dark:text-red-400">{{ error }}</p>
        </div>
      </div>
    </div>

    <!-- 结果统计栏 -->
    <div
      v-if="result"
      class="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2 dark:border-gray-800 dark:bg-gray-900"
    >
      <div class="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
        <span>
          <UIcon name="i-heroicons-table-cells" class="mr-1 inline h-4 w-4" />
          {{ t('rows', { count: result.rowCount }) }}
          <span v-if="result.limited" class="text-yellow-600 dark:text-yellow-400">{{ t('truncated') }}</span>
        </span>
        <span>
          <UIcon name="i-heroicons-clock" class="mr-1 inline h-4 w-4" />
          {{ result.duration }} ms
        </span>
      </div>
      <div class="flex items-center gap-2">
        <UButton variant="ghost" size="xs" @click="openSummaryModal">
          <UIcon name="i-heroicons-sparkles" class="mr-1 h-4 w-4" />
          {{ t('summarize') }}
        </UButton>
        <UButton variant="ghost" size="xs" @click="copyAsCSV">
          <UIcon name="i-heroicons-clipboard-document" class="mr-1 h-4 w-4" />
          {{ t('copyCSV') }}
        </UButton>
      </div>
    </div>

    <!-- 结果表格 -->
    <div v-if="result && result.rows.length > 0" class="flex-1 overflow-auto">
      <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead class="sticky top-0 bg-gray-100 dark:bg-gray-800">
          <tr>
            <th
              v-for="(column, index) in result.columns"
              :key="index"
              class="cursor-pointer whitespace-nowrap px-4 py-2 text-left text-xs font-medium transition-colors hover:bg-gray-200 dark:hover:bg-gray-700"
              @click="handleSort(column)"
            >
              <div class="flex items-center gap-1">
                <div class="flex flex-col">
                  <span class="text-gray-700 dark:text-gray-300">{{ getColumnLabelLocal(column) || column }}</span>
                  <span v-if="getColumnLabelLocal(column)" class="font-mono text-[10px] text-gray-400">{{ column }}</span>
                </div>
                <UIcon
                  v-if="sortColumn === column"
                  :name="sortDirection === 'asc' ? 'i-heroicons-chevron-up' : 'i-heroicons-chevron-down'"
                  class="h-3 w-3 text-gray-500"
                />
              </div>
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900">
          <tr v-for="(row, rowIndex) in sortedRows" :key="rowIndex" class="hover:bg-gray-50 dark:hover:bg-gray-800">
            <td
              v-for="(cell, cellIndex) in row"
              :key="cellIndex"
              class="max-w-xs truncate whitespace-nowrap px-4 py-2 font-mono text-sm text-gray-700 dark:text-gray-300"
              :class="{ 'text-gray-400 italic': cell === null }"
              :title="formatCellValue(cell)"
            >
              {{ formatCellValue(cell) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 空结果 -->
    <div
      v-else-if="result && result.rows.length === 0"
      class="flex flex-1 items-center justify-center text-gray-500 dark:text-gray-400"
    >
      <div class="text-center">
        <UIcon name="i-heroicons-inbox" class="mx-auto h-12 w-12 text-gray-300 dark:text-gray-600" />
        <p class="mt-2 text-sm">{{ t('emptyResult') }}</p>
      </div>
    </div>

    <!-- 初始状态 -->
    <div v-else-if="!error" class="flex flex-1 items-center justify-center text-gray-500 dark:text-gray-400">
      <div class="text-center">
        <UIcon name="i-heroicons-command-line" class="mx-auto h-12 w-12 text-gray-300 dark:text-gray-600" />
        <p class="mt-2 text-sm">{{ t('initialState') }}</p>
        <p class="mt-1 text-xs text-gray-400">{{ t('initialHint') }}</p>
      </div>
    </div>

    <!-- AI 总结弹窗 -->
    <UModal v-model:open="showSummaryModal">
      <template #content>
        <div class="max-h-[70vh] overflow-hidden p-6">
          <div class="mb-4 flex items-center gap-2">
            <UIcon name="i-heroicons-sparkles" class="h-5 w-5 text-pink-500" />
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('summaryTitle') }}</h3>
          </div>

          <!-- 加载状态 -->
          <div v-if="isSummarizing && !streamingContent" class="flex items-center justify-center py-8">
            <UIcon name="i-heroicons-arrow-path" class="h-6 w-6 animate-spin text-pink-500" />
            <span class="ml-2 text-sm text-gray-500">{{ t('analyzing') }}</span>
          </div>

          <!-- 流式输出 / 最终结果 -->
          <div v-else-if="streamingContent || summaryContent" class="max-h-[50vh] overflow-y-auto">
            <div
              class="prose prose-sm max-w-none rounded-lg bg-gray-50 p-4 dark:prose-invert dark:bg-gray-900"
              v-html="md.render(streamingContent || summaryContent)"
            />
            <div v-if="isSummarizing" class="mt-2 flex items-center text-xs text-gray-400">
              <UIcon name="i-heroicons-arrow-path" class="mr-1 h-3 w-3 animate-spin" />
              {{ t('generating') }}
            </div>
          </div>

          <!-- 错误提示 -->
          <div v-if="summaryError" class="rounded-lg bg-red-50 p-4 dark:bg-red-950">
            <p class="text-sm text-red-600 dark:text-red-400">{{ summaryError }}</p>
          </div>

          <!-- 底部按钮 -->
          <div class="mt-4 flex justify-end gap-2">
            <UButton v-if="!isSummarizing && summaryContent" variant="outline" @click="generateSummary">
              <UIcon name="i-heroicons-arrow-path" class="mr-1 h-4 w-4" />
              {{ t('regenerate') }}
            </UButton>
            <UButton variant="ghost" @click="closeSummaryModal">{{ t('close') }}</UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>

<i18n>
{
  "zh-CN": {
    "queryError": "查询错误",
    "rows": "{count} 行",
    "truncated": "（已截断至 1000 行）",
    "summarize": "总结一下",
    "copyCSV": "复制 CSV",
    "emptyResult": "查询结果为空",
    "initialState": "输入 SQL 语句并运行查看结果",
    "initialHint": "仅支持 SELECT 查询，结果最多返回 1000 行",
    "summaryTitle": "AI 结果总结",
    "analyzing": "AI 正在分析结果...",
    "generating": "生成中...",
    "regenerate": "重新生成",
    "close": "关闭",
    "errorNoAIConfig": "请先在设置中配置 AI 服务",
    "errorSummary": "总结失败"
  },
  "en-US": {
    "queryError": "Query Error",
    "rows": "{count} rows",
    "truncated": " (truncated to 1000 rows)",
    "summarize": "Summarize",
    "copyCSV": "Copy CSV",
    "emptyResult": "Query returned no results",
    "initialState": "Enter SQL and run to see results",
    "initialHint": "Only SELECT queries supported, max 1000 rows",
    "summaryTitle": "AI Result Summary",
    "analyzing": "AI is analyzing results...",
    "generating": "Generating...",
    "regenerate": "Regenerate",
    "close": "Close",
    "errorNoAIConfig": "Please configure AI service in settings first",
    "errorSummary": "Summary failed"
  }
}
</i18n>

<!-- Markdown 样式已提取到全局 src/assets/styles/markdown.css -->
