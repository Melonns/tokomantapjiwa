// ponytail: isi halaman legal dan bantuan. Teksnya sengaja pendek dan konkret, berisi aturan yang benar-benar berlaku di alur toko ini,
// bukan template pasal. Kontak diambil dari server (/api/contact) agar dapat diganti tanpa menyentuh kode.

export const LEGAL_LINKS = [
  { path: '/syarat', label: 'Syarat & Ketentuan' },
  { path: '/privasi', label: 'Kebijakan Privasi' },
  { path: '/kontak', label: 'Bantuan & Kontak' },
];

export const LEGAL_PAGES = {
  terms: {
    title: 'Syarat & Ketentuan',
    intro: 'Ketentuan penggunaan layanan Melonbyte. Seluruh isi halaman ini berlaku sejak Anda menekan tombol bayar, sehingga bagian yang ditandai perlu dibaca terlebih dahulu.',
    updated: '15 Oktober 2026',
    sections: [
      {
        title: 'Cara pesanan diproses',
        body: 'Setelah pembayaran diterima, pesanan dikirim secara otomatis ke penyedia layanan. Umumnya selesai di bawah 5 menit. Jika penyedia sedang sibuk atau mengalami gangguan, prosesnya dapat lebih lama. Acuan status selalu halaman pesanan, bukan perkiraan waktu.',
      },
      {
        title: 'Salah isi ID tujuan',
        danger: true,
        body: 'Item dikirim ke User ID atau ID tujuan yang Anda isi sendiri. Jika ID tersebut salah, pesanan tetap diproses dan item tetap terkirim ke ID itu. Pesanan tidak dapat dibatalkan, ditarik, atau dikembalikan. Periksa kembali ID sebelum membayar, dan gunakan tombol periksa nickname jika tersedia.',
      },
      {
        title: 'Pembayaran',
        items: [
          'Harga di katalog sudah final. Tidak ada biaya tambahan di luar angka yang tertulis di halaman pembayaran.',
          'Pembayaran dilakukan melalui kanal resmi yang tersedia: QRIS, Virtual Account, atau e-wallet. Selesaikan pembayaran sebelum batas waktu yang tertera di invoice.',
          'Pesanan yang melewati batas waktu akan kedaluwarsa dengan sendirinya. Selama Anda belum membayar, tidak ada dana yang terpotong.',
          'Kami tidak pernah meminta transfer ke rekening pribadi. Pembayaran hanya melalui kanal yang muncul di halaman invoice.',
        ],
      },
      {
        title: 'Jika pesanan gagal',
        body: 'Jika penyedia tidak dapat memenuhi pesanan, statusnya berubah menjadi gagal dan dana dikembalikan penuh ke metode pembayaran awal tanpa potongan. Jika lebih dari 1×24 jam dana belum masuk, hubungi kami dengan menyebutkan nomor pesanan.',
      },
      {
        title: 'Pengembalian dana (refund)',
        items: [
          'Refund berlaku untuk pesanan yang gagal diproses di sisi kami atau penyedia, bukan karena salah isi ID, salah pilih nominal, atau berubah pikiran.',
          'Dana kembali ke metode pembayaran awal (QRIS, VA, atau e-wallet yang Anda gunakan). Waktu masuknya 1-3 hari kerja, tergantung bank atau e-wallet.',
          'Setelah refund diproses, pesanan ditandai "dana dikembalikan" dan Anda menerima email konfirmasi.',
        ],
      },
      {
        title: 'Akun Anda',
        items: [
          'Satu akun untuk satu orang. Jangan bagikan kata sandi atau akses email kepada siapa pun.',
          'Akun dapat dinonaktifkan jika terbukti digunakan untuk kecurangan, misalnya klaim palsu atau pembatalan pembayaran setelah pesanan selesai.',
        ],
      },
      {
        title: 'Harga, stok, dan ketersediaan',
        body: 'Harga dan stok mengikuti katalog aktif dan dapat berubah kapan saja. Harga yang dipakai adalah harga pada saat pesanan Anda dibuat. Jika sebuah nominal ditandai gangguan, checkout-nya ditutup sampai gangguan selesai.',
      },
      {
        title: 'Batasan tanggung jawab',
        body: 'Melonbyte bukan pemilik layanan game, pulsa, atau e-money. Kami meneruskan pesanan ke penyedia resmi. Kendala di luar kendali kami, seperti pemeliharaan penyedia, pembatasan akun game, atau ID yang tidak valid, tidak dapat kami jamin bebas. Namun dana pesanan yang gagal selalu dikembalikan penuh.',
      },
      {
        title: 'Perubahan ketentuan',
        body: 'Jika ketentuan ini berubah, versi terbaru selalu tersedia di halaman ini. Perubahan berlaku untuk pesanan berikutnya, bukan untuk pesanan yang sudah dibayar.',
      },
    ],
  },
  privacy: {
    title: 'Kebijakan Privasi',
    intro: 'Kami hanya menyimpan data yang dibutuhkan untuk memproses pesanan Anda. Halaman ini menjelaskan data apa yang disimpan, untuk apa, dan siapa saja yang mengaksesnya.',
    updated: '15 Oktober 2026',
    sections: [
      {
        title: 'Data yang kami simpan',
        items: [
          'Email dan nomor HP akun Anda, untuk login dan konfirmasi.',
          'User ID atau Zone ID tujuan pada setiap pesanan, yaitu alamat pengiriman item.',
          'Riwayat pesanan: produk, nominal, status, dan jumlah pembayaran.',
          'Riwayat pemakaian kode promo, untuk menjaga aturan satu akun satu kali pemakaian.',
        ],
      },
      {
        title: 'Untuk apa data itu digunakan',
        items: [
          'Memproses pesanan dan meneruskannya ke penyedia layanan.',
          'Menampilkan riwayat dan status pesanan di akun Anda.',
          'Mengirim email notifikasi saat status pesanan berubah.',
          'Mencegah penyalahgunaan kode promo dan pesanan fiktif.',
        ],
      },
      {
        title: 'Yang tidak kami lakukan',
        items: [
          'Kami tidak menjual atau membagikan data Anda untuk iklan.',
          'Kami tidak menyimpan nomor kartu atau kredensial bank. Pembayaran diproses Midtrans, dan kami hanya menerima statusnya.',
          'Kami tidak menyimpan kata sandi dalam bentuk terbaca; pengelolaan login ada di Supabase Auth.',
          'Kami tidak pernah menanyakan kata sandi, OTP, atau kode pembayaran melalui WhatsApp maupun email.',
        ],
      },
      {
        title: 'Pihak ketiga yang terlibat',
        body: 'Midtrans (pembayaran), Digiflazz (pemenuhan pesanan), Supabase (basis data dan login), dan Brevo (email notifikasi). Masing-masing hanya menerima data yang diperlukan untuk tugasnya, bukan seluruh riwayat akun Anda.',
      },
      {
        title: 'Penyimpanan dan keamanan',
        body: 'Data disimpan di basis data dengan akses terbatas dan hanya melalui koneksi terenkripsi. Akses admin dibatasi untuk keperluan operasional pesanan.',
      },
      {
        title: 'Hak Anda',
        body: 'Anda dapat meminta salinan data akun atau penghapusan akun melalui kontak kami dari email yang terdaftar. Data transaksi yang wajib disimpan untuk pembukuan tetap kami simpan sesuai aturan; sisanya dihapus.',
      },
    ],
  },
  contact: {
    title: 'Bantuan & Kontak',
    intro: 'Sebagian besar pertanyaan sudah terjawab di halaman ini. Jika masih membutuhkan bantuan petugas, hubungi kami dengan menyebutkan nomor pesanan Anda.',
    sections: [
      {
        title: 'Cara memesan dalam 4 langkah',
        items: [
          'Pilih layanan dan nominalnya di katalog.',
          'Isi User ID atau ID tujuan, lalu gunakan tombol periksa nickname jika tersedia.',
          'Pilih metode pembayaran dan selesaikan pembayarannya.',
          'Item masuk otomatis. Status dan struk tersedia di menu Akun, serta email pada setiap perubahan status.',
        ],
      },
      {
        title: 'Sebelum menghubungi kami',
        items: [
          'Siapkan nomor pesanan (format #xxxxxxxx) dari halaman Akun atau email notifikasi.',
          'Sebutkan kendalanya sedetail mungkin: nominal, ID tujuan, dan waktu kejadian.',
          'Jangan pernah mengirim kata sandi, OTP, atau data kartu. Petugas kami tidak akan memintanya.',
        ],
      },
      {
        title: 'Jam layanan',
        body: 'Setiap hari, 08.00-22.00 WIB. Di luar jam tersebut pesanan tetap berjalan otomatis; balasan petugas menyusul pada jam layanan berikutnya.',
      },
    ],
  },
};

// ponytail: kanal kontak dibentuk dari jawaban /api/contact; kanal yang kosong tidak ditampilkan sama sekali (tidak ada tautan mati).
export function contactChannels(info) {
  const channels = [];
  const whatsapp = String(info?.whatsapp || '').trim();
  if (/^https:\/\/wa\.me\/\d{8,15}$/.test(whatsapp)) {
    channels.push({ id: 'whatsapp', label: 'WhatsApp', value: String(info?.whatsappLabel || whatsapp), href: whatsapp });
  }
  const email = String(info?.email || '').trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    channels.push({ id: 'email', label: 'Email', value: email, href: `mailto:${email}` });
  }
  return channels;
}
