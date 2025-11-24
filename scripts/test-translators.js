/**
 * 翻译器功能测试脚本
 * 用于验证翻译器注册表和各个翻译器的功能
 */

const path = require('path')

// 设置环境变量
process.env.NODE_ENV = 'development'
process.env.LOG_LEVEL = 'debug'

// 加载翻译器模块
const { registry, Formats } = require('../src/translators')

console.log('\n╔════════════════════════════════════════════════════════════════╗')
console.log('║             🧪 Translator System Test Suite                   ║')
console.log('╚════════════════════════════════════════════════════════════════╝\n')

// 测试数据
const testCases = {
  openaiRequest: {
    model: 'gpt-4',
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello, how are you?' },
      { role: 'assistant', content: 'I am doing well, thank you!' },
      { role: 'user', content: 'What is the weather like?' }
    ],
    temperature: 0.7,
    max_tokens: 1000,
    stream: true
  },

  claudeRequest: {
    model: 'claude-3-5-sonnet-20241022',
    system: 'You are a helpful assistant.',
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: 'Hello, how are you?' }]
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'I am doing well, thank you!' }]
      },
      {
        role: 'user',
        content: [{ type: 'text', text: 'What is the weather like?' }]
      }
    ],
    temperature: 0.7,
    max_tokens: 1000
  },

  claudeStreamResponse: {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: 'Hello, ' }
  },

  claudeNonStreamResponse: {
    id: 'msg_01XFDUDYJgAACzvnptvVoYEL',
    type: 'message',
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: 'Hello! The weather today is sunny with a temperature of 75°F.'
      }
    ],
    model: 'claude-3-5-sonnet-20241022',
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 100,
      output_tokens: 50
    }
  },

  openaiStreamResponse: `data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\n`,

  openaiNonStreamResponse: {
    id: 'chatcmpl-123',
    object: 'chat.completion',
    created: 1677652288,
    model: 'gpt-4',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: 'Hello! The weather today is sunny with a temperature of 75°F.'
        },
        finish_reason: 'stop'
      }
    ],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150
    }
  }
}

/**
 * 测试请求翻译
 */
function testRequestTranslation() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('🔄 Testing Request Translation')
  console.log('═══════════════════════════════════════════════════════════\n')

  // 测试 OpenAI → Claude
  console.log('1️⃣  OpenAI → Claude Request Translation')
  console.log('─────────────────────────────────────────────────────────')
  try {
    const translated = registry.translateRequest(Formats.OPENAI_CHAT, Formats.CLAUDE, {
      model: testCases.openaiRequest.model,
      rawRequest: testCases.openaiRequest,
      stream: true
    })

    console.log('✅ Translation successful')
    console.log('Original messages count:', testCases.openaiRequest.messages.length)
    console.log('Translated messages count:', translated.messages.length)
    console.log('Has system prompt:', !!translated.system)
    console.log('Model:', translated.model)
    console.log('Max tokens:', translated.max_tokens)
    console.log()
  } catch (error) {
    console.error('❌ Translation failed:', error.message)
    console.log()
  }

  // 测试 Claude → OpenAI
  console.log('2️⃣  Claude → OpenAI Request Translation')
  console.log('─────────────────────────────────────────────────────────')
  try {
    const translated = registry.translateRequest(Formats.CLAUDE, Formats.OPENAI_CHAT, {
      model: testCases.claudeRequest.model,
      rawRequest: testCases.claudeRequest,
      stream: false
    })

    console.log('✅ Translation successful')
    console.log('Original messages count:', testCases.claudeRequest.messages.length)
    console.log('Translated messages count:', translated.messages.length)
    console.log('Has system message:', translated.messages.some((m) => m.role === 'system'))
    console.log('Model:', translated.model)
    console.log('Max tokens:', translated.max_tokens)
    console.log()
  } catch (error) {
    console.error('❌ Translation failed:', error.message)
    console.log()
  }
}

/**
 * 测试响应翻译
 */
function testResponseTranslation() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('🔄 Testing Response Translation')
  console.log('═══════════════════════════════════════════════════════════\n')

  // 测试 Claude Stream → OpenAI Stream
  console.log('3️⃣  Claude Stream → OpenAI Stream Response Translation')
  console.log('─────────────────────────────────────────────────────────')
  try {
    const translated = registry.translateStreamResponse(Formats.OPENAI_CHAT, Formats.CLAUDE, {
      model: 'gpt-4',
      originalRequest: testCases.openaiRequest,
      translatedRequest: {},
      rawResponse: testCases.claudeStreamResponse
    })

    console.log('✅ Translation successful')
    console.log('Output chunks:', translated.length)
    if (translated.length > 0) {
      console.log('First chunk preview:', translated[0].substring(0, 100))
    }
    console.log()
  } catch (error) {
    console.error('❌ Translation failed:', error.message)
    console.log()
  }

  // 测试 Claude NonStream → OpenAI NonStream
  console.log('4️⃣  Claude NonStream → OpenAI NonStream Response Translation')
  console.log('─────────────────────────────────────────────────────────')
  try {
    const translated = registry.translateNonStreamResponse(Formats.OPENAI_CHAT, Formats.CLAUDE, {
      model: 'gpt-4',
      originalRequest: testCases.openaiRequest,
      translatedRequest: {},
      rawResponse: testCases.claudeNonStreamResponse
    })

    console.log('✅ Translation successful')
    console.log('Response ID:', translated.id)
    console.log('Content length:', translated.choices[0].message.content.length)
    console.log('Finish reason:', translated.choices[0].finish_reason)
    console.log('Usage:', JSON.stringify(translated.usage))
    console.log()
  } catch (error) {
    console.error('❌ Translation failed:', error.message)
    console.log()
  }

  // 测试 OpenAI Stream → Claude Stream
  console.log('5️⃣  OpenAI Stream → Claude Stream Response Translation')
  console.log('─────────────────────────────────────────────────────────')
  try {
    const translated = registry.translateStreamResponse(Formats.CLAUDE, Formats.OPENAI_CHAT, {
      model: 'claude-3-5-sonnet-20241022',
      originalRequest: testCases.claudeRequest,
      translatedRequest: {},
      rawResponse: testCases.openaiStreamResponse
    })

    console.log('✅ Translation successful')
    console.log('Output chunks:', translated.length)
    if (translated.length > 0) {
      console.log('First chunk preview:', translated[0].substring(0, 100))
    }
    console.log()
  } catch (error) {
    console.error('❌ Translation failed:', error.message)
    console.log()
  }

  // 测试 OpenAI NonStream → Claude NonStream
  console.log('6️⃣  OpenAI NonStream → Claude NonStream Response Translation')
  console.log('─────────────────────────────────────────────────────────')
  try {
    const translated = registry.translateNonStreamResponse(Formats.CLAUDE, Formats.OPENAI_CHAT, {
      model: 'claude-3-5-sonnet-20241022',
      originalRequest: testCases.claudeRequest,
      translatedRequest: {},
      rawResponse: testCases.openaiNonStreamResponse
    })

    console.log('✅ Translation successful')
    console.log('Response ID:', translated.id)
    console.log('Content length:', translated.content[0].text.length)
    console.log('Stop reason:', translated.stop_reason)
    console.log('Usage:', JSON.stringify(translated.usage))
    console.log()
  } catch (error) {
    console.error('❌ Translation failed:', error.message)
    console.log()
  }
}

/**
 * 测试统计信息
 */
function testStatistics() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('📊 Translation Statistics')
  console.log('═══════════════════════════════════════════════════════════\n')

  const stats = registry.getRuntimeStats()
  console.log('Registered Translators:')
  console.log('  - Request Translators:', stats.registered.requestTranslators)
  console.log('  - Response Translators:', stats.registered.responseTranslators)
  console.log()

  console.log('Runtime Statistics:')
  console.log('  - Request Translations:', stats.runtime.requestTranslations)
  console.log('  - Stream Translations:', stats.runtime.streamTranslations)
  console.log('  - NonStream Translations:', stats.runtime.nonStreamTranslations)
  console.log('  - Total Translations:', stats.runtime.totalTranslations)
  console.log('  - Errors:', stats.runtime.errors)
  console.log()

  const paths = registry.getRegisteredPaths()
  console.log('Available Translation Paths:')
  console.log('  Request Paths:', paths.request.join(', '))
  console.log('  Response Paths:', paths.response.join(', '))
  console.log()
}

/**
 * 主测试函数
 */
async function runTests() {
  try {
    // 打印注册表统计
    console.log('Initial Registry State:\n')
    registry.printStats()
    console.log()

    // 运行测试
    testRequestTranslation()
    testResponseTranslation()
    testStatistics()

    console.log('╔════════════════════════════════════════════════════════════════╗')
    console.log('║              ✅ All tests completed successfully!              ║')
    console.log('╚════════════════════════════════════════════════════════════════╝\n')
  } catch (error) {
    console.error('\n❌ Test suite failed:', error)
    process.exit(1)
  }
}

// 运行测试
runTests()
