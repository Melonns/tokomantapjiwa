# Melonbyte

Melonbyte menampilkan katalog produk aktif dari server. Checkout Mobile Legends memakai format User ID + Zone ID; kategori lain belum punya produk aktif. Login email lewat Supabase Auth; buyer hanya melihat pesanan miliknya, sedangkan admin terdaftar di `admin_users` dapat melihat pesanan toko.

## Jalankan lokal

1. `npm install`
2. Buat proyek Supabase. Jalankan `database/schema.sql` di SQL Editor **pada proyek baru**. Tabel baru kosong: tambahkan produk dan pastikan SKU, harga, serta format tujuan benar sebelum mengubah `enabled` menjadi `true`.
3. Salin `.env.example` ke `.env` dan isi konfigurasi milikmu. Nilai `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY` boleh di browser; `DATABASE_URL`, Midtrans server key, dan Digiflazz API key **hanya untuk server**. Aktifkan Email Auth dan atur Site URL serta redirect URL lokal/domain produksi di Supabase Auth. Jangan kirim secret lewat chat atau commit ke Git. `CHECKOUT_ENABLED` biarkan `false` sampai integrasi terverifikasi.
4. Di terminal pertama jalankan `npm run server`; terminal kedua `npm run dev`. Vite mem-proxy `/api` ke port `3001`.
5. `npm test` dan `npm run build` untuk cek kode. Konfigurasi webhook Midtrans ke `https://domainmu/api/webhooks/midtrans` tanpa redirect. Di produksi, layani `dist/` dari web server dan proxy `/api` ke server Node di origin yang sama; gunakan HTTPS.

Kontrak API, mode sandbox dan penanganan status ambigu: [server/README.md](server/README.md). Tanpa proyek Supabase dan kredensial, katalog tidak menampilkan harga sungguhan dan checkout tidak berjalan; tidak ada harga/produk palsu. Jangan meluncurkan pembayaran sebelum uji integrasi Midtrans–Digiflazz dan prosedur refund/reconciliation nyata.
