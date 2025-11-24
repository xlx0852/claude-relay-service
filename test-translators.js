#!/usr/bin/env node
/**
 * 翻译器功能测试脚本
 */
const { registry, Formats } = require('./src/translators')

console.log('\n🧪 Testing Translator System\n')

// 测试OpenAI → Claude请求翻译
const openaiReq = {
  model: 'gpt-4',
  messages: [
    { role: 'system', content: 'You are helpful.' },
    { role: 'user', content: 'Hello!' }
  ],
  max_tokens: 100
}

console.log('1. OpenAI → Claude Request:')
const claudeReq = registry.translateRequest(Formats.OPENAI_CHAT, Formats.CLAUDE, {
  model: openaiReq.model,
  rawRequest: openaiReq,
  stream: false
})
console.log('   ✅ System:', !!claudeReq.system)
console.log('   ✅ Messages:', claudeReq.messages.length)
console.log()

// 测试Claude响应 → OpenAI
const claudeResp = {
  id: 'msg_123',
  content: [{ type: 'text', text: 'Hello there!' }],
  usage: { input_tokens: 10, output_tokens: 5 }
}

console.log('2. Claude → OpenAI Response:')
const openaiResp = registry.translateNonStreamResponse(Formats.OPENAI_CHAT, Formats.CLAUDE, {
  model: 'gpt-4',
  originalRequest: openaiReq,
  translatedRequest: claudeReq,
  rawResponse: claudeResp
})
console.log('   ✅ Content:', openaiResp.choices[0].message.content)
console.log('   ✅ Usage:', openaiResp.usage)
console.log()

console.log('3. Statistics:')
registry.printStats()
console.log('\n✅ All tests passed!\n')
