# 统一API使用文档

## 🌟 简介

统一API是claude-relay-service的核心功能，它允许**一个API端点自动适配多种客户端格式**，无需修改客户端代码即可在不同AI服务提供商之间无缝切换。

### 核心特性

✅ **自动格式识别** - 通过User-Agent、Header或请求体结构自动识别客户端格式  
✅ **智能路由** - 根据账户可用性自动选择最佳服务提供商  
✅ **透明转换** - 自动翻译请求和响应格式，客户端无感知  
✅ **格式支持** - OpenAI、Claude、Gemini三大格式全支持  
✅ **流式响应** - 完整支持Server-Sent Events (SSE)流式传输  
✅ **负载均衡** - 多账户轮询，自动故障切换  

---

## 🚀 快速开始

### 端点地址

```
POST http://your-server:3000/v1/chat/completions
```

### 基础使用

**1. OpenAI SDK（推荐）**

```python
from openai import OpenAI

client = OpenAI(
    api_key="your-api-key",
    base_url="http://your-server:3000/v1"
)

response = client.chat.completions.create(
    model="gpt-4",
    messages=[
        {"role": "user", "content": "Hello!"}
    ]
)

print(response.choices[0].message.content)
```

**2. Claude SDK**

```python
import anthropic

client = anthropic.Anthropic(
    api_key="your-api-key",
    base_url="http://your-server:3000"
)

response = client.messages.create(
    model="claude-3-5-sonnet-20241022",
    max_tokens=1024,
    messages=[
        {"role": "user", "content": "Hello!"}
    ]
)

print(response.content[0].text)
```

**3. Curl命令**

```bash
curl -X POST http://your-server:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "model": "gpt-4",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

---

## 📋 格式检测机制

统一API使用多种策略自动识别客户端格式：

### 1. Header检测（最高优先级）

```bash
# 明确指定客户端格式
curl -H "X-Client-Format: claude" ...
curl -H "X-API-Format: openai-chat" ...
```

支持的格式值：
- `openai-chat` - OpenAI Chat Completions格式
- `claude` - Claude Messages格式
- `gemini` - Gemini Generative Language格式
- `gemini-cli` - Gemini CLI格式

### 2. User-Agent检测

系统会识别以下客户端：

| User-Agent | 识别为 |
|------------|--------|
| `claude-cli/*` | Claude |
| `GeminiCLI/*` | Gemini CLI |
| `openai-python/*` | OpenAI |
| `openai-node/*` | OpenAI |
| `Cursor/*` | OpenAI |
| `Continue/*` | OpenAI |
| `Cline/*` | Claude |
| `anthropic/*` | Claude |

### 3. 请求体结构推断

```javascript
// Claude格式特征
{
  "system": "...",           // Claude特有
  "messages": [
    {
      "role": "user",
      "content": [             // 数组形式的content
        { "type": "text", "text": "..." }
      ]
    }
  ]
}

// Gemini格式特征
{
  "contents": [...],          // Gemini使用contents
  "systemInstruction": {...}, // Gemini特有
  "generationConfig": {...}   // Gemini特有
}

// OpenAI格式特征
{
  "messages": [
    {
      "role": "user",
      "content": "..."         // 字符串形式的content
    }
  ]
}
```

### 4. 默认格式

如果以上方法都无法识别，默认使用 **OpenAI格式**。

---

## 🔄 格式转换示例

### OpenAI → Claude

**输入（OpenAI格式）：**
```json
{
  "model": "gpt-4",
  "messages": [
    {"role": "system", "content": "You are helpful."},
    {"role": "user", "content": "Hello!"}
  ],
  "max_tokens": 100
}
```

**内部转换为（Claude格式）：**
```json
{
  "model": "claude-3-5-sonnet-20241022",
  "system": "You are helpful.",
  "messages": [
    {
      "role": "user",
      "content": [
        {"type": "text", "text": "Hello!"}
      ]
    }
  ],
  "max_tokens": 100
}
```

**输出（自动转回OpenAI格式）：**
```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "Hello! How can I help you?"
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 8,
    "total_tokens": 18
  }
}
```

---

## 🎯 服务提供商选择

### 自动选择策略

系统按以下优先级选择可用的服务提供商：

1. **专属账户** - 如果API Key绑定了专属账户，优先使用
2. **Claude** - 优先使用Claude账户
3. **Gemini** - 其次使用Gemini账户
4. **OpenAI** - 最后使用OpenAI账户

### 可用性检查

对每个提供商，系统会：
- ✅ 检查是否有活跃账户
- ✅ 检查账户是否被限流
- ✅ 检查账户配额是否充足

### 智能回退

如果首选提供商不可用，自动切换到下一个可用提供商。

---

## 📊 流式响应

### 启用流式响应

```python
# OpenAI SDK
stream = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Tell me a story"}],
    stream=True  # 启用流式
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")
```

### Claude SDK流式

```python
with client.messages.stream(
    model="claude-3-5-sonnet-20241022",
    messages=[{"role": "user", "content": "Tell me a story"}],
    max_tokens=1024
) as stream:
    for text in stream.text_stream:
        print(text, end="", flush=True)
```

### SSE格式

流式响应使用Server-Sent Events (SSE)格式：

```
data: {"id":"chatcmpl-xxx","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","choices":[{"index":0,"delta":{"content":" there"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

---

## 🛠️ 高级功能

### 1. 强制指定提供商

虽然系统会自动选择，但你可以通过模型名称暗示首选提供商：

```python
# 使用Claude模型名称 → 倾向于使用Claude账户
client.chat.completions.create(
    model="claude-3-5-sonnet-20241022",
    messages=[...]
)

# 使用Gemini模型名称 → 倾向于使用Gemini账户
client.chat.completions.create(
    model="gemini-2.0-flash-exp",
    messages=[...]
)
```

### 2. 获取统计信息

```bash
curl -H "Authorization: Bearer your-api-key" \
  http://your-server:3000/v1/chat/completions/stats
```

响应：
```json
{
  "success": true,
  "stats": {
    "totalRequests": 150,
    "byClientFormat": {
      "openai-chat": 100,
      "claude": 30,
      "gemini": 20
    },
    "byServerFormat": {
      "claude": 80,
      "gemini": 40,
      "openai-chat": 30
    },
    "translationCount": 120,
    "translationRate": "80.00%",
    "errors": 2
  }
}
```

### 3. 列出可用模型

```bash
curl -H "Authorization: Bearer your-api-key" \
  http://your-server:3000/v1/models
```

---

## 🎨 客户端集成示例

### Python (OpenAI SDK)

```python
from openai import OpenAI

client = OpenAI(
    api_key="cr_your_api_key",
    base_url="http://your-server:3000/v1"
)

# 非流式
response = client.chat.completions.create(
    model="gpt-4",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "What is the capital of France?"}
    ],
    temperature=0.7,
    max_tokens=100
)

print(response.choices[0].message.content)

# 流式
stream = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Count from 1 to 10"}],
    stream=True
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
```

### JavaScript/TypeScript (OpenAI SDK)

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'cr_your_api_key',
  baseURL: 'http://your-server:3000/v1'
});

// 非流式
const response = await client.chat.completions.create({
  model: 'gpt-4',
  messages: [
    { role: 'user', content: 'Hello!' }
  ]
});

console.log(response.choices[0].message.content);

// 流式
const stream = await client.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Tell me a joke' }],
  stream: true
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || '');
}
```

### Cursor / Continue.dev

在设置中配置：

```json
{
  "models": [
    {
      "title": "Unified API (GPT-4)",
      "provider": "openai",
      "model": "gpt-4",
      "apiBase": "http://your-server:3000/v1",
      "apiKey": "cr_your_api_key"
    }
  ]
}
```

### Claude Desktop App

修改配置文件（`~/.claude/config.json`）：

```json
{
  "apiUrl": "http://your-server:3000",
  "apiKey": "cr_your_api_key"
}
```

---

## 🔍 调试技巧

### 1. 查看检测到的格式

响应头会包含检测信息：

```bash
curl -i -X POST http://your-server:3000/v1/chat/completions \
  -H "Authorization: Bearer your-api-key" \
  -d '{"model":"gpt-4","messages":[{"role":"user","content":"Hi"}]}'

# 响应头：
# X-Detected-Format: openai-chat
# X-Detection-Method: body-structure
# X-Server-Format: claude
# X-Translation-Applied: true
```

### 2. 启用详细日志

设置环境变量：

```bash
export LOG_LEVEL=debug
npm run service:restart
```

### 3. 测试不同格式

```bash
# 测试OpenAI格式
./test-unified-api.js

# 或者手动测试
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-key" \
  -H "X-Client-Format: openai-chat" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Test"}],
    "max_tokens": 50
  }'
```

---

## ⚠️ 注意事项

### 1. 格式差异

虽然统一API会自动转换格式，但某些高级功能可能在转换中丢失：

- ❌ Claude的`thinking`块暂不支持转换到OpenAI格式
- ❌ Gemini的多模态能力可能有限制
- ✅ 基础的文本对话完全支持
- ✅ 工具调用(Function Calling)支持

### 2. 性能考虑

- 格式转换会增加约5-10ms的延迟
- 流式响应的延迟更低（逐chunk转换）
- 建议使用相同格式以获得最佳性能

### 3. 错误处理

如果所有提供商都不可用：

```json
{
  "error": {
    "message": "No available service provider found",
    "type": "service_unavailable"
  }
}
```

---

## 📈 最佳实践

1. **使用OpenAI格式** - 最通用，兼容性最好
2. **明确指定格式** - 通过Header避免自动检测误判
3. **监控统计信息** - 定期查看翻译率和错误率
4. **合理配置账户** - 确保至少有一个提供商可用
5. **使用流式响应** - 获得更好的用户体验

---

## 🎉 总结

统一API让你可以：

✅ 用**任何客户端SDK**访问**任何AI服务**  
✅ 无需修改代码，自动适配格式  
✅ 智能选择最佳服务提供商  
✅ 透明的负载均衡和故障切换  
✅ 完整的流式响应支持  

**一个端点，所有格式，完美兼容！** 🚀
