// ponytail: Struk yang belum tuntas disegarkan makin jarang supaya server tidak dibanjiri permintaan
// ketika pembeli meninggalkan tab terbuka. Tiga detik pada pemeriksaan pertama, lalu lima dan delapan detik.
const RECEIPT_DELAYS = [3000, 5000, 8000];

export function receiptDelay(attempt) {
  const index = Number.isFinite(attempt) && attempt > 0 ? Math.min(Math.floor(attempt), RECEIPT_DELAYS.length - 1) : 0;
  return RECEIPT_DELAYS[index];
}
