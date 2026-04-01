/**
 * Web UI E2E 测试
 *
 * 测试场景：
 * - Web UI 服务开关
 * - 登录认证
 * - 会话浏览
 * - AI 对话
 * - 权限控制（隐藏管理功能）
 */

import { test, expect, Page, BrowserContext } from '@playwright/test'

// ==================== 辅助函数 ====================

const WEB_UI_PORT = 5201 // 使用不同端口避免冲突
const BASE_URL = `http://localhost:${WEB_UI_PORT}`
const TEST_PASSWORD = 'test_password_123'

/**
 * 登录 Web UI
 */
async function login(page: Page, password: string = TEST_PASSWORD) {
  await page.goto(BASE_URL)
  await page.fill('input[type="password"]', password)
  await page.click('button:has-text("登录")')
  // 等待跳转到会话列表
  await page.waitForURL(/.*sessions/, { timeout: 5000 })
}

/**
 * 生成测试 Token（模拟服务端）
 */
function generateTestToken(): string {
  // 实际测试中需要从 Electron API 获取
  return 'test_token_placeholder'
}

// ==================== 测试配置 ====================

test.describe.configure({ mode: 'serial' }) // 顺序执行

test.describe('Web UI 功能测试', () => {
  let context: BrowserContext

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext()
    // TODO: 启动 Electron 并开启 Web UI 服务
    // 需要通过 IPC 调用开启 Web UI 并设置密码
  })

  test.afterAll(async () => {
    await context.close()
    // TODO: 关闭 Web UI 服务
  })

  // ==================== 登录认证测试 ====================

  test.describe('登录认证', () => {
    test('WUI-003: 正确密码登录成功', async ({ page }) => {
      await page.goto(BASE_URL)

      // 验证登录页面元素
      await expect(page.locator('h1, h2')).toContainText(/ChatLab/i)
      await expect(page.locator('input[type="password"]')).toBeVisible()

      // 输入正确密码
      await page.fill('input[type="password"]', TEST_PASSWORD)
      await page.click('button:has-text("登录")')

      // 验证跳转到会话列表
      await expect(page).toHaveURL(new RegExp(`.*${BASE_URL}/sessions.*`))
    })

    test('WUI-004: 错误密码登录失败', async ({ page }) => {
      await page.goto(BASE_URL)

      // 输入错误密码
      await page.fill('input[type="password"]', 'wrong_password')
      await page.click('button:has-text("登录")')

      // 验证错误提示
      await expect(page.locator('.error, [role="alert"]')).toContainText(/密码错误|incorrect/i)

      // 验证仍在登录页面
      await expect(page).toHaveURL(new RegExp(`.*${BASE_URL}/?$`))
    })

    test('WUI-005: Token 过期处理', async ({ page }) => {
      // 设置一个过期的 Token
      await page.goto(BASE_URL)
      await page.evaluate(() => {
        localStorage.setItem('auth_token', 'expired_token')
        localStorage.setItem('token_expires_at', '0')
      })

      // 访问需要认证的页面
      await page.goto(`${BASE_URL}/sessions`)

      // 应该被重定向到登录页
      await expect(page).toHaveURL(new RegExp(`.*${BASE_URL}/?$`))
    })
  })

  // ==================== 会话浏览测试 ====================

  test.describe('会话浏览', () => {
    test.beforeEach(async ({ page }) => {
      await login(page)
    })

    test('WUI-006: 显示会话列表', async ({ page }) => {
      // 验证会话列表组件
      await expect(page.locator('.session-list, [data-testid="session-list"]')).toBeVisible()

      // 如果有会话，验证显示
      const sessionItems = page.locator('.session-item, [data-testid="session-item"]')
      const count = await sessionItems.count()
      if (count > 0) {
        await expect(sessionItems.first()).toBeVisible()
      }
    })

    test.skip('WUI-007-SKIP: 没有会话时跳过', async () => {
      // 此测试用于文档记录，实际在上面的测试中处理
    })

    test('WUI-007: 查看会话消息', async ({ page }) => {
      // 点击第一个会话
      const sessionItem = page.locator('.session-item, [data-testid="session-item"]').first()
      const isVisible = await sessionItem.isVisible()

      if (!isVisible) {
        // 没有会话时跳过此测试
        test.skip()
        return
      }

      await sessionItem.click()

      // 验证消息列表
      await expect(page.locator('.message-list, [data-testid="message-list"]')).toBeVisible({ timeout: 5000 })
    })
  })

  // ==================== AI 对话测试 ====================

  test.describe('AI 对话', () => {
    test.beforeEach(async ({ page }) => {
      await login(page)
    })

    test('WUI-008: 发送消息并收到回复', async ({ page }) => {
      // 导航到 AI 对话页面
      await page.click('nav >> text=/AI|对话/i')

      // 等待 AI 页面加载
      await expect(page.locator('.ai-chat, [data-testid="ai-chat"]')).toBeVisible()

      // 输入消息
      const testMessage = '你好，这是一个测试消息'
      await page.fill('textarea, [data-testid="message-input"]', testMessage)
      await page.click('button:has-text("发送")')

      // 验证用户消息显示
      await expect(page.locator(`text=${testMessage}`)).toBeVisible()

      // 等待 AI 回复（可能需要时间）
      await expect(page.locator('.ai-response, [data-testid="ai-response"]')).toBeVisible({ timeout: 30000 })
    })

    test('WUI-009: SSE 流式响应', async ({ page }) => {
      await page.click('nav >> text=/AI|对话/i')

      // 发送消息
      await page.fill('textarea', '请用一句话回答：1+1等于几？')
      await page.click('button:has-text("发送")')

      // 观察流式输出 - 内容应该逐渐增加
      const responseLocator = page.locator('.ai-response, [data-testid="ai-response"]')

      // 等待开始响应
      await responseLocator.waitFor({ state: 'visible', timeout: 5000 })

      // 验证响应内容最终完整
      await expect(responseLocator).not.toBeEmpty({ timeout: 30000 })
    })
  })

  // ==================== 权限控制测试 ====================

  test.describe('权限控制', () => {
    test.beforeEach(async ({ page }) => {
      await login(page)
    })

    test('WUI-010: 隐藏导入功能', async ({ page }) => {
      // 导航栏不应该有"导入"
      const navImport = page.locator('nav >> text=/导入|Import/i')
      await expect(navImport).not.toBeVisible()

      // 直接访问导入页面应该被禁止或重定向
      await page.goto(`${BASE_URL}/import`)
      // 应该显示 403 或重定向
    })

    test('WUI-011: 隐藏设置功能', async ({ page }) => {
      // 导航栏不应该有"设置"
      const navSettings = page.locator('nav >> text=/设置|Settings/i')
      await expect(navSettings).not.toBeVisible()

      // 直接访问设置页面应该被禁止
      await page.goto(`${BASE_URL}/settings`)
    })

    test('WUI-012: 隐藏 SQL 实验室', async ({ page }) => {
      // 导航栏不应该有"SQL"
      const navSql = page.locator('nav >> text=/SQL|Sql/i')
      await expect(navSql).not.toBeVisible()

      // 直接访问 SQL 实验室应该被禁止
      await page.goto(`${BASE_URL}/sql-lab`)
    })
  })
})

// ==================== 服务控制测试 ====================

test.describe('Web UI 服务控制', () => {
  test.skip('WUI-001: 启用 Web UI 服务', async () => {
    // TODO: 通过 Electron IPC 启用 Web UI
    // 验证服务启动
    // 验证端口监听
  })

  test.skip('WUI-002: 修改服务端口', async () => {
    // TODO: 修改端口配置
    // 验证服务重启在新端口
  })

  test.skip('WUI-011: 关闭 Web UI 服务', async () => {
    // TODO: 关闭 Web UI
    // 验证服务停止
    // 验证无法访问
  })
})

// ==================== 边界测试 ====================

test.describe('边界情况', () => {
  test('空密码登录', async ({ page }) => {
    await page.goto(BASE_URL)
    await page.fill('input[type="password"]', '')
    await page.click('button:has-text("登录")')

    // 应该显示验证错误
    await expect(page.locator('.error, [role="alert"]')).toBeVisible()
  })

  test('超长密码', async ({ page }) => {
    await page.goto(BASE_URL)
    const longPassword = 'a'.repeat(1000)
    await page.fill('input[type="password"]', longPassword)
    await page.click('button:has-text("登录")')

    // 不应该崩溃，应该正常处理
    await expect(page.locator('.error, [role="alert"]')).toBeVisible()
  })

  test('特殊字符密码', async ({ page }) => {
    await page.goto(BASE_URL)
    await page.fill('input[type="password"]', '<script>alert(1)</script>')
    await page.click('button:has-text("登录")')

    // 应该安全处理，不执行脚本
    await expect(page.locator('.error, [role="alert"]')).toBeVisible()
  })
})
