// ponytail: sub-kelompok di dalam satu brand. Katalog supplier tidak punya kolom untuk ini (kolom variant
// isinya wilayah jual, bukan jenis produk), jadi jenisnya dibaca dari pola nama produk.
const POLA = [
  [/weekly\s*diamond\s*pass/i, 'Weekly Diamond Pass'],
  [/twilight\s*pass/i, 'Twilight Pass'],
  [/starlight/i, 'Starlight'],
  [/first\s*top\s*up/i, 'First Top Up'],
  [/bundle/i, 'Bundle'],
  [/cek\s*(username|id|nickname)/i, 'Cek ID'],
  [/diamond/i, 'Diamond'],
]

// Urutan tampil: paket khusus lebih dulu, diamond biasa paling akhir, sisanya "Lainnya".
export const KIND_ORDER = ['Weekly Diamond Pass', 'Twilight Pass', 'Starlight', 'First Top Up', 'Bundle', 'Cek ID', 'Diamond', 'Lainnya']

export function productKind(name) {
  const teks = String(name || '')
  for (const [pola, label] of POLA) if (pola.test(teks)) return label
  return 'Lainnya'
}

// Kelompokkan daftar produk satu brand; brand yang jenisnya cuma satu tidak perlu dipecah.
export function groupByKind(items) {
  const peta = new Map()
  for (const item of items) {
    const kind = productKind(item.name)
    if (!peta.has(kind)) peta.set(kind, [])
    peta.get(kind).push(item)
  }
  return [...peta.entries()]
    .map(([name, daftar]) => ({ name, items: daftar }))
    .sort((a, b) => KIND_ORDER.indexOf(a.name) - KIND_ORDER.indexOf(b.name))
}
