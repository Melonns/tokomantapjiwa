import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./App.jsx', import.meta.url), 'utf8');
const css = await readFile(new URL('./store.css', import.meta.url), 'utf8');
const server = await readFile(new URL('../server/app.mjs', import.meta.url), 'utf8');

test('storefront never renders raw supplier prices', () => {
  assert.equal(source.includes('supplierPreview'), false);
  assert.equal(source.includes('Pratinjau katalog'), false);
  assert.equal(source.includes('Harga supplier, belum harga jual'), false);
});

test('admin pricing panel uses admin-only endpoints and labels cost as modal', () => {
  assert.match(source, /\/api\/admin\/supplier-products/);
  assert.match(source, /\/api\/admin\/products\//);
  assert.match(source, /Harga supplier adalah modal dan tidak ditampilkan ke pembeli\./);
  assert.match(source, /Modal \$\{rupiah\(item\.cost\)\}/);
});

test('admin pricing view: search, filters, card grid, semua produk tampil', () => {
  assert.match(source, /className="price-grid"/);
  assert.match(source, /aria-label="Cari produk supplier"/);
  assert.match(source, /aria-label="Saring produk"/);
  assert.doesNotMatch(source, /Tampilkan lebih banyak/);
  assert.doesNotMatch(source, /pricingVisible/);
  assert.doesNotMatch(source, /catalogShown/);
  assert.match(source, /brand\.kinds\.map\(/);
  assert.match(source, /kind\.items\.map\(/);
  assert.match(source, /className="price-kind"/);
  assert.match(source, /className="price-kind-head"/);
  assert.match(source, /groupByKind\(items\)/);
  assert.match(css, /\.price-kind-head\{/);
  assert.match(source, /catalogShowUnsupported/);
});

test('admin pricing supports batch save and enter-to-save', () => {
  assert.match(source, /saveAllChanges/);
  assert.match(source, /Simpan semua \(\{pricingDirty\}\)/);
  assert.match(source, /onKeyDown=\{\(event\) => \{ if \(event\.key === 'Enter'\) saveSellingPrice/);
  assert.match(source, /pricing-meta-actions/);
});
test('admin pricing groups per kategori dan game dengan sakelar, tanpa tombol teks', () => {
  assert.match(source, /className="price-groups"/);
  assert.match(source, /className="price-group"/);
  assert.match(source, /className="price-brand"/);
  assert.match(source, /price-cat-head/);
  assert.match(source, /GameCover name=\{brand\.name\}/);
  assert.match(source, /role="switch"/);
  assert.match(source, /toggleGroup\(category\.items, event\.target\.checked\)/);
  assert.match(source, /toggleGroup\(brand\.items, event\.target\.checked\)/);
  assert.match(source, /<details className="price-category" open=\{Boolean\(catalogQuery\.trim\(\)\)\}/);
  assert.match(source, /<details className="price-brand-details" open=\{Boolean\(catalogQuery\.trim\(\)\)\}/);
  assert.match(source, /<summary className="price-cat-head"/);
  assert.match(source, /<summary className="price-brand-head"/);
  assert.match(source, /className="switch price-category-switch"/);
  assert.match(source, /className="switch price-brand-switch"/);
  assert.match(css, /\.price-group>\.price-category-switch,\.price-brand>\.price-brand-switch\{position:absolute/);
  assert.match(css, /\.price-cat-head:hover,\.price-brand-head:hover\{background:#203224;border-radius:var\(--r-tile\)\}/);
  assert.match(css, /\.price-category\[open\]>\.price-cat-head:hover\{border-radius:var\(--r-card\) var\(--r-card\) 0 0\}/);
  assert.doesNotMatch(source, /<summary[^>]*>[^]*?<label className="switch"[^]*?<\/summary>/);
  assert.doesNotMatch(source, /price-group-button/);
  assert.doesNotMatch(source, /Sembunyikan semua/);
  assert.match(source, /item\.category \|\| 'Lainnya'/);
  assert.match(source, /item\.game \|\| 'Lainnya'/);
  assert.match(source, /!item\.supported \|\| item\.missing === true \|\| !priceOk/);
});

test('admin pricing menampilkan varian tujuan dan brand berformat plain', () => {
  assert.match(source, /item\.variant \? ` · \$\{item\.variant\}` : ''/);
  assert.match(server, /'FREE FIRE': 'plain'/);
  assert.match(server, /'MOBILE LEGENDS': 'ml_concat'/);
});

test('panel harga menyimpan katalog di server dan bisa menyinkron ulang sendiri', () => {
  assert.match(source, /className="catalog-sync"/);
  assert.match(source, /Perbarui katalog/);
  assert.match(source, /\/api\/admin\/supplier-products\/sync/);
  assert.match(source, /setCatalogSyncNotice\(''\)[^]*?request\('\/api\/admin\/supplier-products\/sync', \{ method: 'POST'/);
  assert.match(source, /className="pricing-stale"/);
  assert.match(source, /setAdminCatalogStale\(data\.catalogStale === true\)/);
  assert.match(css, /\.pricing-stale\{flex-basis:100%/);
});

test('panel harga bisa mengisi draft dari margin persen per brand', () => {
  assert.match(source, /const \[marginDrafts, setMarginDrafts\] = useState\(\{\}\)/);
  assert.match(source, /applyBrandMargin/);
  assert.match(source, /const saran = suggestPrice\(item\.cost, item\.category, pct\)/);
  assert.match(source, /className="price-margin"/);
  assert.match(source, /aria-label=\{`Margin harga \$\{brand\.name\} \(%\)`\}/);
  assert.match(source, /Modal × \(1 \+ %\), sudah termasuk biaya QRIS, dibulatkan ke atas\./);
  assert.match(css, /\.price-margin\{display:flex/);
  assert.match(css, /\.price-margin-field input\{[^}]*min-height:44px/);
});

test('panel harga menandai margin rugi/tipis dan menawarkan harga saran', () => {
  assert.match(source, /const health = priceHealth\(draft\.price, item\.cost, item\.category\)/);
  assert.match(source, /const saran = suggestPrice\(item\.cost, item\.category\)/);
  assert.match(source, /price-health-\$\{health\.level\}/);
  assert.match(source, /Rugi \$\{rupiah\(Math\.abs\(health\.netRp\)\)\} setelah biaya QRIS\./);
  assert.match(source, /Margin aman: sisa \$\{rupiah\(health\.netRp\)\} \(\$\{health\.marginPct\}%\)\./);
  assert.match(source, /Belum cukup untuk biaya VA\./);
  assert.match(source, /Gunakan saran \{rupiah\(saran\)\}/);
  assert.match(source, /target margin \{marginBand\(item\.category, Number\(item\.cost\) \|\| 0\)\.pct\}%/);
  assert.match(css, /\.price-warning\.price-health-rugi\{color:var\(--danger\)\}/);
  assert.match(css, /\.price-suggest-row\{display:flex/);
});

test('harga otomatis: mode per SKU, hitung ulang di server, dan CSV buat Excel', () => {
  assert.match(server, /repriceAutoProducts/);
  assert.match(server, /WHERE p\.price_mode = 'auto'/);
  assert.match(server, /autoPriced/);
  assert.match(server, /price_mode = EXCLUDED\.price_mode/);
  assert.match(source, /buildCatalogCsv/);
  assert.match(source, /parseCatalogCsv/);
  assert.match(source, /Ekspor CSV/);
  assert.match(source, /Impor CSV/);
  assert.match(source, /Kunci manual/);
  assert.match(source, /harga otomatis disesuaikan/);
  assert.match(css, /\.price-mode\{/);
  assert.match(css, /\.csv-import\{/);
});

test('harga otomatis: ekspor CSV tidak membocorkan modal ke storefront', () => {
  assert.match(source, /text\/csv;charset=utf-8/);
  assert.equal(source.includes('supplierPreview'), false);
});

test('panel admin punya halaman voucher dengan formulir dan tombol aktif/nonaktif', () => {
  assert.match(source, /adminPage === 'vouchers' && <section className="order-section admin-section" aria-labelledby="voucher-title">/);
  assert.match(source, /Voucher pembeli baru tidak dapat dipakai oleh akun yang sudah pernah membeli\./);
  assert.match(source, /request\('\/api\/admin\/vouchers', \{ method: 'POST'/);
  assert.match(source, /\{item\.active \? 'Matikan' : 'Nyalakan'\}/);
});
