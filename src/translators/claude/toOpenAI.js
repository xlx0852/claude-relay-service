const logger = require('../../utils/logger')

/**
 * 将 Claude 格式的请求转换为 OpenAI 格式
 * @param {TranslateRequestOptions} options
 * @returns {Object} OpenAI格式的请求
 */
function translateClaudeRequestToOpenAI({ model, rawRequest, stream, metadata }) {
  const openaiRequest = {
    model: model || rawRequest.model || 'gpt-4',
    messages: [],
    stream: stream !== undefined ? stream : !!rawRequest.stream
  }

  // 转换 system prompt
  if (rawRequest.system) {
    openaiRequest.messages.push({
      role: 'system',
      content: rawRequest.system
    })
  }

  // 转换 messages
  for (const message of rawRequest.messages || []) {
    const openaiMessage = {
      role: message.role === 'model' ? 'assistant' : message.role
    }

    // 转换 content
    if (Array.isArray(message.content)) {
      const contentParts = []
      for (const block of message.content) {
        if (block.type === 'text') {
          contentParts.push({ type: 'text', text: block.text })
        } else if (block.type === 'image') {
          // 转换图片格式
          if (block.source.type === 'base64') {
            contentParts.push({
              type: 'image_url',
              image_url: {
                url: `data:${block.source.media_type};base64,${block.source.data}`
              }
            })
          } else if (block.source.type === 'url') {
            contentParts.push({
              type: 'image_url',
              image_url: { url: block.source.url }
            })
          }
        } else if (block.type === 'tool_use') {
          // Claude 的 tool_use 暂时转为文本描述
          contentParts.push({
            type: 'text',
            text: `[Tool Use: ${block.name}(${JSON.stringify(block.input)})]`
          })
        }
      }
      openaiMessage.content = contentParts.length === 1 ? contentParts[0].text : contentParts
    } else if (typeof message.content === 'string') {
      openaiMessage.content = message.content
    }

    openaiRequest.messages.push(openaiMessage)
  }

  // 转换其他参数
  if (rawRequest.max_tokens) {
    openaiRequest.max_tokens = rawRequest.max_tokens
  }
  if (rawRequest.temperature !== undefined) {
    openaiRequest.temperature = rawRequest.temperature
  }
  if (rawRequest.top_p !== undefined) {
    openaiRequest.top_p = rawRequest.top_p
  }
  if (rawRequest.stop_sequences) {
    openaiRequest.stop = rawRequest.stop_sequences
  }

  // 转换 tools
  if (rawRequest.tools && rawRequest.tools.length > 0) {
    openaiRequest.tools = rawRequest.tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description || '',
        parameters: tool.input_schema || {}
      }
    }))
  }

  return openaiRequest
}

/**
 * 将 OpenAI 流式响应转换为 Claude 格式
 * @param {TranslateResponseOptions} options
 * @returns {string[]} SSE格式的响应数组
 */
function translateOpenAIStreamResponseToClaude({ model, originalRequest, rawResponse, metadata }) {
  try {
    const lines = []

    // 解析 OpenAI 响应
    let openaiData
    if (typeof rawResponse === 'string') {
      const dataMatch = rawResponse.match(/data:\s*({.+})/)
      if (dataMatch) {
        openaiData = JSON.parse(dataMatch[1])
      } else if (rawResponse.includes('[DONE]')) {
        lines.push('event: message_stop\n')
        lines.push('data: {"type":"message_stop"}\n\n')
        return lines
      } else {
        return []
      }
    } else {
      openaiData = rawResponse
    }

    const choice = openaiData.choices?.[0]
    if (!choice) {
      return []
    }

    // 转换为 Claude SSE 格式
    if (choice.delta?.role) {
      // 消息开始
      lines.push('event: message_start\n')
      lines.push('data: {"type":"message_start","message":{"role":"assistant"}}\n\n')
    }

    if (choice.delta?.content) {
      // 内容增量
      lines.push('event: content_block_delta\n')
      lines.push(
        `data: ${JSON.stringify({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: choice.delta.content }
        })}\n\n`
      )
    }

    if (choice.finish_reason) {
      // 消息结束
      lines.push('event: message_delta\n')
      lines.push(
        `data: ${JSON.stringify({
          type: 'message_delta',
          delta: { stop_reason: choice.finish_reason === 'stop' ? 'end_turn' : choice.finish_reason }
        })}\n\n`
      )

      lines.push('event: message_stop\n')
      lines.push('data: {"type":"message_stop"}\n\n')
    }

    return lines
  } catch (error) {
    logger.error('❌ Failed to translate OpenAI stream response to Claude', { error: error.message })
    return []
  }
}

/**
 * 将 OpenAI 非流式响应转换为 Claude 格式
 * @param {TranslateResponseOptions} options
 * @returns {Object} Claude格式的响应
 */
function translateOpenAINonStreamResponseToClaude({
  model,
  originalRequest,
  rawResponse,
  metadata
}) {
  try {
    const openaiData = typeof rawResponse === 'string' ? JSON.parse(rawResponse) : rawResponse

    const choice = openaiData.choices?.[0]
    if (!choice) {
      throw new Error('No response from OpenAI')
    }

    const content = []
    const messageContent = choice.message?.content || ''

    if (messageContent) {
      content.push({ type: 'text', text: messageContent })
    }

    // 处理 tool_calls
    if (choice.message?.tool_calls && choice.message.tool_calls.length > 0) {
      for (const toolCall of choice.message.tool_calls) {
        content.push({
          type: 'tool_use',
          id: toolCall.id || `toolu_${Date.now()}`,
          name: toolCall.function.name,
          input: JSON.parse(toolCall.function.arguments || '{}')
        })
      }
    }

    return {
      id: `msg_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      content,
      model: model || originalRequest.model,
      stop_reason: choice.finish_reason === 'stop' ? 'end_turn' : choice.finish_reason || 'end_turn',
      usage: {
        input_tokens: openaiData.usage?.prompt_tokens || 0,
        output_tokens: openaiData.usage?.completion_tokens || 0
      }
    }
  } catch (error) {
    logger.error('❌ Failed to translate OpenAI response to Claude', {
      error: error.message,
      stack: error.stack
    })
    throw error
  }
}

module.exports = {
  translateClaudeRequestToOpenAI,
  translateOpenAIStreamResponseToClaude,
  translateOpenAINonStreamResponseToClaude
}
