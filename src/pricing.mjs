// ponytail: satu sumber aturan harga jual. Margin per kategori menurun pada nominal besar (praktik konter:
// nominal kecil dapat persen lebih besar, nominal besar lebih tipis agar tetap kompetitif) plus fee
// pembayaran yang wajib tertutup di dalam harga (biaya tidak boleh dibebankan ke pembeli).
export const QRIS_FEE_PCT = 0.7 // sudah termasuk PPN
export const EWALLET_FEE_PCT = 2 // GoPay/ShopeePay
export const VA_FEE_RP = 4440 // Rp 4.000 + PPN 11%, flat per transaksi
export const VA_MIN_ORDER = 100000 // fee flat ini baru masuk akal di pesanan besar
export const VA_METHOD_IDS = ['bca_va', 'bni_va', 'bri_va', 'permata_va', 'mandiri_bill']

// Band = [modal mulai dari, margin %, pembulatan ke atas]. Nama kategori mengikuti kolom category katalog supplier.
// ponytail: pembulatan 100 dipakai di semua band. Pembulatan 500/1000 membuat harga melompat jauh di atas modal
// (contoh Weekly Diamond Pass 2x modal 60.588 tersaran 65.000, padahal pasar menjual 64.600).
const BANDS = {
  Games: [[0, 10, 100], [10000, 7, 100], [50000, 5, 100], [250000, 4, 100]],
  Pulsa: [[0, 12, 100], [15000, 6, 100], [45000, 5, 100], [90000, 4, 100]],
  Data: [[0, 12, 100], [10000, 8, 100], [50000, 6, 100]],
  'E-Money': [[0, 2, 100], [100000, 1.5, 100]],
  PLN: [[0, 5, 100], [100000, 4, 100]],
  Gas: [[0, 5, 100], [100000, 4, 100]],
  TV: [[0, 8, 100], [50000, 6, 100]],
  Voucher: [[0, 8, 100], [50000, 6, 100]],
  'Aktivasi Voucher': [[0, 8, 100], [50000, 6, 100]],
  'Aktivasi Perdana': [[0, 8, 100], [50000, 6, 100]],
  'Paket SMS & Telpon': [[0, 8, 100], [50000, 6, 100]],
  'Masa Aktif': [[0, 8, 100], [50000, 6, 100]],
}
const FALLBACK = [[0, 8, 100], [10000, 6, 100], [100000, 5, 100]]

export function marginBand(category, cost) {
  const bands = BANDS[category] || FALLBACK
  let picked = bands[0]
  for (const band of bands) if (cost >= band[0]) picked = band
  return { pct: picked[1], grid: picked[2] }
}

export function roundUpTo(value, grid) {
  return Math.ceil(value / grid) * grid
}

// Harga saran = modal × (1 + margin) dibagi (1 − biaya QRIS) agar biaya ikut tertutup, lalu dibulatkan ke atas.
export function suggestPrice(cost, category, pctOverride) {
  const modal = Number(cost)
  if (!Number.isFinite(modal) || modal <= 0) return null
  const band = marginBand(category, modal)
  const custom = Number(pctOverride)
  const pct = Number.isFinite(custom) && custom >= 0 ? custom : band.pct
  const gross = modal * (1 + pct / 100)
  return roundUpTo(Math.ceil(gross / (1 - QRIS_FEE_PCT / 100)), band.grid)
}

// Sisa bersih setelah biaya QRIS; 'rugi' berarti harga tidak menutup modal dan biaya.
export function priceHealth(price, cost, category) {
  const jual = Number(price)
  const modal = Number(cost)
  if (!Number.isFinite(jual) || !Number.isFinite(modal) || jual <= 0 || modal <= 0) return null
  const band = marginBand(category, modal)
  const fee = Math.round(jual * QRIS_FEE_PCT) / 100
  const netRp = Math.round(jual - modal - fee)
  const marginPct = Math.round(((jual - modal) / jual) * 1000) / 10
  const tipis = netRp < (band.pct / 100) * modal * 0.5
  return {
    netRp,
    marginPct,
    fee: Math.round(fee),
    targetPct: band.pct,
    level: netRp <= 0 ? 'rugi' : tipis ? 'tipis' : 'aman',
    vaSafe: netRp >= VA_FEE_RP,
  }
}

// Kanal flat seperti VA cuma muncul kalau harga pesanan sanggup menutup fee-nya.
export function availablePaymentMethods(methods, price) {
  const total = Number(price)
  return methods.filter((method) => !method.minOrder || (Number.isFinite(total) && total >= method.minOrder))
}

// ponytail: potongan voucher = fungsi murni yang sama dipakai server dan klien, agar angka di layar tidak pernah berbeda dari yang ditagih.
export function voucherDiscount(voucher, total) {
  const harga = Number(total)
  const nilai = Number(voucher?.value)
  if (!Number.isFinite(harga) || harga <= 0 || !Number.isFinite(nilai) || nilai <= 0) return 0
  if (harga < (Number(voucher.min_order) || 0)) return 0
  if (voucher.kind === 'percent') {
    const cap = Number(voucher.max_discount) || 0
    const raw = Math.floor((harga * Math.min(nilai, 90)) / 100)
    return cap > 0 ? Math.min(raw, cap) : raw
  }
  return Math.min(nilai, harga - 1)
}
