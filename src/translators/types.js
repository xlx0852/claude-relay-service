/**
 * 翻译器类型定义文件
 * 使用 JSDoc 提供完整的类型提示
 */

/**
 * 请求翻译选项
 * @typedef {Object} TranslateRequestOptions
 * @property {string} model - 模型名称
 * @property {Object} rawRequest - 原始请求对象
 * @property {boolean} [stream] - 是否流式响应
 * @property {Object} [metadata] - 额外的元数据信息
 * @property {string} [metadata.apiKeyName] - API Key名称
 * @property {string} [metadata.accountId] - 账户ID
 * @property {Object} [metadata.headers] - 原始请求头
 */

/**
 * 响应翻译选项
 * @typedef {Object} TranslateResponseOptions
 * @property {string} model - 模型名称
 * @property {Object} originalRequest - 客户端原始请求对象
 * @property {Object} translatedRequest - 翻译后发送给服务端的请求对象
 * @property {Object|string|Buffer} rawResponse - 服务端原始响应
 * @property {Object} [metadata] - 额外的元数据信息
 * @property {boolean} [isChunk] - 是否为流式响应的chunk
 */

/**
 * 请求翻译器函数类型
 * 将源格式的请求转换为目标格式
 * 
 * @callback RequestTranslator
 * @param {TranslateRequestOptions} options - 翻译选项
 * @returns {Object} 翻译后的请求对象
 * 
 * @example
 * // OpenAI → Claude
 * function translateOpenAIToClaude({ model, rawRequest, stream }) {
 *   return {
 *     model: model,
 *     messages: convertMessages(rawRequest.messages),
 *     max_tokens: rawRequest.max_tokens || 4096,
 *     stream: stream
 *   }
 * }
 */

/**
 * 流式响应翻译器函数类型
 * 将服务端的流式响应chunk转换为客户端格式
 * 
 * @callback StreamResponseTranslator
 * @param {TranslateResponseOptions} options - 翻译选项
 * @returns {string[]} SSE格式的响应数组，每个元素是一个完整的SSE事件
 * 
 * @example
 * // Claude stream → OpenAI stream
 * function translateClaudeStreamToOpenAI({ rawResponse }) {
 *   const data = JSON.parse(rawResponse)
 *   return [`data: ${JSON.stringify({ choices: [{ delta: { content: data.delta.text } }] })}\n\n`]
 * }
 */

/**
 * 非流式响应翻译器函数类型
 * 将服务端的完整响应转换为客户端格式
 * 
 * @callback NonStreamResponseTranslator
 * @param {TranslateResponseOptions} options - 翻译选项
 * @returns {Object} 翻译后的响应对象
 * 
 * @example
 * // Claude response → OpenAI response
 * function translateClaudeToOpenAI({ rawResponse }) {
 *   return {
 *     id: 'chatcmpl-xxx',
 *     choices: [{
 *       message: { role: 'assistant', content: rawResponse.content[0].text },
 *       finish_reason: 'stop'
 *     }]
 *   }
 * }
 */

/**
 * 响应翻译器集合
 * @typedef {Object} ResponseTranslators
 * @property {StreamResponseTranslator} [stream] - 流式响应翻译器
 * @property {NonStreamResponseTranslator} [nonStream] - 非流式响应翻译器
 */

/**
 * 翻译错误类
 */
class TranslationError extends Error {
  /**
   * @param {string} message - 错误消息
   * @param {string} fromFormat - 源格式
   * @param {string} toFormat - 目标格式
   * @param {Error} [originalError] - 原始错误
   */
  constructor(message, fromFormat, toFormat, originalError) {
    super(message)
    this.name = 'TranslationError'
    this.fromFormat = fromFormat
    this.toFormat = toFormat
    this.originalError = originalError
  }
}

/**
 * 翻译统计信息
 * @typedef {Object} TranslationStats
 * @property {number} totalRequests - 总请求翻译数
 * @property {number} totalResponses - 总响应翻译数
 * @property {number} errors - 错误次数
 * @property {Object.<string, number>} byPath - 按路径统计 { 'claude->openai': 123 }
 */

module.exports = {
  TranslationError
}
