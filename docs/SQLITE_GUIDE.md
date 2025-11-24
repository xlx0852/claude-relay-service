# SQLite 持久化层使用指南

## 概述

Claude Relay Service 现已支持 **Redis + SQLite 混合持久化方案**，提供更可靠的数据存储。

### 架构设计

```
┌─────────────┐
│  API 请求   │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Redis 缓存  │ ← 高性能（内存）
│ - 速率限制  │
│ - 并发控制  │
│ - 会话管理  │
└──────┬──────┘
       │
       │ 自动双写
       ▼
┌─────────────┐
│  SQLite DB  │ ← 持久化（磁盘）
│ - API Keys  │
│ - 账户数据  │
│ - 使用统计  │
└─────────────┘
```

### 核心特性

- ✅ **双写机制**: 关键数据同时写入 Redis 和 SQLite
- ✅ **自动恢复**: Redis 数据丢失时自动从 SQLite 恢复
- ✅ **零配置**: 默认启用，无需额外配置
- ✅ **备份简单**: SQLite 文件可直接复制备份
- ✅ **向后兼容**: 完全兼容现有 Redis 逻辑

---

## 快速开始

### 1. 启用 SQLite（默认已启用）

在 `.env` 文件中配置：

```bash
# 启用 SQLite 持久化
ENABLE_SQLITE=true

# 自定义数据库路径（可选）
SQLITE_DB_PATH=./data/relay-service.db
```

### 2. 启动服务

```bash
npm start
```

服务启动时会自动：
- 连接 Redis
- 初始化 SQLite 数据库
- 创建必要的表结构

### 3. 迁移现有数据

如果你有现有的 Redis 数据，运行迁移脚本：

```bash
npm run migrate:redis-to-sqlite
```

迁移完成后会显示统计信息：
```
✅ 迁移完成！
📊 迁移统计
API Keys: 10 个
账户: 5 个
数据库大小: 1.2 MB
```

---

## 数据存储策略

### 实时双写（关键数据）

以下数据会立即同时写入 Redis 和 SQLite：

- ✅ API Key 创建/删除
- ✅ 账户添加/更新/删除
- ✅ 账户凭据变更

### 优先从 Redis 读取

- 所有读取操作优先从 Redis 获取
- Redis 无数据时自动从 SQLite 恢复
- 恢复后自动回写 Redis

### 仅 SQLite 存储

- 使用记录详情（不影响性能）
- 历史统计数据
- 审计日志

---

## 数据恢复场景

### 场景 1: Redis 数据丢失

```bash
# 1. 检查 SQLite 数据
npm run migrate:redis-to-sqlite

# 2. 重启服务（自动从 SQLite 恢复）
npm restart
```

### 场景 2: 系统重启

服务启动时会自动：
1. 检查 Redis 连接
2. 检查 SQLite 数据库
3. 如 Redis 为空，从 SQLite 恢复关键数据

### 场景 3: 部分数据丢失

当访问某个 API Key 时：
1. 先查 Redis
2. Redis 无数据 → 自动查 SQLite
3. SQLite 有数据 → 恢复到 Redis
4. 返回数据给用户

**用户无感知，自动恢复！**

---

## 备份和恢复

### 自动备份

运行备份脚本：

```bash
npm run backup:sqlite
```

备份文件保存在 `backups/sqlite/` 目录：
- `sqlite_backup_20250124_120000.db.gz`
- 自动压缩节省空间
- 保留最近 7 天的备份

### 设置定时备份（推荐）

使用 crontab 设置每天自动备份：

```bash
# 编辑 crontab
crontab -e

# 添加定时任务（每天凌晨 2 点备份）
0 2 * * * cd /path/to/claude-relay-service && npm run backup:sqlite
```

### 手动备份

直接复制数据库文件：

```bash
# 备份
cp ./data/relay-service.db ./backups/manual_backup_$(date +%Y%m%d).db

# 压缩
gzip ./backups/manual_backup_$(date +%Y%m%d).db
```

### 恢复备份

```bash
# 1. 停止服务
npm run service:stop

# 2. 解压备份
gunzip ./backups/sqlite/sqlite_backup_20250124_120000.db.gz

# 3. 替换数据库文件
cp ./backups/sqlite/sqlite_backup_20250124_120000.db ./data/relay-service.db

# 4. 重启服务
npm run service:start
```

---

## 性能优化

### WAL 模式（已启用）

SQLite 使用 WAL (Write-Ahead Logging) 模式：
- ✅ 提高并发读写性能
- ✅ 减少锁等待
- ✅ 更好的崩溃恢复能力

### 索引优化

已创建关键索引：
- API Key 哈希索引（快速查找）
- 账户类型索引
- 使用统计时间索引

### 数据库维护

定期优化数据库：

```bash
node -e "
const sqlite = require('./src/models/sqlite');
sqlite.connect();
sqlite.optimize();
console.log('✅ SQLite 优化完成');
"
```

---

## 数据库结构

### api_keys 表

```sql
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  api_key_hash TEXT UNIQUE,
  name TEXT,
  description TEXT,
  token_limit INTEGER,
  rate_limit_rpm INTEGER,
  rate_limit_tpm INTEGER,
  is_active BOOLEAN,
  created_at DATETIME,
  updated_at DATETIME,
  last_used_at DATETIME,
  expires_at DATETIME,
  permissions TEXT,
  allowed_models TEXT,
  blacklist_models TEXT,
  allowed_clients TEXT,
  total_requests INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  total_input_tokens INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,
  total_cache_create_tokens INTEGER DEFAULT 0,
  total_cache_read_tokens INTEGER DEFAULT 0,
  total_cost REAL DEFAULT 0
);
```

### accounts 表

```sql
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  account_type TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  email TEXT,
  is_active BOOLEAN,
  status TEXT,
  created_at DATETIME,
  updated_at DATETIME,
  last_used_at DATETIME,
  expires_at DATETIME,
  proxy_config TEXT,
  encrypted_credentials TEXT,
  total_requests INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  total_input_tokens INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,
  total_cost REAL DEFAULT 0
);
```

### usage_records 表

```sql
CREATE TABLE usage_records (
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
);
```

---

## 常见问题

### Q: SQLite 会影响性能吗？

A: 不会。关键路径（速率限制、并发控制）仍使用 Redis，SQLite 只用于持久化存储。写入操作使用异步处理，不阻塞主流程。

### Q: 数据库文件会不会太大？

A: 正常情况下：
- 1000 个 API Keys: ~200KB
- 100 个账户: ~100KB
- 10万条使用记录: ~50MB

可通过定期清理旧记录控制大小。

### Q: 如何禁用 SQLite？

A: 在 `.env` 中设置：
```bash
ENABLE_SQLITE=false
```

### Q: Redis 和 SQLite 数据不一致怎么办？

A: 以 SQLite 为准，运行迁移脚本重新同步：
```bash
npm run migrate:redis-to-sqlite
```

### Q: 可以只用 SQLite 不用 Redis 吗？

A: 不建议。Redis 提供高性能缓存和速率限制，是必需的。SQLite 作为持久化层补充。

---

## 监控和调试

### 查看数据库统计

```bash
node -e "
const sqlite = require('./src/models/sqlite');
sqlite.connect();
console.log(sqlite.getStats());
"
```

输出：
```json
{
  "apiKeysCount": 10,
  "accountsCount": 5,
  "usageRecordsCount": 1234,
  "dbSize": 1234567,
  "dbPath": "/path/to/relay-service.db"
}
```

### 查询数据

使用 SQLite 客户端：

```bash
# 安装 sqlite3 命令行工具
brew install sqlite3  # macOS
apt-get install sqlite3  # Linux

# 连接数据库
sqlite3 ./data/relay-service.db

# 查询 API Keys
SELECT id, name, is_active, total_requests FROM api_keys;

# 查询账户
SELECT id, account_type, name, status FROM accounts;

# 查看表结构
.schema api_keys
```

### 日志监控

查看 SQLite 相关日志：

```bash
tail -f logs/claude-relay-*.log | grep -i "sqlite\|dual"
```

---

## 最佳实践

1. **定期备份**: 设置 crontab 每天自动备份
2. **监控数据库大小**: 超过 1GB 考虑清理旧数据
3. **定期优化**: 每周运行一次 `sqlite.optimize()`
4. **验证迁移**: 首次迁移后检查数据完整性
5. **保留备份**: 至少保留最近 7 天的备份

---

## 技术支持

遇到问题？
- 查看日志: `npm run service:logs`
- 检查数据库: `npm run data:debug`
- 重新迁移: `npm run migrate:redis-to-sqlite`
