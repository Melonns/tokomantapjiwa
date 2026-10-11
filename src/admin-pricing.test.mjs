import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./App.jsx', import.meta.url), 'utf8');

test('storefront never renders raw supplier prices', () => {
  assert.equal(source.includes('supplierPreview'), false);
  assert.equal(source.includes('Pratinjau katalog'), false);
  assert.equal(source.includes('Harga supplier, belum harga jual'), false);
});

test('admin pricing panel uses admin-only endpoints and labels cost as modal', () => {
  assert.match(source, /\/api\/admin\/supplier-products/);
  assert.match(source, /\/api\/admin\/products\//);
  assert.match(source, /Harga supplier adalah modal, tidak tampil ke pembeli\./);
  assert.match(source, /Modal \$\{rupiah\(item\.cost\)\}/);
});

test('admin pricing view: search, filters, card grid, semua produk tampil', () => {
  assert.match(source, /className="price-grid"/);
  assert.match(source, /aria-label="Cari produk supplier"/);
  assert.match(source, /aria-label="Saring produk"/);
  assert.doesNotMatch(source, /Tampilkan lebih banyak/);
  assert.doesNotMatch(source, /pricingVisible/);
  assert.doesNotMatch(source, /catalogShown/);
  assert.match(source, /brand\.items\.map\(/);
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
  assert.doesNotMatch(source, /price-collapse/);
  assert.doesNotMatch(source, /price-group-button/);
  assert.doesNotMatch(source, /Sembunyikan semua/);
  assert.match(source, /item\.category \|\| 'Lainnya'/);
  assert.match(source, /item\.game \|\| 'Lainnya'/);
  assert.match(source, /!item\.supported \|\| item\.missing === true \|\| !priceOk/);
});
