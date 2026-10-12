import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./App.jsx', import.meta.url), 'utf8');
const css = await readFile(new URL('./store.css', import.meta.url), 'utf8');

test('halaman pesanan memakai enam kotak berurutan dari kredensial sampai kontak', () => {
  const steps = ['Kredensial akun tujuan', 'Pilih nominal', 'Jumlah pembelian', 'Metode pembayaran', 'Kode promo', 'Detail kontak'];
  const indexes = steps.map((title) => source.indexOf(title));
  assert.ok(indexes.every((index) => index > -1), 'semua judul kotak ada');
  for (let i = 0; i < indexes.length - 1; i++) assert.ok(indexes[i] < indexes[i + 1], `urutan ${steps[i]} sebelum ${steps[i + 1]}`);
  assert.match(source, /<ol className="order-steps">/);
  assert.match(source, /className="order-step"/);
  assert.match(css, /\.order-step\{border:1px solid var\(--line\)/);
  assert.match(css, /\.step-badge\{/);
});

test('kotak nominal memuat kartu produk dan menandai pilihan aktif', () => {
  assert.match(source, /const orderItems = view === 'checkout' \?/);
  assert.match(source, /className=\{item\.id === selected\?\.id \? 'product selected' : 'product'\}/);
  assert.match(source, /aria-current=\{item\.id === selected\?\.id \? 'true' : undefined\}/);
  assert.match(source, /Belum ada item produk yang dipilih\./);
});

test('jumlah pembelian memakai stepper terbatas dan total ringkasan ikut berubah', () => {
  assert.match(source, /const MAX_ITEM_QTY = 10/);
  assert.match(source, /function changeQuantity\(delta\)/);
  assert.match(source, /function setQuantityValue\(raw\)/);
  assert.match(source, /rupiah\(selected\.price \* itemQty\)/);
  assert.match(source, /\{itemQty\} item/);
  assert.match(source, /aria-label="Kurangi jumlah"/);
  assert.match(source, /aria-label="Tambah jumlah"/);
});

test('metode pembayaran dan kode promo tampil sebagai pratinjau yang jelas', () => {
  assert.match(source, /const PAYMENT_METHODS = \[/);
  assert.match(source, /role="radiogroup" aria-label="Metode pembayaran"/);
  assert.match(source, /step-tag">Pratinjau</);
  assert.match(source, /Kode promo belum aktif/);
});

test('detail kontak terisi otomatis untuk member dan bisa diisi tamu', () => {
  assert.match(source, /value=\{session\.user\.email \|\| ''\} readOnly/);
  assert.match(source, /session\.user\.phone \|\| session\.user\.user_metadata\?\.requested_phone/);
  assert.match(source, /Transaksi tamu \(email \+ nomor HP\) belum aktif/);
});
