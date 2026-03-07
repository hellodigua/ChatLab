/**
 * Query service module (server-side)
 *
 * Consolidates all analysis query functions originally spread across
 * electron/main/worker/query/ into directly callable server-side functions.
 *
 * No worker_threads, no Electron dependencies.
 * Database connections managed through ./db-pool.ts.
 */

export {
  type TimeFilter,
  openDatabase,
  closeDatabase,
  closeAllDatabases,
  getDbPath,
  getDbDirectory,
  openWritableDatabase,
  openReadonlyDatabase,
  buildTimeFilter,
  buildSystemMessageFilter,
} from './db-pool'

// Re-export everything from sub-modules
export * from './queries/basic'
export * from './queries/sessions'
export * from './queries/messages'
export * from './queries/sql'
export * from './queries/advanced'
export * from './queries/session-index'
export * from './queries/ai-tools'
export * from './queries/filter'
export * from './queries/export'
export * from './queries/types'
