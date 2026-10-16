// ponytail: Struk yang belum tuntas disegarkan makin jarang supaya server tidak dibanjiri permintaan
// ketika pembeli meninggalkan tab terbuka. Delapan detik pada menit pertama, lalu lima belas dan tiga puluh detik.
const RECEIPT_DELAYS = [8000, 15000, 30000];

export function receiptDelay(attempt) {
  const index = Number.isFinite(attempt) && attempt > 0 ? Math.min(Math.floor(attempt), RECEIPT_DELAYS.length - 1) : 0;
  return RECEIPT_DELAYS[index];
}
