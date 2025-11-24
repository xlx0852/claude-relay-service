const { registry, Formats } = require('../translators')
const claudeRelayService = require('./claudeRelayService')
const geminiRelayService = require('./geminiRelayService')
const openaiResponsesRelayService = require('./openaiResponsesRelayService')
const unifiedClaudeScheduler = require('./unifiedClaudeScheduler')
const unifiedGeminiScheduler = require('./unifiedGeminiScheduler')
const unifiedOpenAIScheduler = require('./unifiedOpenAIScheduler')
const claudeAccountService = require('./claudeAccountService')
const geminiAccountService = require('./geminiAccountService')
const openaiAccountService = require('./openaiResponsesAccountService')
const logger = require('../utils/logger')

/**
 * 统一转发服务
 * 核心功能：
 * 1. 自动识别客户端格式
 * 2. 智能选择可用的服务提供商
 * 3. 自动翻译请求/响应格式
 * 4. 支持流式和非流式响应
 */
class UnifiedRelayService {
  constructor() {
    // 服务提供商优先级配置
    this.providerPriority = [
      { format: Formats.CLAUDE, name: 'Claude' },
      { format: Formats.GEMINI, name: 'Gemini' },
      { format: Formats.OPENAI_CHAT, name: 'OpenAI' }
    ]

    // 统计信息
    this.stats = {
      totalRequests: 0,
      byClientFormat: {},
      byServerFormat: {},
      translationCount: 0,
      errors: 0
    }
  }

  /**
   * 统一转发请求入口
   * @param {string} clientFormat - 客户端使用的格式 (openai-chat/claude/gemini)
   * @param {Object} requestBody - 原始请求体
   * @param {Object} apiKeyData - API Key数据
   * @param {Object} clientRequest - Express request对象
   * @param {Object} clientResponse - Express response对象
   * @param {Object} options - 额外选项
   * @returns {Promise<void>}
   */
  async relayRequest(
    clientFormat,
    requestBody,
    apiKeyData,
    clientRequest,
    clientResponse,
    _options = {}
  ) {
    const startTime = Date.now()
    this.stats.totalRequests++
    this.stats.byClientFormat[clientFormat] = (this.stats.byClientFormat[clientFormat] || 0) + 1

    try {
      logger.info(`🌐 Unified relay request started`, {
        clientFormat,
        apiKeyName: apiKeyData.name,
        model: requestBody.model,
        stream: !!requestBody.stream
      })

      // 1. 确定目标服务提供商
      const targetProvider = await this.selectTargetProvider(apiKeyData, requestBody.model)
      logger.info(`🎯 Selected target provider: ${targetProvider.name} (${targetProvider.format})`)

      this.stats.byServerFormat[targetProvider.format] =
        (this.stats.byServerFormat[targetProvider.format] || 0) + 1

      // 2. 翻译请求格式（如果需要）
      let translatedRequest = requestBody
      const needsTranslation = clientFormat !== targetProvider.format

      if (needsTranslation) {
        translatedRequest = registry.translateRequest(clientFormat, targetProvider.format, {
          model: requestBody.model,
          rawRequest: requestBody,
          stream: !!requestBody.stream,
          metadata: {
            apiKeyName: apiKeyData.name,
            clientFormat,
            serverFormat: targetProvider.format
          }
        })
        this.stats.translationCount++
        logger.debug(`🔄 Request translated: ${clientFormat} → ${targetProvider.format}`)
      }

      // 3. 调用目标服务
      const stream = requestBody.stream || false

      if (stream) {
        // 流式响应
        await this.handleStreamResponse(
          clientFormat,
          targetProvider,
          translatedRequest,
          requestBody,
          apiKeyData,
          clientRequest,
          clientResponse,
          needsTranslation
        )
      } else {
        // 非流式响应
        await this.handleNonStreamResponse(
          clientFormat,
          targetProvider,
          translatedRequest,
          requestBody,
          apiKeyData,
          clientRequest,
          clientResponse,
          needsTranslation
        )
      }

      const duration = Date.now() - startTime
      logger.info(`✅ Unified relay completed`, {
        clientFormat,
        serverFormat: targetProvider.format,
        translated: needsTranslation,
        duration: `${duration}ms`
      })
    } catch (error) {
      this.stats.errors++
      logger.error(`❌ Unified relay failed`, {
        clientFormat,
        error: error.message,
        stack: error.stack
      })
      throw error
    }
  }

  /**
   * 选择目标服务提供商
   * 根据可用账户、模型支持、负载等因素智能选择
   * @param {Object} apiKeyData - API Key数据
   * @param {string} model - 请求的模型名称
   * @returns {Promise<Object>} 目标提供商信息
   */
  async selectTargetProvider(apiKeyData, _model) {
    // 检查API Key是否有专属绑定
    if (apiKeyData.dedicatedAccounts && apiKeyData.dedicatedAccounts.length > 0) {
      const dedicatedAccount = apiKeyData.dedicatedAccounts[0]
      logger.info(`🔒 Using dedicated account: ${dedicatedAccount.accountId}`)

      // 根据专属账户类型确定提供商
      if (dedicatedAccount.type === 'claude') {
        return {
          format: Formats.CLAUDE,
          name: 'Claude (Dedicated)',
          scheduler: unifiedClaudeScheduler,
          accountService: claudeAccountService,
          relayService: claudeRelayService
        }
      }
      // 可以添加其他类型的专属账户
    }

    // 按优先级检查可用提供商
    for (const provider of this.providerPriority) {
      const isAvailable = await this.checkProviderAvailability(provider.format)

      if (isAvailable) {
        const providerInfo = this.getProviderInfo(provider.format)
        logger.debug(`✅ Provider ${provider.name} is available`)
        return providerInfo
      } else {
        logger.debug(`⏭️ Provider ${provider.name} not available, trying next...`)
      }
    }

    throw new Error('No available service provider found')
  }

  /**
   * 检查提供商是否可用
   * @param {string} format - 提供商格式
   * @returns {Promise<boolean>}
   */
  async checkProviderAvailability(format) {
    try {
      switch (format) {
        case Formats.CLAUDE: {
          const claudeAccounts = await claudeAccountService.getActiveAccounts()
          return claudeAccounts && claudeAccounts.length > 0
        }
        case Formats.GEMINI: {
          const geminiAccounts = await geminiAccountService.getActiveAccounts()
          return geminiAccounts && geminiAccounts.length > 0
        }
        case Formats.OPENAI_CHAT: {
          const openaiAccounts = await openaiAccountService.getActiveAccounts()
          return openaiAccounts && openaiAccounts.length > 0
        }
        default:
          return false
      }
    } catch (error) {
      logger.warn(`⚠️ Failed to check provider availability: ${format}`, { error: error.message })
      return false
    }
  }

  /**
   * 获取提供商信息
   * @param {string} format - 提供商格式
   * @returns {Object}
   */
  getProviderInfo(format) {
    const providers = {
      [Formats.CLAUDE]: {
        format: Formats.CLAUDE,
        name: 'Claude',
        scheduler: unifiedClaudeScheduler,
        accountService: claudeAccountService,
        relayService: claudeRelayService
      },
      [Formats.GEMINI]: {
        format: Formats.GEMINI,
        name: 'Gemini',
        scheduler: unifiedGeminiScheduler,
        accountService: geminiAccountService,
        relayService: geminiRelayService
      },
      [Formats.OPENAI_CHAT]: {
        format: Formats.OPENAI_CHAT,
        name: 'OpenAI',
        scheduler: unifiedOpenAIScheduler,
        accountService: openaiAccountService,
        relayService: openaiResponsesRelayService
      }
    }

    return providers[format] || null
  }

  /**
   * 处理流式响应
   * @param {string} clientFormat - 客户端格式
   * @param {Object} targetProvider - 目标提供商
   * @param {Object} translatedRequest - 翻译后的请求
   * @param {Object} originalRequest - 原始请求
   * @param {Object} apiKeyData - API Key数据
   * @param {Object} clientRequest - Express request
   * @param {Object} clientResponse - Express response
   * @param {boolean} needsTranslation - 是否需要响应翻译
   */
  async handleStreamResponse(
    clientFormat,
    targetProvider,
    translatedRequest,
    originalRequest,
    apiKeyData,
    clientRequest,
    clientResponse,
    needsTranslation
  ) {
    // 设置SSE响应头
    clientResponse.setHeader('Content-Type', 'text/event-stream')
    clientResponse.setHeader('Cache-Control', 'no-cache')
    clientResponse.setHeader('Connection', 'keep-alive')
    clientResponse.setHeader('X-Accel-Buffering', 'no')

    try {
      // 根据提供商类型调用对应的relay服务
      if (targetProvider.format === Formats.CLAUDE) {
        await this.handleClaudeStreamRelay(
          clientFormat,
          targetProvider,
          translatedRequest,
          originalRequest,
          apiKeyData,
          clientRequest,
          clientResponse,
          needsTranslation
        )
      } else if (targetProvider.format === Formats.GEMINI) {
        await this.handleGeminiStreamRelay(
          clientFormat,
          targetProvider,
          translatedRequest,
          originalRequest,
          apiKeyData,
          clientRequest,
          clientResponse,
          needsTranslation
        )
      } else {
        throw new Error(`Unsupported provider format for streaming: ${targetProvider.format}`)
      }
    } catch (error) {
      logger.error(`❌ Stream response handling failed`, { error: error.message })
      if (!clientResponse.headersSent) {
        clientResponse.status(500).json({
          error: {
            message: error.message,
            type: 'internal_error'
          }
        })
      }
      throw error
    }
  }

  /**
   * 处理Claude流式响应
   */
  async handleClaudeStreamRelay(
    clientFormat,
    targetProvider,
    translatedRequest,
    originalRequest,
    apiKeyData,
    clientRequest,
    clientResponse,
    needsTranslation
  ) {
    await claudeRelayService.relayRequest(
      translatedRequest,
      apiKeyData,
      clientRequest,
      clientResponse,
      {},
      { stream: true }
    )

    // Claude的relayRequest已经直接写入了response
    // 如果需要翻译，我们需要拦截并翻译响应
    if (needsTranslation && clientFormat !== Formats.CLAUDE) {
      logger.warn(`⚠️ Stream translation not yet fully implemented for Claude → ${clientFormat}`)
      // TODO: 实现流式响应的实时翻译
    }
  }

  /**
   * 处理Gemini流式响应
   */
  async handleGeminiStreamRelay(
    clientFormat,
    targetProvider,
    translatedRequest,
    originalRequest,
    apiKeyData,
    clientRequest,
    clientResponse,
    needsTranslation
  ) {
    // 获取Gemini流式响应
    const stream = await geminiRelayService.handleStreamResponse(
      translatedRequest,
      originalRequest.model || 'gemini-2.0-flash-exp',
      apiKeyData.id,
      null
    )

    // 逐chunk处理并翻译
    for await (const chunk of stream) {
      if (needsTranslation && clientFormat !== Formats.GEMINI) {
        // 翻译响应chunk
        const translatedChunks = registry.translateStreamResponse(
          clientFormat,
          targetProvider.format,
          {
            model: originalRequest.model,
            originalRequest,
            translatedRequest,
            rawResponse: chunk
          }
        )

        // 发送翻译后的chunks
        for (const translatedChunk of translatedChunks) {
          clientResponse.write(translatedChunk)
        }
      } else {
        // 不需要翻译，直接发送
        clientResponse.write(chunk)
      }
    }

    clientResponse.end()
  }

  /**
   * 处理非流式响应
   * @param {string} clientFormat - 客户端格式
   * @param {Object} targetProvider - 目标提供商
   * @param {Object} translatedRequest - 翻译后的请求
   * @param {Object} originalRequest - 原始请求
   * @param {Object} apiKeyData - API Key数据
   * @param {Object} clientRequest - Express request
   * @param {Object} clientResponse - Express response
   * @param {boolean} needsTranslation - 是否需要响应翻译
   */
  async handleNonStreamResponse(
    clientFormat,
    targetProvider,
    translatedRequest,
    originalRequest,
    apiKeyData,
    clientRequest,
    clientResponse,
    needsTranslation
  ) {
    try {
      let serverResponse

      // 根据提供商类型调用对应的relay服务
      if (targetProvider.format === Formats.CLAUDE) {
        const result = await claudeRelayService.relayRequest(
          translatedRequest,
          apiKeyData,
          clientRequest,
          clientResponse,
          {},
          { stream: false }
        )
        serverResponse = result.body || result
      } else if (targetProvider.format === Formats.GEMINI) {
        serverResponse = await geminiRelayService.relayRequest(
          translatedRequest,
          apiKeyData,
          false,
          null
        )
      } else if (targetProvider.format === Formats.OPENAI_CHAT) {
        serverResponse = await openaiResponsesRelayService.relayRequest(
          translatedRequest,
          apiKeyData,
          false,
          null
        )
      } else {
        throw new Error(`Unsupported provider format: ${targetProvider.format}`)
      }

      // 翻译响应（如果需要）
      let finalResponse = serverResponse

      if (needsTranslation) {
        finalResponse = registry.translateNonStreamResponse(clientFormat, targetProvider.format, {
          model: originalRequest.model,
          originalRequest,
          translatedRequest,
          rawResponse: serverResponse
        })
        logger.debug(`🔄 Response translated: ${targetProvider.format} → ${clientFormat}`)
      }

      // 发送响应
      if (!clientResponse.headersSent) {
        clientResponse.json(finalResponse)
      }
    } catch (error) {
      logger.error(`❌ Non-stream response handling failed`, { error: error.message })
      if (!clientResponse.headersSent) {
        clientResponse.status(error.statusCode || 500).json({
          error: {
            message: error.message,
            type: 'internal_error'
          }
        })
      }
      throw error
    }
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    return {
      ...this.stats,
      translationRate:
        this.stats.totalRequests > 0
          ? `${((this.stats.translationCount / this.stats.totalRequests) * 100).toFixed(2)}%`
          : '0%'
    }
  }

  /**
   * 重置统计信息
   */
  resetStats() {
    this.stats = {
      totalRequests: 0,
      byClientFormat: {},
      byServerFormat: {},
      translationCount: 0,
      errors: 0
    }
    logger.info('📊 Unified relay statistics reset')
  }
}

// 单例模式
const unifiedRelayService = new UnifiedRelayService()

module.exports = unifiedRelayService
