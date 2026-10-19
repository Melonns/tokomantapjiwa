import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./App.jsx', import.meta.url), 'utf8');

test('game and checkout are routed as separate pages', () => {
  assert.match(source, /'\/game\/'/);
  assert.match(source, /'\/beli\/'/);
  assert.match(source, /routeFromPath\(\)/);
  assert.match(source, /view === 'game' \?/);
  assert.match(source, /view === 'checkout' \?/);
});

test('choosing a game or voucher navigates to a page instead of stacking on home', () => {
  assert.match(source, /go\(`\/game\/\$\{encodeURIComponent/);
  assert.match(source, /go\(`\/beli\/\$\{encodeURIComponent/);
  assert.doesNotMatch(source, /setSelected\(/);
  assert.doesNotMatch(source, /category === 'Game' && game/);
});


test('catalog search suggests entries in a dropdown and opens the game page', () => {
  assert.match(source, /const searchCatalogs = /);
  assert.match(source, /id="home-search-suggest"/);
  assert.match(source, /aria-label="Cari di katalog"/);
  assert.ok(source.indexOf('className="home-search"') < source.indexOf('</header>'));
  assert.match(source, /const \[searchOpen, setSearchOpen\] = useState\(false\)/);
  assert.match(source, /function openCatalog\(name\) \{/);
  assert.match(source, /\/game\/\$\{encodeURIComponent\(name\)\}/);
  assert.doesNotMatch(source, /catalog-results/);
  assert.doesNotMatch(source, /catalogMatches/);
});
;

test('admin summary is a routed page with a real-data range control and honest environment label', () => {
  assert.match(source, /if \(path === '\/admin\/ringkasan'\) return \{ view: 'admin', adminPage: 'summary'/);
  assert.match(source, /if \(path === '\/admin' \|\| path === '\/admin\/produk'\) return \{ view: 'admin'/);
  assert.match(source, /href="\/admin\/ringkasan"/);
  assert.match(source, /request\(`\/api\/admin\/sales\?days=\$\{adminSalesDays\}`/);
  assert.match(source, /Lingkungan sandbox\. Angka di bawah bukan penjualan nyata\./);
  assert.match(source, /Belum ada data pembayaran terverifikasi pada periode ini\./);
  assert.match(source, /adminSalesDays === 7/);
  assert.match(source, /adminSalesDays === 30/);
});

test('admin pages are separate from personal profile and gated by server-verified role', () => {
  assert.match(source, /if \(path === '\/admin\/ringkasan'\) return \{ view: 'admin', adminPage: 'summary'/);
  assert.match(source, /const canManage = Boolean\(session && roleState === 'ready' && role === 'admin' && roleToken === session\.access_token\)/);
  assert.match(source, /canManage && <a href="\/admin"/);
  assert.match(source, /aria-label="Navigasi admin"/);
  assert.match(source, /href="\/admin\/produk"/);
  assert.match(source, /view !== 'admin' && <>/);
  assert.match(source, /view === 'admin' && canManage && adminPage === 'transactions'/);
  assert.match(source, /view === 'admin' && canManage && adminPage === 'products'/);
  assert.match(source, /Halaman ini khusus admin toko\./);
  const personal = source.slice(source.indexOf("{view !== 'admin' && <>"), source.indexOf("{view === 'admin' && session && roleState === 'loading'"));
  assert.match(personal, /Profil akun/);
  assert.match(personal, /Riwayat pesanan/);
  assert.doesNotMatch(personal, /pricing-title|admin-title|Navigasi admin/);
});

test('paid orders land on a dedicated invoice page, not the account page', () => {
  assert.match(source, /'\/struk\/'/);
  assert.match(source, /view === 'receipt' \?/);
  assert.match(source, /api\/orders\/\$\{encodeURIComponent\(receiptId\)\}/);
  assert.match(source, /\/struk\/\$\{encodeURIComponent\(order\.id\)\}/);
  assert.match(source, /className="invoice-page wrap"/);
  assert.match(source, /Invoice <span className="invoice-code">/);
  assert.match(source, /className="invoice-pay"/);
  assert.match(source, /className="invoice-progress"/);
  assert.match(source, /className="progress-steps"/);
  assert.match(source, /invoiceDetail\?\.qrUrl/);
  assert.match(source, /invoiceDetail\?\.vaNumber/);
  assert.match(source, /invoiceDetail\?\.billKey/);
  assert.match(source, /invoiceRemainingLabel/);
  assert.match(source, /Selesaikan pembayaran sebelum waktu habis\./);
  assert.equal(source.includes('Selesaikan pembayaran di halaman Midtrans'), false);
  assert.match(source, /copyText\(invoiceDetail\.vaNumber\)/);
  assert.match(source, /Menunggu pembayaran/);
  assert.match(source, /setReceiptRetry\(\(value\) => value \+ 1\), receiptDelay\(receiptRetry\)\)/);
  assert.match(source, /ACTIVE_STATUSES\.includes\(receipt\?\.status\)/);
});

test('halaman tidak dikenal, jeda struk bertingkat, dan pengajuan hapus akun tersedia', () => {
  assert.match(source, /view === 'notfound'/);
  assert.match(source, /id="tidak-ditemukan"/);
  assert.match(source, /import \{ receiptDelay \} from '\.\/refresh\.mjs'/);
  assert.match(source, /receiptDelay\(receiptRetry\)/);
  assert.match(source, /\/api\/account\/deletion-request/);
  assert.match(source, /Ajukan penghapusan akun/);
  assert.match(source, /account-danger/);
});
