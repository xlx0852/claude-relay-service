const Database = require('better-sqlite3')
const path = require('path')
const fs = require('fs')
const logger = require('../utils/logger')
const config = require('../../config/config')

class SQLiteClient {
  constructor() {
    this.db = null
    this.isConnected = false
    this.dbPath = path.join(__dirname, '../../data/relay-service.db')
  }

  /**
   * 连接数据库
   */
  connect() {
    try {
      // 确保 data 目录存在
      const dataDir = path.dirname(this.dbPath)
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true })
      }

      // 创建/打开数据库
      this.db = new Database(this.dbPath, {
        verbose: config.development.debug ? logger.debug : null
      })

      // 启用 WAL 模式（提高并发性能）
      this.db.pragma('journal_mode = WAL')

      // 启用外键约束
      this.db.pragma('foreign_keys = ON')

      // 初始化数据库表
      this.initTables()

      this.isConnected = true
      logger.info(`🗄️  SQLite connected: ${this.dbPath}`)

      return this.db
    } catch (error) {
      logger.error('💥 Failed to connect to SQLite:', error)
      throw error
    }
  }

  /**
   * 初始化数据库表结构
   */
  initTables() {
    // API Keys 表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        api_key_hash TEXT NOT NULL UNIQUE,
        name TEXT,
        description TEXT,
        token_limit INTEGER DEFAULT 1000000,
        rate_limit_rpm INTEGER,
        rate_limit_tpm INTEGER,
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_used_at DATETIME,
        expires_at DATETIME,
        
        -- 权限控制
        permissions TEXT,
        allowed_models TEXT,
        blacklist_models TEXT,
        allowed_clients TEXT,
        
        -- 使用统计（定期从 Redis 同步）
        total_requests INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        total_input_tokens INTEGER DEFAULT 0,
        total_output_tokens INTEGER DEFAULT 0,
        total_cache_create_tokens INTEGER DEFAULT 0,
        total_cache_read_tokens INTEGER DEFAULT 0,
        
        -- 费用统计
        total_cost REAL DEFAULT 0
      )
    `)

    // 账户表（通用）
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        account_type TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        email TEXT,
        is_active BOOLEAN DEFAULT 1,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_used_at DATETIME,
        expires_at DATETIME,
        
        -- 代理配置（JSON）
        proxy_config TEXT,
        
        -- 加密的凭据（JSON）
        encrypted_credentials TEXT,
        
        -- 使用统计
        total_requests INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        total_input_tokens INTEGER DEFAULT 0,
        total_output_tokens INTEGER DEFAULT 0,
        total_cost REAL DEFAULT 0
      )
    `)

    // 使用统计表（按小时聚合）
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS usage_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        stat_type TEXT NOT NULL,
        timestamp DATETIME NOT NULL,
        
        requests INTEGER DEFAULT 0,
        tokens INTEGER DEFAULT 0,
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        cache_create_tokens INTEGER DEFAULT 0,
        cache_read_tokens INTEGER DEFAULT 0,
        
        cost REAL DEFAULT 0,
        
        model TEXT,
        
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        
        UNIQUE(entity_type, entity_id, stat_type, timestamp, model)
      )
    `)

    // 使用记录表（详细记录）
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS usage_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        api_key_id TEXT NOT NULL,
        account_id TEXT,
        timestamp DATETIME NOT NULL,
        
        model TEXT NOT NULL,
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        cache_create_tokens INTEGER DEFAULT 0,
        cache_read_tokens INTEGER DEFAULT 0,
        
        cost REAL DEFAULT 0,
        
        request_duration_ms INTEGER,
        status TEXT,
        error_message TEXT,
        
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        
        FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE CASCADE
      )
    `)

    // 系统配置表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS system_config (
        key TEXT PRIMARY KEY,
        value TEXT,
        description TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // 创建索引
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active);
      CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(api_key_hash);
      CREATE INDEX IF NOT EXISTS idx_accounts_type ON accounts(account_type);
      CREATE INDEX IF NOT EXISTS idx_accounts_active ON accounts(is_active);
      CREATE INDEX IF NOT EXISTS idx_usage_stats_entity ON usage_stats(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_usage_stats_timestamp ON usage_stats(timestamp);
      CREATE INDEX IF NOT EXISTS idx_usage_records_key ON usage_records(api_key_id);
      CREATE INDEX IF NOT EXISTS idx_usage_records_timestamp ON usage_records(timestamp);
    `)

    logger.info('✅ SQLite tables initialized')
  }

  /**
   * 断开连接
   */
  disconnect() {
    if (this.db) {
      this.db.close()
      this.isConnected = false
      logger.info('👋 SQLite disconnected')
    }
  }

  /**
   * 获取数据库实例
   */
  getDB() {
    if (!this.db || !this.isConnected) {
      logger.warn('⚠️ SQLite client is not connected')
      return null
    }
    return this.db
  }

  /**
   * 安全获取数据库实例
   */
  getDBSafe() {
    if (!this.db || !this.isConnected) {
      throw new Error('SQLite client is not connected')
    }
    return this.db
  }

  // ========================================
  // API Key 操作
  // ========================================

  /**
   * 保存 API Key
   */
  saveApiKey(keyData) {
    const db = this.getDBSafe()

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO api_keys (
        id, api_key_hash, name, description, token_limit, rate_limit_rpm, rate_limit_tpm,
        is_active, created_at, updated_at, last_used_at, expires_at,
        permissions, allowed_models, blacklist_models, allowed_clients,
        total_requests, total_tokens, total_input_tokens, total_output_tokens,
        total_cache_create_tokens, total_cache_read_tokens, total_cost
      ) VALUES (
        @id, @apiKeyHash, @name, @description, @tokenLimit, @rateLimitRpm, @rateLimitTpm,
        @isActive, @createdAt, @updatedAt, @lastUsedAt, @expiresAt,
        @permissions, @allowedModels, @blacklistModels, @allowedClients,
        @totalRequests, @totalTokens, @totalInputTokens, @totalOutputTokens,
        @totalCacheCreateTokens, @totalCacheReadTokens, @totalCost
      )
    `)

    return stmt.run({
      id: keyData.id,
      apiKeyHash: keyData.apiKey,
      name: keyData.name || null,
      description: keyData.description || null,
      tokenLimit: parseInt(keyData.tokenLimit) || 1000000,
      rateLimitRpm: keyData.rateLimitRpm ? parseInt(keyData.rateLimitRpm) : null,
      rateLimitTpm: keyData.rateLimitTpm ? parseInt(keyData.rateLimitTpm) : null,
      isActive: keyData.isActive === 'true' || keyData.isActive === true ? 1 : 0,
      createdAt: keyData.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastUsedAt: keyData.lastUsedAt || null,
      expiresAt: keyData.expiresAt || null,
      permissions: keyData.permissions || null,
      allowedModels: keyData.allowedModels || null,
      blacklistModels: keyData.blacklistModels || null,
      allowedClients: keyData.allowedClients || null,
      totalRequests: parseInt(keyData.totalRequests) || 0,
      totalTokens: parseInt(keyData.totalTokens) || 0,
      totalInputTokens: parseInt(keyData.totalInputTokens) || 0,
      totalOutputTokens: parseInt(keyData.totalOutputTokens) || 0,
      totalCacheCreateTokens: parseInt(keyData.totalCacheCreateTokens) || 0,
      totalCacheReadTokens: parseInt(keyData.totalCacheReadTokens) || 0,
      totalCost: parseFloat(keyData.totalCost) || 0
    })
  }

  /**
   * 获取 API Key
   */
  getApiKey(keyId) {
    const db = this.getDBSafe()
    const stmt = db.prepare('SELECT * FROM api_keys WHERE id = ?')
    return stmt.get(keyId)
  }

  /**
   * 通过 Hash 查找 API Key
   */
  getApiKeyByHash(hash) {
    const db = this.getDBSafe()
    const stmt = db.prepare('SELECT * FROM api_keys WHERE api_key_hash = ?')
    return stmt.get(hash)
  }

  /**
   * 获取所有 API Keys
   */
  getAllApiKeys() {
    const db = this.getDBSafe()
    const stmt = db.prepare('SELECT * FROM api_keys ORDER BY created_at DESC')
    return stmt.all()
  }

  /**
   * 删除 API Key
   */
  deleteApiKey(keyId) {
    const db = this.getDBSafe()
    const stmt = db.prepare('DELETE FROM api_keys WHERE id = ?')
    return stmt.run(keyId)
  }

  /**
   * 更新 API Key 使用统计
   */
  updateApiKeyUsage(keyId, usage) {
    const db = this.getDBSafe()
    const stmt = db.prepare(`
      UPDATE api_keys 
      SET 
        total_requests = total_requests + @requests,
        total_tokens = total_tokens + @tokens,
        total_input_tokens = total_input_tokens + @inputTokens,
        total_output_tokens = total_output_tokens + @outputTokens,
        total_cache_create_tokens = total_cache_create_tokens + @cacheCreateTokens,
        total_cache_read_tokens = total_cache_read_tokens + @cacheReadTokens,
        total_cost = total_cost + @cost,
        last_used_at = @lastUsedAt,
        updated_at = @updatedAt
      WHERE id = @keyId
    `)

    return stmt.run({
      keyId,
      requests: parseInt(usage.requests) || 0,
      tokens: parseInt(usage.tokens) || 0,
      inputTokens: parseInt(usage.inputTokens) || 0,
      outputTokens: parseInt(usage.outputTokens) || 0,
      cacheCreateTokens: parseInt(usage.cacheCreateTokens) || 0,
      cacheReadTokens: parseInt(usage.cacheReadTokens) || 0,
      cost: parseFloat(usage.cost) || 0,
      lastUsedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })
  }

  // ========================================
  // 账户操作
  // ========================================

  /**
   * 保存账户
   */
  saveAccount(accountData) {
    const db = this.getDBSafe()

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO accounts (
        id, account_type, name, description, email, is_active, status,
        created_at, updated_at, last_used_at, expires_at,
        proxy_config, encrypted_credentials,
        total_requests, total_tokens, total_input_tokens, total_output_tokens, total_cost
      ) VALUES (
        @id, @accountType, @name, @description, @email, @isActive, @status,
        @createdAt, @updatedAt, @lastUsedAt, @expiresAt,
        @proxyConfig, @encryptedCredentials,
        @totalRequests, @totalTokens, @totalInputTokens, @totalOutputTokens, @totalCost
      )
    `)

    return stmt.run({
      id: accountData.id,
      accountType: accountData.accountType,
      name: accountData.name,
      description: accountData.description || null,
      email: accountData.email || null,
      isActive: accountData.isActive === 'true' || accountData.isActive === true ? 1 : 0,
      status: accountData.status || 'active',
      createdAt: accountData.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastUsedAt: accountData.lastUsedAt || null,
      expiresAt: accountData.expiresAt || null,
      proxyConfig: accountData.proxyConfig ? JSON.stringify(accountData.proxyConfig) : null,
      encryptedCredentials: accountData.encryptedCredentials || null,
      totalRequests: parseInt(accountData.totalRequests) || 0,
      totalTokens: parseInt(accountData.totalTokens) || 0,
      totalInputTokens: parseInt(accountData.totalInputTokens) || 0,
      totalOutputTokens: parseInt(accountData.totalOutputTokens) || 0,
      totalCost: parseFloat(accountData.totalCost) || 0
    })
  }

  /**
   * 获取账户
   */
  getAccount(accountId) {
    const db = this.getDBSafe()
    const stmt = db.prepare('SELECT * FROM accounts WHERE id = ?')
    const account = stmt.get(accountId)

    if (account && account.proxy_config) {
      try {
        account.proxy_config = JSON.parse(account.proxy_config)
      } catch (e) {
        account.proxy_config = null
      }
    }

    return account
  }

  /**
   * 获取指定类型的所有账户
   */
  getAccountsByType(accountType) {
    const db = this.getDBSafe()
    const stmt = db.prepare(
      'SELECT * FROM accounts WHERE account_type = ? ORDER BY created_at DESC'
    )
    const accounts = stmt.all(accountType)

    return accounts.map((account) => {
      if (account.proxy_config) {
        try {
          account.proxy_config = JSON.parse(account.proxy_config)
        } catch (e) {
          account.proxy_config = null
        }
      }
      return account
    })
  }

  /**
   * 获取所有账户
   */
  getAllAccounts() {
    const db = this.getDBSafe()
    const stmt = db.prepare('SELECT * FROM accounts ORDER BY created_at DESC')
    return stmt.all()
  }

  /**
   * 删除账户
   */
  deleteAccount(accountId) {
    const db = this.getDBSafe()
    const stmt = db.prepare('DELETE FROM accounts WHERE id = ?')
    return stmt.run(accountId)
  }

  // ========================================
  // 使用统计操作
  // ========================================

  /**
   * 保存使用统计
   */
  saveUsageStat(stat) {
    const db = this.getDBSafe()

    const stmt = db.prepare(`
      INSERT INTO usage_stats (
        entity_type, entity_id, stat_type, timestamp,
        requests, tokens, input_tokens, output_tokens,
        cache_create_tokens, cache_read_tokens, cost, model
      ) VALUES (
        @entityType, @entityId, @statType, @timestamp,
        @requests, @tokens, @inputTokens, @outputTokens,
        @cacheCreateTokens, @cacheReadTokens, @cost, @model
      )
      ON CONFLICT(entity_type, entity_id, stat_type, timestamp, model) DO UPDATE SET
        requests = requests + @requests,
        tokens = tokens + @tokens,
        input_tokens = input_tokens + @inputTokens,
        output_tokens = output_tokens + @outputTokens,
        cache_create_tokens = cache_create_tokens + @cacheCreateTokens,
        cache_read_tokens = cache_read_tokens + @cacheReadTokens,
        cost = cost + @cost
    `)

    return stmt.run({
      entityType: stat.entityType,
      entityId: stat.entityId,
      statType: stat.statType,
      timestamp: stat.timestamp,
      requests: parseInt(stat.requests) || 0,
      tokens: parseInt(stat.tokens) || 0,
      inputTokens: parseInt(stat.inputTokens) || 0,
      outputTokens: parseInt(stat.outputTokens) || 0,
      cacheCreateTokens: parseInt(stat.cacheCreateTokens) || 0,
      cacheReadTokens: parseInt(stat.cacheReadTokens) || 0,
      cost: parseFloat(stat.cost) || 0,
      model: stat.model || null
    })
  }

  /**
   * 获取使用统计
   */
  getUsageStats(entityType, entityId, statType, startTime, endTime) {
    const db = this.getDBSafe()

    let query = `
      SELECT * FROM usage_stats 
      WHERE entity_type = ? AND entity_id = ? AND stat_type = ?
    `
    const params = [entityType, entityId, statType]

    if (startTime) {
      query += ' AND timestamp >= ?'
      params.push(startTime)
    }

    if (endTime) {
      query += ' AND timestamp <= ?'
      params.push(endTime)
    }

    query += ' ORDER BY timestamp DESC'

    const stmt = db.prepare(query)
    return stmt.all(...params)
  }

  /**
   * 保存使用记录
   */
  saveUsageRecord(record) {
    const db = this.getDBSafe()

    const stmt = db.prepare(`
      INSERT INTO usage_records (
        api_key_id, account_id, timestamp, model,
        input_tokens, output_tokens, cache_create_tokens, cache_read_tokens,
        cost, request_duration_ms, status, error_message
      ) VALUES (
        @apiKeyId, @accountId, @timestamp, @model,
        @inputTokens, @outputTokens, @cacheCreateTokens, @cacheReadTokens,
        @cost, @requestDurationMs, @status, @errorMessage
      )
    `)

    return stmt.run({
      apiKeyId: record.apiKeyId,
      accountId: record.accountId || null,
      timestamp: record.timestamp || new Date().toISOString(),
      model: record.model,
      inputTokens: parseInt(record.inputTokens) || 0,
      outputTokens: parseInt(record.outputTokens) || 0,
      cacheCreateTokens: parseInt(record.cacheCreateTokens) || 0,
      cacheReadTokens: parseInt(record.cacheReadTokens) || 0,
      cost: parseFloat(record.cost) || 0,
      requestDurationMs: parseInt(record.requestDurationMs) || null,
      status: record.status || 'success',
      errorMessage: record.errorMessage || null
    })
  }

  /**
   * 获取使用记录
   */
  getUsageRecords(apiKeyId, limit = 100) {
    const db = this.getDBSafe()
    const stmt = db.prepare(`
      SELECT * FROM usage_records 
      WHERE api_key_id = ? 
      ORDER BY timestamp DESC 
      LIMIT ?
    `)
    return stmt.all(apiKeyId, limit)
  }

  // ========================================
  // 系统配置操作
  // ========================================

  /**
   * 设置系统配置
   */
  setConfig(key, value, description = null) {
    const db = this.getDBSafe()
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO system_config (key, value, description, updated_at)
      VALUES (?, ?, ?, ?)
    `)
    return stmt.run(key, value, description, new Date().toISOString())
  }

  /**
   * 获取系统配置
   */
  getConfig(key) {
    const db = this.getDBSafe()
    const stmt = db.prepare('SELECT value FROM system_config WHERE key = ?')
    const result = stmt.get(key)
    return result ? result.value : null
  }

  // ========================================
  // 事务支持
  // ========================================

  /**
   * 执行事务
   */
  transaction(callback) {
    const db = this.getDBSafe()
    const transaction = db.transaction(callback)
    return transaction()
  }

  // ========================================
  // 备份和维护
  // ========================================

  /**
   * 备份数据库
   */
  backup(backupPath) {
    const db = this.getDBSafe()
    return db.backup(backupPath)
  }

  /**
   * 优化数据库
   */
  optimize() {
    const db = this.getDBSafe()
    db.pragma('optimize')
    db.exec('VACUUM')
    logger.info('🔧 SQLite database optimized')
  }

  /**
   * 获取数据库统计信息
   */
  getStats() {
    const db = this.getDBSafe()

    const apiKeysCount = db.prepare('SELECT COUNT(*) as count FROM api_keys').get().count
    const accountsCount = db.prepare('SELECT COUNT(*) as count FROM accounts').get().count
    const usageRecordsCount = db.prepare('SELECT COUNT(*) as count FROM usage_records').get().count

    const dbSize = fs.existsSync(this.dbPath) ? fs.statSync(this.dbPath).size : 0

    return {
      apiKeysCount,
      accountsCount,
      usageRecordsCount,
      dbSize,
      dbPath: this.dbPath
    }
  }
}

// 导出单例实例
const sqliteClient = new SQLiteClient()

module.exports = sqliteClient
