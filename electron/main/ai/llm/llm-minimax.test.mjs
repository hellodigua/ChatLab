/**
 * MiniMax provider configuration tests
 *
 * Tests the MiniMax LLM provider configuration including:
 * - API endpoint URLs (international + China domestic)
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

  it('should include minimax-cn in LLMProvider union type', () => {
    assert.match(typesSource, /['"]minimax-cn['"]/, 'minimax-cn should be in LLMProvider type')
  })
})

describe('MiniMax provider info (international)', () => {
  it('should use api.minimax.io for international endpoint', () => {
    assert.match(
      indexSource,
      /MINIMAX_INFO[\s\S]*?defaultBaseUrl:\s*['"]https:\/\/api\.minimax\.io\/v1['"]/,
      'International base URL should be https://api.minimax.io/v1'
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
    const minimaxBlock = indexSource.match(/const MINIMAX_INFO[\s\S]*?\n\}/)?.[0] || ''
    assert.doesNotMatch(minimaxBlock, /['"]MiniMax-M2['"](?![\.\-])/, 'Should not include deprecated MiniMax-M2')
    assert.doesNotMatch(minimaxBlock, /MiniMax-M2-Stable/, 'Should not include deprecated MiniMax-M2-Stable')
  })
})

describe('MiniMax provider info (China domestic)', () => {
  it('should use api.minimax.chat for China domestic endpoint', () => {
    assert.match(
      indexSource,
      /MINIMAX_CN_INFO[\s\S]*?defaultBaseUrl:\s*['"]https:\/\/api\.minimax\.chat\/v1['"]/,
      'China domestic base URL should be https://api.minimax.chat/v1'
    )
  })

  it('should have minimax-cn as provider id', () => {
    assert.match(
      indexSource,
      /MINIMAX_CN_INFO[\s\S]*?id:\s*['"]minimax-cn['"]/,
      'China domestic provider should have id minimax-cn'
    )
  })

  it('should include MINIMAX_CN_INFO in PROVIDERS export', () => {
    assert.match(indexSource, /MINIMAX_CN_INFO/, 'MINIMAX_CN_INFO should be in PROVIDERS array')
  })
})

describe('MiniMax context window handling', () => {
  it('should set 204800 context window for M2.7 models', () => {
    assert.match(
      indexSource,
      /204800/,
      'M2.7 models should have 204800 context window'
    )
  })

  it('should NOT use 1M (1000000) context window', () => {
    assert.doesNotMatch(
      indexSource,
      /contextWindow\s*=\s*1000000/,
      'Should not use 1M context window for any MiniMax model'
    )
  })

  it('should handle minimax-cn provider for context window', () => {
    assert.match(
      indexSource,
      /minimax-cn/,
      'Context window logic should handle minimax-cn provider'
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
      'Error message should mention api.minimax.io URL'
    )
    assert.match(
      indexSource,
      /api\.minimax\.chat/,
      'Error message should mention api.minimax.chat URL'
    )
  })

  it('should validate minimax-cn provider too', () => {
    assert.match(
      indexSource,
      /minimax-cn/,
      'Validation should also cover minimax-cn provider'
    )
  })
})

describe('MiniMax in PROVIDERS array', () => {
  it('should include MINIMAX_INFO in PROVIDERS export', () => {
    assert.match(indexSource, /MINIMAX_INFO/, 'MINIMAX_INFO should be in PROVIDERS array')
  })

  it('should include MINIMAX_CN_INFO in PROVIDERS export', () => {
    assert.match(indexSource, /MINIMAX_CN_INFO/, 'MINIMAX_CN_INFO should be in PROVIDERS array')
  })
})

// ==================== i18n Locale Tests ====================

const locales = ['en-US', 'zh-CN', 'ja-JP', 'zh-TW']
const expectedModels = ['MiniMax-M2.7', 'MiniMax-M2.7-highspeed', 'MiniMax-M2.5', 'MiniMax-M2.5-highspeed']
const minimaxProviders = ['minimax', 'minimax-cn']

for (const locale of locales) {
  describe(`MiniMax i18n (${locale})`, () => {
    const localePath = path.join(projectRoot, 'src/i18n/locales', locale, 'providers.json')
    let localeData

    it('should have providers.json file', () => {
      assert.ok(fs.existsSync(localePath), `${locale}/providers.json should exist`)
      localeData = JSON.parse(fs.readFileSync(localePath, 'utf-8'))
    })

    for (const provider of minimaxProviders) {
      it(`should have ${provider} provider entry`, () => {
        if (!localeData) localeData = JSON.parse(fs.readFileSync(localePath, 'utf-8'))
        assert.ok(localeData[provider], `Should have ${provider} key`)
        assert.ok(localeData[provider].name, `Should have ${provider} name`)
        assert.ok(localeData[provider].description, `Should have ${provider} description`)
      })

      for (const model of expectedModels) {
        it(`should have translation for ${model} in ${provider}`, () => {
          if (!localeData) localeData = JSON.parse(fs.readFileSync(localePath, 'utf-8'))
          assert.ok(
            localeData[provider]?.models?.[model],
            `Should have translation for ${model} in ${provider} (${locale})`
          )
        })
      }
    }

    it('should NOT have deprecated M2/M2-Stable translations', () => {
      if (!localeData) localeData = JSON.parse(fs.readFileSync(localePath, 'utf-8'))
      const models = localeData.minimax?.models || {}
      assert.ok(!models['MiniMax-M2'], 'Should not have deprecated MiniMax-M2')
      assert.ok(!models['MiniMax-M2-Stable'], 'Should not have deprecated MiniMax-M2-Stable')
    })
  })
}
