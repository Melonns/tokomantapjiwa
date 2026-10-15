import assert from 'node:assert/strict';
import test from 'node:test';
import { availablePaymentMethods, marginBand, priceHealth, QRIS_FEE_PCT, suggestPrice, VA_FEE_RP, VA_METHOD_IDS, VA_MIN_ORDER, voucherDiscount } from './pricing.mjs';

test('saran harga mengikuti modal + biaya QRIS dan dibulatkan ke atas', () => {
  // Angka nyata dari katalog supplier: 10% di nominal kecil, turun di nominal besar.
  assert.equal(suggestPrice(1605, 'Games'), 1800);
  assert.equal(suggestPrice(28343, 'Games'), 31000);
  assert.equal(suggestPrice(60135, 'Games'), 64500);
  assert.equal(suggestPrice(10175, 'Pulsa'), 11500);
  assert.equal(suggestPrice(19830, 'Pulsa'), 21500);
  assert.equal(suggestPrice(50270, 'E-Money'), 52000);
  assert.equal(suggestPrice(21400, 'PLN'), 23000);
  // Nominal receh tetap dapat harga bulat.
  assert.equal(suggestPrice(5, 'Games'), 100);
  assert.equal(suggestPrice(1605, 'Games', 20), 2000);
  assert.equal(suggestPrice(0, 'Games'), null);
  assert.equal(suggestPrice(null, 'Games'), null);
  assert.equal(suggestPrice(undefined, 'Games'), null);
  assert.equal(suggestPrice('abc', 'Games'), null);
});

test('margin turun saat modal naik, kategori tak dikenal dapat default', () => {
  const games = [100, 20000, 100000, 300000].map((cost) => marginBand('Games', cost).pct);
  assert.deepEqual(games, [10, 8, 6, 4]);
  const pulsa = [10175, 19830, 48785, 98685].map((cost) => suggestPrice(cost, 'Pulsa'));
  assert.deepEqual(pulsa, [11500, 21500, 52000, 104000]);
  assert.equal(marginBand('Kategori Baru', 5000).pct, 8);
  assert.equal(marginBand('E-Money', 200000).pct, 1.5);
});

test('sisa bersih dihitung setelah biaya QRIS', () => {
  const aman = priceHealth(1800, 1605, 'Games');
  assert.equal(aman.level, 'aman');
  assert.equal(aman.netRp, 182);
  assert.equal(aman.marginPct, 10.8);
  assert.equal(aman.vaSafe, false);
  const tipis = priceHealth(6500, 6333, 'Games');
  assert.equal(tipis.level, 'tipis');
  assert.equal(tipis.netRp, 122);
  const rugi = priceHealth(1610, 1605, 'Games');
  assert.equal(rugi.level, 'rugi');
  assert.ok(rugi.netRp < 0);
  const besar = priceHealth(50000, 28343, 'Games');
  assert.equal(besar.level, 'aman');
  assert.equal(besar.vaSafe, true);
  assert.equal(priceHealth('', 1605, 'Games'), null);
  assert.equal(priceHealth(1800, 0, 'Games'), null);
});

test('kanal ber-minOrder disembunyikan di pesanan kecil', () => {
  const methods = [{ id: 'qris' }, { id: 'bca_va', minOrder: VA_MIN_ORDER }, { id: 'gopay' }];
  assert.deepEqual(availablePaymentMethods(methods, 1800).map((m) => m.id), ['qris', 'gopay']);
  assert.deepEqual(availablePaymentMethods(methods, VA_MIN_ORDER).map((m) => m.id), ['qris', 'bca_va', 'gopay']);
  assert.deepEqual(availablePaymentMethods(methods, undefined).map((m) => m.id), ['qris', 'gopay']);
  assert.equal(QRIS_FEE_PCT, 0.7);
  assert.equal(VA_FEE_RP, 4440);
  assert.equal(VA_MIN_ORDER, 100000);
  assert.equal(VA_METHOD_IDS.length, 5);
});

test('voucherDiscount: potongan tetap, persen dengan plafon, dan syarat minimum', () => {
  assert.equal(voucherDiscount({ kind: 'fixed', value: 1000, min_order: 10000 }, 25000), 1000);
  assert.equal(voucherDiscount({ kind: 'fixed', value: 1000, min_order: 10000 }, 9999), 0);
  assert.equal(voucherDiscount({ kind: 'fixed', value: 5000, min_order: 0 }, 2000), 1999);
  assert.equal(voucherDiscount({ kind: 'percent', value: 10, min_order: 0, max_discount: 2000 }, 64500), 2000);
  assert.equal(voucherDiscount({ kind: 'percent', value: 10, min_order: 0, max_discount: 0 }, 64500), 6450);
  assert.equal(voucherDiscount({ kind: 'percent', value: 200, min_order: 0 }, 64500), 58050);
  assert.equal(voucherDiscount(null, 64500), 0);
  assert.equal(voucherDiscount({ kind: 'fixed', value: 1000 }, 0), 0);
  assert.equal(voucherDiscount({ kind: 'fixed', value: 'abc' }, 25000), 0);
});
