const ZONA_WIB = 'Asia/Jakarta';

// ponytail: satu tempat format tanggal dan jam WIB agar invoice, daftar pesanan, dan mutasi bank menampilkan waktu yang sama.
export const tanggalWib = (value, pendek = false) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: pendek ? 'short' : 'long', year: 'numeric', timeZone: ZONA_WIB }).format(date);
};

export const jamWib = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const jam = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: ZONA_WIB }).format(date);
  return `${jam} WIB`;
};

export const labelTanggalJam = (value) => {
  const tanggal = tanggalWib(value);
  const jam = jamWib(value);
  return tanggal && jam ? `${tanggal} pukul ${jam}` : '';
};
