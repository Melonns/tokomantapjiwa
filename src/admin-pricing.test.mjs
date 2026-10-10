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

test('admin pricing view stays compact: search, filters, card grid, load more', () => {
  assert.match(source, /className="price-grid"/);
  assert.match(source, /aria-label="Cari produk supplier"/);
  assert.match(source, /aria-label="Saring produk"/);
  assert.match(source, /Tampilkan lebih banyak \(sisa /);
  assert.match(source, /pricingVisible\.map/);
  assert.match(source, /Menampilkan \{pricingVisible\.length\} dari \{pricingItems\.length\} produk/);
  assert.match(source, /catalogShowUnsupported/);
});

test('admin pricing supports batch save and enter-to-save', () => {
  assert.match(source, /saveAllChanges/);
  assert.match(source, /Simpan semua \(\{pricingDirty\}\)/);
  assert.match(source, /onKeyDown=\{\(event\) => \{ if \(event\.key === 'Enter'\) saveSellingPrice/);
  assert.match(source, /pricing-meta-actions/);
});
