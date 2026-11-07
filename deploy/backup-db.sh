#!/usr/bin/env bash
# Cadangan harian basis data Supabase memakai pg_dump.
# Contoh cron (server sudah memakai zona waktu Asia/Jakarta):
#   15 3 * * * /usr/bin/bash /srv/melonbyte/deploy/backup-db.sh >> /var/log/melonbyte-backup.log 2>&1
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/melonbyte}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backup}"
KEEP_DAYS="${KEEP_DAYS:-14}"
BACKUP_REMOTE="${BACKUP_REMOTE:-}"

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
ERR="/tmp/melonbyte-backup-$$.log"

# ponytail: satu percobaan ulang; gagal dua kali berarti ada masalah nyata yang harus dilihat manusia.
if ! pg_dump --no-owner --no-privileges --format=custom --file="$TARGET" "$DATABASE_URL" 2>"$ERR"; then
  sleep 30
  if ! pg_dump --no-owner --no-privileges --format=custom --file="$TARGET" "$DATABASE_URL" 2>"$ERR"; then
    msg="cadangan GAGAL: $(tail -n 3 "$ERR" | tr '\n' ' ')"
    rm -f "$ERR"
    echo "$(date '+%Y-%m-%d %H:%M:%S') $msg" >&2
    if [ -n "${BACKUP_ALERT_URL:-}" ] && command -v curl >/dev/null; then curl -fsS -m 10 -X POST "$BACKUP_ALERT_URL" --data-urlencode "text=$msg" >/dev/null || true; fi
    exit 1
  fi
fi
rm -f "$ERR"

# ponytail: cadangan yang tidak bisa dibaca ulang sama saja tidak ada. Cek daftar isinya, bukan cuma ukuran file.
if ! pg_restore --list "$TARGET" >/dev/null 2>&1; then
  msg="cadangan RUSAK (pg_restore --list gagal): $TARGET"
  echo "$(date '+%Y-%m-%d %H:%M:%S') $msg" >&2
  if [ -n "${BACKUP_ALERT_URL:-}" ] && command -v curl >/dev/null; then curl -fsS -m 10 -X POST "$BACKUP_ALERT_URL" --data-urlencode "text=$msg" >/dev/null || true; fi
  exit 1
fi

find "$BACKUP_DIR" -maxdepth 1 -name 'melonbyte-*.dump' -type f -mtime +"$KEEP_DAYS" -delete

# ponytail: salinan kedua di luar VPS. Tanpa ini cadangan hilang bersama servernya.
if [ -n "$BACKUP_REMOTE" ]; then
  command -v rclone >/dev/null || { echo "$(date '+%Y-%m-%d %H:%M:%S') rclone tidak ada; salinan luar dilewati" >&2; exit 1; }
  rclone copy "$TARGET" "$BACKUP_REMOTE" --no-traverse || { echo "$(date '+%Y-%m-%d %H:%M:%S') salinan luar GAGAL: $BACKUP_REMOTE" >&2; exit 1; }
fi

echo "$(date '+%Y-%m-%d %H:%M:%S') cadangan selesai: $TARGET ($(du -h "$TARGET" | cut -f1))"
