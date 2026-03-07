/**
 * SQL Lab queries (server-side)
 * Ported from electron/main/worker/query/sql.ts — no worker_threads.
 */

import { openDatabase } from '../db-pool'
import type { SQLResult, TableSchema } from './types'

export function getSchema(sessionId: string): TableSchema[] {
  const db = openDatabase(sessionId)
  if (!db) throw new Error('数据库不存在')

  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type='table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    )
    .all() as { name: string }[]

  const schema: TableSchema[] = []
  for (const table of tables) {
    const columns = db.prepare(`PRAGMA table_info('${table.name}')`).all() as {
      cid: number; name: string; type: string; notnull: number; dflt_value: any; pk: number
    }[]
    schema.push({
      name: table.name,
      columns: columns.map((col) => ({
        name: col.name,
        type: col.type,
        notnull: col.notnull === 1,
        pk: col.pk === 1,
      })),
    })
  }
  return schema
}

export function executePluginQuery<T = Record<string, any>>(
  sessionId: string,
  sql: string,
  params: any[] = [],
): T[] {
  const db = openDatabase(sessionId)
  if (!db) throw new Error('数据库不存在')
  const stmt = db.prepare(sql.trim())
  if (!stmt.readonly) {
    throw new Error('Plugin Security Violation: Only READ-ONLY statements are allowed.')
  }
  return stmt.all(...params) as T[]
}

export function executeRawSQL(sessionId: string, sql: string): SQLResult {
  const db = openDatabase(sessionId)
  if (!db) throw new Error('数据库不存在')

  const trimmedSQL = sql.trim()
  if (!trimmedSQL.toUpperCase().startsWith('SELECT')) {
    throw new Error('只支持 SELECT 查询语句')
  }

  const startTime = Date.now()
  try {
    const stmt = db.prepare(trimmedSQL)
    const rows = stmt.all()
    const duration = Date.now() - startTime
    const columns = stmt.columns().map((col) => col.name)
    const rowData = rows.map((row: any) => columns.map((col) => row[col]))
    return { columns, rows: rowData, rowCount: rows.length, duration, limited: false }
  } catch (error) {
    if (error instanceof Error) {
      const message = error.message
        .replace(/^SQLITE_ERROR: /, '')
        .replace(/^SQLITE_READONLY: /, '只读模式：')
      throw new Error(message)
    }
    throw error
  }
}
