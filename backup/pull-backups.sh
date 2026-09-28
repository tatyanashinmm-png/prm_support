#!/bin/bash
# Запускается НА МАКЕ. Скачивает свежие дампы с сервера в локальную папку —
# вторая копия на случай полной потери сервера, не только диска.
set -e

SERVER="root@31.58.171.228"
REMOTE_DIR="/root/support-desk-backend/backups"
LOCAL_DIR="$HOME/support-desk-backups"

mkdir -p "$LOCAL_DIR"
scp "$SERVER:$REMOTE_DIR/*.sql.gz" "$LOCAL_DIR/" 2>&1 | grep -v "^$" || true

echo "Готово. Локально хранится:"
ls -lh "$LOCAL_DIR"/*.sql.gz 2>/dev/null | tail -5
