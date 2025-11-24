#!/usr/bin/env node

/**
 * Redis → SQLite 数据迁移脚本
 * 从 Redis 导入所有数据到 SQLite
 */

const redis = require('../src/models/redis')
const sqlite = require('../src/models/sqlite')
const logger = require('../src/utils/logger')

class RedisToSQLiteMigration {
  constructor() {
    this.stats = {
      apiKeys: { total: 0, success: 0, failed: 0 },
      accounts: { total: 0, success: 0, failed: 0 },
      errors: []
    }
  }

  async run() {
    try {
      logger.info('========================================')
      logger.info('🔄 Redis → SQLite 数据迁移')
      logger.info('========================================')

      // 连接数据库
      await this.connectDatabases()

      // 迁移 API Keys
      await this.migrateApiKeys()

      // 迁移账户
      await this.migrateAccounts()

      // 显示统计
      this.printStats()

      // 关闭连接
      await this.cleanup()

      logger.info('========================================')
      logger.info('✅ 迁移完成！')
      logger.info('========================================')
    } catch (error) {
      logger.error('💥 迁移失败:', error)
      process.exit(1)
    }
  }

  async connectDatabases() {
    logger.info('🔗 连接 Redis...')
    await redis.connect()
    logger.info('✅ Redis 已连接')

    logger.info('🔗 连接 SQLite...')
    sqlite.connect()
    logger.info('✅ SQLite 已连接')
  }

  async migrateApiKeys() {
    logger.info('\n📋 迁移 API Keys...')

    try {
      // 获取所有 API Keys
      const redisKeys = await redis.getAllApiKeys()
      this.stats.apiKeys.total = redisKeys.length

      logger.info(`找到 ${redisKeys.length} 个 API Keys`)

      for (const key of redisKeys) {
        try {
          // 转换格式并保存到 SQLite
          sqlite.saveApiKey({
            id: key.id,
            apiKey: key.apiKey,
            name: key.name || null,
            description: key.description || null,
            tokenLimit: parseInt(key.tokenLimit) || 1000000,
            rateLimitRpm: key.rateLimitRpm ? parseInt(key.rateLimitRpm) : null,
            rateLimitTpm: key.rateLimitTpm ? parseInt(key.rateLimitTpm) : null,
            isActive: key.isActive === 'true' || key.isActive === true,
            createdAt: key.createdAt || new Date().toISOString(),
            lastUsedAt: key.lastUsedAt || null,
            expiresAt: key.expiresAt || null,
            permissions: key.permissions || null,
            allowedModels: key.allowedModels || null,
            blacklistModels: key.blacklistModels || null,
            allowedClients: key.allowedClients || null,
            totalRequests: parseInt(key.totalRequests) || 0,
            totalTokens: parseInt(key.totalTokens) || 0,
            totalInputTokens: parseInt(key.totalInputTokens) || 0,
            totalOutputTokens: parseInt(key.totalOutputTokens) || 0,
            totalCacheCreateTokens: parseInt(key.totalCacheCreateTokens) || 0,
            totalCacheReadTokens: parseInt(key.totalCacheReadTokens) || 0,
            totalCost: parseFloat(key.totalCost) || 0
          })

          this.stats.apiKeys.success++
          logger.info(`  ✅ ${key.id} (${key.name || 'Unnamed'})`)
        } catch (error) {
          this.stats.apiKeys.failed++
          this.stats.errors.push({
            type: 'API Key',
            id: key.id,
            error: error.message
          })
          logger.error(`  ❌ ${key.id}: ${error.message}`)
        }
      }
    } catch (error) {
      logger.error('❌ API Keys 迁移失败:', error)
    }
  }

  async migrateAccounts() {
    logger.info('\n📋 迁移账户...')

    const accountTypes = [
      { type: 'claude', prefix: 'claude:account:' },
      { type: 'claude-console', prefix: 'claude_console_account:' },
      { type: 'openai', prefix: 'openai:account:' },
      { type: 'openai-responses', prefix: 'openai_responses_account:' },
      { type: 'azure-openai', prefix: 'azure_openai:account:' },
      { type: 'gemini', prefix: 'gemini_account:' },
      { type: 'gemini-api', prefix: 'gemini_api_account:' },
      { type: 'bedrock', prefix: 'bedrock_account:' },
      { type: 'droid', prefix: 'droid:account:' }
    ]

    for (const { type, prefix } of accountTypes) {
      try {
        logger.info(`\n  迁移 ${type} 账户...`)

        const accountKeys = await redis.client.keys(`${prefix}*`)
        let typeCount = 0

        for (const redisKey of accountKeys) {
          try {
            const accountId = redisKey.replace(prefix, '')
            const accountData = await redis.client.hgetall(redisKey)

            if (!accountData || Object.keys(accountData).length === 0) {
              continue
            }

            // 保存到 SQLite
            sqlite.saveAccount({
              id: accountId,
              accountType: type,
              name: accountData.name || 'Unnamed Account',
              description: accountData.description || null,
              email: accountData.email || null,
              isActive: accountData.isActive === 'true' || accountData.isActive === true,
              status: accountData.status || 'active',
              createdAt: accountData.createdAt || new Date().toISOString(),
              lastUsedAt: accountData.lastUsedAt || null,
              expiresAt: accountData.expiresAt || null,
              proxyConfig: accountData.proxy ? JSON.parse(accountData.proxy) : null,
              encryptedCredentials: accountData.encryptedOAuthData || accountData.apiKey || null,
              totalRequests: parseInt(accountData.totalRequests) || 0,
              totalTokens: parseInt(accountData.totalTokens) || 0,
              totalInputTokens: parseInt(accountData.totalInputTokens) || 0,
              totalOutputTokens: parseInt(accountData.totalOutputTokens) || 0,
              totalCost: parseFloat(accountData.totalCost) || 0
            })

            typeCount++
            this.stats.accounts.success++
            logger.info(`    ✅ ${accountId} (${accountData.name || 'Unnamed'})`)
          } catch (error) {
            this.stats.accounts.failed++
            this.stats.errors.push({
              type: `${type} Account`,
              id: redisKey,
              error: error.message
            })
            logger.error(`    ❌ ${redisKey}: ${error.message}`)
          }
        }

        logger.info(`  完成 ${type}: ${typeCount} 个账户`)
        this.stats.accounts.total += typeCount
      } catch (error) {
        logger.error(`  ❌ ${type} 账户迁移失败:`, error)
      }
    }
  }

  printStats() {
    logger.info('\n========================================')
    logger.info('📊 迁移统计')
    logger.info('========================================')

    logger.info('\nAPI Keys:')
    logger.info(`  总数: ${this.stats.apiKeys.total}`)
    logger.info(`  成功: ${this.stats.apiKeys.success}`)
    logger.info(`  失败: ${this.stats.apiKeys.failed}`)

    logger.info('\n账户:')
    logger.info(`  总数: ${this.stats.accounts.total}`)
    logger.info(`  成功: ${this.stats.accounts.success}`)
    logger.info(`  失败: ${this.stats.accounts.failed}`)

    if (this.stats.errors.length > 0) {
      logger.info('\n❌ 错误列表:')
      this.stats.errors.forEach((err, index) => {
        logger.info(`  ${index + 1}. [${err.type}] ${err.id}: ${err.error}`)
      })
    }

    // 获取 SQLite 统计
    const sqliteStats = sqlite.getStats()
    logger.info('\n📊 SQLite 数据库统计:')
    logger.info(`  API Keys: ${sqliteStats.apiKeysCount}`)
    logger.info(`  账户: ${sqliteStats.accountsCount}`)
    logger.info(`  使用记录: ${sqliteStats.usageRecordsCount}`)
    logger.info(`  数据库大小: ${(sqliteStats.dbSize / 1024 / 1024).toFixed(2)} MB`)
    logger.info(`  数据库路径: ${sqliteStats.dbPath}`)
  }

  async cleanup() {
    logger.info('\n🧹 清理连接...')

    try {
      await redis.disconnect()
      sqlite.disconnect()
      logger.info('✅ 连接已关闭')
    } catch (error) {
      logger.error('清理失败:', error)
    }
  }
}

// 执行迁移
const migration = new RedisToSQLiteMigration()
migration.run().catch((error) => {
  logger.error('💥 迁移脚本执行失败:', error)
  process.exit(1)
})
