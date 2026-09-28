#!/bin/bash
# Запускается НА СЕРВЕРЕ (через cron). Делает дамп Postgres, сжимает,
# хранит последние 14 штук — старые сами удаляются.
set -e

PROJECT_DIR="/root/support-desk-backend"
BACKUP_DIR="$PROJECT_DIR/backups"
mkdir -p "$BACKUP_DIR"

STAMP=$(date +%Y-%m-%d_%H-%M-%S)
FILE="$BACKUP_DIR/support_desk_$STAMP.sql.gz"

cd "$PROJECT_DIR"
docker compose exec -T db pg_dump -U support support_desk | gzip > "$FILE"

# ротация — оставляем последние 14 дампов (примерно 2 недели при суточном расписании)
ls -1t "$BACKUP_DIR"/support_desk_*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm --

echo "[$(date)] backup saved: $FILE ($(du -h "$FILE" | cut -f1))"
