const { registry, Formats } = require('../translators')
const ClaudeExecutor = require('../executors/claudeExecutor')
const GeminiExecutor = require('../executors/geminiExecutor')
const OpenAIExecutor = require('../executors/openaiExecutor')
const logger = require('../utils/logger')

/**
 * AuthManager - 统一认证和执行管理器
 * 
 * 核心职责：
 * 1. 管理所有Executor实例
 * 2. 自动选择可用的Provider
 * 3. 自动翻译请求/响应格式
 * 4. 实现重试和故障切换
 * 5. 统一错误处理
 * 
 * 对标Go实现：sdk/cliproxy/auth/manager.go
 */
class AuthManager {
  constructor() {
    // Executor注册表
    this.executors = new Map()
    
    // Provider优先级配置
    this.providerPriority = [
      Formats.CLAUDE,
      Formats.GEMINI,
      Formats.OPENAI_CHAT
    ]

    // 重试配置
    this.retryConfig = {
      maxRetries: 3,
      retryDelay: 1000, // 1秒
      retryableStatusCodes: [408, 429, 500, 502, 503, 504]
    }

    // 统计信息
    this.stats = {
      totalExecutions: 0,
      successExecutions: 0,
      failedExecutions: 0,
      retriesCount: 0,
      providerSwitchCount: 0
    }

    // 注册默认executors
    this._registerDefaultExecutors()
  }

  /**
   * 注册默认的executors
   * @private
   */
  _registerDefaultExecutors() {
    this.registerExecutor(Formats.CLAUDE, new ClaudeExecutor())
    this.registerExecutor(Formats.GEMINI, new GeminiExecutor())
    this.registerExecutor(Formats.OPENAI_CHAT, new OpenAIExecutor())
    
    logger.info('🔧 AuthManager: Default executors registered', {
      executors: Array.from(this.executors.keys())
    })
  }

  /**
   * 注册executor
   * @param {string} format - 格式类型
   * @param {BaseExecutor} executor - Executor实例
   */
  registerExecutor(format, executor) {
    this.executors.set(format, executor)
    logger.debug(`AuthManager: Registered executor for format: ${format}`)
  }

  /**
   * 获取executor
   * @param {string} format - 格式类型
   * @returns {BaseExecutor|null}
   */
  getExecutor(format) {
    return this.executors.get(format) || null
  }

  /**
   * 执行非流式请求（核心方法）
   * 
   * @param {Array<string>} providers - Provider格式列表，按优先级排序
   * @param {Object} request - 请求对象
   * @param {string} request.model - 模型名称
   * @param {Object} request.payload - 请求负载（原始格式）
   * @param {Object} request.metadata - 元数据
   * @param {Object} options - 选项
   * @param {string} options.sourceFormat - 源格式（客户端格式）
   * @param {boolean} options.stream - 是否流式
   * @param {Object} options.originalRequest - 原始请求
   * @param {Object} apiKeyData - API Key数据
   * @returns {Promise<Object>} 翻译后的响应
   */
  async execute(providers, request, options, apiKeyData) {
    this.stats.totalExecutions++
    const startTime = Date.now()

    logger.info('🚀 AuthManager: Executing request', {
      providers: providers,
      sourceFormat: options.sourceFormat,
      model: request.model,
      stream: options.stream
    })

    // 验证providers
    if (!providers || providers.length === 0) {
      throw new Error('No providers specified')
    }

    let lastError = null
    let attemptCount = 0

    // 遍历providers，尝试执行
    for (const providerFormat of providers) {
      const executor = this.executors.get(providerFormat)
      
      if (!executor) {
        logger.warn(`AuthManager: No executor found for provider: ${providerFormat}`)
        continue
      }

      // 检查executor是否可用
      const isAvailable = await executor.isAvailable()
      if (!isAvailable) {
        logger.info(`AuthManager: Provider ${providerFormat} is not available, trying next...`)
        this.stats.providerSwitchCount++
        continue
      }

      // 尝试执行（带重试）
      for (let retry = 0; retry <= this.retryConfig.maxRetries; retry++) {
        attemptCount++

        if (retry > 0) {
          this.stats.retriesCount++
          logger.info(`AuthManager: Retry attempt ${retry} for provider ${providerFormat}`)
          // 延迟重试
          await this._sleep(this.retryConfig.retryDelay * retry)
        }

        try {
          // 翻译请求格式
          const translatedRequest = this._translateRequest(
            options.sourceFormat,
            providerFormat,
            request,
            options
          )

          // 执行请求
          logger.debug(`AuthManager: Executing on ${providerFormat}`, {
            attempt: attemptCount,
            retry: retry
          })

          const response = await executor.execute(
            translatedRequest,
            options,
            apiKeyData
          )

          // 翻译响应格式
          const translatedResponse = this._translateResponse(
            options.sourceFormat,
            providerFormat,
            response,
            request,
            translatedRequest,
            options
          )

          const duration = Date.now() - startTime
          this.stats.successExecutions++

          logger.info('✅ AuthManager: Execution succeeded', {
            provider: providerFormat,
            duration: `${duration}ms`,
            attempts: attemptCount
          })

          return translatedResponse
        } catch (error) {
          lastError = error
          
          // 判断是否应该重试
          const shouldRetry = this._shouldRetry(error, retry)
          
          if (shouldRetry) {
            logger.warn(`AuthManager: Retryable error on ${providerFormat}`, {
              error: error.message,
              statusCode: error.statusCode,
              retry: retry + 1
            })
            continue // 重试当前provider
          } else {
            logger.warn(`AuthManager: Non-retryable error on ${providerFormat}, switching provider`, {
              error: error.message,
              statusCode: error.statusCode
            })
            break // 切换到下一个provider
          }
        }
      }
    }

    // 所有providers都失败了
    this.stats.failedExecutions++
    const duration = Date.now() - startTime

    logger.error('❌ AuthManager: All providers failed', {
      providers: providers,
      attempts: attemptCount,
      duration: `${duration}ms`,
      lastError: lastError?.message
    })

    throw new Error(
      lastError 
        ? `All providers failed. Last error: ${lastError.message}`
        : 'All providers failed with no error details'
    )
  }

  /**
   * 执行流式请求
   * 
   * @param {Array<string>} providers - Provider格式列表
   * @param {Object} request - 请求对象
   * @param {Object} options - 选项
   * @param {Object} apiKeyData - API Key数据
   * @returns {AsyncGenerator} 流数据生成器
   */
  async *executeStream(providers, request, options, apiKeyData) {
    this.stats.totalExecutions++

    logger.info('🌊 AuthManager: Executing stream request', {
      providers: providers,
      sourceFormat: options.sourceFormat,
      model: request.model
    })

    // 验证providers
    if (!providers || providers.length === 0) {
      throw new Error('No providers specified')
    }

    let lastError = null

    // 遍历providers
    for (const providerFormat of providers) {
      const executor = this.executors.get(providerFormat)
      
      if (!executor) {
        logger.warn(`AuthManager: No executor found for provider: ${providerFormat}`)
        continue
      }

      // 检查可用性
      const isAvailable = await executor.isAvailable()
      if (!isAvailable) {
        logger.info(`AuthManager: Provider ${providerFormat} not available for streaming`)
        continue
      }

      try {
        // 翻译请求
        const translatedRequest = this._translateRequest(
          options.sourceFormat,
          providerFormat,
          request,
          options
        )

        logger.debug(`AuthManager: Starting stream on ${providerFormat}`)

        // 执行流式请求
        const stream = executor.executeStream(translatedRequest, options, apiKeyData)

        // 逐chunk翻译并yield
        for await (const chunk of stream) {
          if (chunk.error) {
            throw chunk.error
          }

          if (chunk.done) {
            this.stats.successExecutions++
            logger.info(`✅ AuthManager: Stream completed on ${providerFormat}`)
            return
          }

          // 翻译响应chunk
          const translatedChunks = registry.translateStreamResponse(
            options.sourceFormat,
            providerFormat,
            {
              model: request.model,
              originalRequest: options.originalRequest,
              translatedRequest: translatedRequest,
              rawResponse: chunk.data
            }
          )

          // Yield翻译后的chunks
          for (const translatedChunk of translatedChunks) {
            yield translatedChunk
          }
        }

        return // 成功完成
      } catch (error) {
        lastError = error
        logger.warn(`AuthManager: Stream failed on ${providerFormat}, trying next`, {
          error: error.message
        })
        continue
      }
    }

    // 所有providers都失败
    this.stats.failedExecutions++
    throw new Error(
      lastError
        ? `All providers failed for streaming. Last error: ${lastError.message}`
        : 'All providers failed for streaming'
    )
  }

  /**
   * 获取可用的providers列表
   * 
   * @param {Object} apiKeyData - API Key数据
   * @returns {Promise<Array<string>>} Provider格式列表
   */
  async getAvailableProviders(apiKeyData) {
    const availableProviders = []

    // 检查专属账户
    if (apiKeyData.dedicatedAccounts && apiKeyData.dedicatedAccounts.length > 0) {
      for (const dedAccount of apiKeyData.dedicatedAccounts) {
        const format = this._accountTypeToFormat(dedAccount.type)
        if (format) {
          availableProviders.push(format)
          logger.debug(`AuthManager: Found dedicated account for ${format}`)
        }
      }
      return availableProviders
    }

    // 按优先级检查所有providers
    for (const format of this.providerPriority) {
      const executor = this.executors.get(format)
      if (executor && await executor.isAvailable()) {
        availableProviders.push(format)
      }
    }

    logger.debug(`AuthManager: Available providers`, { providers: availableProviders })
    return availableProviders
  }

  /**
   * 翻译请求格式
   * @private
   */
  _translateRequest(sourceFormat, targetFormat, request, options) {
    if (sourceFormat === targetFormat) {
      return request // 无需翻译
    }

    const translatedPayload = registry.translateRequest(
      sourceFormat,
      targetFormat,
      {
        model: request.model,
        rawRequest: request.payload,
        stream: options.stream,
        metadata: request.metadata
      }
    )

    return {
      model: request.model,
      payload: translatedPayload,
      metadata: request.metadata
    }
  }

  /**
   * 翻译响应格式
   * @private
   */
  _translateResponse(sourceFormat, targetFormat, response, originalRequest, translatedRequest, options) {
    if (sourceFormat === targetFormat) {
      return response.payload // 无需翻译
    }

    return registry.translateNonStreamResponse(
      sourceFormat,
      targetFormat,
      {
        model: originalRequest.model,
        originalRequest: originalRequest.payload,
        translatedRequest: translatedRequest.payload,
        rawResponse: response.payload,
        metadata: response.metadata
      }
    )
  }

  /**
   * 判断是否应该重试
   * @private
   */
  _shouldRetry(error, currentRetry) {
    if (currentRetry >= this.retryConfig.maxRetries) {
      return false
    }

    // 检查状态码
    if (error.statusCode && 
        this.retryConfig.retryableStatusCodes.includes(error.statusCode)) {
      return true
    }

    // 检查错误类型
    const retryableErrors = ['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND']
    if (error.code && retryableErrors.includes(error.code)) {
      return true
    }

    return false
  }

  /**
   * 账户类型转格式
   * @private
   */
  _accountTypeToFormat(type) {
    const mapping = {
      'claude': Formats.CLAUDE,
      'gemini': Formats.GEMINI,
      'openai': Formats.OPENAI_CHAT
    }
    return mapping[type] || null
  }

  /**
   * 延迟函数
   * @private
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const executorStats = {}
    for (const [format, executor] of this.executors) {
      executorStats[format] = executor.getStats()
    }

    return {
      authManager: {
        ...this.stats,
        successRate: this.stats.totalExecutions > 0
          ? ((this.stats.successExecutions / this.stats.totalExecutions) * 100).toFixed(2) + '%'
          : '0%'
      },
      executors: executorStats
    }
  }

  /**
   * 重置统计信息
   */
  resetStats() {
    this.stats = {
      totalExecutions: 0,
      successExecutions: 0,
      failedExecutions: 0,
      retriesCount: 0,
      providerSwitchCount: 0
    }

    for (const executor of this.executors.values()) {
      executor.resetStats()
    }

    logger.info('AuthManager: Statistics reset')
  }
}

// 单例模式
const authManager = new AuthManager()

module.exports = authManager
