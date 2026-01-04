/**
 * SQL 实验室共享类型定义
 */

// Schema 类型
export interface TableSchema {
  name: string
  columns: ColumnSchema[]
}

export interface ColumnSchema {
  name: string
  type: string
  notnull: boolean
  pk: boolean
}

// AI 历史记录类型
export interface AIHistory {
  id: string
  prompt: string
  sql: string
  explanation: string
  timestamp: number
}

// SQL 执行结果类型
export interface SQLResult {
  columns: string[]
  rows: any[][]
  rowCount: number
  duration: number
  limited: boolean
}

// 表/列的中文标签映射
export const TABLE_LABELS: Record<string, string> = {
  message: '消息记录',
  member: '群成员',
  meta: '群信息',
  member_name_history: '昵称历史',
}

export const COLUMN_LABELS: Record<string, Record<string, string>> = {
  message: {
    id: '消息ID',
    sender_id: '发送者ID',
    sender_account_name: '发送时账号名',
    sender_group_nickname: '发送时群昵称',
    ts: '时间戳(秒)',
    type: '消息类型',
    content: '消息内容',
  },
  member: {
    id: '成员ID',
    platform_id: '平台ID',
    account_name: '账号名称',
    group_nickname: '群昵称',
    aliases: '自定义别名',
  },
  meta: {
    name: '群名称',
    platform: '平台',
    type: '聊天类型',
    imported_at: '导入时间',
  },
  member_name_history: {
    id: '记录ID',
    member_id: '成员ID',
    name_type: '名称类型',
    name: '昵称值',
    start_ts: '开始时间',
    end_ts: '结束时间',
  },
}

// 获取表的中文标签
export function getTableLabel(tableName: string): string {
  return TABLE_LABELS[tableName] || tableName
}

// 获取列的中文标签
export function getColumnLabel(tableName: string, columnName: string): string {
  return COLUMN_LABELS[tableName]?.[columnName] || columnName
}
