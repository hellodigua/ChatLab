import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { getAppDataDir, getDatabaseDir, getSettingsDir, getAiDataDir, getTempDir, getLogsDir, ensureDir, ensureAppDirs } from './paths'

describe('paths', () => {
  describe('getAppDataDir', () => {
    const originalEnv = process.env.CHATLAB_DATA_DIR

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.CHATLAB_DATA_DIR
      } else {
        process.env.CHATLAB_DATA_DIR = originalEnv
      }
    })

    it('returns default path when CHATLAB_DATA_DIR is not set', () => {
      delete process.env.CHATLAB_DATA_DIR
      const result = getAppDataDir()
      const expected = path.join(os.homedir(), '.chatlab', 'data')
      assert.equal(result, expected)
    })

    it('uses CHATLAB_DATA_DIR when set to an absolute path', () => {
      const customDir = '/tmp/chatlab-test-data'
      process.env.CHATLAB_DATA_DIR = customDir
      const result = getAppDataDir()
      assert.equal(result, customDir)
    })

    it('ignores CHATLAB_DATA_DIR when set to a relative path', () => {
      process.env.CHATLAB_DATA_DIR = 'relative/path'
      const result = getAppDataDir()
      const expected = path.join(os.homedir(), '.chatlab', 'data')
      assert.equal(result, expected)
    })

    it('ignores CHATLAB_DATA_DIR when empty', () => {
      process.env.CHATLAB_DATA_DIR = '   '
      const result = getAppDataDir()
      const expected = path.join(os.homedir(), '.chatlab', 'data')
      assert.equal(result, expected)
    })
  })

  describe('subdirectory getters', () => {
    const originalEnv = process.env.CHATLAB_DATA_DIR

    beforeEach(() => {
      process.env.CHATLAB_DATA_DIR = '/tmp/chatlab-test-paths'
    })

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.CHATLAB_DATA_DIR
      } else {
        process.env.CHATLAB_DATA_DIR = originalEnv
      }
    })

    it('getDatabaseDir returns databases subdir', () => {
      assert.equal(getDatabaseDir(), '/tmp/chatlab-test-paths/databases')
    })

    it('getSettingsDir returns settings subdir', () => {
      assert.equal(getSettingsDir(), '/tmp/chatlab-test-paths/settings')
    })

    it('getAiDataDir returns ai subdir', () => {
      assert.equal(getAiDataDir(), '/tmp/chatlab-test-paths/ai')
    })

    it('getTempDir returns temp subdir', () => {
      assert.equal(getTempDir(), '/tmp/chatlab-test-paths/temp')
    })

    it('getLogsDir returns logs subdir', () => {
      assert.equal(getLogsDir(), '/tmp/chatlab-test-paths/logs')
    })
  })

  describe('ensureDir', () => {
    const testDir = path.join(os.tmpdir(), 'chatlab-test-ensure-' + Date.now())

    afterEach(() => {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true })
      }
    })

    it('creates a directory that does not exist', () => {
      const nested = path.join(testDir, 'a', 'b', 'c')
      assert.equal(fs.existsSync(nested), false)
      ensureDir(nested)
      assert.equal(fs.existsSync(nested), true)
      assert.equal(fs.statSync(nested).isDirectory(), true)
    })

    it('does not throw if directory already exists', () => {
      ensureDir(testDir)
      assert.doesNotThrow(() => ensureDir(testDir))
    })
  })

  describe('ensureAppDirs', () => {
    const testDir = path.join(os.tmpdir(), 'chatlab-test-appdirs-' + Date.now())
    const originalEnv = process.env.CHATLAB_DATA_DIR

    beforeEach(() => {
      process.env.CHATLAB_DATA_DIR = testDir
    })

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.CHATLAB_DATA_DIR
      } else {
        process.env.CHATLAB_DATA_DIR = originalEnv
      }
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true })
      }
    })

    it('creates all standard app directories', () => {
      ensureAppDirs()
      assert.equal(fs.existsSync(path.join(testDir, 'databases')), true)
      assert.equal(fs.existsSync(path.join(testDir, 'settings')), true)
      assert.equal(fs.existsSync(path.join(testDir, 'ai')), true)
      assert.equal(fs.existsSync(path.join(testDir, 'temp')), true)
      assert.equal(fs.existsSync(path.join(testDir, 'logs')), true)
    })
  })
})
