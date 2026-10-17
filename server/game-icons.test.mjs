// Uji penarik ikon game: unduh dari App Store lalu tulis ke folder publik.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { GAME_ICONS, refreshGameIcons } from './game-icons.mjs'

const gambar = Buffer.alloc(30000, 7)
const potong = () => gambar.buffer.slice(gambar.byteOffset, gambar.byteOffset + gambar.byteLength)

const appPalsu = { trackName: 'Uji Game', version: '1.0', artworkUrl512: 'https://contoh.test/ikon.jpg' }

async function denganFolder(kerja) {
  const folder = await mkdtemp(join(tmpdir(), 'melon-ikon-'))
  try {
    return await kerja(folder)
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
}

test('semua ikon game diunduh lalu ditulis ke folder tujuan', () => denganFolder(async (folder) => {
  const dipanggil = []
  const fetchImpl = async (url) => {
    dipanggil.push(url)
    if (url.includes('/search')) return { ok: true, status: 200, json: async () => ({ results: [appPalsu] }) }
    return { ok: true, status: 200, arrayBuffer: async () => potong() }
  }
  const hasil = await refreshGameIcons({ fetchImpl, folders: [folder] })
  assert.equal(hasil.length, GAME_ICONS.length)
  assert.ok(hasil.every((item) => item.ok), JSON.stringify(hasil))
  assert.ok(dipanggil.some((url) => url.includes('country=id')))
  for (const item of GAME_ICONS) {
    const isi = await readFile(join(folder, `${item.slug}.jpg`))
    assert.equal(isi.length, gambar.length)
  }
}))

test('kegagalan satu game tidak menghentikan game lain', () => denganFolder(async (folder) => {
  let pencarian = 0
  const fetchImpl = async (url) => {
    if (url.includes('/search')) {
      pencarian += 1
      if (pencarian === 1) return { ok: false, status: 503, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => ({ results: [appPalsu] }) }
    }
    return { ok: true, status: 200, arrayBuffer: async () => potong() }
  }
  const hasil = await refreshGameIcons({ fetchImpl, folders: [folder] })
  assert.equal(hasil[0].ok, false)
  assert.match(hasil[0].error, /Pencarian/)
  assert.equal(hasil.filter((item) => item.ok).length, GAME_ICONS.length - 1)
}))

test('berkas yang terlalu kecil ditolak supaya tidak menimpa ikon bagus', () => denganFolder(async (folder) => {
  const fetchImpl = async (url) => url.includes('/search')
    ? { ok: true, status: 200, json: async () => ({ results: [appPalsu] }) }
    : { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(10) }
  const hasil = await refreshGameIcons({ fetchImpl, folders: [folder] })
  assert.ok(hasil.every((item) => !item.ok))
  assert.match(hasil[0].error, /terlalu kecil/)
}))
