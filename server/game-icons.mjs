// Menarik ulang ikon resmi game dari App Store Indonesia.
// Dipakai oleh tombol "Perbarui gambar game" di panel admin.
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const GAME_ICONS = [
  { slug: 'mobile-legends', cari: 'mobile legends bang bang' },
  { slug: 'free-fire', cari: 'free fire' },
  { slug: 'genshin-impact', cari: 'genshin impact' },
  { slug: 'honkai-star-rail', cari: 'honkai star rail' },
]

// ponytail: satu gambar gagal tidak boleh membatalkan gambar lain, jadi tiap game dicatat sendiri.
export async function refreshGameIcons({ fetchImpl = fetch, folders = ['public/logo/game'], negara = 'id' } = {}) {
  const hasil = []
  for (const item of GAME_ICONS) {
    try {
      const cari = await fetchImpl(`https://itunes.apple.com/search?term=${encodeURIComponent(item.cari)}&country=${negara}&entity=software&limit=1`)
      if (!cari.ok) throw new Error(`Pencarian ke App Store gagal (${cari.status}).`)
      const data = await cari.json()
      const app = data?.results?.[0]
      if (!app?.artworkUrl512) throw new Error('Ikon tidak ditemukan di App Store.')
      const unduh = await fetchImpl(app.artworkUrl512)
      if (!unduh.ok) throw new Error(`Unduhan ikon gagal (${unduh.status}).`)
      const berkas = Buffer.from(await unduh.arrayBuffer())
      if (berkas.length < 20000) throw new Error('Berkas ikon terlalu kecil, kemungkinan bukan gambar.')
      for (const folder of folders) {
        await mkdir(folder, { recursive: true })
        await writeFile(join(folder, `${item.slug}.jpg`), berkas)
      }
      hasil.push({ slug: item.slug, ok: true, nama: app.trackName, versi: app.version, bytes: berkas.length })
    } catch (error) {
      hasil.push({ slug: item.slug, ok: false, error: error?.message || String(error) })
    }
  }
  return hasil
}
