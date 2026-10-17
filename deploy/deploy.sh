#!/usr/bin/env bash
# Deploy Melonbyte: tarik kode terbaru, pasang dependensi, jalankan tes, build, lalu mulai ulang API.
# Jalankan di VPS sebagai pengguna layanan (di panduan ini: melon):
#   bash /srv/melonbyte/deploy/deploy.sh
# Lewati tes bila perlu (tidak disarankan): SKIP_TESTS=1 bash deploy/deploy.sh
# Skrip ini tidak terikat satu proyek: APP_DIR, BRANCH, SERVICE, dan HEALTH_URL dapat ditimpa lewat variabel lingkungan.
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/melonbyte}"
BRANCH="${BRANCH:-main}"
SERVICE="${SERVICE:-melonbyte-api}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3001/api/health}"

cd "$APP_DIR"

echo "==> Menarik kode terbaru dari cabang $BRANCH"
git fetch --prune origin
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "==> Memasang dependensi"
npm ci --no-audit --no-fund

if [ "${SKIP_TESTS:-0}" != "1" ]; then
  echo "==> Menjalankan tes"
  npm test
fi

# Vite menyalin VITE_* dari .env saat build, jadi berkas .env wajib sudah terisi sebelum langkah ini.
echo "==> Membangun berkas statis"
npm run build

echo "==> Memulai ulang layanan $SERVICE"
sudo systemctl restart "$SERVICE"
sleep 2
systemctl is-active "$SERVICE"

echo "==> Memeriksa titik kesehatan"
curl -fsS "$HEALTH_URL"
echo
echo "Selesai. Buka https://melonbyte.biz.id untuk memastikan tampilannya."
