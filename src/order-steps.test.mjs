import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { VA_METHOD_IDS, VA_MIN_ORDER } from './pricing.mjs';

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

test('jumlah pembelian memakai stepper terbatas dan ringkasan menagih satu item', () => {
  assert.match(source, /const MAX_ITEM_QTY = 10/);
  assert.match(source, /function changeQuantity\(delta\)/);
  assert.match(source, /function setQuantityValue\(raw\)/);
  assert.match(source, /<span>Jumlah<\/span><strong>1 item<\/strong>/);
  assert.match(source, /<span>Total<\/span><strong>\{rupiah\(selected\.price - voucherCut\(\)\)\}<\/strong>/);
  assert.match(source, /id="voucher-code"/);
  assert.match(source, /Potongan \{voucher\.code\}/);
  assert.match(source, /Jumlah banyak belum aktif, jadi satu pesanan berisi satu item\./);
  // ponytail: pembeli harus tahu total di checkout sama dengan harga di rak - lawan trik 'murah di depan, biaya di belakang'.
  assert.match(source, /Sudah termasuk biaya pembayaran — tidak ada tambahan di langkah berikutnya\./);
  assert.match(source, /aria-label="Kurangi jumlah"/);
  assert.match(source, /aria-label="Tambah jumlah"/);
});

test('metode pembayaran yang dipilih ikut terkirim ke checkout, kode promo aktif', () => {
  assert.match(source, /const PAYMENT_METHODS = \[/);
  assert.match(source, /role="radiogroup" aria-label="Metode pembayaran"/);
  assert.match(source, /zoneId: zoneId\.trim\(\), paymentMethod: activePaymentMethod\(payable\), voucherCode: voucherUse\?\.code \}/);
  assert.match(source, /QR atau nomor Virtual Account tampil di halaman invoice setelah pesanan dibuat/);
  assert.match(source, /const VA_BANKS = \{ bca: 'BCA', bni: 'BNI', bri: 'BRI', permata: 'Permata' \}/);
  for (const id of ['qris', 'bca_va', 'bni_va', 'bri_va', 'permata_va', 'mandiri_bill', 'gopay', 'shopeepay']) {
    assert.ok(source.includes(`id: '${id}'`), `kanal ${id} hilang dari PAYMENT_METHODS`);
  }
  assert.equal(source.includes('Metode final masih dipilih'), false);
  assert.match(source, /Punya kode dari teman\? Tulis di sini/);
});

test('pesanan dibuat lewat modal konfirmasi, bukan langsung dari form', () => {
  assert.match(source, /function openConfirm\(event\)/);
  assert.match(source, /onSubmit=\{openConfirm\}/);
  assert.match(source, /role="dialog" aria-modal="true" aria-labelledby="confirm-title"/);
  assert.match(source, /Periksa sekali lagi\. Pesanan baru dibuat setelah kamu menekan Pesan sekarang\./);
  assert.match(source, /<dt>Potongan \{voucher\.code\}<\/dt><dd>\u2212\{rupiah\(voucherCut\(\)\)\}<\/dd>/);
  assert.match(source, /<dt>Total<\/dt><dd><strong>\{rupiah\(\(selected\?\.price \|\| 0\) - voucherCut\(\)\)\}<\/strong><\/dd>/);
  assert.match(source, /Pesan sekarang/);
  assert.match(source, /className="confirm-terms"/);
  assert.match(source, /disabled=\{!termsOk \|\| checkoutState === 'loading'\}/);
  assert.match(source, /window\.location\.hash = `#struk\/\$\{encodeURIComponent\(data\.orderId\)\}`/);
  assert.equal(source.includes('window.location.assign('), false);
  assert.equal(source.includes('snap/v1/transactions'), false);
});

test('detail kontak terisi otomatis untuk member dan bisa diisi tamu', () => {
  assert.match(source, /value=\{session\.user\.email \|\| ''\} readOnly/);
  assert.match(source, /session\.user\.phone \|\| session\.user\.user_metadata\?\.requested_phone/);
  assert.match(source, /Transaksi tamu \(email \+ nomor HP\) belum aktif/);
});

test('halaman beli mendukung format uid_server (pilih server) dan riot (Riot ID)', () => {
  assert.match(source, /const uidServerOptions = \[/);
  assert.match(source, /<label>Server <select value=\{zoneId\}/);
  assert.match(source, /orderFormat === 'uid_server'/);
  assert.match(source, /orderFormat === 'riot'/);
  assert.match(source, /Nama#1234/);
  assert.match(source, /Riot ID/);
});

test('id kanal bayar di klien sama dengan id kanal di server', async () => {
  const server = await readFile(new URL('../server/app.mjs', import.meta.url), 'utf8');
  const start = server.indexOf('const PAYMENT_METHODS = {');
  assert.ok(start > 0, 'PAYMENT_METHODS server tidak ditemukan');
  const block = server.slice(start, server.indexOf('};', start));
  const serverIds = [...block.matchAll(/^ {2}([a-z_]+):/gm)].map((match) => match[1]);
  const clientIds = [...source.matchAll(/id: '([a-z_]+)', group/g)].map((match) => match[1]);
  assert.equal(serverIds.length, 8);
  assert.deepEqual(clientIds, serverIds);
  const serverMin = Number(server.match(/const VA_MIN_ORDER = (\d+)/)[1]);
  assert.equal(serverMin, VA_MIN_ORDER);
  for (const id of VA_METHOD_IDS) assert.ok(server.includes(`'${id}'`), `${id} tidak ada di server`);
});
test('kanal VA disembunyikan di pesanan kecil dan dipaksa aman saat checkout', () => {
  assert.match(source, /function activePaymentMethod\(price\)/);
  assert.match(source, /availablePaymentMethods\(PAYMENT_METHODS, selected \? selected\.price - voucherCut\(\) : 0\)\.map\(\(method, index, options\)/);
  assert.match(source, /Virtual Account &amp; Mandiri Bill tersedia untuk pesanan mulai \{rupiah\(VA_MIN_ORDER\)\}/);
  assert.match(source, /paymentMethod: activePaymentMethod\(payable\), voucherCode: voucherUse\?\.code \}/);
  assert.match(css, /\.pay-note\{color:var\(--muted\)/);
});
test('struk menampilkan harga asli, potongan, dan total yang ditagih', () => {
  assert.match(source, /Harga<\/dt><dd>\{rupiah\(Number\(receipt\.price\) \+ Number\(receipt\.discount\)\)\}<\/dd>/);
  assert.match(source, /Potongan\{receipt\.voucherCode/);
  assert.match(source, /\u2212\{rupiah\(receipt\.discount\)\}/);
  assert.match(source, /<dt>Total<\/dt><dd><strong>\{rupiah\(receipt\.price\)\}<\/strong><\/dd>/);
});
