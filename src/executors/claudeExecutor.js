const { BaseExecutor } = require('./baseExecutor')
const { Formats } = require('../translators')
const claudeAccountService = require('../services/claudeAccountService')
const unifiedClaudeScheduler = require('../services/unifiedClaudeScheduler')
const apiKeyService = require('../services/apiKeyService')
const logger = require('../utils/logger')
const https = require('https')
const { HttpsProxyAgent } = require('https-proxy-agent')
const { SocksProxyAgent } = require('socks-proxy-agent')
const config = require('../../config/config')

/**
 * Claude Executor
 * 负责执行对Claude API的请求
 * 
 * 特点：
 * - 支持多账户轮询
 * - 支持专属账户绑定
 * - 自动错误处理和重试
 * - 统一的请求/响应格式
 */
class ClaudeExecutor extends BaseExecutor {
  constructor() {
    super('ClaudeExecutor', Formats.CLAUDE)
    this.apiUrl = config.claude.apiUrl
    this.apiVersion = config.claude.apiVersion
    this.betaHeader = config.claude.betaHeader
  }

  /**
   * 检查是否可用
   */
  async isAvailable() {
    try {
      const accounts = await claudeAccountService.getActiveAccounts()
      return accounts && accounts.length > 0
    } catch (error) {
      logger.warn(`${this.name}: Availability check failed`, { error: error.message })
      return false
    }
  }

  /**
   * 获取可用账户数
   */
  async getAvailableAccountsCount() {
    try {
      const accounts = await claudeAccountService.getActiveAccounts()
      return accounts ? accounts.length : 0
    } catch (error) {
      return 0
    }
  }

  /**
   * 执行非流式请求
   */
  async execute(request, options, apiKeyData) {
    this._validateRequest(request, options)

    return this._wrapExecute(async () => {
      // 选择账户
      const account = await this._selectAccount(apiKeyData, request.model)

      // 发送请求
      const response = await this._sendRequest(account, request.payload, false)

      // 🔔 记录计费和统计（非流式）
      if (response.usage && apiKeyData?.id) {
        await this._recordUsage(apiKeyData.id, response.usage, request.model, account.accountId)
      }

      return {
        payload: response,
        metadata: {
          accountId: account.accountId,
          usage: response.usage
        }
      }
    }, request, options)
  }

  /**
   * 执行流式请求
   */
  async *executeStream(request, options, apiKeyData) {
    this._validateRequest(request, options)

    // 选择账户
    const account = await this._selectAccount(apiKeyData, request.model)

    logger.debug(`${this.name}: Starting stream request`, {
      accountId: account.accountId,
      model: request.model
    })

    let lastUsage = null

    try {
      // 发送流式请求
      for await (const chunk of this._sendStreamRequest(account, request.payload)) {
        // 尝试从流中提取usage信息
        if (chunk.usage) {
          lastUsage = chunk.usage
        }

        yield {
          data: chunk,
          done: false
        }
      }

      // 🔔 记录计费和统计（流式）
      if (lastUsage && apiKeyData?.id) {
        await this._recordUsage(apiKeyData.id, lastUsage, request.model, account.accountId)
      }

      yield {
        data: '',
        done: true,
        usage: lastUsage
      }
    } catch (error) {
      logger.error(`${this.name}: Stream failed`, { error: error.message })
      yield {
        error: error,
        done: true
      }
    }
  }

  /**
   * 选择Claude账户
   * @private
   */
  async _selectAccount(apiKeyData, model) {
    // 检查是否有专属账户
    if (apiKeyData.dedicatedAccounts && apiKeyData.dedicatedAccounts.length > 0) {
      const dedicatedAccount = apiKeyData.dedicatedAccounts.find(
        acc => acc.type === 'claude'
      )
      if (dedicatedAccount) {
        logger.debug(`${this.name}: Using dedicated account`, {
          accountId: dedicatedAccount.accountId
        })
        return await claudeAccountService.getAccountById(dedicatedAccount.accountId)
      }
    }

    // 使用scheduler选择账户
    const selection = await unifiedClaudeScheduler.selectAccountForApiKey(
      apiKeyData,
      null, // sessionHash
      model
    )

    return selection.account
  }

  /**
   * 发送非流式请求到Claude API
   * @private
   */
  async _sendRequest(account, payload, stream = false) {
    return new Promise((resolve, reject) => {
      const requestBody = {
        ...payload,
        stream: stream
      }

      const data = JSON.stringify(requestBody)
      
      const options = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          'anthropic-version': this.apiVersion,
          'authorization': `Bearer ${account.accessToken}`,
          'anthropic-beta': this.betaHeader
        }
      }

      // 添加代理支持
      if (account.proxyUrl) {
        if (account.proxyUrl.startsWith('socks')) {
          options.agent = new SocksProxyAgent(account.proxyUrl)
        } else {
          options.agent = new HttpsProxyAgent(account.proxyUrl)
        }
      }

      const req = https.request(this.apiUrl, options, (res) => {
        let responseData = ''

        res.on('data', (chunk) => {
          responseData += chunk.toString()
        })

        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(responseData))
            } catch (error) {
              reject(new Error(`Failed to parse response: ${error.message}`))
            }
          } else {
            const error = new Error(`Claude API error: ${res.statusCode}`)
            error.statusCode = res.statusCode
            error.response = responseData
            reject(error)
          }
        })
      })

      req.on('error', (error) => {
        reject(error)
      })

      req.write(data)
      req.end()
    })
  }

  /**
   * 发送流式请求到Claude API
   * @private
   */
  async *_sendStreamRequest(account, payload) {
    const requestBody = {
      ...payload,
      stream: true
    }

    const data = JSON.stringify(requestBody)
    
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'anthropic-version': this.apiVersion,
        'authorization': `Bearer ${account.accessToken}`,
        'anthropic-beta': this.betaHeader
      }
    }

    // 添加代理支持
    if (account.proxyUrl) {
      if (account.proxyUrl.startsWith('socks')) {
        options.agent = new SocksProxyAgent(account.proxyUrl)
      } else {
        options.agent = new HttpsProxyAgent(account.proxyUrl)
      }
    }

    return new Promise((resolve, reject) => {
      const req = https.request(this.apiUrl, options, (res) => {
        if (res.statusCode !== 200) {
          let errorData = ''
          res.on('data', (chunk) => {
            errorData += chunk.toString()
          })
          res.on('end', () => {
            const error = new Error(`Claude API error: ${res.statusCode}`)
            error.statusCode = res.statusCode
            error.response = errorData
            reject(error)
          })
          return
        }

        // 创建异步生成器
        const generator = async function* () {
          for await (const chunk of res) {
            yield chunk.toString()
          }
        }

        resolve(generator())
      })

      req.on('error', (error) => {
        reject(error)
      })

      req.write(data)
      req.end()
    })
  }
}

module.exports = ClaudeExecutor
