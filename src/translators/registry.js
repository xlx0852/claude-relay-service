const logger = require('../utils/logger')
const { TranslationError } = require('./types')

/**
 * 翻译器注册表类
 * 负责管理所有格式之间的请求和响应翻译器
 *
 * 架构说明：
 * - 请求翻译器：从客户端格式 → 服务端格式
 * - 响应翻译器：从服务端格式 → 客户端格式
 *
 * 存储结构：
 * requestTranslators: Map<fromFormat, Map<toFormat, translatorFunction>>
 * responseTranslators: Map<clientFormat, Map<serverFormat, { stream, nonStream }>>
 */
class TranslatorRegistry {
  constructor() {
    // 请求翻译器：{ fromFormat: { toFormat: translatorFunction } }
    this.requestTranslators = new Map()

    // 响应翻译器：{ clientFormat: { serverFormat: { stream, nonStream } } }
    this.responseTranslators = new Map()

    // 统计信息
    this.stats = {
      requestTranslators: 0,
      responseTranslators: 0,
      requestTranslations: 0,
      streamTranslations: 0,
      nonStreamTranslations: 0,
      errors: 0
    }
  }

  /**
   * 注册翻译器
   * @param {string} fromFormat - 源格式
   * @param {string} toFormat - 目标格式
   * @param {RequestTranslator} requestTranslator - 请求翻译器函数
   * @param {ResponseTranslators} responseTranslators - 响应翻译器对象
   */
  register(fromFormat, toFormat, requestTranslator, responseTranslators = {}) {
    if (!fromFormat || !toFormat) {
      throw new Error('fromFormat and toFormat are required')
    }

    // 注册请求翻译器
    if (requestTranslator && typeof requestTranslator === 'function') {
      if (!this.requestTranslators.has(fromFormat)) {
        this.requestTranslators.set(fromFormat, new Map())
      }
      this.requestTranslators.get(fromFormat).set(toFormat, requestTranslator)
      this.stats.requestTranslators++

      logger.debug(`✅ Registered request translator: ${fromFormat} → ${toFormat}`)
    }

    // 注册响应翻译器
    if (responseTranslators.stream || responseTranslators.nonStream) {
      // 响应翻译的方向是反向的：从目标格式（服务端）回到源格式（客户端）
      if (!this.responseTranslators.has(fromFormat)) {
        this.responseTranslators.set(fromFormat, new Map())
      }
      this.responseTranslators.get(fromFormat).set(toFormat, responseTranslators)
      this.stats.responseTranslators++

      logger.debug(
        `✅ Registered response translator: ${toFormat} → ${fromFormat} (stream: ${!!responseTranslators.stream}, nonStream: ${!!responseTranslators.nonStream})`
      )
    }
  }

  /**
   * 翻译请求
   * @param {string} fromFormat - 源格式（客户端格式）
   * @param {string} toFormat - 目标格式（服务端格式）
   * @param {TranslateRequestOptions} options - 翻译选项
   * @returns {Object} 翻译后的请求
   */
  translateRequest(fromFormat, toFormat, options) {
    // 如果源格式和目标格式相同，直接返回原始请求
    if (fromFormat === toFormat) {
      logger.debug(`⏩ Skipping translation: same format (${fromFormat})`)
      return options.rawRequest
    }

    const translators = this.requestTranslators.get(fromFormat)
    if (!translators) {
      logger.warn(`⚠️ No request translators registered for source format: ${fromFormat}`)
      return options.rawRequest
    }

    const translator = translators.get(toFormat)
    if (!translator) {
      logger.warn(
        `⚠️ No request translator found: ${fromFormat} → ${toFormat}, using original request`
      )
      return options.rawRequest
    }

    try {
      const startTime = Date.now()
      const translated = translator(options)
      const duration = Date.now() - startTime

      this.stats.requestTranslations++
      logger.debug(`🔄 Translated request: ${fromFormat} → ${toFormat} (${duration}ms)`)

      return translated
    } catch (error) {
      this.stats.errors++
      logger.error(`❌ Request translation failed: ${fromFormat} → ${toFormat}`, {
        error: error.message,
        stack: error.stack
      })

      throw new TranslationError(
        `Failed to translate request from ${fromFormat} to ${toFormat}: ${error.message}`,
        fromFormat,
        toFormat,
        error
      )
    }
  }

  /**
   * 检查是否存在响应翻译器
   * @param {string} clientFormat - 客户端格式
   * @param {string} serverFormat - 服务端格式
   * @returns {boolean}
   */
  hasResponseTranslator(clientFormat, serverFormat) {
    const translators = this.responseTranslators.get(clientFormat)
    if (!translators) {
      return false
    }
    return translators.has(serverFormat)
  }

  /**
   * 翻译流式响应
   * @param {string} clientFormat - 客户端格式
   * @param {string} serverFormat - 服务端格式
   * @param {TranslateResponseOptions} options - 翻译选项
   * @returns {string[]} SSE格式的响应数组
   */
  translateStreamResponse(clientFormat, serverFormat, options) {
    // 格式相同，直接返回
    if (clientFormat === serverFormat) {
      const rawStr =
        typeof options.rawResponse === 'string'
          ? options.rawResponse
          : JSON.stringify(options.rawResponse)
      return [rawStr]
    }

    const translators = this.responseTranslators.get(clientFormat)
    if (!translators) {
      logger.warn(
        `⚠️ No response translators registered for client format: ${clientFormat}, returning raw response`
      )
      const rawStr =
        typeof options.rawResponse === 'string'
          ? options.rawResponse
          : JSON.stringify(options.rawResponse)
      return [rawStr]
    }

    const translator = translators.get(serverFormat)
    if (!translator || !translator.stream) {
      logger.warn(
        `⚠️ No stream response translator: ${serverFormat} → ${clientFormat}, returning raw response`
      )
      const rawStr =
        typeof options.rawResponse === 'string'
          ? options.rawResponse
          : JSON.stringify(options.rawResponse)
      return [rawStr]
    }

    try {
      const startTime = Date.now()
      const translated = translator.stream(options)
      const duration = Date.now() - startTime

      this.stats.streamTranslations++
      logger.debug(`🔄 Translated stream chunk: ${serverFormat} → ${clientFormat} (${duration}ms)`)

      return Array.isArray(translated) ? translated : [translated]
    } catch (error) {
      this.stats.errors++
      logger.error(`❌ Stream response translation failed: ${serverFormat} → ${clientFormat}`, {
        error: error.message,
        stack: error.stack
      })

      // 发生错误时返回原始响应
      const rawStr =
        typeof options.rawResponse === 'string'
          ? options.rawResponse
          : JSON.stringify(options.rawResponse)
      return [rawStr]
    }
  }

  /**
   * 翻译非流式响应
   * @param {string} clientFormat - 客户端格式
   * @param {string} serverFormat - 服务端格式
   * @param {TranslateResponseOptions} options - 翻译选项
   * @returns {Object} 翻译后的响应
   */
  translateNonStreamResponse(clientFormat, serverFormat, options) {
    // 格式相同，直接返回
    if (clientFormat === serverFormat) {
      logger.debug(`⏩ Skipping response translation: same format (${clientFormat})`)
      return options.rawResponse
    }

    const translators = this.responseTranslators.get(clientFormat)
    if (!translators) {
      logger.warn(
        `⚠️ No response translators registered for client format: ${clientFormat}, returning raw response`
      )
      return options.rawResponse
    }

    const translator = translators.get(serverFormat)
    if (!translator || !translator.nonStream) {
      logger.warn(
        `⚠️ No non-stream response translator: ${serverFormat} → ${clientFormat}, returning raw response`
      )
      return options.rawResponse
    }

    try {
      const startTime = Date.now()
      const translated = translator.nonStream(options)
      const duration = Date.now() - startTime

      this.stats.nonStreamTranslations++
      logger.debug(
        `🔄 Translated non-stream response: ${serverFormat} → ${clientFormat} (${duration}ms)`
      )

      return translated
    } catch (error) {
      this.stats.errors++
      logger.error(`❌ Non-stream response translation failed: ${serverFormat} → ${clientFormat}`, {
        error: error.message,
        stack: error.stack
      })

      throw new TranslationError(
        `Failed to translate response from ${serverFormat} to ${clientFormat}: ${error.message}`,
        serverFormat,
        clientFormat,
        error
      )
    }
  }

  /**
   * 获取所有已注册的翻译路径
   * @returns {Object} 翻译路径信息
   */
  getRegisteredPaths() {
    const paths = {
      request: [],
      response: []
    }

    // 请求翻译器路径
    for (const [from, toMap] of this.requestTranslators) {
      for (const to of toMap.keys()) {
        paths.request.push(`${from} → ${to}`)
      }
    }

    // 响应翻译器路径
    for (const [client, serverMap] of this.responseTranslators) {
      for (const server of serverMap.keys()) {
        paths.response.push(`${server} → ${client}`)
      }
    }

    return paths
  }

  /**
   * 打印注册统计信息
   */
  printStats() {
    const paths = this.getRegisteredPaths()

    logger.info('╔════════════════════════════════════════════════════════════════╗')
    logger.info('║          📊 Translator Registry Statistics                    ║')
    logger.info('╠════════════════════════════════════════════════════════════════╣')
    logger.info(
      `║  Request Translators:      ${String(this.stats.requestTranslators).padStart(4)} registered          ║`
    )
    logger.info(
      `║  Response Translators:     ${String(this.stats.responseTranslators).padStart(4)} registered          ║`
    )
    logger.info('╠════════════════════════════════════════════════════════════════╣')
    logger.info(
      `║  Request Paths (${paths.request.length}):                                         ║`
    )
    paths.request.forEach((path) => {
      logger.info(`║    • ${path.padEnd(54)} ║`)
    })
    logger.info('╠════════════════════════════════════════════════════════════════╣')
    logger.info(
      `║  Response Paths (${paths.response.length}):                                        ║`
    )
    paths.response.forEach((path) => {
      logger.info(`║    • ${path.padEnd(54)} ║`)
    })
    logger.info('╚════════════════════════════════════════════════════════════════╝')
  }

  /**
   * 重置统计计数器
   */
  resetStats() {
    this.stats.requestTranslations = 0
    this.stats.streamTranslations = 0
    this.stats.nonStreamTranslations = 0
    this.stats.errors = 0
    logger.info('📊 Translation statistics reset')
  }

  /**
   * 获取运行时统计信息
   * @returns {Object} 统计信息
   */
  getRuntimeStats() {
    return {
      registered: {
        requestTranslators: this.stats.requestTranslators,
        responseTranslators: this.stats.responseTranslators
      },
      runtime: {
        requestTranslations: this.stats.requestTranslations,
        streamTranslations: this.stats.streamTranslations,
        nonStreamTranslations: this.stats.nonStreamTranslations,
        totalTranslations:
          this.stats.requestTranslations +
          this.stats.streamTranslations +
          this.stats.nonStreamTranslations,
        errors: this.stats.errors
      }
    }
  }
}

// 单例模式 - 全局共享一个注册表实例
const registry = new TranslatorRegistry()

module.exports = registry
