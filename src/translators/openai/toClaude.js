const logger = require('../../utils/logger')

/**
 * 将 OpenAI 格式的请求转换为 Claude 格式
 * 
 * OpenAI格式示例：
 * {
 *   model: "gpt-4",
 *   messages: [
 *     { role: "system", content: "You are a helpful assistant" },
 *     { role: "user", content: "Hello" }
 *   ],
 *   temperature: 0.7,
 *   max_tokens: 1000
 * }
 * 
 * Claude格式示例：
 * {
 *   model: "claude-3-5-sonnet-20241022",
 *   system: "You are a helpful assistant",
 *   messages: [
 *     { role: "user", content: [{ type: "text", text: "Hello" }] }
 *   ],
 *   temperature: 0.7,
 *   max_tokens: 1000
 * }
 * 
 * @param {TranslateRequestOptions} options
 * @returns {Object} Claude格式的请求
 */
function translateOpenAIRequestToClaude({ model, rawRequest, stream, metadata }) {
  const claudeRequest = {
    model: model || rawRequest.model || 'claude-3-5-sonnet-20241022',
    max_tokens: rawRequest.max_tokens || 4096,
    stream: stream !== undefined ? stream : !!rawRequest.stream
  }

  // 转换 messages
  const messages = []
  let systemPrompt = null

  for (const message of rawRequest.messages || []) {
    if (message.role === 'system') {
      // Claude 使用单独的 system 字段
      systemPrompt = systemPrompt ? `${systemPrompt}\n\n${message.content}` : message.content
    } else if (message.role === 'user' || message.role === 'assistant') {
      // 转换为 Claude 的 content 格式
      const content = []

      if (typeof message.content === 'string') {
        content.push({ type: 'text', text: message.content })
      } else if (Array.isArray(message.content)) {
        for (const part of message.content) {
          if (part.type === 'text') {
            content.push({ type: 'text', text: part.text })
          } else if (part.type === 'image_url') {
            // 转换图片格式
            const imageUrl = part.image_url?.url || part.image_url
            if (imageUrl.startsWith('data:')) {
              // base64格式
              const match = imageUrl.match(/^data:image\/(\w+);base64,(.+)$/)
              if (match) {
                content.push({
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: `image/${match[1]}`,
                    data: match[2]
                  }
                })
              }
            } else {
              // URL格式
              content.push({
                type: 'image',
                source: {
                  type: 'url',
                  url: imageUrl
                }
              })
            }
          }
        }
      }

      messages.push({
        role: message.role,
        content
      })
    }
  }

  claudeRequest.messages = messages

  if (systemPrompt) {
    claudeRequest.system = systemPrompt
  }

  // 转换 tools (function calling)
  if (rawRequest.tools && rawRequest.tools.length > 0) {
    claudeRequest.tools = rawRequest.tools.map((tool) => {
      if (tool.type === 'function') {
        return {
          name: tool.function.name,
          description: tool.function.description || '',
          input_schema: tool.function.parameters || { type: 'object', properties: {} }
        }
      }
      return tool
    })
  }

  // 转换其他参数
  if (rawRequest.temperature !== undefined) {
    claudeRequest.temperature = rawRequest.temperature
  }
  if (rawRequest.top_p !== undefined) {
    claudeRequest.top_p = rawRequest.top_p
  }
  if (rawRequest.stop) {
    claudeRequest.stop_sequences = Array.isArray(rawRequest.stop)
      ? rawRequest.stop
      : [rawRequest.stop]
  }

  logger.debug('🔄 Translated OpenAI request to Claude format', {
    originalModel: rawRequest.model,
    claudeModel: claudeRequest.model,
    messageCount: messages.length,
    hasSystem: !!systemPrompt,
    hasTools: !!claudeRequest.tools
  })

  return claudeRequest
}

/**
 * 将 Claude 流式响应转换为 OpenAI 格式
 * 
 * Claude SSE 事件类型：
 * - message_start: 消息开始
 * - content_block_start: 内容块开始
 * - content_block_delta: 内容增量（包含text）
 * - content_block_stop: 内容块结束
 * - message_delta: 消息元数据更新
 * - message_stop: 消息结束
 * 
 * OpenAI SSE格式：
 * data: {"id":"chatcmpl-xxx","choices":[{"index":0,"delta":{"content":"text"},"finish_reason":null}]}
 * 
 * @param {TranslateResponseOptions} options
 * @returns {string[]} SSE格式的响应数组
 */
function translateClaudeStreamResponseToOpenAI({ model, originalRequest, rawResponse, metadata }) {
  try {
    const lines = []

    // 解析 Claude 响应
    let claudeData
    if (typeof rawResponse === 'string') {
      // 处理 SSE 格式: "event: xxx\ndata: {...}\n\n"
      const eventMatch = rawResponse.match(/event:\s*(\w+)/)
      const dataMatch = rawResponse.match(/data:\s*({.+})/)

      if (dataMatch) {
        claudeData = JSON.parse(dataMatch[1])
        if (eventMatch) {
          claudeData._event = eventMatch[1]
        }
      } else {
        return []
      }
    } else {
      claudeData = rawResponse
    }

    // 生成 OpenAI chunk
    const openaiChunk = {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: model || originalRequest.model || 'gpt-4',
      choices: []
    }

    // 根据不同的 Claude 事件类型转换
    const eventType = claudeData._event || claudeData.type

    if (eventType === 'message_start') {
      // 消息开始 - 发送 role
      openaiChunk.choices.push({
        index: 0,
        delta: { role: 'assistant' },
        finish_reason: null
      })
    } else if (eventType === 'content_block_delta') {
      // 内容增量 - 发送文本
      const text = claudeData.delta?.text || ''
      if (text) {
        openaiChunk.choices.push({
          index: 0,
          delta: { content: text },
          finish_reason: null
        })
      }
    } else if (eventType === 'message_delta') {
      // 消息结束 - 发送 finish_reason
      const stopReason = claudeData.delta?.stop_reason
      if (stopReason) {
        openaiChunk.choices.push({
          index: 0,
          delta: {},
          finish_reason: stopReason === 'end_turn' ? 'stop' : stopReason
        })
      }
    } else if (eventType === 'message_stop') {
      // 最终结束标记
      lines.push('data: [DONE]\n\n')
      return lines
    }

    // 只有当有 choices 时才发送
    if (openaiChunk.choices.length > 0) {
      lines.push(`data: ${JSON.stringify(openaiChunk)}\n\n`)
    }

    return lines
  } catch (error) {
    logger.error('❌ Failed to translate Claude stream response to OpenAI', {
      error: error.message,
      rawResponse: typeof rawResponse === 'string' ? rawResponse.substring(0, 200) : 'object'
    })
    return []
  }
}

/**
 * 将 Claude 非流式响应转换为 OpenAI 格式
 * 
 * Claude 响应格式：
 * {
 *   id: "msg_xxx",
 *   type: "message",
 *   role: "assistant",
 *   content: [{ type: "text", text: "response text" }],
 *   stop_reason: "end_turn",
 *   usage: { input_tokens: 10, output_tokens: 20 }
 * }
 * 
 * OpenAI 响应格式：
 * {
 *   id: "chatcmpl-xxx",
 *   choices: [{
 *     index: 0,
 *     message: { role: "assistant", content: "response text" },
 *     finish_reason: "stop"
 *   }],
 *   usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
 * }
 * 
 * @param {TranslateResponseOptions} options
 * @returns {Object} OpenAI格式的响应
 */
function translateClaudeNonStreamResponseToOpenAI({
  model,
  originalRequest,
  rawResponse,
  metadata
}) {
  try {
    const claudeData = typeof rawResponse === 'string' ? JSON.parse(rawResponse) : rawResponse

    const openaiResponse = {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: model || originalRequest.model || 'gpt-4',
      choices: [],
      usage: {
        prompt_tokens: claudeData.usage?.input_tokens || 0,
        completion_tokens: claudeData.usage?.output_tokens || 0,
        total_tokens:
          (claudeData.usage?.input_tokens || 0) + (claudeData.usage?.output_tokens || 0)
      }
    }

    // 提取内容
    let content = ''
    const toolCalls = []

    if (claudeData.content && Array.isArray(claudeData.content)) {
      for (const block of claudeData.content) {
        if (block.type === 'text') {
          content += block.text
        } else if (block.type === 'tool_use') {
          // 转换 tool_use 为 OpenAI 的 tool_calls 格式
          toolCalls.push({
            id: block.id || `call_${Date.now()}`,
            type: 'function',
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input || {})
            }
          })
        }
      }
    }

    const message = {
      role: 'assistant',
      content: content || null
    }

    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls
    }

    openaiResponse.choices.push({
      index: 0,
      message,
      finish_reason: claudeData.stop_reason === 'end_turn' ? 'stop' : claudeData.stop_reason || 'stop'
    })

    logger.debug('🔄 Translated Claude non-stream response to OpenAI format', {
      contentLength: content.length,
      toolCallsCount: toolCalls.length,
      usage: openaiResponse.usage
    })

    return openaiResponse
  } catch (error) {
    logger.error('❌ Failed to translate Claude response to OpenAI', {
      error: error.message,
      stack: error.stack
    })
    throw error
  }
}

module.exports = {
  translateOpenAIRequestToClaude,
  translateClaudeStreamResponseToOpenAI,
  translateClaudeNonStreamResponseToOpenAI
}
