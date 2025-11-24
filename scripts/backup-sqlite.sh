#!/bin/bash
# SQLite 自动备份脚本

set -e

# 配置
BACKUP_DIR="./backups/sqlite"
DB_FILE="./data/relay-service.db"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="sqlite_backup_${TIMESTAMP}.db"
RETENTION_DAYS=7

# 颜色
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# 创建备份目录
mkdir -p "${BACKUP_DIR}"

# 检查数据库文件
if [ ! -f "${DB_FILE}" ]; then
    log_warn "数据库文件不存在: ${DB_FILE}"
    exit 1
fi

# 备份数据库
log_info "开始备份 SQLite 数据库..."
cp "${DB_FILE}" "${BACKUP_DIR}/${BACKUP_NAME}"

# 压缩备份
log_info "压缩备份文件..."
gzip "${BACKUP_DIR}/${BACKUP_NAME}"

# 显示备份信息
BACKUP_SIZE=$(du -h "${BACKUP_DIR}/${BACKUP_NAME}.gz" | cut -f1)
log_info "备份完成: ${BACKUP_NAME}.gz (${BACKUP_SIZE})"

# 清理旧备份
log_info "清理超过 ${RETENTION_DAYS} 天的旧备份..."
find "${BACKUP_DIR}" -name "sqlite_backup_*.db.gz" -type f -mtime +${RETENTION_DAYS} -delete

log_info "备份任务完成！"
