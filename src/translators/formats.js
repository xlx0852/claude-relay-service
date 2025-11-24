/**
 * 支持的API格式常量
 * 定义所有可以相互转换的API格式标识符
 */
const Formats = {
  // Claude API 标准格式
  CLAUDE: 'claude',

  // Gemini API 标准格式
  GEMINI: 'gemini',

  // Gemini CLI 专用格式
  GEMINI_CLI: 'gemini-cli',

  // OpenAI Chat Completions API
  OPENAI_CHAT: 'openai-chat',

  // OpenAI Responses API (用于Codex)
  OPENAI_RESPONSES: 'openai-responses',

  // Codex CLI 格式
  CODEX: 'codex'
}

// 格式别名映射（用于识别）
const FormatAliases = {
  anthropic: Formats.CLAUDE,
  claude: Formats.CLAUDE,
  'claude-code': Formats.CLAUDE,

  google: Formats.GEMINI,
  gemini: Formats.GEMINI,
  'gemini-api': Formats.GEMINI,

  openai: Formats.OPENAI_CHAT,
  gpt: Formats.OPENAI_CHAT,
  chatgpt: Formats.OPENAI_CHAT,

  codex: Formats.CODEX
}

/**
 * 从字符串解析格式
 * @param {string} formatStr - 格式字符串
 * @returns {string} 标准化的格式常量
 */
function parseFormat(formatStr) {
  if (!formatStr) {
    return Formats.OPENAI_CHAT // 默认格式
  }

  const normalized = formatStr.toLowerCase().trim()

  // 直接匹配
  if (Object.values(Formats).includes(normalized)) {
    return normalized
  }

  // 别名匹配
  if (FormatAliases[normalized]) {
    return FormatAliases[normalized]
  }

  return Formats.OPENAI_CHAT // 默认返回OpenAI格式
}

/**
 * 检查格式是否有效
 * @param {string} format - 格式字符串
 * @returns {boolean}
 */
function isValidFormat(format) {
  return Object.values(Formats).includes(format)
}

module.exports = {
  Formats,
  FormatAliases,
  parseFormat,
  isValidFormat
}
