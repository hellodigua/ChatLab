/**
 * 数据库迁移系统
 *
 * 用于管理数据库 schema 的版本升级。
 * 每次添加新字段或修改表结构时，创建一个新的迁移脚本。
 *
 * 使用方式：
 * 1. 在 migrations 数组中添加新的迁移对象
 * 2. version 必须递增
 * 3. up 函数执行迁移逻辑
 */

import type Database from 'better-sqlite3'

/** 迁移脚本接口 */
interface Migration {
  /** 版本号（必须递增） */
  version: number
  /** 迁移描述（技术说明） */
  description: string
  /** 用户可读的升级原因（显示在弹窗中） */
  userMessage: string
  /** 迁移执行函数 */
  up: (db: Database.Database) => void
}

/** 导出给前端使用的迁移信息 */
export interface MigrationInfo {
  version: number
  /** 技术描述（面向开发者） */
  description: string
  /** 用户可读的升级原因（显示在弹窗中） */
  userMessage: string
}

/** 当前 schema 版本（最新迁移的版本号） */
export const CURRENT_SCHEMA_VERSION = 2

/**
 * 迁移脚本列表
 * 注意：版本号必须递增，每个迁移只执行一次
 */
const migrations: Migration[] = [
  {
    version: 1,
    description: '添加 owner_id 字段到 meta 表',
    userMessage: '支持「Owner」功能，可在成员列表中设置自己的身份',
    up: (db) => {
      // 检查 owner_id 列是否已存在（防止重复执行）
      const tableInfo = db.prepare('PRAGMA table_info(meta)').all() as Array<{ name: string }>
      const hasOwnerIdColumn = tableInfo.some((col) => col.name === 'owner_id')
      if (!hasOwnerIdColumn) {
        db.exec('ALTER TABLE meta ADD COLUMN owner_id TEXT')
      }
    },
  },
  {
    version: 2,
    description: '添加 roles 字段到 member 表',
    userMessage: '支持成员角色（群主、管理员等）',
    up: (db) => {
      // 检查 roles 列是否已存在（防止重复执行）
      const tableInfo = db.prepare('PRAGMA table_info(member)').all() as Array<{ name: string }>
      const hasRolesColumn = tableInfo.some((col) => col.name === 'roles')
      if (!hasRolesColumn) {
        db.exec("ALTER TABLE member ADD COLUMN roles TEXT DEFAULT '[]'")
      }
    },
  },
]

/**
 * 获取数据库的 schema 版本
 * 如果没有版本信息，返回 0
 */
function getSchemaVersion(db: Database.Database): number {
  try {
    // 检查 meta 表是否有 schema_version 列
    const tableInfo = db.prepare('PRAGMA table_info(meta)').all() as Array<{ name: string }>
    const hasVersionColumn = tableInfo.some((col) => col.name === 'schema_version')

    if (!hasVersionColumn) {
      return 0
    }

    const result = db.prepare('SELECT schema_version FROM meta LIMIT 1').get() as
      | { schema_version: number | null }
      | undefined
    return result?.schema_version ?? 0
  } catch {
    return 0
  }
}

/**
 * 设置数据库的 schema 版本
 */
function setSchemaVersion(db: Database.Database, version: number): void {
  // 检查 schema_version 列是否存在
  const tableInfo = db.prepare('PRAGMA table_info(meta)').all() as Array<{ name: string }>
  const hasVersionColumn = tableInfo.some((col) => col.name === 'schema_version')

  if (!hasVersionColumn) {
    // 添加 schema_version 列
    db.exec('ALTER TABLE meta ADD COLUMN schema_version INTEGER DEFAULT 0')
  }

  // 更新版本号
  db.prepare('UPDATE meta SET schema_version = ?').run(version)
}

/**
 * 执行数据库迁移
 * 自动检测当前版本并执行所有需要的迁移
 *
 * @param db 数据库连接
 * @returns 是否执行了迁移
 */
export function migrateDatabase(db: Database.Database): boolean {
  const currentVersion = getSchemaVersion(db)

  // 已是最新版本，无需迁移
  if (currentVersion >= CURRENT_SCHEMA_VERSION) {
    return false
  }

  // 获取需要执行的迁移
  const pendingMigrations = migrations.filter((m) => m.version > currentVersion)

  if (pendingMigrations.length === 0) {
    return false
  }

  console.log(
    `[Migration] 数据库版本 ${currentVersion} -> ${CURRENT_SCHEMA_VERSION}，执行 ${pendingMigrations.length} 个迁移`
  )

  // 在事务中执行所有迁移
  const migrate = db.transaction(() => {
    for (const migration of pendingMigrations) {
      console.log(`[Migration] 执行迁移 v${migration.version}: ${migration.description}`)
      migration.up(db)
      setSchemaVersion(db, migration.version)
    }
  })

  migrate()

  console.log(`[Migration] 迁移完成，当前版本: ${CURRENT_SCHEMA_VERSION}`)
  return true
}

/**
 * 检查数据库是否需要迁移
 */
export function needsMigration(db: Database.Database): boolean {
  const currentVersion = getSchemaVersion(db)
  return currentVersion < CURRENT_SCHEMA_VERSION
}

/**
 * 获取待执行的迁移信息（用户可读）
 * @param fromVersion 起始版本（不含）
 */
export function getPendingMigrationInfos(fromVersion = 0): MigrationInfo[] {
  return migrations
    .filter((m) => m.version > fromVersion)
    .map((m) => ({
      version: m.version,
      description: m.description,
      userMessage: m.userMessage,
    }))
}
