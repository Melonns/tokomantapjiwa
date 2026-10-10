import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { supplierCatalog } from './catalog.mjs';
import { createHandler } from './app.mjs';

const env = { DIGIFLAZZ_USERNAME: 'test-buyer', DIGIFLAZZ_API_KEY: 'test-key', CHECKOUT_ENABLED: 'true' };
const active = { product_name: 'Test product', brand: 'Test brand', category: 'Pulsa', buyer_sku_code: 'test-sku', price: '10000', buyer_product_status: true, seller_product_status: true, unlimited_stock: false, stock: '1' };

test('catalog filters unavailable and invalid products, caches concurrent requests, exposes no credentials', async () => {
  let calls = 0;
  const load = supplierCatalog(async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.digiflazz.com/v1/price-list');
    assert.deepEqual(JSON.parse(options.body), { cmd: 'prepaid', username: env.DIGIFLAZZ_USERNAME, sign: createHash('md5').update('test-buyertest-keypricelist').digest('hex') });
    return { ok: true, json: async () => ({ data: [active, { ...active, seller_product_status: false }, { ...active, stock: 0 }, { ...active, price: -1 }, { ...active, buyer_sku_code: 'unlimited', unlimited_stock: true, stock: 0 }] }) };
  }, env);
  const [a, b] = await Promise.all([load(), load()]);
  assert.equal(a, b);
  assert.equal(a.length, 2);
  assert.deepEqual(a[0], { id: 'test-sku', name: 'Test product', game: 'Test brand', category: 'Pulsa', price: 10000 });
  await load();
  assert.equal(calls, 1);
});

test('provider error is not cached and retry can recover', async () => {
  let calls = 0;
  const load = supplierCatalog(async () => ({ ok: true, json: async () => ++calls === 1 ? { data: { rc: '03' } } : { data: [active] } }), env);
  await assert.rejects(load());
  assert.equal((await load()).length, 1);
  assert.equal(calls, 2);
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
