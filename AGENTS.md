# Melonbyte

Untuk perubahan UI/copy, jalankan aturan `antislop` beserta `antislop-ui`, `antislop-copywriting`, `antislop-human`, dan `antislop-layoutmobile` bila tersedia di lingkungan agent. Terapkan selama pembangunan; jangan meniru aset atau identitas situs referensi. Prioritaskan UI jelas, mobile, keyboard, kontras, dan status kosong yang jujur.

Produk/harga hanya dari data aktif server. Jangan taruh secret Supabase database, Midtrans, atau Digiflazz di kode browser. Setiap pesanan wajib terkait akun terverifikasi; baca riwayat hanya milik pemilik. Pembayaran sah hanya dari webhook Midtrans terverifikasi; ulang webhook tak boleh membuat dua top up. Status Digiflazz pending tetap pending hingga diverifikasi. Jangan aktifkan checkout tanpa integrasi dan tes nyata.

Verifikasi `npm run build` dan `npm test` setelah mengubah kode.
