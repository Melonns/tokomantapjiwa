#!/usr/bin/env bash
# Cadangan harian basis data Supabase memakai pg_dump.
# Contoh cron (server sudah memakai zona waktu Asia/Jakarta):
#   15 3 * * * /usr/bin/bash /srv/melonbyte/deploy/backup-db.sh >> /var/log/melonbyte-backup.log 2>&1
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/melonbyte}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backup}"
KEEP_DAYS="${KEEP_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
umask 077

# DATABASE_URL dibaca langsung dari .env supaya sandi tidak perlu ditulis di crontab.
DATABASE_URL="$(sed -n 's/^[[:space:]]*DATABASE_URL=//p' "$APP_DIR/.env" | tail -n 1)"
DATABASE_URL="${DATABASE_URL%\"}"; DATABASE_URL="${DATABASE_URL#\"}"
DATABASE_URL="${DATABASE_URL%\'}"; DATABASE_URL="${DATABASE_URL#\'}"
: "${DATABASE_URL:?DATABASE_URL belum diisi di $APP_DIR/.env}"

STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="$BACKUP_DIR/melonbyte-$STAMP.dump"

pg_dump --no-owner --no-privileges --format=custom --file="$TARGET" "$DATABASE_URL"
find "$BACKUP_DIR" -maxdepth 1 -name 'melonbyte-*.dump' -type f -mtime +"$KEEP_DAYS" -delete

echo "$(date '+%Y-%m-%d %H:%M:%S') cadangan selesai: $TARGET ($(du -h "$TARGET" | cut -f1))"
