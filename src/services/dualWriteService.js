const redis = require('../models/redis')
const sqlite = require('../models/sqlite')
const logger = require('../utils/logger')

/**
 * Redis + SQLite 双写服务
 * 提供统一的数据访问接口，同时写入 Redis 和 SQLite
 */
class DualWriteService {
  constructor() {
    this.enableSQLite = process.env.ENABLE_SQLITE !== 'false' // 默认启用
  }

  /**
   * 保存 API Key（双写）
   */
  async saveApiKey(keyId, keyData, hashedKey = null) {
    try {
      // 写入 Redis（主存储）
      await redis.setApiKey(keyId, keyData, hashedKey)

      // 写入 SQLite（持久化）
      if (this.enableSQLite) {
        try {
          sqlite.saveApiKey({
            id: keyId,
            ...keyData
          })
        } catch (sqliteError) {
          logger.error('❌ Failed to write API Key to SQLite:', sqliteError)
          // SQLite 失败不影响主流程
        }
      }
    } catch (error) {
      logger.error('❌ Failed to save API Key:', error)
      throw error
    }
  }

  /**
   * 获取 API Key（优先从 Redis 读取）
   */
  async getApiKey(keyId) {
    try {
      // 优先从 Redis 读取
      const redisData = await redis.getApiKey(keyId)

      if (redisData && Object.keys(redisData).length > 0) {
        return redisData
      }

      // Redis 没有数据，尝试从 SQLite 恢复
      if (this.enableSQLite) {
        try {
          const sqliteData = sqlite.getApiKey(keyId)
          if (sqliteData) {
            logger.info(`🔄 Recovered API Key ${keyId} from SQLite`)
            // 恢复到 Redis
            await redis.setApiKey(keyId, this._sqliteToRedisFormat(sqliteData))
            return this._sqliteToRedisFormat(sqliteData)
          }
        } catch (sqliteError) {
          logger.error('❌ Failed to read from SQLite:', sqliteError)
        }
      }

      return null
    } catch (error) {
      logger.error('❌ Failed to get API Key:', error)
      throw error
    }
  }

  /**
   * 删除 API Key（双删除）
   */
  async deleteApiKey(keyId) {
    try {
      // 从 Redis 删除
      await redis.deleteApiKey(keyId)

      // 从 SQLite 删除
      if (this.enableSQLite) {
        try {
          sqlite.deleteApiKey(keyId)
        } catch (sqliteError) {
          logger.error('❌ Failed to delete from SQLite:', sqliteError)
        }
      }
    } catch (error) {
      logger.error('❌ Failed to delete API Key:', error)
      throw error
    }
  }

  /**
   * 获取所有 API Keys
   */
  async getAllApiKeys() {
    try {
      // 优先从 Redis 读取
      const redisKeys = await redis.getAllApiKeys()

      if (redisKeys && redisKeys.length > 0) {
        return redisKeys
      }

      // Redis 为空，尝试从 SQLite 恢复
      if (this.enableSQLite) {
        try {
          const sqliteKeys = sqlite.getAllApiKeys()
          if (sqliteKeys && sqliteKeys.length > 0) {
            logger.info(`🔄 Recovered ${sqliteKeys.length} API Keys from SQLite`)
            // 批量恢复到 Redis
            for (const key of sqliteKeys) {
              await redis.setApiKey(key.id, this._sqliteToRedisFormat(key))
            }
            return sqliteKeys.map((k) => ({ id: k.id, ...this._sqliteToRedisFormat(k) }))
          }
        } catch (sqliteError) {
          logger.error('❌ Failed to read from SQLite:', sqliteError)
        }
      }

      return []
    } catch (error) {
      logger.error('❌ Failed to get all API Keys:', error)
      throw error
    }
  }

  /**
   * 通过哈希查找 API Key
   */
  async findApiKeyByHash(hashedKey) {
    try {
      // 优先从 Redis 读取
      const redisKey = await redis.findApiKeyByHash(hashedKey)

      if (redisKey) {
        return redisKey
      }

      // Redis 没有，尝试从 SQLite 查找
      if (this.enableSQLite) {
        try {
          const sqliteKey = sqlite.getApiKeyByHash(hashedKey)
          if (sqliteKey) {
            logger.info(`🔄 Recovered API Key by hash from SQLite`)
            // 恢复到 Redis
            await redis.setApiKey(sqliteKey.id, this._sqliteToRedisFormat(sqliteKey), hashedKey)
            return { id: sqliteKey.id, ...this._sqliteToRedisFormat(sqliteKey) }
          }
        } catch (sqliteError) {
          logger.error('❌ Failed to find by hash in SQLite:', sqliteError)
        }
      }

      return null
    } catch (error) {
      logger.error('❌ Failed to find API Key by hash:', error)
      throw error
    }
  }

  /**
   * 更新 API Key 使用统计（双写）
   */
  async updateApiKeyUsage(keyId, usage) {
    try {
      // 更新 Redis（实时统计）
      // 注意：这里直接调用 redis.incrementTokenUsage 等方法

      // 更新 SQLite（持久化统计）
      if (this.enableSQLite) {
        try {
          sqlite.updateApiKeyUsage(keyId, usage)
        } catch (sqliteError) {
          logger.error('❌ Failed to update usage in SQLite:', sqliteError)
        }
      }
    } catch (error) {
      logger.error('❌ Failed to update API Key usage:', error)
      throw error
    }
  }

  /**
   * 保存账户（双写）
   */
  async saveAccount(accountId, accountType, accountData) {
    try {
      // 写入 Redis
      const accountTypeConfig = {
        claude: 'claude:account:',
        'claude-console': 'claude_console_account:',
        openai: 'openai:account:',
        'openai-responses': 'openai_responses_account:',
        'azure-openai': 'azure_openai:account:',
        gemini: 'gemini_account:',
        'gemini-api': 'gemini_api_account:',
        bedrock: 'bedrock_account:',
        droid: 'droid:account:'
      }

      const prefix = accountTypeConfig[accountType] || 'account:'
      const redisKey = `${prefix}${accountId}`

      await redis.client.hset(redisKey, accountData)

      // 写入 SQLite
      if (this.enableSQLite) {
        try {
          sqlite.saveAccount({
            id: accountId,
            accountType,
            ...accountData
          })
        } catch (sqliteError) {
          logger.error('❌ Failed to write account to SQLite:', sqliteError)
        }
      }
    } catch (error) {
      logger.error('❌ Failed to save account:', error)
      throw error
    }
  }

  /**
   * 获取账户
   */
  async getAccount(accountId, accountType) {
    try {
      // 优先从 Redis 读取
      const accountTypeConfig = {
        claude: 'claude:account:',
        'claude-console': 'claude_console_account:',
        openai: 'openai:account:',
        'openai-responses': 'openai_responses_account:',
        'azure-openai': 'azure_openai:account:',
        gemini: 'gemini_account:',
        'gemini-api': 'gemini_api_account:',
        bedrock: 'bedrock_account:',
        droid: 'droid:account:'
      }

      const prefix = accountTypeConfig[accountType] || 'account:'
      const redisKey = `${prefix}${accountId}`

      const redisData = await redis.client.hgetall(redisKey)

      if (redisData && Object.keys(redisData).length > 0) {
        return redisData
      }

      // Redis 没有，尝试从 SQLite 恢复
      if (this.enableSQLite) {
        try {
          const sqliteData = sqlite.getAccount(accountId)
          if (sqliteData) {
            logger.info(`🔄 Recovered account ${accountId} from SQLite`)
            // 恢复到 Redis
            await redis.client.hset(redisKey, this._sqliteToRedisFormat(sqliteData))
            return this._sqliteToRedisFormat(sqliteData)
          }
        } catch (sqliteError) {
          logger.error('❌ Failed to read account from SQLite:', sqliteError)
        }
      }

      return null
    } catch (error) {
      logger.error('❌ Failed to get account:', error)
      throw error
    }
  }

  /**
   * 删除账户（双删除）
   */
  async deleteAccount(accountId, accountType) {
    try {
      // 从 Redis 删除
      const accountTypeConfig = {
        claude: 'claude:account:',
        'claude-console': 'claude_console_account:',
        openai: 'openai:account:',
        'openai-responses': 'openai_responses_account:',
        'azure-openai': 'azure_openai:account:',
        gemini: 'gemini_account:',
        'gemini-api': 'gemini_api_account:',
        bedrock: 'bedrock_account:',
        droid: 'droid:account:'
      }

      const prefix = accountTypeConfig[accountType] || 'account:'
      const redisKey = `${prefix}${accountId}`

      await redis.client.del(redisKey)

      // 从 SQLite 删除
      if (this.enableSQLite) {
        try {
          sqlite.deleteAccount(accountId)
        } catch (sqliteError) {
          logger.error('❌ Failed to delete account from SQLite:', sqliteError)
        }
      }
    } catch (error) {
      logger.error('❌ Failed to delete account:', error)
      throw error
    }
  }

  /**
   * 保存使用记录（仅 SQLite）
   */
  saveUsageRecord(record) {
    if (this.enableSQLite) {
      try {
        sqlite.saveUsageRecord(record)
      } catch (error) {
        logger.error('❌ Failed to save usage record to SQLite:', error)
      }
    }
  }

  /**
   * 获取使用记录（从 SQLite）
   */
  getUsageRecords(apiKeyId, limit = 100) {
    if (this.enableSQLite) {
      try {
        return sqlite.getUsageRecords(apiKeyId, limit)
      } catch (error) {
        logger.error('❌ Failed to get usage records from SQLite:', error)
        return []
      }
    }
    return []
  }

  /**
   * SQLite 格式转 Redis 格式
   */
  _sqliteToRedisFormat(sqliteData) {
    if (!sqliteData) {
      return null
    }

    // 转换布尔值
    const result = { ...sqliteData }

    if ('is_active' in result) {
      result.isActive = result.is_active === 1 ? 'true' : 'false'
      delete result.is_active
    }

    if ('api_key_hash' in result) {
      result.apiKey = result.api_key_hash
      delete result.api_key_hash
    }

    if ('token_limit' in result) {
      result.tokenLimit = String(result.token_limit || 0)
      delete result.token_limit
    }

    if ('rate_limit_rpm' in result) {
      result.rateLimitRpm = result.rate_limit_rpm ? String(result.rate_limit_rpm) : null
      delete result.rate_limit_rpm
    }

    if ('rate_limit_tpm' in result) {
      result.rateLimitTpm = result.rate_limit_tpm ? String(result.rate_limit_tpm) : null
      delete result.rate_limit_tpm
    }

    if ('created_at' in result) {
      result.createdAt = result.created_at
      delete result.created_at
    }

    if ('updated_at' in result) {
      result.updatedAt = result.updated_at
      delete result.updated_at
    }

    if ('last_used_at' in result) {
      result.lastUsedAt = result.last_used_at
      delete result.last_used_at
    }

    if ('expires_at' in result) {
      result.expiresAt = result.expires_at
      delete result.expires_at
    }

    if ('total_requests' in result) {
      result.totalRequests = String(result.total_requests || 0)
      delete result.total_requests
    }

    if ('total_tokens' in result) {
      result.totalTokens = String(result.total_tokens || 0)
      delete result.total_tokens
    }

    if ('total_input_tokens' in result) {
      result.totalInputTokens = String(result.total_input_tokens || 0)
      delete result.total_input_tokens
    }

    if ('total_output_tokens' in result) {
      result.totalOutputTokens = String(result.total_output_tokens || 0)
      delete result.total_output_tokens
    }

    if ('total_cache_create_tokens' in result) {
      result.totalCacheCreateTokens = String(result.total_cache_create_tokens || 0)
      delete result.total_cache_create_tokens
    }

    if ('total_cache_read_tokens' in result) {
      result.totalCacheReadTokens = String(result.total_cache_read_tokens || 0)
      delete result.total_cache_read_tokens
    }

    if ('total_cost' in result) {
      result.totalCost = String(result.total_cost || 0)
      delete result.total_cost
    }

    if ('allowed_models' in result) {
      result.allowedModels = result.allowed_models
      delete result.allowed_models
    }

    if ('blacklist_models' in result) {
      result.blacklistModels = result.blacklist_models
      delete result.blacklist_models
    }

    if ('allowed_clients' in result) {
      result.allowedClients = result.allowed_clients
      delete result.allowed_clients
    }

    return result
  }
}

// 导出单例
const dualWriteService = new DualWriteService()
module.exports = dualWriteService
