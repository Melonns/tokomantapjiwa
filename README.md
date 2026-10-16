# Melonbyte

Melonbyte menampilkan katalog produk aktif dari server. Checkout Mobile Legends memakai format User ID + Zone ID; kategori lain belum punya produk aktif. Daftar meminta email, nomor HP, dan username. Verifikasi dilakukan lewat email, sedangkan nomor HP dipakai sebagai identitas login tanpa SMS. Login memakai email atau nomor HP beserta kata sandi, atau Google lewat Supabase Auth. Username dan nomor HP sebelum terverifikasi hanya metadata, bukan identitas login. Buyer hanya melihat pesanan miliknya, sedangkan admin terdaftar di `admin_users` dapat melihat pesanan toko.

## Jalankan lokal

1. `npm install`
2. Buat proyek Supabase. Jalankan `database/schema.sql` di SQL Editor **pada proyek baru**. Tabel baru kosong: tambahkan produk dan pastikan SKU, harga, serta format tujuan benar sebelum mengubah `enabled` menjadi `true`.
3. Salin `.env.example` ke `.env` dan isi konfigurasi milikmu. Nilai `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY` boleh di browser; `DATABASE_URL`, Midtrans server key, dan Digiflazz API key **hanya untuk server**. Aktifkan Email Auth dan atur Site URL serta redirect URL lokal/domain produksi di Supabase Auth. Jangan kirim secret lewat chat atau commit ke Git. `CHECKOUT_ENABLED` biarkan `false` sampai integrasi terverifikasi.
Login nomor HP tidak memakai SMS: pengguna masuk dengan nomor HP dan kata sandi, sedangkan verifikasi tetap lewat email. Di Supabase Dashboard buka **Authentication → URL Configuration** untuk mengatur Site URL dan Redirect URLs (lokal saat pengembangan, domain produksi saat mengudara). Pengiriman email verifikasi memakai SMTP Brevo yang diatur di **Authentication → SMTP Settings**; jangan menyalin kredensial penyedia ke `.env` browser.

4. Di terminal pertama jalankan `npm run server`; terminal kedua `npm run dev`. Vite mem-proxy `/api` ke port `3001`.
5. `npm test` dan `npm run build` untuk cek kode. Konfigurasi webhook Midtrans ke `https://domainmu/api/webhooks/midtrans` tanpa redirect. Di produksi, layani `dist/` dari web server dan proxy `/api` ke server Node di origin yang sama; gunakan HTTPS.

Siap mengudara di VPS? Ikuti [DEPLOY.md](DEPLOY.md): berkas Caddy, layanan systemd, skrip deploy, cadangan harian, dan pemantauan uptime sudah disiapkan di folder `deploy/`.

Kontrak API, mode sandbox dan penanganan status ambigu: [server/README.md](server/README.md). Tanpa proyek Supabase dan kredensial, katalog tidak menampilkan harga sungguhan dan checkout tidak berjalan; tidak ada harga/produk palsu. Jangan meluncurkan pembayaran sebelum uji integrasi Midtrans–Digiflazz dan prosedur refund/reconciliation nyata.
