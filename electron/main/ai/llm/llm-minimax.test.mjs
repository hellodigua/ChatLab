/**
 * MiniMax provider configuration tests
 *
 * Tests the MiniMax LLM provider configuration including:
 * - API endpoint URL correctness
 * - Model definitions
 * - Context window sizes
 * - Base URL validation
 * - i18n locale completeness
 *
 * Usage: node --test electron/main/ai/llm/llm-minimax.test.mjs
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../../../..')

// Read source files for testing
const indexSource = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf-8')
const typesSource = fs.readFileSync(path.join(__dirname, 'types.ts'), 'utf-8')

// ==================== Unit Tests ====================

describe('MiniMax provider type definition', () => {
  it('should include minimax in LLMProvider union type', () => {
    assert.match(typesSource, /['"]minimax['"]/, 'minimax should be in LLMProvider type')
  })
})

describe('MiniMax provider info', () => {
  it('should use correct API base URL (api.minimax.io)', () => {
    assert.match(
      indexSource,
      /defaultBaseUrl:\s*['"]https:\/\/api\.minimax\.io\/v1['"]/,
      'Base URL should be https://api.minimax.io/v1'
    )
  })

  it('should NOT use old api.minimaxi.com URL', () => {
    assert.doesNotMatch(
      indexSource,
      /defaultBaseUrl:\s*['"]https:\/\/api\.minimaxi\.com/,
      'Should not use deprecated api.minimaxi.com endpoint'
    )
  })

  it('should include MiniMax-M2.7 model', () => {
    assert.match(indexSource, /['"]MiniMax-M2\.7['"]/, 'Should include M2.7 model')
  })

  it('should include MiniMax-M2.7-highspeed model', () => {
    assert.match(indexSource, /['"]MiniMax-M2\.7-highspeed['"]/, 'Should include M2.7-highspeed model')
  })

  it('should include MiniMax-M2.5 model', () => {
    assert.match(indexSource, /['"]MiniMax-M2\.5['"]/, 'Should include M2.5 model')
  })

  it('should include MiniMax-M2.5-highspeed model', () => {
    assert.match(indexSource, /['"]MiniMax-M2\.5-highspeed['"]/, 'Should include M2.5-highspeed model')
  })

  it('should NOT include deprecated M2/M2-Stable models', () => {
    // Check that old models are not in the MINIMAX_INFO provider block
    const minimaxBlock = indexSource.match(/const MINIMAX_INFO[\s\S]*?\n\}/)?.[0] || ''
    assert.doesNotMatch(minimaxBlock, /['"]MiniMax-M2['"](?![\.\-])/, 'Should not include deprecated MiniMax-M2')
    assert.doesNotMatch(minimaxBlock, /MiniMax-M2-Stable/, 'Should not include deprecated MiniMax-M2-Stable')
  })
})

describe('MiniMax context window handling', () => {
  it('should set 1M context window for M2.7 models', () => {
    assert.match(
      indexSource,
      /M2\.7.*\n\s*contextWindow\s*=\s*1000000|contextWindow\s*=\s*1000000[\s\S]*?M2\.7/,
      'M2.7 models should have 1M context window'
    )
  })

  it('should set 204K context window for M2.5-highspeed', () => {
    assert.match(
      indexSource,
      /M2\.5-highspeed.*\n\s*contextWindow\s*=\s*204000|contextWindow\s*=\s*204000[\s\S]*?M2\.5-highspeed/,
      'M2.5-highspeed should have 204K context window'
    )
  })
})

describe('MiniMax base URL validation', () => {
  it('should reject old minimaxi.com domain in validation', () => {
    assert.match(
      indexSource,
      /minimaxi\.com/,
      'Should have validation check for old minimaxi.com domain'
    )
  })

  it('should provide migration guidance in error message', () => {
    assert.match(
      indexSource,
      /api\.minimax\.io/,
      'Error message should point to correct api.minimax.io URL'
    )
  })
})

describe('MiniMax in PROVIDERS array', () => {
  it('should include MINIMAX_INFO in PROVIDERS export', () => {
    assert.match(indexSource, /MINIMAX_INFO/, 'MINIMAX_INFO should be in PROVIDERS array')
  })
})

// ==================== i18n Locale Tests ====================

const locales = ['en-US', 'zh-CN', 'ja-JP', 'zh-TW']
const expectedModels = ['MiniMax-M2.7', 'MiniMax-M2.7-highspeed', 'MiniMax-M2.5', 'MiniMax-M2.5-highspeed']

for (const locale of locales) {
  describe(`MiniMax i18n (${locale})`, () => {
    const localePath = path.join(projectRoot, 'src/i18n/locales', locale, 'providers.json')
    let localeData

    it('should have providers.json file', () => {
      assert.ok(fs.existsSync(localePath), `${locale}/providers.json should exist`)
      localeData = JSON.parse(fs.readFileSync(localePath, 'utf-8'))
    })

    it('should have minimax provider entry', () => {
      if (!localeData) localeData = JSON.parse(fs.readFileSync(localePath, 'utf-8'))
      assert.ok(localeData.minimax, 'Should have minimax key')
      assert.ok(localeData.minimax.name, 'Should have minimax name')
      assert.ok(localeData.minimax.description, 'Should have minimax description')
    })

    for (const model of expectedModels) {
      it(`should have translation for ${model}`, () => {
        if (!localeData) localeData = JSON.parse(fs.readFileSync(localePath, 'utf-8'))
        assert.ok(
          localeData.minimax?.models?.[model],
          `Should have translation for ${model} in ${locale}`
        )
      })
    }

    it('should NOT have deprecated M2/M2-Stable translations', () => {
      if (!localeData) localeData = JSON.parse(fs.readFileSync(localePath, 'utf-8'))
      const models = localeData.minimax?.models || {}
      assert.ok(!models['MiniMax-M2'], 'Should not have deprecated MiniMax-M2')
      assert.ok(!models['MiniMax-M2-Stable'], 'Should not have deprecated MiniMax-M2-Stable')
    })
  })
}
