import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { fetchSupplierCatalog } from './catalog.mjs';
import { createHandler } from './app.mjs';

const env = { DIGIFLAZZ_USERNAME: 'test-buyer', DIGIFLAZZ_API_KEY: 'test-key', CHECKOUT_ENABLED: 'true' };
const active = { product_name: 'Test product', brand: 'Test brand', type: 'Umum', category: 'Pulsa', buyer_sku_code: 'test-sku', price: '10000', buyer_product_status: true, seller_product_status: true, unlimited_stock: false, stock: '1' };

test('katalog supplier disaring, SKU ganda memakai baris terakhir, kredensial tidak ikut keluar', async () => {
  let calls = 0;
  const items = await fetchSupplierCatalog(async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.digiflazz.com/v1/price-list');
    assert.deepEqual(JSON.parse(options.body), { cmd: 'prepaid', username: env.DIGIFLAZZ_USERNAME, sign: createHash('md5').update('test-buyertest-keypricelist').digest('hex') });
    return { ok: true, json: async () => ({ data: [
      active,
      { ...active, seller_product_status: false },
      { ...active, stock: 0 },
      { ...active, price: -1 },
      { ...active, buyer_sku_code: 'unlimited', unlimited_stock: true, stock: 0 },
      { ...active, price: '12000', product_name: ' Test product ' },
      { ...active, buyer_sku_code: 'bad-game', brand: 'X'.repeat(200) },
    ] }) };
  }, env);
  assert.equal(calls, 1);
  assert.equal(items.length, 2);
  assert.deepEqual(items.find(item => item.id === 'test-sku'), { id: 'test-sku', name: 'Test product', game: 'Test brand', category: 'Pulsa', variant: 'Umum', price: 12000 });
  assert.equal(items.find(item => item.id === 'unlimited').price, 10000);
  assert.equal(JSON.stringify(items).includes('test-key'), false);
});

test('error provider membawa rc supaya endpoint bisa membedakan pesannya, dan pull berikutnya bisa pulih', async () => {
  let calls = 0;
  await assert.rejects(fetchSupplierCatalog(async () => { calls++; return { ok: true, json: async () => ({ data: { rc: '83', message: 'limitasi pengecekan pricelist' } }) }; }, env), err => err.rc === '83');
  const items = await fetchSupplierCatalog(async () => ({ ok: true, json: async () => ({ data: [active] }) }), env);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0], { id: 'test-sku', name: 'Test product', game: 'Test brand', category: 'Pulsa', variant: 'Umum', price: 10000 });
  assert.equal(calls, 1);
});

test('empty merchant catalog serves no supplier prices and never touches Digiflazz', async () => {
  let supplierCalls = 0;
  const server = createServer(createHandler({
    env,
    pool: { async query(sql) { assert.ok(sql.startsWith('SELECT')); return { rows: [] }; } },
    fetchImpl: async () => { supplierCalls++; throw Error('supplier touched'); },
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/products`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body, { products: [], checkoutAvailable: false });
    assert.equal(supplierCalls, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
