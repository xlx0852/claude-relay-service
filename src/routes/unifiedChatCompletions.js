const express = require('express')
const router = express.Router()
const unifiedRelayService = require('../services/unifiedRelayServiceV2') // 使用V2架构
const { detectClientFormat, validateRequestFormat } = require('../middleware/formatDetector')
const { verifyApiKey } = require('../middleware/auth')
const logger = require('../utils/logger')

/**
 * 统一的 Chat Completions API 端点
 *
 * 特性：
 * - 自动识别客户端格式（OpenAI/Claude/Gemini）
 * - 智能选择可用的服务提供商
 * - 自动翻译请求和响应格式
 * - 支持流式和非流式响应
 * - 完全兼容OpenAI/Claude/Gemini客户端
 *
 * 使用示例：
 *
 * 1. OpenAI SDK:
 *    POST /v1/chat/completions
 *    { "model": "gpt-4", "messages": [...] }
 *
 * 2. Claude SDK:
 *    POST /v1/chat/completions
 *    { "model": "claude-3-5-sonnet", "messages": [...] }
 *
 * 3. Gemini SDK:
 *    POST /v1/chat/completions
 *    { "model": "gemini-2.0-flash", "contents": [...] }
 *
 * 所有格式都会被自动处理！
 */

/**
 * POST /v1/chat/completions
 * 统一的对话补全端点
 */
router.post(
  '/v1/chat/completions',
  verifyApiKey, // 1. 验证API Key
  detectClientFormat, // 2. 检测客户端格式
  validateRequestFormat, // 3. 验证请求格式
  async (req, res) => {
    const startTime = Date.now()

    try {
      logger.info('📨 Unified chat completions request', {
        clientFormat: req.clientFormat,
        detectionMethod: req.formatDetectionMethod,
        apiKeyName: req.apiKeyData.name,
        model: req.body.model,
        stream: !!req.body.stream,
        messageCount: req.body.messages?.length || req.body.contents?.length || 0
      })

      // 调用统一转发服务
      await unifiedRelayService.relayRequest(
        req.clientFormat, // 客户端格式
        req.body, // 请求体
        req.apiKeyData, // API Key数据
        req, // Express request
        res, // Express response
        {
          detectionMethod: req.formatDetectionMethod,
          startTime
        }
      )

      // 如果是非流式响应，统计信息会在response发送后记录
      if (!req.body.stream && !res.headersSent) {
        const duration = Date.now() - startTime
        logger.info(`✅ Request completed in ${duration}ms`)
      }
    } catch (error) {
      const duration = Date.now() - startTime

      logger.error('❌ Unified chat completions failed', {
        error: error.message,
        stack: error.stack,
        clientFormat: req.clientFormat,
        duration: `${duration}ms`
      })

      // 如果响应头还没发送，返回错误
      if (!res.headersSent) {
        const statusCode = error.statusCode || error.status || 500
        res.status(statusCode).json({
          error: {
            message: error.message || 'Internal server error',
            type: error.type || 'internal_error',
            code: error.code
          }
        })
      }
    }
  }
)

/**
 * GET /v1/models
 * 列出所有可用模型（兼容OpenAI API）
 */
router.get('/v1/models', verifyApiKey, async (req, res) => {
  try {
    // 返回一个虚拟的模型列表
    // 实际使用中，这些模型会被自动路由到可用的服务提供商
    const models = [
      {
        id: 'gpt-4',
        object: 'model',
        created: 1687882411,
        owned_by: 'unified-relay',
        permission: [],
        root: 'gpt-4',
        parent: null
      },
      {
        id: 'gpt-4-turbo',
        object: 'model',
        created: 1687882411,
        owned_by: 'unified-relay',
        permission: [],
        root: 'gpt-4-turbo',
        parent: null
      },
      {
        id: 'claude-3-5-sonnet-20241022',
        object: 'model',
        created: 1687882411,
        owned_by: 'unified-relay',
        permission: [],
        root: 'claude-3-5-sonnet-20241022',
        parent: null
      },
      {
        id: 'claude-opus-4-20250514',
        object: 'model',
        created: 1687882411,
        owned_by: 'unified-relay',
        permission: [],
        root: 'claude-opus-4-20250514',
        parent: null
      },
      {
        id: 'gemini-2.0-flash-exp',
        object: 'model',
        created: 1687882411,
        owned_by: 'unified-relay',
        permission: [],
        root: 'gemini-2.0-flash-exp',
        parent: null
      }
    ]

    res.json({
      object: 'list',
      data: models
    })
  } catch (error) {
    logger.error('❌ Failed to list models', { error: error.message })
    res.status(500).json({
      error: {
        message: 'Failed to retrieve models',
        type: 'internal_error'
      }
    })
  }
})

/**
 * GET /v1/chat/completions/stats
 * 获取统一转发服务的统计信息（需要管理员权限）
 */
router.get('/v1/chat/completions/stats', verifyApiKey, (req, res) => {
  try {
    // TODO: 添加管理员权限检查
    const stats = unifiedRelayService.getStats()
    res.json({
      success: true,
      stats
    })
  } catch (error) {
    logger.error('❌ Failed to get stats', { error: error.message })
    res.status(500).json({
      error: {
        message: 'Failed to retrieve statistics',
        type: 'internal_error'
      }
    })
  }
})

/**
 * POST /v1/chat/completions/stats/reset
 * 重置统计信息（需要管理员权限）
 */
router.post('/v1/chat/completions/stats/reset', verifyApiKey, (req, res) => {
  try {
    // TODO: 添加管理员权限检查
    unifiedRelayService.resetStats()
    res.json({
      success: true,
      message: 'Statistics reset successfully'
    })
  } catch (error) {
    logger.error('❌ Failed to reset stats', { error: error.message })
    res.status(500).json({
      error: {
        message: 'Failed to reset statistics',
        type: 'internal_error'
      }
    })
  }
})

module.exports = router
