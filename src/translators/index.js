/**
 * 翻译器自动注册模块
 * 负责导入所有翻译器并自动注册到注册表
 */
const registry = require('./registry')
const { Formats, parseFormat, isValidFormat } = require('./formats')
const logger = require('../utils/logger')

// 导入所有翻译器
const openaiToClaude = require('./openai/toClaude')
const claudeToOpenAI = require('./claude/toOpenAI')

/**
 * 注册所有翻译器到注册表
 */
function registerAllTranslators() {
  logger.info('🔧 Registering API format translators...')

  try {
    // ============================================
    // OpenAI ↔ Claude 双向翻译
    // ============================================

    // OpenAI → Claude (请求) + Claude → OpenAI (响应)
    registry.register(
      Formats.OPENAI_CHAT,
      Formats.CLAUDE,
      openaiToClaude.translateOpenAIRequestToClaude,
      {
        stream: openaiToClaude.translateClaudeStreamResponseToOpenAI,
        nonStream: openaiToClaude.translateClaudeNonStreamResponseToOpenAI
      }
    )

    // Claude → OpenAI (请求) + OpenAI → Claude (响应)
    registry.register(
      Formats.CLAUDE,
      Formats.OPENAI_CHAT,
      claudeToOpenAI.translateClaudeRequestToOpenAI,
      {
        stream: claudeToOpenAI.translateOpenAIStreamResponseToClaude,
        nonStream: claudeToOpenAI.translateOpenAINonStreamResponseToClaude
      }
    )

    // ============================================
    // 未来可以添加更多翻译器
    // ============================================

    // TODO: Claude ↔ Gemini
    // TODO: OpenAI ↔ Gemini
    // TODO: Codex支持

    // 打印注册统计信息
    registry.printStats()

    logger.info('✅ All translators registered successfully')
  } catch (error) {
    logger.error('❌ Failed to register translators', {
      error: error.message,
      stack: error.stack
    })
    throw error
  }
}

// 自动注册所有翻译器
registerAllTranslators()

// 导出模块
module.exports = {
  registry,
  Formats,
  parseFormat,
  isValidFormat,
  registerAllTranslators
}
