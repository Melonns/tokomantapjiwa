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

Prasyarat: VPS Ubuntu 22.04 atau 24.04 (Oracle Cloud Always Free, Tencent Lighthouse, atau penyedia lain), domain `melonbyte.biz.id`, akses SSH, dan repo GitHub `Melonns/tokomantapjiwa`. Untuk Oracle Cloud, baca lampiran di akhir berkas ini lebih dahulu.

## Konvensi penamaan

Nama mesin dibuat generik karena satu VPS dapat menampung beberapa proyek kelak. Nama proyek hanya dipakai pada hal yang memang milik proyek itu.

| Tingkat | Contoh | Keterangan |
|---|---|---|
| Instans dan hostname | `melon-vps` | Nama di Console penyedia. Oracle memakai nama ini sebagai hostname. |
| Pengguna layanan di server | `melon` | Satu pengguna untuk semua proyek. Bila kelak ingin pemisahan ketat antarproyek, buat pengguna terpisah per proyek lalu ubah `User=` dan `Group=` pada unit systemd-nya. |
| Kunci SSH | `~/.ssh/melon_oracle` | Dipakai untuk masuk ke semua instans di akun Oracle ini. |
| Alamat IP tetap | `melon-ip` | Nama alamat IP yang direservasi. |
| Folder proyek | `/srv/melonbyte` | Satu folder per proyek. Proyek berikutnya memakai `/srv/<nama-proyek>`. |
| Unit systemd | `melonbyte-api` | Satu unit per proyek, mengikuti nama proyek. |
| Situs Caddy | `melonbyte.biz.id` | Satu blok per domain. |

## 1. Siapkan VPS

Untuk **Oracle Cloud (Always Free)**, pilih region **Batam** (`ap-batam-1`, Indonesia Utara); rinciannya ada di lampiran di akhir berkas ini. Untuk penyedia lain, pilih region **Jakarta** bila tersedia dengan **Singapore** sebagai cadangan; keduanya dekat dengan pembeli di Indonesia, dan Jakarta memberi latensi paling rendah. Konfigurasi 2 vCPU dan 2 GB RAM sudah cukup untuk aplikasi ini. Region tidak dapat dipindahkan setelah instans dibuat, jadi pastikan pilihan region dan konfigurasi sebelum menekan beli.

Buka port **22, 80, 443** di firewall penyedia (di Tencent Lighthouse: Firewall pada halaman instans; di Oracle Cloud: Security List pada VCN, lihat lampiran). Port 3001 **tidak** dibuka ke internet.

```bash
# Perbarui sistem dan pasang perkakas dasar
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git ufw nano

# Zona waktu WIB agar log dan jadwal cadangan sesuai
sudo timedatectl set-timezone Asia/Jakarta

# Firewall: hanya SSH dan web
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

# Pengguna aplikasi (tanpa kata sandi, hanya kunci SSH)
sudo adduser --disabled-password --gecos "" melon
sudo mkdir -p /srv/melonbyte
sudo chown melon:melon /srv/melonbyte
```

Agar skrip deploy boleh memulai ulang layanan tanpa kata sandi:

```bash
echo 'melon ALL=(root) NOPASSWD: /usr/bin/systemctl restart melonbyte-api' | sudo tee /etc/sudoers.d/melon-deploy
sudo chmod 440 /etc/sudoers.d/melon-deploy
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
sudo -u melon git clone https://github.com/Melonns/tokomantapjiwa.git /srv/melonbyte
cd /srv/melonbyte
```

Bila repo bersifat privat, pakai kunci deploy GitHub (Settings, Deploy keys) atau token akses pribadi. Jangan menaruh token di dalam repo.

## 4. Isi .env produksi

```bash
cd /srv/melonbyte
sudo -u melon cp .env.example .env
sudo -u melon nano .env
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
sudo -u melon npm ci --no-audit --no-fund
sudo -u melon npm run build
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

Bila `www` diaktifkan, blok `www.melonbyte.biz.id` sudah tersedia di Caddyfile; arahkan DNS `www` ke domain utama atau IP VPS, lalu `sudo systemctl reload caddy`.

Bila memakai Cloudflare:

- Proxy hanya untuk record web (`A`/`CNAME`); record `MX`, `TXT`, dan DKIM harus **DNS only**.
- SSL/TLS: **Full (strict)**, Always Use HTTPS, Minimum TLS 1.2.
- Jangan aktifkan Bot Fight Mode atau Under Attack Mode secara permanen karena dapat memblokir webhook.
- Caddyfile sudah memuat `trusted_proxies` Cloudflare. UFW hanya membuka 80/443 dari daftar IP Cloudflare; perbarui daftar itu bila Cloudflare mengubah range.
- Setelah aktif, `curl -I https://melonbyte.biz.id` harus memuat `server: cloudflare` dan `cf-ray`.

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
sudo -u melon mkdir -p /srv/melonbyte/backup
sudo -u melon bash /srv/melonbyte/deploy/backup-db.sh   # uji sekali

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
sudo -u melon git reset --hard <commit-lama>
sudo -u melon npm run build && sudo systemctl restart melonbyte-api
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
- Pembatas percobaan aktif untuk seluruh API, login, checkout, cek akun, voucher, dan webhook. `RATE_LIMIT_DISABLED=1` ditolak saat `NODE_ENV=production`.
- Caddy membatasi ukuran header, ukuran badan permintaan, dan waktu baca/tulis; folder `.env`, `.git`, serta jalur pemindai umum dijawab 404.
- UFW memakai `limit` untuk SSH; fail2ban mengelola dua jail: `sshd` dan `caddy-ratelimit` (429 berulang).
- Layanan API berjalan sebagai `melon`, hanya mendengarkan `127.0.0.1:3001`, dan memakai pengerasan systemd (`systemd-analyze security melonbyte-api`).
- Semua tabel publik mengaktifkan RLS dan mencabut akses `anon`/`authenticated`; API memakai koneksi server, bukan kunci publik browser.
- `npm audit --omit=dev` harus tetap bersih sebelum deploy.

## Lampiran: Catatan khusus Oracle Cloud (Always Free)

Seluruh langkah di atas tetap berlaku di Oracle Cloud. Yang berbeda hanya penyiapan akun, bentuk instans, dan jaringannya. Urutan mengeklik di Console ada di [deploy/LANGKAH-ORACLE.md](deploy/LANGKAH-ORACLE.md).

### Spesifikasi yang dipilih

| Bagian | Pilihan | Alasan |
|---|---|---|
| Region | Batam (`ap-batam-1`, Indonesia Utara) | Terdekat dengan pembeli di Indonesia. Region ini memiliki satu availability domain dan sudah tersedia sejak Mei 2025. |
| Bentuk (shape) | `VM.Standard.A1.Flex`, 2 OCPU, 12 GB RAM | Tepat sebesar jatah gratis: 1.500 OCPU-jam dan 9.000 GB-jam per bulan, cukup untuk 2 OCPU dan 12 GB menyala terus. |
| Prosesor | Arm (aarch64) | Seluruh perkakas proyek ini mendukung Arm: Node 22, Caddy, Vite, Rollup, esbuild, dan modul `pg` yang murni JavaScript. |
| Image | Ubuntu 24.04 (arm64) | Sama seperti panduan di atas, sehingga semua perintah `apt` dapat dipakai apa adanya. |
| Boot volume | 50 GB (bawaan) | Diambil dari jatah 200 GB penyimpanan gratis; sisanya tetap tersedia bila diperlukan. |
| IP publik | IPv4, lalu **reserve** | Alamat sementara terikat pada instans dan ikut terhapus saat instans dibuang, sehingga DNS dan sertifikat HTTPS harus diperbarui. Reservasi membuat alamat tetap dan dapat dipasang ulang ke instans baru. |

Jatah Always Free yang lain: 200 GB penyimpanan blok, 5 cadangan volume, 10 TB data keluar per bulan, 20 GB Object Storage, dan satu load balancer 10 Mbps. Kredit percobaan 300 dolar berlaku 30 hari dan tidak perlu dipakai.

### Sebelum menekan Create

1. **Buka port di Security List VCN.** Daftar bawaan hanya mengizinkan port 22. Tambahkan dua Ingress Rule dengan sumber `0.0.0.0/0`, protokol TCP, port tujuan `80` dan `443`.
2. **Simpan kunci SSH.** Oracle mengunduhkan kunci privat saat instans dibuat dan berkas itu tidak dapat diunduh ulang. Sambung dengan `ssh -i <berkas-kunci> ubuntu@<IP-publik>`; pengguna bawaan image Ubuntu adalah `ubuntu`, bukan `root`.
3. **Simpan salinan `.env` di luar VPS.** Bila instans hilang, pemulihan hanya membutuhkan instans baru, `git clone`, dan `.env` yang sama.

### Bila muncul "Out of host capacity"

Kapasitas A1 Flex sering penuh di region populer, dan itu bukan masalah akun. Coba lagi pada jam berbeda selama beberapa hari, atau sementara pakai `VM.Standard.E2.1.Micro` (AMD, 1 GB RAM) yang juga termasuk Always Free. Aplikasi tetap berjalan di sana, hanya lebih lambat saat build.

### Bila halaman belum terbuka padahal Security List sudah dibuka

Periksa firewall di dalam sistem:

```bash
sudo iptables -L INPUT -n --line-numbers | head -20
```

Bila terlihat aturan `REJECT` atau `DROP` pada port 80 dan 443, tambahkan pengecualian lalu simpan:

```bash
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo apt install -y iptables-persistent
sudo netfilter-persistent save
```

### Reklamasi instans menganggur

Oracle berhak menarik kembali instans Always Free yang dinilai menganggur, yaitu bila selama 7 hari persentil ke-95 pemakaian CPU di bawah 20 persen, jaringan di bawah 20 persen, dan memori di bawah 20 persen (khusus bentuk A1). Toko kecil berpeluang masuk kategori ini. Dua persiapan yang menutup risiko tersebut:

- Simpan salinan `.env` dan cadangan basis data di luar VPS. Basis data utama sudah berada di Supabase, jadi instans dapat dibuat ulang dalam hitungan menit tanpa kehilangan data pesanan.
- Bila tidak ingin menghadapi risiko ini sama sekali, naikkan akun ke Pay As You Go. Sumber daya Always Free tetap gratis, tetapi kartu terpasang dan pemakaian di luar kuota gratis akan ditagih, jadi pastikan kuota tidak pernah terlampaui lebih dahulu.

Cadangan harian dari langkah 10 sebaiknya disalin juga ke Object Storage (20 GB gratis) agar tidak berada di mesin yang sama dengan aplikasi.

### Berapa banyak instans yang boleh dibuat

Jatah gratis dihitung dari total jam pemakaian, bukan dari jumlah instans: 1.500 OCPU-jam dan 9.000 GB-jam per bulan untuk bentuk A1. Karena satu instans A1 minimal memakai 1 OCPU, susunan yang tetap gratis adalah:

| Susunan | Terpakai per bulan | Status |
|---|---|---|
| 1 instans, 2 OCPU, 12 GB | 1.460 OCPU-jam, 8.760 GB-jam | Gratis |
| 2 instans, masing-masing 1 OCPU, 6 GB | 1.460 OCPU-jam, 8.760 GB-jam | Gratis |
| 3 instans, masing-masing 1 OCPU, 6 GB | 2.190 OCPU-jam | Kelebihannya ditagih |

Dua instans AMD `VM.Standard.E2.1.Micro` (1 GB RAM masing-masing) berada di jatah terpisah, jadi keduanya dapat dipakai tanpa mengurangi jatah A1. Setiap instans juga mengambil 50 GB dari 200 GB penyimpanan blok.

Untuk satu toko, satu instans 2 OCPU dan 12 GB adalah pilihan paling sederhana dan paling lega. Bila kelak ada beberapa proyek, seluruh proyek dapat ditumpangkan pada instans yang sama: satu blok situs Caddy per domain, dan satu layanan systemd per aplikasi pada port berbeda. Satu alamat IP cukup untuk banyak domain karena Caddy memilih sertifikat berdasarkan nama domain.

### Menjaga tagihan tetap nol

- Buat hanya sumber daya berlabel **Always Free-eligible** di Console. Sumber daya Always Free tidak ikut dihapus saat masa percobaan berakhir; yang dihapus hanya sumber daya berbayar dari masa percobaan.
- Masa percobaan berlangsung 30 hari dengan kredit 300 dolar. Setelah masa atau kreditnya habis, Anda mendapat masa tenggang 30 hari untuk beralih ke akun berbayar; selama masa itu akun tetap aktif tetapi sumber daya berbayar baru tidak dapat dibuat.
- Pasang anggaran (Billing, lalu Budgets) sebesar 1 dolar beserta aturan pemberitahuan. Anggaran hanya mengirim pemberitahuan, bukan menghentikan pemakaian secara otomatis.
- Periksa halaman Billing, lalu Cost Analysis, secara berkala. Selama hanya sumber daya Always Free yang berjalan, saldo kredit tetap utuh. Bila saldo mulai berkurang, berarti ada sumber daya berbayar yang perlu dimatikan.
- Bila bank menampilkan tagihan tertahan sekitar 1 dolar, itu pemeriksaan keabsahan kartu saat pendaftaran. Dana kembali sendiri dalam tiga sampai lima hari dan bukan tagihan.
