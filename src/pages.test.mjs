import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./App.jsx', import.meta.url), 'utf8');

test('game and checkout are routed as separate pages', () => {
  assert.match(source, /#game\//);
  assert.match(source, /#beli\//);
  assert.match(source, /routeFromHash\(\)/);
  assert.match(source, /view === 'game' \?/);
  assert.match(source, /view === 'checkout' \?/);
});

test('choosing a game or voucher navigates to a page instead of stacking on home', () => {
  assert.match(source, /window\.location\.hash = `#game\/\$\{encodeURIComponent/);
  assert.match(source, /window\.location\.hash = `#beli\/\$\{encodeURIComponent/);
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
  assert.match(source, /#game\/\$\{encodeURIComponent\(name\)\}/);
  assert.doesNotMatch(source, /catalog-results/);
  assert.doesNotMatch(source, /catalogMatches/);
});
;

test('admin pages are separate from personal profile and gated by server-verified role', () => {
  assert.match(source, /hash === '#admin' \|\| hash === '#admin\/produk'/);
  assert.match(source, /const canManage = Boolean\(session && roleState === 'ready' && role === 'admin' && roleToken === session\.access_token\)/);
  assert.match(source, /canManage && <a href="#admin"/);
  assert.match(source, /aria-label="Navigasi admin"/);
  assert.match(source, /href="#admin\/produk"/);
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
  assert.match(source, /#struk\//);
  assert.match(source, /view === 'receipt' \?/);
  assert.match(source, /api\/orders\/\$\{encodeURIComponent\(receiptId\)\}/);
  assert.match(source, /#struk\/\$\{encodeURIComponent\(order\.id\)\}/);
  assert.match(source, /className="invoice-page wrap"/);
  assert.match(source, /Invoice <span className="invoice-code">/);
  assert.match(source, /className="invoice-pay"/);
  assert.match(source, /className="invoice-progress"/);
  assert.match(source, /className="progress-steps"/);
  assert.match(source, /invoiceDetail\?\.qrUrl/);
  assert.match(source, /invoiceDetail\?\.vaNumber/);
  assert.match(source, /invoiceDetail\?\.billKey/);
  assert.match(source, /invoiceRemainingLabel/);
  assert.match(source, /Bayar pakai QR atau nomor Virtual Account di halaman ini\./);
  assert.equal(source.includes('Selesaikan pembayaran di halaman Midtrans'), false);
  assert.match(source, /copyText\(invoiceDetail\.vaNumber\)/);
  assert.match(source, /Menunggu pembayaran/);
  assert.match(source, /setReceiptRetry\(\(value\) => value \+ 1\), 8000\)/);
  assert.match(source, /ACTIVE_STATUSES\.includes\(receipt\?\.status\)/);
});
