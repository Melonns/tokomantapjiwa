import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const app = await readFile(new URL('./App.jsx', import.meta.url), 'utf8')
const css = await readFile(new URL('./store.css', import.meta.url), 'utf8')

test('pemilih server memakai komponen sendiri, bukan select bawaan peramban', () => {
  assert.equal(/<select[\s>]/.test(app), false, 'tidak ada select bawaan peramban');
  assert.match(app, /function PilihanServer\(\{ nilai, onPilih \}\)/);
  assert.match(app, /aria-haspopup="listbox"/);
  assert.match(app, /aria-expanded=\{buka\}/);
  assert.match(app, /role="listbox"/);
  assert.match(app, /role="option" aria-selected=\{option\.value === nilai\}/);
})

test('pemilih server bisa dioperasikan dengan papan ketik', () => {
  for (const tombol of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', 'Escape', 'Tab']) {
    assert.ok(app.includes(`event.key === '${tombol}'`), `menangani tombol ${tombol}`);
  }
  assert.match(app, /aria-controls="pilih-server-daftar"/);
})

test('daftar server menutup saat pengguna menekan di luar kotak', () => {
  assert.match(app, /document\.addEventListener\('pointerdown', tutup\)/);
  assert.match(app, /document\.removeEventListener\('pointerdown', tutup\)/);
})

test('server wajib dipilih sebelum lanjut ke pembayaran', () => {
  assert.match(app, /orderFormat === 'uid_server' && !zoneId/);
  assert.match(app, /Pilih server akun terlebih dahulu, lalu lanjut ke pembayaran\./);
})

test('gaya pemilih server memakai token radius dan tampil di atas isi lain', () => {
  assert.match(css, /\.pilih-server-daftar\{[^}]*border-radius:var\(--r-card\)/);
  assert.match(css, /\.pilih-server-daftar\{[^}]*z-index:30/);
  assert.match(css, /\.pilih-server-tombol\{[^}]*border-radius:var\(--r-pill\)/);
  assert.match(css, /\.pilih-server-tombol:focus-visible\{[^}]*box-shadow:0 0 0 3px/);
})

test('gambar game di kepala halaman berukuran besar dan mengikuti warna merek', () => {
  assert.match(css, /\.brand-art\{width:132px;height:132px/);
  assert.match(css, /\.brand-banner\{[^}]*linear-gradient\(120deg,var\(--brand-dark/);
  assert.match(app, /className=\{`brand-art/);
  assert.match(app, /ratingRingkas && ratingRingkas\.count > 0 \? <><strong>★/);
  assert.match(app, /request\(`\/api\/ratings\?game=\$\{encodeURIComponent\(nama\)\}`\)/);
  assert.equal(app.includes('{filtered.length}</strong>'), false);
})

test('penilaian hanya muncul di struk pesanan selesai dan dikirim ke API', () => {
  assert.match(app, /receipt\.status === 'fulfilled' && <section className="invoice-rating"/);
  assert.match(app, /role="radiogroup" aria-label="Jumlah bintang"/);
  assert.match(app, /\/api\/orders\/\$\{encodeURIComponent\(receipt\.id\)\}\/rating/);
  assert.match(app, /maxLength=\{500\}/);
  assert.match(app, /Pilih jumlah bintang terlebih dahulu/);
})

test('saran pencarian memakai gambar layanan, bukan inisial huruf', () => {
  assert.match(app, /className=\{`suggest-art/);
  assert.match(app, /brandLogo\(name\)\.src/);
  assert.match(css, /\.suggest-art\{[^}]*width:44px;height:44px/);
})
