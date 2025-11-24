const logger = require('../utils/logger')

/**
 * Executor基类
 * 定义所有AI服务提供商执行器的统一接口
 *
 * 设计理念：
 * - 所有executor必须实现相同的接口
 * - 统一的错误处理机制
 * - 统一的参数和返回值格式
 * - 支持流式和非流式两种模式
 *
 * 参考Go实现：sdk/cliproxy/executor/executor.go
 */

/**
 * @typedef {Object} ExecutorRequest
 * @property {string} model - 模型名称
 * @property {Object} payload - 请求负载（已翻译为目标格式）
 * @property {Object} [metadata] - 元数据
 * @property {string} [metadata.apiKeyName] - API Key名称
 * @property {string} [metadata.accountId] - 账户ID
 */

/**
 * @typedef {Object} ExecutorOptions
 * @property {boolean} stream - 是否流式响应
 * @property {string} sourceFormat - 源格式（用于日志和调试）
 * @property {Object} originalRequest - 原始请求（未翻译）
 * @property {Object} [metadata] - 额外元数据
 */

/**
 * @typedef {Object} ExecutorResponse
 * @property {Object|string} payload - 响应负载（原始格式）
 * @property {Object} [metadata] - 响应元数据
 * @property {Object} [metadata.usage] - Token使用量
 * @property {number} [metadata.duration] - 请求耗时(ms)
 */

/**
 * @typedef {Object} ExecutorStreamChunk
 * @property {string|Buffer} data - 流数据chunk
 * @property {Error} [error] - 错误信息
 * @property {boolean} [done] - 是否结束
 */

class BaseExecutor {
  /**
   * 构造函数
   * @param {string} name - Executor名称
   * @param {string} format - 格式类型
   */
  constructor(name, format) {
    this.name = name
    this.format = format
    this.stats = {
      totalRequests: 0,
      successRequests: 0,
      failedRequests: 0,
      totalDuration: 0,
      errors: {}
    }
  }

  /**
   * 执行非流式请求（必须由子类实现）
   * @param {ExecutorRequest} request - 请求对象
   * @param {ExecutorOptions} options - 选项
   * @param {Object} apiKeyData - API Key数据
   * @returns {Promise<ExecutorResponse>} 响应对象
   */
  async execute(_request, _options, _apiKeyData) {
    throw new Error(`${this.name}: execute() must be implemented by subclass`)
  }

  /**
   * 执行流式请求（必须由子类实现）
   * @param {ExecutorRequest} request - 请求对象
   * @param {ExecutorOptions} options - 选项
   * @param {Object} apiKeyData - API Key数据
   * @returns {AsyncGenerator<ExecutorStreamChunk>} 流数据生成器
   */
  async executeStream(_request, _options, _apiKeyData) {
    throw new Error(`${this.name}: executeStream() must be implemented by subclass`)
  }

  /**
   * 检查此executor是否可用
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    return true // 默认可用，子类可重写
  }

  /**
   * 获取可用账户数量
   * @returns {Promise<number>}
   */
  async getAvailableAccountsCount() {
    return 0 // 默认返回0，子类应重写
  }

  /**
   * 包装执行逻辑，添加统计和错误处理
   * @protected
   */
  async _wrapExecute(fn, request, options) {
    const startTime = Date.now()
    this.stats.totalRequests++

    try {
      logger.debug(`${this.name}: Executing request`, {
        model: request.model,
        stream: options.stream,
        sourceFormat: options.sourceFormat
      })

      const result = await fn()

      const duration = Date.now() - startTime
      this.stats.successRequests++
      this.stats.totalDuration += duration

      logger.info(`${this.name}: Request succeeded`, {
        model: request.model,
        duration: `${duration}ms`,
        stream: options.stream
      })

      return result
    } catch (error) {
      const duration = Date.now() - startTime
      this.stats.failedRequests++

      // 统计错误类型
      const errorType = error.code || error.name || 'Unknown'
      this.stats.errors[errorType] = (this.stats.errors[errorType] || 0) + 1

      logger.error(`${this.name}: Request failed`, {
        error: error.message,
        errorType,
        duration: `${duration}ms`,
        model: request.model,
        stack: error.stack
      })

      // 包装错误，添加executor信息
      const wrappedError = new ExecutorError(error.message, this.name, this.format, error)
      wrappedError.statusCode = error.statusCode || error.status || 500
      throw wrappedError
    }
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    return {
      name: this.name,
      format: this.format,
      stats: {
        ...this.stats,
        successRate:
          this.stats.totalRequests > 0
            ? `${((this.stats.successRequests / this.stats.totalRequests) * 100).toFixed(2)}%`
            : '0%',
        avgDuration:
          this.stats.successRequests > 0
            ? `${Math.round(this.stats.totalDuration / this.stats.successRequests)}ms`
            : '0ms'
      }
    }
  }

  /**
   * 重置统计信息
   */
  resetStats() {
    this.stats = {
      totalRequests: 0,
      successRequests: 0,
      failedRequests: 0,
      totalDuration: 0,
      errors: {}
    }
    logger.info(`${this.name}: Statistics reset`)
  }

  /**
   * 验证请求参数
   * @protected
   */
  _validateRequest(request, options) {
    if (!request || typeof request !== 'object') {
      throw new Error('Request must be an object')
    }
    if (!request.model) {
      throw new Error('Request must include model')
    }
    if (!request.payload) {
      throw new Error('Request must include payload')
    }
    if (!options || typeof options !== 'object') {
      throw new Error('Options must be an object')
    }
    if (typeof options.stream !== 'boolean') {
      throw new Error('Options.stream must be a boolean')
    }
  }
}

/**
 * Executor专用错误类
 */
class ExecutorError extends Error {
  constructor(message, executorName, format, originalError) {
    super(message)
    this.name = 'ExecutorError'
    this.executorName = executorName
    this.format = format
    this.originalError = originalError
    this.statusCode = 500
    this.timestamp = new Date().toISOString()
  }

  toJSON() {
    return {
      error: {
        message: this.message,
        type: 'executor_error',
        executor: this.executorName,
        format: this.format,
        statusCode: this.statusCode,
        timestamp: this.timestamp
      }
    }
  }
}

module.exports = {
  BaseExecutor,
  ExecutorError
}
