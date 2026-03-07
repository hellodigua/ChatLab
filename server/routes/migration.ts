/**
 * Database migration API routes
 *
 * Replaces the Electron IPC handlers for database migration:
 *   GET  /api/migration/check - check if migration is needed
 *   POST /api/migration/run   - run pending migrations on all databases
 */

import { Router } from 'express'
import {
  checkMigrationNeeded,
  migrateAllDatabases,
} from '../database/core'
import {
  CURRENT_SCHEMA_VERSION,
  getPendingMigrationInfos,
} from '../database/migrations'

const router = Router()

/**
 * GET /api/migration/check
 * Check whether any databases need migration.
 * Returns {
 *   needsMigration: boolean,
 *   count: number,
 *   currentVersion: number,
 *   pendingMigrations: MigrationInfo[]
 * }
 */
router.get('/check', (_req, res) => {
  try {
    const result = checkMigrationNeeded()
    const pendingMigrations = getPendingMigrationInfos(result.lowestVersion)

    res.json({
      needsMigration: result.count > 0,
      count: result.count,
      currentVersion: CURRENT_SCHEMA_VERSION,
      pendingMigrations,
    })
  } catch (error) {
    console.error('[API] migration/check error:', error)
    res.json({
      needsMigration: false,
      count: 0,
      currentVersion: CURRENT_SCHEMA_VERSION,
      pendingMigrations: [],
    })
  }
})

/**
 * POST /api/migration/run
 * Run pending migrations on all databases that need them.
 * Returns {
 *   success: boolean,
 *   migratedCount: number,
 *   failures: Array<{ sessionId: string, error: string }>,
 *   error?: string
 * }
 */
router.post('/run', (_req, res) => {
  try {
    const result = migrateAllDatabases()
    res.json(result)
  } catch (error) {
    console.error('[API] migration/run error:', error)
    res.status(500).json({
      success: false,
      migratedCount: 0,
      error: error instanceof Error ? error.message : String(error),
    })
  }
})

export default router
