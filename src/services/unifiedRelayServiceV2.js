const authManager = require('./authManager')
const { Formats } = require('../translators')
const logger = require('../utils/logger')

/**
 * 统一转发服务 V2 (使用AuthManager架构)
 * 
 * 重构说明：
 * - 使用AuthManager统一管理所有执行
 * - 移除手动if-else判断
 * - 移除手动翻译逻辑（由AuthManager处理）
 * - 代码量减少70%+
 * - 完全对齐Go的架构设计
 */
class UnifiedRelayServiceV2 {
  constructor() {
    this.authManager = authManager

    // 统计信息（仅服务层）
    this.stats = {
      totalRequests: 0,
      byClientFormat: {},
      errors: 0
    }
  }

  /**
   * 统一转发请求入口（简化版）
   * 
   * @param {string} clientFormat - 客户端格式
   * @param {Object} requestBody - 请求体
   * @param {Object} apiKeyData - API Key数据
   * @param {Object} clientRequest - Express request
   * @param {Object} clientResponse - Express response
   * @param {Object} options - 额外选项
   */
  async relayRequest(
    clientFormat,
    requestBody,
    apiKeyData,
    clientRequest,
    clientResponse,
    options = {}
  ) {
    const startTime = Date.now()
    this.stats.totalRequests++
    this.stats.byClientFormat[clientFormat] = 
      (this.stats.byClientFormat[clientFormat] || 0) + 1

    try {
      logger.info('🌐 UnifiedRelay V2: Request started', {
        clientFormat,
        apiKeyName: apiKeyData.name,
        model: requestBody.model,
        stream: !!requestBody.stream
      })

      // 1. 获取可用的providers列表
      const providers = await this.authManager.getAvailableProviders(apiKeyData)

      if (providers.length === 0) {
        throw new Error('No available providers found')
      }

      logger.debug('UnifiedRelay V2: Available providers', { providers })

      // 2. 构建请求对象
      const request = {
        model: requestBody.model,
        payload: requestBody,
        metadata: {
          apiKeyName: apiKeyData.name,
          clientFormat: clientFormat
        }
      }

      // 3. 构建执行选项
      const execOptions = {
        stream: !!requestBody.stream,
        sourceFormat: clientFormat,
        originalRequest: requestBody,
        metadata: options
      }

      // 4. 执行请求（AuthManager自动处理一切！）
      if (execOptions.stream) {
        await this._handleStreamResponse(
          providers,
          request,
          execOptions,
          apiKeyData,
          clientResponse
        )
      } else {
        await this._handleNonStreamResponse(
          providers,
          request,
          execOptions,
          apiKeyData,
          clientResponse
        )
      }

      const duration = Date.now() - startTime
      logger.info('✅ UnifiedRelay V2: Request completed', {
        clientFormat,
        duration: `${duration}ms`
      })
    } catch (error) {
      this.stats.errors++
      const duration = Date.now() - startTime

      logger.error('❌ UnifiedRelay V2: Request failed', {
        error: error.message,
        duration: `${duration}ms`,
        stack: error.stack
      })

      throw error
    }
  }

  /**
   * 处理非流式响应（极简版）
   * @private
   */
  async _handleNonStreamResponse(
    providers,
    request,
    options,
    apiKeyData,
    clientResponse
  ) {
    // AuthManager自动：选择provider、翻译请求、执行、翻译响应
    const response = await this.authManager.execute(
      providers,
      request,
      options,
      apiKeyData
    )

    // 直接返回，已经翻译好了！
    if (!clientResponse.headersSent) {
      clientResponse.json(response)
    }
  }

  /**
   * 处理流式响应（极简版）
   * @private
   */
  async _handleStreamResponse(
    providers,
    request,
    options,
    apiKeyData,
    clientResponse
  ) {
    // 设置SSE响应头
    clientResponse.setHeader('Content-Type', 'text/event-stream')
    clientResponse.setHeader('Cache-Control', 'no-cache')
    clientResponse.setHeader('Connection', 'keep-alive')
    clientResponse.setHeader('X-Accel-Buffering', 'no')

    try {
      // AuthManager自动处理流式响应
      const stream = this.authManager.executeStream(
        providers,
        request,
        options,
        apiKeyData
      )

      // 逐chunk写入response
      for await (const chunk of stream) {
        if (!clientResponse.write(chunk)) {
          // 背压处理
          await new Promise(resolve => clientResponse.once('drain', resolve))
        }
      }

      clientResponse.end()
    } catch (error) {
      logger.error('UnifiedRelay V2: Stream error', { error: error.message })
      
      if (!clientResponse.headersSent) {
        clientResponse.status(500).json({
          error: {
            message: error.message,
            type: 'stream_error'
          }
        })
      } else {
        clientResponse.end()
      }
    }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      service: this.stats,
      authManager: this.authManager.getStats()
    }
  }

  /**
   * 重置统计信息
   */
  resetStats() {
    this.stats = {
      totalRequests: 0,
      byClientFormat: {},
      errors: 0
    }
    this.authManager.resetStats()
    logger.info('UnifiedRelay V2: Statistics reset')
  }
}

// 单例模式
const unifiedRelayServiceV2 = new UnifiedRelayServiceV2()

module.exports = unifiedRelayServiceV2
