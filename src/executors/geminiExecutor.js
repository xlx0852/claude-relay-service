const { BaseExecutor } = require('./baseExecutor')
const { Formats } = require('../translators')
const geminiAccountService = require('../services/geminiAccountService')
const geminiRelayService = require('../services/geminiRelayService')

// 注意：GeminiExecutor复用geminiRelayService，
// geminiRelayService内部已经调用apiKeyService.recordUsage()
// 所以这里不需要再次记录，避免重复计费

/**
 * Gemini Executor
 * 负责执行对Gemini API的请求
 */
class GeminiExecutor extends BaseExecutor {
  constructor() {
    super('GeminiExecutor', Formats.GEMINI)
  }

  async isAvailable() {
    try {
      const accounts = await geminiAccountService.getActiveAccounts()
      return accounts && accounts.length > 0
    } catch (error) {
      return false
    }
  }

  async getAvailableAccountsCount() {
    try {
      const accounts = await geminiAccountService.getActiveAccounts()
      return accounts ? accounts.length : 0
    } catch (error) {
      return 0
    }
  }

  async execute(request, options, apiKeyData) {
    this._validateRequest(request, options)

    return this._wrapExecute(
      async () => {
        // 调用现有的geminiRelayService
        const response = await geminiRelayService.relayRequest(
          request.payload,
          apiKeyData,
          false, // non-stream
          null
        )

        return {
          payload: response,
          metadata: {
            usage: response.usageMetadata
          }
        }
      },
      request,
      options
    )
  }

  async *executeStream(request, options, apiKeyData) {
    this._validateRequest(request, options)

    try {
      const stream = await geminiRelayService.handleStreamResponse(
        request.payload,
        request.model,
        apiKeyData.id,
        null
      )

      for await (const chunk of stream) {
        yield {
          data: chunk,
          done: false
        }
      }

      yield { data: '', done: true }
    } catch (error) {
      yield { error, done: true }
    }
  }
}

module.exports = GeminiExecutor
