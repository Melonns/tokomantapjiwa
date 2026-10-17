import assert from 'node:assert/strict';
import test from 'node:test';
import { groupByKind, KIND_ORDER, namaSingkat, productKind } from './katalog.mjs';

test('jenis produk dibaca dari nama katalog supplier yang sebenarnya', () => {
  assert.equal(productKind('Mobile Legends 5 Diamonds (Indonesia)'), 'Diamond');
  assert.equal(productKind('Mobile Legends 86 Diamonds'), 'Diamond');
  assert.equal(productKind('Free Fire 70 Diamonds'), 'Diamond');
  assert.equal(productKind('Mobile Legends Weekly Diamond Pass (Indonesia)'), 'Weekly Diamond Pass');
  assert.equal(productKind('Mobile Legends Weekly Diamond Pass 5x (Indonesia)'), 'Weekly Diamond Pass');
  assert.equal(productKind('Mobile Legends Twilight Pass (Indonesia)'), 'Twilight Pass');
  assert.equal(productKind('Mobile Legends Bundle 5 + 10 Diamonds (Indonesia)'), 'Bundle');
  assert.equal(productKind('MOBILE LEGENDS Weekly Elite Bundle (Indonesia)'), 'Bundle');
  assert.equal(productKind('Mobile Legends First Top Up 50+Bonus Diamonds (Indonesia)'), 'First Top Up');
  assert.equal(productKind('Mobile Legends Cek Username'), 'Cek ID');
});

test('nama di luar pola tetap punya kelompok, bukan hilang', () => {
  assert.equal(productKind('Genshin Impact 60 Genesis Crystals'), 'Lainnya');
  assert.equal(productKind(''), 'Lainnya');
  assert.equal(productKind(null), 'Lainnya');
  assert.equal(productKind(undefined), 'Lainnya');
});

test('paket khusus tidak tertelan oleh pola diamond', () => {
  const nama = [
    'Mobile Legends First Top Up 50+Bonus Diamonds (Indonesia)',
    'Mobile Legends Weekly Diamond Pass (Indonesia)',
    'Mobile Legends 86 Diamonds (Indonesia)',
  ];
  const kinds = nama.map(productKind);
  assert.deepEqual(kinds, ['First Top Up', 'Weekly Diamond Pass', 'Diamond']);
});

test('pengelompokan mengikuti urutan tampil dan memuat semua produk', () => {
  const items = [
    { name: 'Mobile Legends 86 Diamonds' },
    { name: 'Mobile Legends Weekly Diamond Pass' },
    { name: 'Mobile Legends Twilight Pass' },
    { name: 'Mobile Legends 172 Diamonds' },
  ];
  const hasil = groupByKind(items);
  assert.deepEqual(hasil.map((g) => g.name), ['Weekly Diamond Pass', 'Twilight Pass', 'Diamond']);
  assert.deepEqual(hasil.map((g) => g.items.length), [1, 1, 2]);
  assert.equal(hasil.reduce((n, g) => n + g.items.length, 0), items.length);
  assert.equal(KIND_ORDER.at(-1), 'Lainnya');
});

test('nama kartu nominal dipangkas dari nama brand', () => {
  assert.equal(namaSingkat({ game: 'Genshin Impact', name: 'Genshin Impact 60 Genesis Crystals' }), '60 Genesis Crystals');
  assert.equal(namaSingkat({ game: 'MOBILE LEGENDS', name: 'Mobile Legends 10 Diamonds (Indonesia)' }), '10 Diamonds (Indonesia)');
  assert.equal(namaSingkat({ game: 'FREE FIRE', name: 'Free Fire 10 Diamond' }), '10 Diamond');
  assert.equal(namaSingkat({ game: 'Honkai Star Rail', name: 'Honkai Star Rail  6480+1600 Monochrome x2' }), '6480+1600 Monochrome x2');
  assert.equal(namaSingkat({ game: 'Valorant', name: 'Valorant 1.000 VP' }), '1.000 VP');
});

test('nama tanpa awalan brand dibiarkan utuh', () => {
  assert.equal(namaSingkat({ game: 'K-VISION dan GOL', name: 'K-Vision & GOL Paket CLING (CL01) 30 Hari' }), 'K-Vision & GOL Paket CLING (CL01) 30 Hari');
  assert.equal(namaSingkat({ game: 'Valorant', name: 'Paket Spesial' }), 'Paket Spesial');
  assert.equal(namaSingkat({ game: 'Valorant', name: 'Valorant' }), 'Valorant');
  assert.equal(namaSingkat({}), '');
  assert.equal(namaSingkat(null), '');
});
