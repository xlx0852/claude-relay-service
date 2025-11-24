const { BaseExecutor } = require('./baseExecutor')
const { Formats } = require('../translators')
const openaiAccountService = require('../services/openaiResponsesAccountService')
const openaiRelayService = require('../services/openaiResponsesRelayService')

/**
 * OpenAI Executor  
 * 负责执行对OpenAI API的请求
 */
class OpenAIExecutor extends BaseExecutor {
  constructor() {
    super('OpenAIExecutor', Formats.OPENAI_CHAT)
  }

  async isAvailable() {
    try {
      const accounts = await openaiAccountService.getActiveAccounts()
      return accounts && accounts.length > 0
    } catch (error) {
      return false
    }
  }

  async getAvailableAccountsCount() {
    try {
      const accounts = await openaiAccountService.getActiveAccounts()
      return accounts ? accounts.length : 0
    } catch (error) {
      return 0
    }
  }

  async execute(request, options, apiKeyData) {
    this._validateRequest(request, options)

    return this._wrapExecute(async () => {
      const response = await openaiRelayService.relayRequest(
        request.payload,
        apiKeyData,
        false,
        null
      )

      return {
        payload: response,
        metadata: {
          usage: response.usage
        }
      }
    }, request, options)
  }

  async *executeStream(request, options, apiKeyData) {
    this._validateRequest(request, options)

    try {
      const stream = await openaiRelayService.relayRequest(
        request.payload,
        apiKeyData,
        true,
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

module.exports = OpenAIExecutor
