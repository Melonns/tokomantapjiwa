import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./App.jsx', import.meta.url), 'utf8')
const css = await readFile(new URL('./store.css', import.meta.url), 'utf8')

test('tombol periksa nickname hanya muncul untuk produk yang mendukung pemeriksaan', () => {
  assert.match(source, /\{selected\?\.checkable && \(/)
  assert.match(source, /Periksa nickname/)
  assert.match(source, /disabled=\{!checkAvailable \|\| checkState === 'loading'\}/)
})

test('permintaan pemeriksaan memakai produk terpilih agar layanan mengikuti brand', () => {
  assert.match(source, /request\('\/api\/check-account', \{/)
  assert.match(source, /productId: selected\.id, userId: id/)
  assert.match(source, /zoneId: zone, force: force === true/)
})

test('hasil pemeriksaan menampilkan nama, asal data, dan tombol periksa ulang', () => {
  assert.match(source, /Nickname: <strong>\{checkResult\.nickname\}<\/strong>/)
  assert.match(source, /'hasil tersimpan' : 'baru diperiksa'/)
  assert.match(source, /Periksa ulang/)
})

test('kegagalan pemeriksaan ditampilkan apa adanya dan tidak mengunci checkout', () => {
  assert.match(source, /setCheckError\(error\.message\)/)
  assert.match(source, /Fitur periksa nickname belum aktif di server ini\./)
  assert.match(source, /Isi User ID dan Zone ID berupa angka terlebih dahulu\./)
})

test('hasil pemeriksaan lama dibuang saat ID atau pilihan berubah', () => {
  assert.match(source, /\}, \[userId, zoneId, selected\?\.id\]\)/)
  assert.match(source, /if \(run !== checkRunRef\.current\) return/)
})

test('kelas gaya periksa nickname tersedia di stylesheet', () => {
  assert.match(css, /\.check-button\{/)
  assert.match(css, /\.check-result\{/)
  assert.match(css, /\.check-error\{/)
  assert.match(css, /\.check-again-button\{/)
})
