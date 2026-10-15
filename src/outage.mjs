// ponytail: satu tempat untuk aturan "produk sedang gangguan" supaya katalog, checkout, dan panel admin memakai kalimat yang sama.

export const OUTAGE_NOTE = 'Nominal ini sedang mengalami gangguan pada penyedia layanan. Pilih nominal lain, atau coba kembali beberapa saat lagi.';

export function isOutage(product) {
  return product?.gangguan === true;
}

export function allOutage(products) {
  const list = Array.isArray(products) ? products : [];
  return list.length > 0 && list.every(isOutage);
}
