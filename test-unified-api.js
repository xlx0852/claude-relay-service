#!/usr/bin/env node
/**
 * 统一API测试脚本
 * 测试不同格式的客户端请求都能被正确处理
 */

const axios = require('axios')

// 配置
const BASE_URL = 'http://localhost:3000'
const API_KEY = 'your-test-api-key' // 需要替换为实际的API Key

// 测试用例
const testCases = [
  {
    name: 'OpenAI Format Request',
    format: 'openai-chat',
    request: {
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Say "Hello from OpenAI format!"' }
      ],
      max_tokens: 50,
      temperature: 0.7
    }
  },
  {
    name: 'Claude Format Request',
    format: 'claude',
    request: {
      model: 'claude-3-5-sonnet-20241022',
      system: 'You are a helpful assistant.',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Say "Hello from Claude format!"' }]
        }
      ],
      max_tokens: 50,
      temperature: 0.7
    }
  },
  {
    name: 'Gemini Format Request',
    format: 'gemini',
    request: {
      model: 'gemini-2.0-flash-exp',
      systemInstruction: {
        role: 'user',
        parts: [{ text: 'You are a helpful assistant.' }]
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Say "Hello from Gemini format!"' }]
        }
      ],
      generationConfig: {
        maxOutputTokens: 50,
        temperature: 0.7
      }
    }
  }
]

/**
 * 发送测试请求
 */
async function sendTestRequest(testCase) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`🧪 Testing: ${testCase.name}`)
  console.log(`${'='.repeat(60)}`)

  try {
    const response = await axios.post(`${BASE_URL}/v1/chat/completions`, testCase.request, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
        'X-Client-Format': testCase.format // 明确指定客户端格式
      },
      timeout: 30000
    })

    console.log('✅ Request successful')
    console.log('Status:', response.status)
    console.log('Detected Format:', response.headers['x-detected-format'] || 'N/A')
    console.log('Server Format:', response.headers['x-server-format'] || 'N/A')
    console.log('\nResponse preview:')
    
    if (response.data.choices) {
      // OpenAI format response
      console.log('Content:', response.data.choices[0]?.message?.content?.substring(0, 100))
      console.log('Usage:', response.data.usage)
    } else if (response.data.content) {
      // Claude format response
      console.log('Content:', response.data.content[0]?.text?.substring(0, 100))
      console.log('Usage:', response.data.usage)
    } else if (response.data.candidates) {
      // Gemini format response
      console.log('Content:', response.data.candidates[0]?.content?.parts[0]?.text?.substring(0, 100))
      console.log('Usage:', response.data.usageMetadata)
    }

    return true
  } catch (error) {
    console.error('❌ Request failed')
    
    if (error.response) {
      console.error('Status:', error.response.status)
      console.error('Error:', error.response.data)
    } else if (error.request) {
      console.error('No response received:', error.message)
    } else {
      console.error('Error:', error.message)
    }

    return false
  }
}

/**
 * 测试格式自动检测
 */
async function testAutoDetection() {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`🔍 Testing Auto Format Detection`)
  console.log(`${'='.repeat(60)}`)

  const request = {
    model: 'gpt-4',
    messages: [
      { role: 'user', content: 'Test auto-detection' }
    ],
    max_tokens: 20
  }

  try {
    // 不指定 X-Client-Format header，让系统自动检测
    const response = await axios.post(`${BASE_URL}/v1/chat/completions`, request, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
        'User-Agent': 'OpenAI-Python/1.0.0' // 模拟OpenAI SDK
      },
      timeout: 30000
    })

    console.log('✅ Auto-detection successful')
    console.log('Detected from User-Agent:', response.headers['x-detected-format'] || 'openai-chat')
    return true
  } catch (error) {
    console.error('❌ Auto-detection failed:', error.message)
    return false
  }
}

/**
 * 测试流式响应
 */
async function testStreamingResponse() {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`🌊 Testing Streaming Response`)
  console.log(`${'='.repeat(60)}`)

  const request = {
    model: 'gpt-4',
    messages: [
      { role: 'user', content: 'Count from 1 to 5' }
    ],
    max_tokens: 100,
    stream: true
  }

  try {
    const response = await axios.post(`${BASE_URL}/v1/chat/completions`, request, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
        'X-Client-Format': 'openai-chat'
      },
      responseType: 'stream',
      timeout: 30000
    })

    console.log('✅ Stream started')
    console.log('Receiving chunks...')

    let chunkCount = 0
    response.data.on('data', (chunk) => {
      chunkCount++
      const lines = chunk.toString().split('\n').filter(line => line.trim())
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.substring(6)
          if (data === '[DONE]') {
            console.log('Stream completed')
          } else {
            try {
              const parsed = JSON.parse(data)
              const content = parsed.choices?.[0]?.delta?.content
              if (content) {
                process.stdout.write(content)
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      }
    })

    return new Promise((resolve) => {
      response.data.on('end', () => {
        console.log(`\n✅ Stream ended (${chunkCount} chunks received)`)
        resolve(true)
      })
      response.data.on('error', (error) => {
        console.error('❌ Stream error:', error.message)
        resolve(false)
      })
    })
  } catch (error) {
    console.error('❌ Streaming failed:', error.message)
    return false
  }
}

/**
 * 测试统计API
 */
async function testStatsAPI() {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`📊 Testing Statistics API`)
  console.log(`${'='.repeat(60)}`)

  try {
    const response = await axios.get(`${BASE_URL}/v1/chat/completions/stats`, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`
      }
    })

    console.log('✅ Stats retrieved')
    console.log(JSON.stringify(response.data.stats, null, 2))
    return true
  } catch (error) {
    console.error('❌ Stats retrieval failed:', error.message)
    return false
  }
}

/**
 * 主测试函数
 */
async function runTests() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗')
  console.log('║        🧪 Unified API Test Suite                              ║')
  console.log('╚════════════════════════════════════════════════════════════════╝')

  const results = {
    total: 0,
    passed: 0,
    failed: 0
  }

  // 测试不同格式的请求
  for (const testCase of testCases) {
    results.total++
    const success = await sendTestRequest(testCase)
    if (success) {
      results.passed++
    } else {
      results.failed++
    }
    await new Promise(resolve => setTimeout(resolve, 1000)) // 延迟1秒
  }

  // 测试自动检测
  results.total++
  if (await testAutoDetection()) {
    results.passed++
  } else {
    results.failed++
  }

  // 测试流式响应
  results.total++
  if (await testStreamingResponse()) {
    results.passed++
  } else {
    results.failed++
  }

  // 测试统计API
  results.total++
  if (await testStatsAPI()) {
    results.passed++
  } else {
    results.failed++
  }

  // 打印结果
  console.log('\n╔════════════════════════════════════════════════════════════════╗')
  console.log('║                    📊 Test Results                             ║')
  console.log('╠════════════════════════════════════════════════════════════════╣')
  console.log(`║  Total Tests:  ${String(results.total).padStart(4)}                                         ║`)
  console.log(`║  Passed:       ${String(results.passed).padStart(4)}  ✅                                    ║`)
  console.log(`║  Failed:       ${String(results.failed).padStart(4)}  ${results.failed > 0 ? '❌' : '  '}                                    ║`)
  console.log('╚════════════════════════════════════════════════════════════════╝\n')

  if (results.failed === 0) {
    console.log('🎉 All tests passed!\n')
    process.exit(0)
  } else {
    console.log('⚠️  Some tests failed.\n')
    console.log('💡 Tips:')
    console.log('  1. Make sure the server is running: npm run service:start')
    console.log('  2. Replace API_KEY with a valid key from your instance')
    console.log('  3. Ensure you have at least one active account configured\n')
    process.exit(1)
  }
}

// 运行测试
runTests().catch(error => {
  console.error('\n💥 Test suite crashed:', error)
  process.exit(1)
})
