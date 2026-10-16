# Panduan Deploy Melonbyte ke VPS

Panduan ini menuntun dari VPS kosong sampai `https://melonbyte.biz.id` aktif, lengkap dengan cadangan harian dan pemantauan.

Alur singkat:

1. Beli VPS dan siapkan dasar (pengguna, zona waktu, firewall).
2. Pasang Node 22, Caddy, git, dan klien PostgreSQL.
3. Tarik kode ke `/srv/melonbyte`.
4. Isi `.env` produksi.
5. Build berkas statis.
6. Pasang Caddyfile dan layanan systemd.
7. Arahkan DNS ke IP VPS.
8. Uji HTTPS, login, dan checkout sandbox.
9. Perbarui URL webhook Midtrans dan Digiflazz, serta Site URL Supabase.
10. Nyalakan cadangan harian dan pemantauan uptime.

Prasyarat: VPS Ubuntu 22.04 atau 24.04 (2 GB RAM cukup), domain `melonbyte.biz.id`, akses SSH, dan repo GitHub `Melonns/tokomantapjiwa`.

## 1. Siapkan VPS

Pilih region **Jakarta** bila kuota gratisnya tersedia, dengan **Singapore** sebagai cadangan. Keduanya dekat dengan pembeli di Indonesia; Jakarta memberi latensi paling rendah. Konfigurasi 2 vCPU dan 2 GB RAM sudah cukup untuk aplikasi ini. Region ditentukan saat pembelian dan tidak dapat dipindahkan setelahnya, jadi pastikan pilihan region dan konfigurasi sebelum menekan beli.

Buka port **22, 80, 443** di firewall penyedia (di Tencent Lighthouse: Firewall pada halaman instans). Port 3001 **tidak** dibuka ke internet.

```bash
# Perbarui sistem dan pasang perkakas dasar
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git ufw

# Zona waktu WIB agar log dan jadwal cadangan sesuai
sudo timedatectl set-timezone Asia/Jakarta

# Firewall: hanya SSH dan web
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

# Pengguna aplikasi (tanpa kata sandi, hanya kunci SSH)
sudo adduser --disabled-password --gecos "" melonbyte
sudo mkdir -p /srv/melonbyte
sudo chown melonbyte:melonbyte /srv/melonbyte
```

Agar skrip deploy boleh memulai ulang layanan tanpa kata sandi:

```bash
echo 'melonbyte ALL=(root) NOPASSWD: /usr/bin/systemctl restart melonbyte-api' | sudo tee /etc/sudoers.d/melonbyte-deploy
sudo chmod 440 /etc/sudoers.d/melonbyte-deploy
```

## 2. Pasang perkakas

```bash
# Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # harapan: v22.x

# Caddy (repositori resmi)
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

# Klien PostgreSQL untuk pg_dump
sudo apt install -y postgresql-client
pg_dump --version
```

Catatan: `pg_dump` harus sama atau lebih baru dari versi PostgreSQL Supabase. Bila muncul galat "server version mismatch", pasang klien versi yang sesuai dari repositori PGDG:

```bash
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" | sudo tee /etc/apt/sources.list.d/pgdg.list
sudo apt update && sudo apt install -y postgresql-client-17
```

## 3. Tarik kode

```bash
sudo -u melonbyte git clone https://github.com/Melonns/tokomantapjiwa.git /srv/melonbyte
cd /srv/melonbyte
```

Bila repo bersifat privat, pakai kunci deploy GitHub (Settings, Deploy keys) atau token akses pribadi. Jangan menaruh token di dalam repo.

## 4. Isi .env produksi

```bash
cd /srv/melonbyte
sudo -u melonbyte cp .env.example .env
sudo -u melonbyte nano .env
sudo chmod 600 .env
```

Nilai yang **wajib** berbeda dari lokal:

| Variabel | Nilai produksi |
|---|---|
| `STORE_URL` | `https://melonbyte.biz.id` |
| `SUPPORT_EMAIL` | alamat inbox dukungan Anda |
| `SUPPORT_WHATSAPP` | nomor WhatsApp dukungan, format `08xxxxxxxxxx` |
| `MIDTRANS_ENV` | biarkan `sandbox` sampai uji tuntas selesai |
| `DIGIFLAZZ_TESTING` | biarkan `true` sampai uji tuntas selesai |
| `CHECKOUT_ENABLED` | `true` hanya setelah semua uji lolos |
| `RATE_LIMIT_DISABLED` | biarkan kosong (pembatas percobaan harus aktif) |
| `RECONCILE_INTERVAL_MINUTES` | `10` |

Penting: `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY` disalin ke berkas hasil build **saat build**, jadi `.env` harus lengkap sebelum langkah 5. Sandi dan kunci server (`DATABASE_URL`, `MIDTRANS_SERVER_KEY`, `DIGIFLAZZ_API_KEY`, `BREVO_API_KEY`) hanya hidup di server ini dan tidak pernah ikut ke Git.

Catatan: berkas `prod-ca-2021.crt` tidak ikut Git. Server tetap hidup tanpa berkas itu karena memakai daftar akar bawaan Node. Bila ingin memakai sertifikat akar lama Supabase, salin berkasnya ke `/srv/melonbyte/` secara manual.

## 5. Build berkas statis

```bash
cd /srv/melonbyte
sudo -u melonbyte npm ci --no-audit --no-fund
sudo -u melonbyte npm run build
ls dist   # harus ada index.html, assets/, favicon.svg, robots.txt, sitemap.xml
```

## 6. Pasang Caddy dan layanan systemd

```bash
cd /srv/melonbyte

# Caddy
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile        # ganti email di blok awal dengan email aktif Anda
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy

# Layanan API
sudo cp deploy/melonbyte-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now melonbyte-api
sudo systemctl status melonbyte-api --no-pager
```

Caddy akan meminta sertifikat HTTPS saat pertama kali menerima permintaan untuk domain tersebut. Bila DNS belum mengarah ke VPS, Caddy akan mencoba ulang secara berkala; tidak ada yang perlu dilakukan.

Periksa API secara lokal:

```bash
curl -s http://127.0.0.1:3001/api/health
# harapan: {"ok":true,"db":"ok","time":"..."}
```

## 7. Arahkan DNS

Di panel DNS tempat `melonbyte.biz.id` dikelola, tambahkan:

| Jenis | Nama | Nilai |
|---|---|---|
| A | `@` | IP VPS Anda |
| A | `www` | IP VPS Anda (opsional) |

Tunggu propagasi (biasanya 5 sampai 60 menit), lalu periksa:

```bash
dig +short melonbyte.biz.id
curl -I https://melonbyte.biz.id
```

Bila `www` diaktifkan, buka komentar blok `www.melonbyte.biz.id` di `/etc/caddy/Caddyfile` lalu `sudo systemctl reload caddy`.

## 8. Uji setelah domain aktif

1. Buka `https://melonbyte.biz.id`, pastikan katalog termuat.
2. `https://melonbyte.biz.id/api/health` membalas `{"ok":true,"db":"ok"}`.
3. Daftar akun baru, verifikasi email, lalu masuk.
4. Checkout sandbox dengan kode promo `TEMAN1K`, bayar lewat simulator Midtrans, pastikan status berubah menjadi diproses.
5. Periksa header keamanan: `curl -I https://melonbyte.biz.id` harus memuat `strict-transport-security` dan `content-security-policy`.
6. Buka satu alamat ngawur seperti `https://melonbyte.biz.id/#apa-saja`, pastikan muncul halaman "Halaman tidak ditemukan".

## 9. Perbarui URL webhook dan Supabase

- Dashboard Midtrans: Notification URL menjadi `https://melonbyte.biz.id/api/webhooks/midtrans` (tanpa redirect).
- Dashboard Digiflazz: Webhook URL menjadi `https://melonbyte.biz.id/api/webhooks/digiflazz`, dengan Secret yang sama seperti `DIGIFLAZZ_WEBHOOK_SECRET`.
- Supabase, Authentication, URL Configuration: Site URL `https://melonbyte.biz.id` dan tambahkan `https://melonbyte.biz.id/**` ke Redirect URLs.

## 10. Cadangan harian

```bash
sudo -u melonbyte mkdir -p /srv/melonbyte/backup
sudo -u melonbyte bash /srv/melonbyte/deploy/backup-db.sh   # uji sekali

sudo crontab -e
```

Tambahkan baris berikut (cadangan pukul 03.15 WIB setiap hari, disimpan 14 hari):

```
15 3 * * * /usr/bin/bash /srv/melonbyte/deploy/backup-db.sh >> /var/log/melonbyte-backup.log 2>&1
```

Memulihkan cadangan bila diperlukan:

```bash
pg_restore --clean --no-owner --no-privileges --dbname "$DATABASE_URL" /srv/melonbyte/backup/melonbyte-XXXXXXXX-XXXXXX.dump
```

## 11. Pemantauan uptime

Buat monitor gratis di UptimeRobot (atau layanan serupa):

- Jenis: HTTP(s)
- URL: `https://melonbyte.biz.id/api/health`
- Interval: 5 menit
- Pemberitahuan: email Anda

Balasan 503 berarti API hidup tetapi basis data tidak dapat dihubungi, jadi monitor ini menangkap dua masalah sekaligus.

## 12. Pemeliharaan rutin

```bash
# Deploy versi terbaru
bash /srv/melonbyte/deploy/deploy.sh

# Log API
sudo journalctl -u melonbyte-api -n 100 --no-pager
sudo journalctl -u melonbyte-api -f

# Log Caddy
sudo tail -f /var/log/caddy/melonbyte.log

# Kembalikan ke versi sebelumnya
cd /srv/melonbyte && git log --oneline -5
sudo -u melonbyte git reset --hard <commit-lama>
sudo -u melonbyte npm run build && sudo systemctl restart melonbyte-api
```

Pembaruan sistem setiap bulan:

```bash
sudo apt update && sudo apt upgrade -y
sudo systemctl restart melonbyte-api
```

## 13. Daftar periksa keamanan

- Masuk SSH memakai kunci, bukan kata sandi (`PasswordAuthentication no` di `/etc/ssh/sshd_config`).
- Port 3001 tidak pernah dibuka ke internet; hanya Caddy yang menjangkau API.
- Caddy menimpa `X-Forwarded-For` dengan alamat asli klien dan membuang `Cf-Connecting-Ip`, sehingga pembatas percobaan per IP tidak dapat dilewati dengan header palsu. Bila nanti menaruh Cloudflare di depan Caddy, sesuaikan pengaturan ini agar alamat asli tetap benar.
- `.env` bermode `600` dan tidak pernah masuk Git.
- Bila ada kunci yang pernah tampil di luar server (tangkapan layar, obrolan, atau repositori), ganti kuncinya di penyedia masing-masing lalu perbarui `.env` dan mulai ulang layanan.
- Aktifkan 2FA pada akun GitHub, Midtrans, Digiflazz, Supabase, dan Brevo.
