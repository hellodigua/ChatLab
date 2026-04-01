# ChatLab Web UI 设计文档

> 版本: v1.1  
> 日期: 2026-04-01  
> 状态: 设计评审阶段

---

## 一、需求概述

### 1.1 背景

ChatLab 当前是一个 Electron 桌面应用，仅支持本地管理员使用。用户提出扩展需求：

| 核心诉求         | 描述                                  |
| ---------------- | ------------------------------------- |
| **Web UI 访问**  | 允许其他用户通过浏览器访问 ChatLab    |
| **只读浏览**     | Web 用户只能浏览，不能导入/设置       |
| **AI 对话保留**  | Web 用户可以使用 AI 对话功能          |
| **简单权限区分** | 管理员（桌面端）vs 普通用户（Web UI） |

### 1.2 设计目标

```
┌─────────────────────────────────────────────────────────────┐
│                      用户角色区分                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   管理员（桌面端）          普通用户（Web UI）              │
│   ┌─────────────────┐      ┌─────────────────┐            │
│   │ ✅ 浏览会话      │      │ ✅ 浏览会话      │            │
│   │ ✅ 浏览消息      │      │ ✅ 浏览消息      │            │
│   │ ✅ 统计分析      │      │ ✅ 统计分析      │            │
│   │ ✅ AI 对话       │      │ ✅ AI 对话       │            │
│   │ ✅ 导入聊天      │      │ ❌ 仅管理员      │            │
│   │ ✅ 设置功能      │      │ ❌ 仅管理员      │            │
│   │ ✅ SQL 实验室    │      │ ❌ 仅管理员      │            │
│   │ ✅ LLM 配置      │      │ ❌ 仅管理员      │            │
│   └─────────────────┘      └─────────────────┘            │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 1.3 核心设计原则

| 原则         | 说明                                         |
| ------------ | -------------------------------------------- |
| **UI 复用**  | Web UI 复用 Electron 的 Vue 组件，不重新开发 |
| **只读访问** | Web 用户无法导入、设置、修改配置             |
| **简单认证** | 密码保护，管理员在设置中配置                 |
| **配置共享** | Web 用户使用管理员配置的 AI                  |
| **开关控制** | 设置页面增加 Web UI 开关                     |

---

## 二、架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Vue 3 前端（复用）                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  同一套 Vue 组件                                     │   │
│  │  ├── 会话列表 / 消息浏览 / 统计图表 ✅              │   │
│  │  ├── AI 对话 ✅                                     │   │
│  │  ├── 导入功能 (v-if="isAdmin") ❌ Web              │   │
│  │  ├── 设置页面 (v-if="isAdmin") ❌ Web              │   │
│  │  └── SQL 实验室 (v-if="isAdmin") ❌ Web            │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              API 客户端抽象层                        │   │
│  │  ┌──────────────────┐  ┌──────────────────┐        │   │
│  │  │ electron-client  │  │   http-client    │        │   │
│  │  │ (IPC 调用)       │  │ (HTTP API)       │        │   │
│  │  └──────────────────┘  └──────────────────┘        │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Electron 主进程                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Fastify HTTP Server                     │   │
│  │  ┌──────────────────────────────────────────────┐   │   │
│  │  │ 现有 API（已有）                              │   │   │
│  │  │  ├── GET  /api/v1/sessions      会话列表     │   │   │
│  │  │  ├── GET  /api/v1/sessions/:id  会话详情     │   │   │
│  │  │  ├── GET  /api/v1/sessions/:id/messages      │   │   │
│  │  │  ├── GET  /api/v1/sessions/:id/members       │   │   │
│  │  │  └── GET  /api/v1/sessions/:id/stats/*       │   │   │
│  │  ├──────────────────────────────────────────────┤   │   │
│  │  │ 新增 API（需开发）                            │   │   │
│  │  │  ├── POST /api/v1/auth/login    登录认证     │   │   │
│  │  │  ├── POST /api/v1/auth/verify   验证Token    │   │   │
│  │  │  ├── POST /api/v1/sessions/:id/ai/chat       │   │   │
│  │  │  └── GET  /api/v1/sessions/:id/ai/stream     │   │   │
│  │  └──────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 数据流向

```
管理员操作流程：
┌──────────┐     IPC      ┌──────────┐     Direct     ┌──────────┐
│ Electron │ ──────────▶ │  Main    │ ─────────────▶ │ Database │
│   App    │             │ Process  │                │ (SQLite) │
└──────────┘             └──────────┘                └──────────┘

普通用户操作流程：
┌──────────┐     HTTP     ┌──────────┐     Direct     ┌──────────┐
│ Browser  │ ──────────▶ │ Fastify  │ ─────────────▶ │ Database │
│  (Web)   │   REST/SSE  │  Server  │                │ (SQLite) │
└──────────┘             └──────────┘                └──────────┘
```

---

## 三、功能设计

### 3.1 Web UI 设置页面

```
设置 > 网络设置
┌─────────────────────────────────────────────────────────────┐
│                                                              │
│  Web UI 服务                                                 │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ ☑ 启用 Web UI 访问                                      │ │
│  │                                                         │ │
│  │   端口号:    [5200    ]  (可修改)                      │ │
│  │   访问密码:  [••••••••] [显示]  (用于Web登录)          │ │
│  │                                                         │ │
│  │   访问地址:  http://192.168.1.100:5200                 │ │
│  │              [复制链接]                                 │ │
│  │                                                         │ │
│  │   ℹ️ 启用后，局域网内用户可通过浏览器访问               │ │
│  │      仅支持浏览和 AI 对话功能                          │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Web UI 登录页面

```
┌─────────────────────────────────────────────────────────────┐
│                        ChatLab                              │
│                                                              │
│              ┌─────────────────────────────┐                │
│              │     🔐 访问密码              │                │
│              │                             │                │
│              │  ┌───────────────────────┐  │                │
│              │  │ ••••••••              │  │                │
│              │  └───────────────────────┘  │                │
│              │                             │                │
│              │       [ 登 录 ]             │                │
│              │                             │                │
│              └─────────────────────────────┘                │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 前端条件渲染

```vue
<!-- 导航栏 -->
<template>
  <nav>
    <!-- 所有用户可见 -->
    <NavItem to="/sessions">会话</NavItem>
    <NavItem to="/analysis">分析</NavItem>
    <NavItem to="/ai">AI 对话</NavItem>

    <!-- 仅管理员可见 -->
    <NavItem v-if="isAdmin" to="/import">导入</NavItem>
    <NavItem v-if="isAdmin" to="/sql-lab">SQL 实验室</NavItem>
    <NavItem v-if="isAdmin" to="/settings">设置</NavItem>
  </nav>
</template>

<script setup>
// 检测运行环境
const isAdmin = computed(() => {
  // Electron 环境 = 管理员
  // Browser 环境 = 普通用户
  return typeof window !== 'undefined' && window.electron !== undefined
})
</script>
```

---

## 四、API 设计

### 4.1 认证 API（新增）

```typescript
// POST /api/v1/auth/login
// 用户登录
Request:
{
  "password": "访问密码"
}
Response:
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "expiresAt": 1234567890
}

// POST /api/v1/auth/verify
// 验证 Token
Request:
{
  "token": "xxx"
}
Response:
{
  "success": true,
  "user": {
    "role": "viewer"
  }
}

// POST /api/v1/auth/logout
// 登出
```

### 4.2 AI 对话 API（新增）

```typescript
// POST /api/v1/sessions/:id/ai/chat
// AI 对话（非流式）
Request:
{
  "message": "用户消息",
  "conversationId": "xxx",  // 可选
  "assistantId": "default"
}
Response:
{
  "success": true,
  "conversationId": "xxx",
  "message": {
    "id": "xxx",
    "role": "assistant",
    "content": "AI 回复",
    "timestamp": 1234567890
  }
}

// GET /api/v1/sessions/:id/ai/stream
// AI 对话（流式 SSE）
Query:
  - message: 用户消息
  - conversationId: 对话ID
  - assistantId: 助手ID
Response (SSE):
event: content
data: {"type":"content","text":"这是"}

event: content
data: {"type":"content","text":"AI"}

event: done
data: {"type":"done"}

// GET /api/v1/sessions/:id/ai/conversations
// 获取对话列表
Response:
{
  "success": true,
  "data": [
    {
      "id": "conv_xxx",
      "title": "对话标题",
      "createdAt": 1234567890
    }
  ]
}

// GET /api/v1/ai/conversations/:conversationId
// 获取对话详情（含所有消息）
```

### 4.3 现有 API（复用）

以下 API 已存在，Web UI 直接调用：

| API                             | 方法 | 说明     |
| ------------------------------- | ---- | -------- |
| `/api/v1/sessions`              | GET  | 会话列表 |
| `/api/v1/sessions/:id`          | GET  | 会话详情 |
| `/api/v1/sessions/:id/messages` | GET  | 消息列表 |
| `/api/v1/sessions/:id/members`  | GET  | 成员列表 |
| `/api/v1/sessions/:id/stats/*`  | GET  | 统计数据 |

---

## 五、API 客户端抽象层

### 5.1 接口定义

```typescript
// src/api/types.ts
export interface ChatApi {
  getSessions(): Promise<AnalysisSession[]>
  getSession(id: string): Promise<AnalysisSession | null>
  getMessages(sessionId: string, filter?: MessageFilter): Promise<{ messages: Message[]; total: number }>
  getMembers(sessionId: string): Promise<Member[]>
}

export interface AiApi {
  chat(sessionId: string, message: string, conversationId?: string): Promise<AIResponse>
  stream(sessionId: string, message: string, onChunk: (chunk: StreamChunk) => void): Promise<void>
  getConversations(sessionId: string): Promise<AIConversation[]>
}

export interface ApiClient {
  chat: ChatApi
  ai: AiApi
}

// 环境检测
export const isElectron = typeof window !== 'undefined' && typeof (window as any).electron !== 'undefined'
```

### 5.2 Electron 客户端

```typescript
// src/api/electron-client.ts
export function createElectronClient(): ApiClient {
  return {
    chat: {
      getSessions: () => window.chatApi.getSessions(),
      getSession: (id) => window.chatApi.getSession(id),
      getMessages: (sid, filter) => window.chatApi.getMessages(sid, filter),
      getMembers: (sid) => window.chatApi.getMembers(sid),
    },
    ai: {
      chat: (sid, msg, cid) => window.aiApi.sendMessage(sid, msg, cid),
      stream: (sid, msg, onChunk) => window.aiApi.streamMessage(sid, msg, onChunk),
      getConversations: (sid) => window.aiApi.getConversations(sid),
    },
  }
}
```

### 5.3 HTTP 客户端

```typescript
// src/api/http-client.ts
export function createHttpClient(): ApiClient {
  const baseUrl = window.location.origin
  const token = localStorage.getItem('auth_token')

  return {
    chat: {
      getSessions: () => httpGet(`${baseUrl}/api/v1/sessions`),
      getSession: (id) => httpGet(`${baseUrl}/api/v1/sessions/${id}`),
      getMessages: (sid, filter) => httpGet(`${baseUrl}/api/v1/sessions/${sid}/messages`, filter),
      getMembers: (sid) => httpGet(`${baseUrl}/api/v1/sessions/${sid}/members`),
    },
    ai: {
      chat: (sid, msg, cid) =>
        httpPost(`${baseUrl}/api/v1/sessions/${sid}/ai/chat`, { message: msg, conversationId: cid }),
      stream: (sid, msg, onChunk) => sseGet(`${baseUrl}/api/v1/sessions/${sid}/ai/stream`, { message: msg }, onChunk),
      getConversations: (sid) => httpGet(`${baseUrl}/api/v1/sessions/${sid}/ai/conversations`),
    },
  }
}
```

### 5.4 统一入口

```typescript
// src/api/client.ts
import { isElectron } from './types'
import { createElectronClient } from './electron-client'
import { createHttpClient } from './http-client'

export function getApiClient(): ApiClient {
  return isElectron ? createElectronClient() : createHttpClient()
}
```

---

## 六、认证与安全

### 6.1 认证流程

```
┌─────────┐                    ┌─────────┐                    ┌─────────┐
│ Browser │                    │ Server  │                    │ Config  │
└────┬────┘                    └────┬────┘                    └────┬────┘
     │                              │                              │
     │  1. POST /auth/login         │                              │
     │  { password: "xxx" }         │                              │
     │ ────────────────────────────▶│                              │
     │                              │  2. 读取配置中的密码哈希       │
     │                              │ ─────────────────────────────▶│
     │                              │                              │
     │                              │  3. 返回密码哈希              │
     │                              │ ◀─────────────────────────────│
     │                              │                              │
     │                              │  4. 验证密码                  │
     │                              │  5. 生成 JWT Token            │
     │                              │                              │
     │  6. 返回 Token               │                              │
     │ ◀────────────────────────────│                              │
     │                              │                              │
     │  7. 存储 Token 到 localStorage                            │
     │                              │                              │
     │  8. GET /api/v1/sessions     │                              │
     │  Authorization: Bearer xxx   │                              │
     │ ────────────────────────────▶│                              │
     │                              │  9. 验证 Token                │
     │                              │  10. 返回数据                 │
     │ ◀────────────────────────────│                              │
     │                              │                              │
└─────────┘                    └─────────┘                    └─────────┘
```

### 6.2 配置文件

```json
// ~/.chatlab/data/settings/web-ui.json
{
  "enabled": false,
  "port": 5200,
  "auth": {
    "enabled": true,
    "passwordHash": "bcrypt_hash_xxx",
    "tokenExpiresIn": 604800000
  }
}
```

### 6.3 JWT 工具

```typescript
// electron/main/web/auth/jwt.ts
const JWT_SECRET = crypto.randomBytes(64).toString('hex')
const JWT_EXPIRES_IN = 7 * 24 * 60 * 60 * 1000 // 7天

export function generateToken(): string {
  // 使用 HMAC-SHA256 签名
  const payload = { role: 'viewer', iat: Date.now(), exp: Date.now() + JWT_EXPIRES_IN }
  return sign(payload, JWT_SECRET)
}

export function verifyToken(token: string): boolean {
  // 验证签名和过期时间
  return verify(token, JWT_SECRET)
}
```

---

## 七、开发计划

### 7.1 分阶段实现

| 阶段        | 任务             | 文件                                              | 工作量   |
| ----------- | ---------------- | ------------------------------------------------- | -------- |
| **Phase 1** | API 客户端抽象层 | `src/api/*.ts`                                    | 1-2 人日 |
| **Phase 2** | AI 对话 HTTP API | `electron/main/api/routes/ai.ts`                  | 1-2 人日 |
| **Phase 3** | 认证系统         | `electron/main/web/auth/*.ts`                     | 1 人日   |
| **Phase 4** | 设置页开关       | `src/pages/settings/components/WebUISettings.vue` | 1 人日   |
| **Phase 5** | 前端条件渲染     | 各 Vue 组件                                       | 0.5 人日 |
| **Phase 6** | 静态文件服务     | `electron/main/api/static.ts`                     | 0.5 人日 |
| **Phase 7** | 测试与文档       | `tests/e2e/web-ui.spec.ts`                        | 1 人日   |

**总计：约 6-9 人日**

### 7.2 文件变更清单

```
新增文件：
├── src/api/
│   ├── types.ts              # API 接口定义
│   ├── client.ts             # 统一入口
│   ├── electron-client.ts    # IPC 实现
│   └── http-client.ts        # HTTP 实现
│
├── electron/main/api/routes/
│   ├── ai.ts                 # AI 对话 API
│   └── auth.ts               # 认证 API
│
├── electron/main/web/auth/
│   └── jwt.ts                # JWT 工具
│
├── src/pages/settings/components/
│   └── WebUISettings.vue     # Web UI 设置组件
│
└── tests/e2e/
    └── web-ui.spec.ts        # E2E 测试

修改文件：
├── electron/main/api/server.ts       # 添加认证中间件
├── electron/main/api/index.ts        # 注册新路由
├── src/stores/settings.ts            # 添加 Web UI 状态
└── src/App.vue                       # 条件渲染逻辑
```

---

## 八、E2E 测试用例

### 8.1 测试场景

| ID          | 场景            | 步骤                                           | 预期结果               |
| ----------- | --------------- | ---------------------------------------------- | ---------------------- |
| **WUI-001** | Web UI 服务开关 | 1. 打开设置<br>2. 勾选"启用 Web UI"<br>3. 保存 | 服务启动，显示访问地址 |
| **WUI-002** | Web UI 端口修改 | 1. 修改端口为 8080<br>2. 保存                  | 服务重启在新端口       |
| **WUI-003** | Web UI 登录成功 | 1. 访问 Web UI<br>2. 输入正确密码              | 登录成功，跳转首页     |
| **WUI-004** | Web UI 登录失败 | 1. 访问 Web UI<br>2. 输入错误密码              | 显示"密码错误"         |
| **WUI-005** | Token 过期处理  | 1. 使用过期 Token 访问                         | 返回 401，跳转登录     |
| **WUI-006** | 浏览会话列表    | 1. 登录后访问会话列表                          | 显示所有会话           |
| **WUI-007** | 浏览消息        | 1. 点击会话<br>2. 查看消息                     | 显示消息内容           |
| **WUI-008** | AI 对话         | 1. 进入 AI 对话<br>2. 发送消息                 | 返回 AI 回复           |
| **WUI-009** | AI 流式对话     | 1. 发送消息<br>2. 观察 SSE                     | 逐字显示回复           |
| **WUI-010** | 隐藏管理功能    | 1. 检查导航栏                                  | 无"导入/设置/SQL"      |
| **WUI-011** | 服务关闭        | 1. 取消勾选"启用"<br>2. 保存                   | 服务停止，无法访问     |

### 8.2 测试代码框架

```typescript
// tests/e2e/web-ui.spec.ts
import { test, expect } from '@playwright/test'

test.describe('Web UI', () => {
  test.beforeEach(async ({ page }) => {
    // 启动 Electron 并开启 Web UI
  })

  test('WUI-001: 启用 Web UI 服务', async ({ page }) => {
    await page.goto('http://localhost:5200')
    await expect(page.locator('h1')).toContainText('ChatLab')
  })

  test('WUI-003: 登录成功', async ({ page }) => {
    await page.goto('http://localhost:5200')
    await page.fill('input[type="password"]', 'correct_password')
    await page.click('button:has-text("登录")')
    await expect(page).toHaveURL(/.*sessions/)
  })

  test('WUI-004: 登录失败', async ({ page }) => {
    await page.goto('http://localhost:5200')
    await page.fill('input[type="password"]', 'wrong_password')
    await page.click('button:has-text("登录")')
    await expect(page.locator('.error')).toContainText('密码错误')
  })

  test('WUI-010: 隐藏管理功能', async ({ page }) => {
    // 登录
    await login(page)
    // 检查导航栏
    await expect(page.locator('nav >> text=导入')).not.toBeVisible()
    await expect(page.locator('nav >> text=设置')).not.toBeVisible()
    await expect(page.locator('nav >> text=SQL')).not.toBeVisible()
  })

  test('WUI-008: AI 对话', async ({ page }) => {
    await login(page)
    await page.click('nav >> text=AI')
    await page.fill('textarea', '你好')
    await page.click('button:has-text("发送")')
    await expect(page.locator('.ai-response')).toBeVisible()
  })
})
```

---

## 九、风险与缓解

| 风险       | 影响             | 缓解措施            |
| ---------- | ---------------- | ------------------- |
| Token 泄露 | 未授权访问       | HTTPS + 短过期时间  |
| 密码爆破   | 安全风险         | 登录失败次数限制    |
| SSE 兼容性 | 部分浏览器不支持 | 提供轮询降级方案    |
| 并发访问   | 性能下降         | 连接池 + 数据库优化 |

---

## 十、附录

### A. 配置 Schema

```typescript
interface WebUIConfig {
  enabled: boolean
  port: number
  auth: {
    enabled: boolean
    passwordHash: string
    tokenExpiresIn: number
  }
}

const DEFAULT_CONFIG: WebUIConfig = {
  enabled: false,
  port: 5200,
  auth: {
    enabled: true,
    passwordHash: '',
    tokenExpiresIn: 7 * 24 * 60 * 60 * 1000,
  },
}
```

### B. 国际化 Key

```json
{
  "settings.webUI.title": "Web UI 服务",
  "settings.webUI.enabled": "启用 Web UI 访问",
  "settings.webUI.port": "端口号",
  "settings.webUI.password": "访问密码",
  "settings.webUI.url": "访问地址",
  "settings.webUI.hint": "启用后，局域网内用户可通过浏览器访问",

  "web.login.title": "访问 ChatLab",
  "web.login.password": "访问密码",
  "web.login.submit": "登录",
  "web.login.error": "密码错误",

  "web.error.unauthorized": "未授权，请重新登录",
  "web.error.tokenExpired": "登录已过期"
}
```

---

**文档结束** | v1.1 | 待评审
