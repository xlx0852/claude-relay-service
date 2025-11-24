# Gemini 账户登录方案详解

## 🎯 支持的登录方案

Node.js 项目中，Gemini 支持 **2 种主要登录方案**：

---

## 1. OAuth 2.0 登录（推荐）⭐

### 方案概述

通过 Google OAuth 2.0 授权流程获取 Access Token 和 Refresh Token，支持自动刷新。

### 技术实现

```javascript
// src/services/geminiAccountService.js

// OAuth 配置（Gemini CLI 公开凭据）
const OAUTH_CLIENT_ID = '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com'
const OAUTH_CLIENT_SECRET = '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'
const OAUTH_SCOPES = ['https://www.googleapis.com/auth/cloud-platform']

// OAuth流程
async function generateAuthUrl(state, redirectUri, proxyConfig) {
  const oAuth2Client = createOAuth2Client(redirectUri, proxyConfig)
  
  // 生成 PKCE code verifier
  const codeVerifier = await oAuth2Client.generateCodeVerifierAsync()
  
  // 生成授权 URL
  const authUrl = oAuth2Client.generateAuthUrl({
    redirect_uri: redirectUri || 'https://codeassist.google.com/authcode',
    access_type: 'offline',
    scope: OAUTH_SCOPES,
    code_challenge_method: 'S256',
    code_challenge: codeVerifier.codeChallenge,
    state: stateValue,
    prompt: 'select_account'
  })
  
  return { authUrl, codeVerifier, state }
}
```

### 使用步骤

#### 步骤1：生成授权URL

```bash
# 管理后台操作
Web UI → 账户管理 → 添加Gemini账户 → 选择OAuth方式
```

系统会生成一个授权链接：

```
https://accounts.google.com/o/oauth2/v2/auth?
  client_id=681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com
  &redirect_uri=https://codeassist.google.com/authcode
  &response_type=code
  &scope=https://www.googleapis.com/auth/cloud-platform
  &access_type=offline
  &prompt=select_account
  &code_challenge_method=S256
  &code_challenge=<生成的challenge>
  &state=<随机state>
```

#### 步骤2：用户授权

1. 用户点击授权链接
2. 跳转到 Google 登录页面
3. 选择 Google 账户并授权
4. Google 重定向回 `redirect_uri`，携带 `code`

#### 步骤3：交换Token

```javascript
// 系统自动交换 authorization code 为 tokens
async function exchangeCodeForTokens(code, codeVerifier, redirectUri, proxyConfig) {
  const oAuth2Client = createOAuth2Client(redirectUri, proxyConfig)
  
  // 设置 code verifier
  oAuth2Client.setCodeVerifier(codeVerifier)
  
  // 交换 tokens
  const { tokens } = await oAuth2Client.getToken({
    code,
    redirect_uri: redirectUri
  })
  
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    scope: tokens.scope,
    token_type: tokens.token_type,
    expiry_date: tokens.expiry_date
  }
}
```

#### 步骤4：保存账户

```javascript
// 创建 Gemini 账户
await geminiAccountService.createAccount({
  name: 'My Gemini Account',
  geminiOauth: {
    access_token: 'ya29.a0AfB_...',
    refresh_token: '1//0gK...',
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    token_type: 'Bearer',
    expiry_date: 1704067200000
  },
  proxyUrl: 'socks5://127.0.0.1:1080', // 可选
  proxyUsername: 'user',                // 可选
  proxyPassword: 'pass'                 // 可选
})
```

### 自动刷新机制

```javascript
// Token 过期自动刷新
async function refreshAccessToken(refreshToken, proxyConfig) {
  const oAuth2Client = createOAuth2Client(null, proxyConfig)
  
  // 设置 credentials
  oAuth2Client.setCredentials({
    refresh_token: refreshToken
  })
  
  // 刷新 token
  const response = await oAuth2Client.refreshAccessToken()
  const { credentials } = response
  
  return {
    access_token: credentials.access_token,
    refresh_token: credentials.refresh_token || refreshToken,
    scope: credentials.scope,
    token_type: credentials.token_type,
    expiry_date: credentials.expiry_date
  }
}

// 在发送请求前自动检查并刷新
if (isTokenExpired(account)) {
  await refreshAccountToken(account.id)
}
```

### 存储结构

```javascript
// Redis: gemini_account:{id}
{
  id: 'uuid',
  name: 'My Gemini Account',
  platform: 'gemini',
  
  // OAuth数据（加密存储）
  geminiOauth: 'encrypted:{...}',  // 完整OAuth对象
  accessToken: 'encrypted:ya29...', // 当前access_token
  refreshToken: 'encrypted:1//0g...', // refresh_token
  expiresAt: '2024-01-01T00:00:00Z', // token过期时间
  scopes: 'https://www.googleapis.com/auth/cloud-platform',
  
  // 代理配置
  proxyUrl: 'socks5://127.0.0.1:1080',
  proxyUsername: 'encrypted:user',
  proxyPassword: 'encrypted:pass',
  
  // 状态
  status: 'active',
  isActive: 'true',
  lastUsedAt: '2024-01-01T00:00:00Z',
  lastRefreshAt: '2024-01-01T00:00:00Z'
}
```

### 优点

✅ **自动刷新**：Token过期自动刷新，无需手动维护  
✅ **长期有效**：只要refresh_token有效，就能持续使用  
✅ **安全性高**：遵循OAuth 2.0标准，支持PKCE  
✅ **支持代理**：完整的代理支持（SOCKS5/HTTP）  
✅ **加密存储**：敏感数据AES-256加密  

### 缺点

⚠️ **配置复杂**：需要走完整OAuth流程  
⚠️ **依赖网络**：需要能访问Google OAuth服务  

---

## 2. 手动Access Token（简单方案）

### 方案概述

直接提供 Google Access Token，适合临时使用或测试场景。

### 使用步骤

#### 步骤1：获取Access Token

可以通过多种方式获取：

**方式A：从浏览器开发者工具**

```javascript
// 1. 打开 https://aistudio.google.com/
// 2. 打开浏览器开发者工具（F12）
// 3. 切换到 Network 标签
// 4. 发送一个 Gemini 请求
// 5. 查看请求头，找到 Authorization: Bearer ya29...
// 6. 复制 ya29... 部分（Access Token）
```

**方式B：从 gcloud CLI**

```bash
# 使用 Google Cloud SDK
gcloud auth print-access-token
# 输出: ya29.a0AfB_byAbc...
```

**方式C：从服务账号**

```bash
# 使用服务账号密钥
gcloud auth activate-service-account --key-file=service-account.json
gcloud auth print-access-token
```

#### 步骤2：创建账户

```javascript
// 方式1：通过 Web UI
Web UI → 账户管理 → 添加Gemini账户
→ 选择"手动Token"
→ 粘贴 Access Token

// 方式2：通过 API
POST /admin/gemini-accounts
{
  "name": "Test Gemini",
  "accessToken": "ya29.a0AfB_byAbc...",
  "proxyUrl": "socks5://127.0.0.1:1080"  // 可选
}
```

#### 步骤3：使用

```javascript
// 系统会自动使用这个 token
// 直到 token 过期（通常1小时）
```

### 存储结构

```javascript
// Redis: gemini_account:{id}
{
  id: 'uuid',
  name: 'Test Gemini',
  platform: 'gemini',
  
  // 只有 accessToken（加密存储）
  accessToken: 'encrypted:ya29...',
  // 没有 refreshToken！
  refreshToken: '',
  geminiOauth: '',  // 空
  expiresAt: '',     // 通常未知
  
  status: 'active'
}
```

### 优点

✅ **简单快速**：无需OAuth流程  
✅ **适合测试**：快速验证功能  
✅ **灵活获取**：多种方式获取token  

### 缺点

❌ **无法刷新**：Token过期后必须手动更新  
❌ **短期有效**：通常只有1小时有效期  
❌ **不适合生产**：需要频繁手动维护  

---

## 3. 两种方案对比

| 特性 | OAuth 2.0 | 手动Token |
|------|----------|----------|
| **配置难度** | ⚠️ 中等 | ✅ 简单 |
| **有效期** | ✅ 长期（自动刷新） | ❌ 短期（1小时） |
| **自动刷新** | ✅ 支持 | ❌ 不支持 |
| **维护成本** | ✅ 低（自动） | ❌ 高（手动） |
| **适用场景** | ✅ 生产环境 | ⚠️ 测试/临时 |
| **代理支持** | ✅ 完整支持 | ✅ 完整支持 |
| **加密存储** | ✅ 支持 | ✅ 支持 |

---

## 4. 推荐使用方案

### 生产环境 → OAuth 2.0

```javascript
// 优势：
✅ 长期稳定运行
✅ 自动刷新，无需人工介入
✅ 符合安全最佳实践

// 配置步骤：
1. Web UI → 添加Gemini账户 → OAuth方式
2. 生成授权URL
3. 用户授权
4. 系统自动完成后续流程
```

### 开发/测试 → 手动Token

```javascript
// 优势：
✅ 快速验证功能
✅ 无需复杂配置
✅ 适合临时使用

// 使用步骤：
1. 从浏览器/gcloud获取token
2. Web UI → 添加账户 → 粘贴token
3. 立即可用
```

---

## 5. 完整流程示例

### OAuth 2.0 完整流程

```javascript
// 1. 管理员在Web UI发起OAuth
const { authUrl, sessionId } = await generateAuthUrl({
  proxyUrl: 'socks5://127.0.0.1:1080'
})

console.log('请访问:', authUrl)
// https://accounts.google.com/o/oauth2/v2/auth?...

// 2. 用户在浏览器授权
// → 选择Google账户
// → 同意权限
// → 重定向回 redirect_uri?code=xxx&state=xxx

// 3. 系统自动轮询检查授权状态
const result = await pollAuthorizationStatus(sessionId)

if (result.success) {
  // 4. 授权成功，创建账户
  const account = await createAccount({
    name: 'Production Gemini',
    geminiOauth: result.tokens,
    proxyUrl: 'socks5://127.0.0.1:1080'
  })
  
  console.log('账户创建成功:', account.id)
}

// 5. 后续使用（自动处理token刷新）
const account = await getAccount(accountId)

if (isTokenExpired(account)) {
  // 自动刷新
  await refreshAccountToken(accountId)
}

// 使用新token发送请求
await sendGeminiRequest(account)
```

### 手动Token流程

```javascript
// 1. 获取token（从浏览器）
// F12 → Network → Authorization: Bearer ya29...

const accessToken = 'ya29.a0AfB_byAbc...'

// 2. 创建账户
const account = await createAccount({
  name: 'Test Gemini',
  accessToken: accessToken
})

// 3. 使用
await sendGeminiRequest(account)

// 4. Token过期后（约1小时）
// → 需要重新获取新token
// → 更新账户: updateAccount(id, { accessToken: newToken })
```

---

## 6. 代理配置支持

两种方案都支持完整的代理配置：

```javascript
// OAuth流程代理
const { authUrl } = await generateAuthUrl({
  state: 'xxx',
  redirectUri: 'https://codeassist.google.com/authcode',
  proxyConfig: {
    url: 'socks5://127.0.0.1:1080',
    username: 'user',
    password: 'pass'
  }
})

// Token刷新代理
await refreshAccessToken(refreshToken, {
  url: 'socks5://127.0.0.1:1080',
  username: 'user',
  password: 'pass'
})

// 请求代理
const account = {
  accessToken: '...',
  proxyUrl: 'socks5://127.0.0.1:1080',
  proxyUsername: 'user',
  proxyPassword: 'pass'
}

await sendGeminiRequest(account) // 自动使用账户配置的代理
```

---

## 7. 安全机制

### 加密存储

```javascript
// 所有敏感数据使用AES-256-CBC加密
const ALGORITHM = 'aes-256-cbc'

function encrypt(text) {
  const key = crypto.scryptSync(config.encryptionKey, 'gemini-account-salt', 32)
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  let encrypted = cipher.update(text)
  encrypted = Buffer.concat([encrypted, cipher.final()])
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`
}

// 存储到Redis时自动加密
account.accessToken = encrypt('ya29...')
account.refreshToken = encrypt('1//0g...')
account.geminiOauth = encrypt(JSON.stringify(oauthData))
```

### Token脱敏

```javascript
// 日志中自动脱敏
const { maskToken } = require('../utils/tokenMask')

logger.info('Using token:', maskToken(accessToken))
// 输出: Using token: ya29...abc***xyz
```

### 解密缓存

```javascript
// 使用LRU缓存避免重复解密
const decryptCache = new LRUCache(500)

function decrypt(text) {
  const cacheKey = crypto.createHash('sha256').update(text).digest('hex')
  const cached = decryptCache.get(cacheKey)
  if (cached) return cached  // 缓存命中
  
  // 解密并缓存结果
  const result = actualDecrypt(text)
  decryptCache.set(cacheKey, result, 5 * 60 * 1000) // 5分钟
  return result
}
```

---

## 8. 常见问题

### Q1: OAuth授权后token多久过期？

**A:** Access Token通常1小时过期，但系统会自动刷新。只要refresh_token有效，就能持续使用。

### Q2: 手动Token如何续期？

**A:** 手动Token无法自动续期，需要：
1. 重新获取新token（从浏览器/gcloud）
2. 更新账户：`updateAccount(id, { accessToken: newToken })`

### Q3: 代理是必须的吗？

**A:** 不是必须的，但推荐配置：
- 国内访问Google服务需要代理
- OAuth流程和API请求都会使用配置的代理

### Q4: 如何知道token是否过期？

**A:** 系统会自动检查：

```javascript
function isTokenExpired(account) {
  if (!account.expiresAt) return false
  
  const expiryTime = new Date(account.expiresAt).getTime()
  const currentTime = Date.now()
  const bufferTime = 10 * 60 * 1000 // 提前10分钟
  
  return currentTime >= expiryTime - bufferTime
}
```

### Q5: OAuth失败怎么办？

**A:** 检查以下几点：
1. 代理配置是否正确
2. redirect_uri是否匹配
3. code_verifier是否正确传递
4. 网络是否能访问Google服务

---

## 9. 总结

### 推荐方案

| 场景 | 推荐方案 | 理由 |
|------|---------|------|
| 生产环境 | OAuth 2.0 | 长期稳定，自动刷新 |
| 开发测试 | 手动Token | 快速验证，简单方便 |
| 临时使用 | 手动Token | 无需配置OAuth |
| 长期运营 | OAuth 2.0 | 维护成本低 |

### 核心特性

✅ **2种登录方案**：OAuth 2.0 + 手动Token  
✅ **自动刷新**：OAuth方式支持自动刷新  
✅ **代理支持**：完整的SOCKS5/HTTP代理  
✅ **安全存储**：AES-256加密  
✅ **解密优化**：LRU缓存提升性能  

**Node项目的Gemini集成非常完善，生产和测试场景都能很好支持！** 🚀
