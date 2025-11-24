const { Formats, parseFormat } = require('../translators')
const logger = require('../utils/logger')

/**
 * 客户端格式检测中间件
 * 
 * 检测策略：
 * 1. 检查 X-Client-Format header
 * 2. 检查 User-Agent 识别客户端类型
 * 3. 检查请求体结构推断格式
 * 4. 默认使用 OpenAI 格式
 */
function detectClientFormat(req, res, next) {
  let detectedFormat = null
  let detectionMethod = 'default'

  // 策略1: 检查自定义header
  const formatHeader = req.headers['x-client-format'] || req.headers['x-api-format']
  if (formatHeader) {
    detectedFormat = parseFormat(formatHeader)
    detectionMethod = 'header'
    logger.debug(`🔍 Format detected from header: ${detectedFormat}`)
  }

  // 策略2: 检查User-Agent
  if (!detectedFormat) {
    const userAgent = req.headers['user-agent'] || ''
    const format = detectFormatFromUserAgent(userAgent)
    if (format) {
      detectedFormat = format
      detectionMethod = 'user-agent'
      logger.debug(`🔍 Format detected from User-Agent: ${detectedFormat}`)
    }
  }

  // 策略3: 分析请求体结构
  if (!detectedFormat && req.body) {
    const format = detectFormatFromRequestBody(req.body)
    if (format) {
      detectedFormat = format
      detectionMethod = 'body-structure'
      logger.debug(`🔍 Format detected from request body: ${detectedFormat}`)
    }
  }

  // 默认使用OpenAI格式（最通用）
  if (!detectedFormat) {
    detectedFormat = Formats.OPENAI_CHAT
    detectionMethod = 'default'
    logger.debug(`🔍 Using default format: ${detectedFormat}`)
  }

  // 将检测到的格式附加到request对象
  req.clientFormat = detectedFormat
  req.formatDetectionMethod = detectionMethod

  logger.info(`🎯 Client format: ${detectedFormat} (detected by: ${detectionMethod})`, {
    path: req.path,
    method: req.method,
    userAgent: req.headers['user-agent']?.substring(0, 50)
  })

  next()
}

/**
 * 从User-Agent识别客户端格式
 * @param {string} userAgent - User-Agent字符串
 * @returns {string|null} 识别到的格式
 */
function detectFormatFromUserAgent(userAgent) {
  const ua = userAgent.toLowerCase()

  // Claude Code CLI
  if (ua.includes('claude-cli') || ua.includes('claude-code')) {
    return Formats.CLAUDE
  }

  // Gemini CLI
  if (ua.includes('geminicli') || ua.includes('gemini-cli')) {
    return Formats.GEMINI_CLI
  }

  // OpenAI官方SDK
  if (ua.includes('openai-python') || ua.includes('openai-node')) {
    return Formats.OPENAI_CHAT
  }

  // Cursor Editor
  if (ua.includes('cursor')) {
    return Formats.OPENAI_CHAT
  }

  // Continue.dev
  if (ua.includes('continue')) {
    return Formats.OPENAI_CHAT
  }

  // Cline (原Claude Dev)
  if (ua.includes('cline')) {
    return Formats.CLAUDE
  }

  // Anthropic SDK
  if (ua.includes('anthropic')) {
    return Formats.CLAUDE
  }

  // Google AI SDK
  if (ua.includes('google-ai') || ua.includes('generativelanguage')) {
    return Formats.GEMINI
  }

  return null
}

/**
 * 从请求体结构推断格式
 * @param {Object} body - 请求体
 * @returns {string|null} 识别到的格式
 */
function detectFormatFromRequestBody(body) {
  if (!body || typeof body !== 'object') {
    return null
  }

  // Claude格式特征
  if (body.system !== undefined || 
      (body.messages && Array.isArray(body.messages) && 
       body.messages.some(m => Array.isArray(m.content)))) {
    return Formats.CLAUDE
  }

  // Gemini格式特征
  if (body.contents !== undefined || 
      body.systemInstruction !== undefined ||
      body.generationConfig !== undefined) {
    return Formats.GEMINI
  }

  // OpenAI格式特征（最宽松，因为很多格式都类似）
  if (body.messages && Array.isArray(body.messages)) {
    return Formats.OPENAI_CHAT
  }

  return null
}

/**
 * 验证请求格式中间件
 * 确保请求体至少包含基本字段
 */
function validateRequestFormat(req, res, next) {
  if (!req.body) {
    return res.status(400).json({
      error: {
        message: 'Request body is required',
        type: 'invalid_request_error'
      }
    })
  }

  // 基本验证：至少要有messages或contents
  const hasMessages = req.body.messages && Array.isArray(req.body.messages)
  const hasContents = req.body.contents && Array.isArray(req.body.contents)

  if (!hasMessages && !hasContents) {
    return res.status(400).json({
      error: {
        message: 'Request must contain either "messages" or "contents" field',
        type: 'invalid_request_error',
        param: 'messages/contents'
      }
    })
  }

  next()
}

/**
 * 格式转换中间件（可选）
 * 如果指定了目标格式，强制转换请求格式
 */
function forceFormat(targetFormat) {
  return (req, res, next) => {
    if (req.clientFormat !== targetFormat) {
      logger.info(`🔄 Forcing format conversion: ${req.clientFormat} → ${targetFormat}`)
      req.clientFormat = targetFormat
      req.formatDetectionMethod = 'forced'
    }
    next()
  }
}

module.exports = {
  detectClientFormat,
  validateRequestFormat,
  forceFormat,
  detectFormatFromUserAgent,
  detectFormatFromRequestBody
}
