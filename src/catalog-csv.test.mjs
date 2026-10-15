import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalogCsv, parseCatalogCsv } from './catalog-csv.mjs';

test('csv katalog: header dan baris memakai pemisah titik-koma agar rapi di Excel Indonesia', () => {
  const csv = buildCatalogCsv([
    { sku: 'ff12', name: '12 Diamonds', game: 'FREE FIRE', category: 'Games', cost: 1605, price: 1800, saran: 1800, priceMode: 'auto', enabled: true },
    { sku: 'ml10', name: '10 Diamond', game: 'MOBILE LEGENDS', category: 'Games', cost: 3057, price: 4000, saran: 3800, priceMode: 'manual', enabled: false },
  ]);
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[0], 'sku;nama;game;kategori;modal;harga_sekarang;harga_saran;mode;aktif');
  assert.equal(lines[1], 'ff12;12 Diamonds;FREE FIRE;Games;1605;1800;1800;auto;ya');
  assert.equal(lines[2], 'ml10;10 Diamond;MOBILE LEGENDS;Games;3057;4000;3800;manual;tidak');
});

test('csv katalog: hasil ekspor bisa dibaca balik (sku, harga, mode)', () => {
  const csv = buildCatalogCsv([{ sku: 'ff12', name: '12 Diamonds', game: 'FREE FIRE', category: 'Games', cost: 1605, price: 1800, saran: 1800, priceMode: 'auto', enabled: true }]);
  assert.deepEqual(parseCatalogCsv(csv), [{ sku: 'ff12', price: 1800, priceMode: 'auto' }]);
});

test('csv katalog: nerima pemisah koma dan header ringkas sku,harga,mode', () => {
  const rows = parseCatalogCsv('sku,harga,mode\nff12,2500,manual\nml10,3800,AUTO\n');
  assert.deepEqual(rows, [
    { sku: 'ff12', price: 2500, priceMode: 'manual' },
    { sku: 'ml10', price: 3800, priceMode: 'auto' },
  ]);
});

test('csv katalog: sel kosong = harga tidak diubah, dan sel berisi titik-koma aman', () => {
  const rows = parseCatalogCsv('sku;nama;harga_sekarang;mode\nff12;"12 Diamonds; promo";1800;manual\nml10;; ;auto\n');
  assert.deepEqual(rows, [
    { sku: 'ff12', price: 1800, priceMode: 'manual' },
    { sku: 'ml10', price: null, priceMode: 'auto' },
  ]);
});

test('csv katalog: header tidak dikenal dibalas null agar panel dapat memberi contoh', () => {
  assert.equal(parseCatalogCsv('nama,game\n12 Diamonds,FREE FIRE\n'), null);
  assert.deepEqual(parseCatalogCsv(''), []);
});

test('csv katalog: harga di luar batas server diabaikan (dianggap kosong)', () => {
  const rows = parseCatalogCsv('sku,harga\nff12,999999999999\nml10,0\n');
  assert.deepEqual(rows, [
    { sku: 'ff12', price: null, priceMode: 'auto' },
    { sku: 'ml10', price: null, priceMode: 'auto' },
  ]);
});
