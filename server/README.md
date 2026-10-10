# API Melonbyte

Node ESM + `pg` + HTTP bawaan Node. Jalankan skema `database/schema.sql` di Supabase SQL Editor untuk instalasi **baru**, lalu isi produk sendiri. Skema memakai `auth.users` Supabase. Jika tabel `orders` sudah ada, `CREATE TABLE IF NOT EXISTS` tidak menambah `owner_id`: audit dan tautkan setiap pesanan lama ke pengguna yang sah sebelum migrasi manual ke `owner_id uuid NOT NULL REFERENCES auth.users(id)`. Jangan tebak pemilik dari ID pesanan; checkout dan daftar pesanan akan gagal sampai migrasi selesai. Produk baru `enabled=false`; aktifkan hanya setelah kode SKU, harga, dan format tujuan diuji terhadap Digiflazz. Tidak ada produk contoh atau kredensial bawaan.

## Lingkungan server (jangan gunakan `VITE_`)

- `DATABASE_URL`: URI koneksi Postgres Supabase. Server memverifikasi TLS memakai `prod-ca-2021.crt` di root repo; sertifikat lokal ini diabaikan Git. Pastikan file tersedia saat deploy.
- `SUPABASE_URL`: URL HTTPS proyek Supabase (contoh `https://example.supabase.co`).
- `SUPABASE_ANON_KEY`: public anon key Supabase. Backend memvalidasi access token lewat `GET /auth/v1/user` Supabase setiap permintaan pelanggan; jangan gunakan service-role key di browser.
- `MIDTRANS_SERVER_KEY`: server key untuk mode yang dipilih.
- `MIDTRANS_ENV`: **wajib** `sandbox` atau `production`.
- `DIGIFLAZZ_USERNAME`, `DIGIFLAZZ_API_KEY`: kredensial buyer mode sesuai lingkungan.
- `DIGIFLAZZ_TESTING`: **wajib** `true` bila Midtrans sandbox; **wajib** `false` bila production. Setelan lain menutup checkout/webhook.
- `CHECKOUT_ENABLED`: default nonaktif; isi `true` hanya setelah akun, IP, Midtrans sandbox, Digiflazz testing, dan alur end-to-end teruji. Tidak perlu mengubah `.env` saat ini; tetap nonaktif.
- `PORT`: opsional, default `3001`.

Jalankan `npm run server` setelah menaruh konfigurasi lokal di `.env` (tidak masuk Git); tes `npm test`. Arahkan proxy `/api` dari frontend ke backend sendiri; API tidak mengaktifkan CORS lintas-origin. Jangan taruh secret dalam browser. Tabel `products`, `orders`, dan `admin_users` menyalakan RLS tanpa policy serta mencabut akses `anon`/`authenticated`; browser tidak boleh membaca DB langsung. Akun Postgres backend perlu izin tabel, sementara pemilikan pesanan diperiksa lagi di API.

Untuk database yang sudah ada, jalankan bagian `CREATE TABLE IF NOT EXISTS admin_users`, `ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY`, dan `REVOKE ALL ON admin_users FROM anon, authenticated` dari `database/schema.sql` di Supabase SQL Editor. Setelah email pengelola terverifikasi di Supabase Auth, tambahkan UUID akunnya dari dashboard Auth lewat SQL Editor: `INSERT INTO public.admin_users (user_id) VALUES ('UUID_AKUN_TERVERIFIKASI');`. Akun lain otomatis buyer. Jangan berikan akses admin berdasarkan email kiriman browser atau `user_metadata`. Migrasi belum diterapkan otomatis ke database terhubung.

## Kontrak HTTP

- `GET /api/products` → `{ "products": [...], "checkoutAvailable": false }`; hanya produk aktif dari DB, dan status checkout dari konfigurasi server. Tombol checkout tetap nonaktif sampai server mengizinkan.
- `GET /api/me` dengan bearer access token → `{ "role": "buyer" }` atau `{ "role": "admin" }`. Keanggotaan admin diambil dari `admin_users`, bukan klaim browser.
- `GET /api/admin/orders` dengan bearer admin → 100 pesanan terbaru toko, tanpa data tujuan pelanggan. Buyer ditolak 403.
- `POST /api/checkout` dengan `Authorization: Bearer <Supabase access token>` dan JSON `{ "productId": "ml10", "userId": "12345", "zoneId": "100" }` → HTTP 201 `{ "orderId": "uuid", "redirectUrl": "https://app.sandbox.midtrans.com/..." }`. UUID pemilik berasal dari Supabase Auth, bukan body. Harga dan SKU berasal dari DB; tujuan berasal dari input yang tervalidasi; harga kiriman klien diabaikan. ID alfanumerik/`_`/`-`, maksimal 64 karakter. Format `customer_no` sekarang hanya `userId + zoneId` (`ml_concat`); pastikan format SKU tujuan sebelum aktivasi.
- `GET /api/orders` dengan bearer access token → `{ "orders": [...] }`, hanya pesanan milik pengguna, terbaru dahulu.
- `GET /api/orders/:id` dengan bearer access token → `{ "order": { "id": "uuid", "status": "pending", "productName": "...", "price": 25000, "userId": "...", "zoneId": "..." } }`. Pesanan pengguna lain dan ID yang tidak ada sama-sama 404. Status: `pending`, `payment_paid`, `fulfillment_pending`, `fulfilled`, `fulfillment_failed`, `manual_review`. Token hilang/kedaluwarsa ditolak 401; email belum terverifikasi ditolak 403; Supabase Auth tidak tersedia ditolak 502. Jangan jadikan ID pesanan sebagai bukti kepemilikan.
- `POST /api/webhooks/midtrans`: URL publik HTTPS untuk notifikasi Midtrans (atur persis tanpa redirect pada dashboard). Hanya signature SHA-512 sah, jumlah sesuai harga DB, status `settlement`/`capture`, kode 200, dan fraud `accept` bila ada. `capture` butuh `accept`. Notifikasi duplikat tidak memulai topup kedua; klaim DB atomik, satu `ref_id` = ID pesanan.
- `POST /api/admin/orders/:id/check-digiflazz` dengan bearer access token akun admin: cek transaksi pending setelah jeda minimal lima menit memakai *ref_id yang sama*. Jangan jadwalkan cek otomatis tanpa pengawasan. Ini mengirim ulang permintaan API sesuai dokumentasi Digiflazz, bukan membuat `ref_id` baru.
- Kesalahan: `{ "error": "Pesan singkat" }`, status HTTP sesuai.

## Kesiapan operasional

Checkout gagal tertutup bila kredensial atau mode tidak lengkap. Setelah pembayaran, request Digiflazz ambigu/timeout disimpan `manual_review`; jangan mengulang topup dengan `ref_id` baru. `fulfillment_pending` bisa dicek lewat endpoint admin; `manual_review` dan `fulfillment_failed` perlu rekonsiliasi/refund manual di dashboard sebelum tindakan lain. Jika proses mati setelah klaim DB dan sebelum respons Digiflazz, order tetap `fulfillment_pending` (atau perlu rekonsiliasi manual); tidak ada jaminan pengiriman otomatis setelah crash. Snap timeout dapat meninggalkan pesanan `pending`; buat pesanan baru hanya setelah mengecek transaksi lama agar pelanggan tidak ditagih dua kali. Status pembayaran yang telat, refund, deny, expire, cancel belum diproses otomatis: verifikasi lewat dashboard/status Midtrans dan tangani manual. Tidak ada polling/recovery otomatis, callback Digiflazz, atau verifikasi live dengan kredensial nyata. Jangan meluncurkan produksi tanpa uji integrasi nyata dan prosedur rekonsiliasi/refund.

Rujukan: https://docs.midtrans.com/docs/snap-snap-integration-guide ; https://docs.midtrans.com/reference/handle-notifications ; https://developer.digiflazz.com/api/buyer/topup/ .
