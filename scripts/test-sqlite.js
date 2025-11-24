#!/usr/bin/env node

/**
 * SQLite 功能测试脚本
 */

const sqlite = require('../src/models/sqlite')
const logger = require('../src/utils/logger')

async function testSQLite() {
  try {
    logger.info('========================================')
    logger.info('🧪 SQLite 功能测试')
    logger.info('========================================')

    // 1. 连接数据库
    logger.info('\n1️⃣  测试数据库连接...')
    sqlite.connect()
    logger.info('✅ 数据库连接成功')

    // 2. 测试 API Key 操作
    logger.info('\n2️⃣  测试 API Key 操作...')
    const testApiKey = {
      id: `test-key-${Date.now()}`,
      apiKey: `hash-${Date.now()}`,
      name: '测试 API Key',
      description: 'SQLite 功能测试',
      tokenLimit: 1000000,
      isActive: true,
      createdAt: new Date().toISOString(),
      totalRequests: 0,
      totalTokens: 0
    }

    // 保存
    sqlite.saveApiKey(testApiKey)
    logger.info(`✅ API Key 已保存: ${testApiKey.id}`)

    // 读取
    const retrievedKey = sqlite.getApiKey(testApiKey.id)
    if (retrievedKey && retrievedKey.name === testApiKey.name) {
      logger.info('✅ API Key 读取成功')
    } else {
      throw new Error('API Key 读取失败')
    }

    // 通过哈希查找
    const keyByHash = sqlite.getApiKeyByHash(testApiKey.apiKey)
    if (keyByHash && keyByHash.id === testApiKey.id) {
      logger.info('✅ 通过哈希查找成功')
    } else {
      throw new Error('通过哈希查找失败')
    }

    // 3. 测试账户操作
    logger.info('\n3️⃣  测试账户操作...')
    const testAccount = {
      id: `test-account-${Date.now()}`,
      accountType: 'claude',
      name: '测试 Claude 账户',
      email: 'test@example.com',
      isActive: true,
      status: 'active',
      createdAt: new Date().toISOString(),
      totalRequests: 0,
      totalTokens: 0
    }

    // 保存
    sqlite.saveAccount(testAccount)
    logger.info(`✅ 账户已保存: ${testAccount.id}`)

    // 读取
    const retrievedAccount = sqlite.getAccount(testAccount.id)
    if (retrievedAccount && retrievedAccount.name === testAccount.name) {
      logger.info('✅ 账户读取成功')
    } else {
      throw new Error('账户读取失败')
    }

    // 按类型查询
    const claudeAccounts = sqlite.getAccountsByType('claude')
    if (claudeAccounts.length > 0) {
      logger.info(`✅ 按类型查询成功，找到 ${claudeAccounts.length} 个 Claude 账户`)
    }

    // 4. 测试使用记录
    logger.info('\n4️⃣  测试使用记录...')
    const testRecord = {
      apiKeyId: testApiKey.id,
      accountId: testAccount.id,
      timestamp: new Date().toISOString(),
      model: 'claude-3-5-sonnet-20241022',
      inputTokens: 100,
      outputTokens: 200,
      cacheCreateTokens: 0,
      cacheReadTokens: 0,
      cost: 0.005,
      status: 'success'
    }

    sqlite.saveUsageRecord(testRecord)
    logger.info('✅ 使用记录已保存')

    const records = sqlite.getUsageRecords(testApiKey.id, 10)
    if (records.length > 0) {
      logger.info(`✅ 使用记录读取成功，找到 ${records.length} 条记录`)
    }

    // 5. 测试统计功能
    logger.info('\n5️⃣  测试数据库统计...')
    const stats = sqlite.getStats()
    logger.info('📊 数据库统计:')
    logger.info(`   - API Keys: ${stats.apiKeysCount}`)
    logger.info(`   - 账户: ${stats.accountsCount}`)
    logger.info(`   - 使用记录: ${stats.usageRecordsCount}`)
    logger.info(`   - 数据库大小: ${(stats.dbSize / 1024).toFixed(2)} KB`)
    logger.info(`   - 路径: ${stats.dbPath}`)

    // 6. 清理测试数据
    logger.info('\n6️⃣  清理测试数据...')
    sqlite.deleteApiKey(testApiKey.id)
    sqlite.deleteAccount(testAccount.id)
    logger.info('✅ 测试数据已清理')

    // 断开连接
    sqlite.disconnect()

    logger.info('\n========================================')
    logger.info('✅ 所有测试通过！')
    logger.info('========================================')
  } catch (error) {
    logger.error('❌ 测试失败:', error)
    process.exit(1)
  }
}

// 运行测试
testSQLite()
