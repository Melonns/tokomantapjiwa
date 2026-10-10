import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { validateCheckout, verifiedPayment } from './core.mjs';
import { createHandler, digiRequest } from './app.mjs';

const env = { MIDTRANS_SERVER_KEY: 'sandbox-secret', DIGIFLAZZ_USERNAME: 'buyer', DIGIFLAZZ_API_KEY: 'api-secret', MIDTRANS_ENV: 'sandbox', DIGIFLAZZ_TESTING: 'true', CHECKOUT_ENABLED: 'true', DATABASE_URL: 'test', SUPABASE_URL: 'https://sample.supabase.co', SUPABASE_ANON_KEY: 'public-key' };
const ownerId = '22222222-2222-4222-8222-222222222222';
const authHeaders = { authorization: 'Bearer buyer-token' };
const withAuth = next => async (url, options) => url === 'https://sample.supabase.co/auth/v1/user'
  ? { ok: true, status: 200, json: async () => ({ id: ownerId, email_confirmed_at: '2026-01-01T00:00:00Z' }) }
  : next(url, options);

test('checkout validates identifiers and rejects non-scalar/oversized input', () => {
  assert.deepEqual(validateCheckout({ productId: 'ml-1', userId: '12345', zoneId: '1234' }), { productId: 'ml-1', userId: '12345', zoneId: '1234' });
  for (const body of [{ productId: 'x', userId: {}, zoneId: '1' }, { productId: 'x', userId: '123', zoneId: 'a b' }, { productId: 'x', userId: '1'.repeat(65), zoneId: '1' }, { productId: 'x/../', userId: '1', zoneId: '1' }]) assert.throws(() => validateCheckout(body));
});

test('signed settlement validates amount and rejects forged capture', () => {
  const n = { order_id: '11111111-1111-4111-8111-111111111111', status_code: '200', gross_amount: '25000.00', transaction_status: 'settlement' };
  n.signature_key = createHash('sha512').update(n.order_id + n.status_code + n.gross_amount + env.MIDTRANS_SERVER_KEY).digest('hex');
  assert.equal(verifiedPayment(n, env.MIDTRANS_SERVER_KEY), true);
  assert.equal(verifiedPayment({ ...n, gross_amount: '1.00' }, env.MIDTRANS_SERVER_KEY), false);
  assert.equal(verifiedPayment({ ...n, transaction_status: 'capture', fraud_status: 'challenge' }, env.MIDTRANS_SERVER_KEY), false);
  assert.equal(verifiedPayment({ ...n, status_code: '201' }, env.MIDTRANS_SERVER_KEY), false);
});

test('Digiflazz request uses development testing flag and stable ref_id', () => {
  const row = { id: '11111111-1111-4111-8111-111111111111', digi_sku: 'TEST', customer_no: '123100', price: 25000 };
  const request = digiRequest(row, env);
  assert.equal(request.username, 'buyer');
  assert.equal(request.ref_id, row.id);
  assert.equal(request.testing, true);
  assert.equal(request.sign, createHash('md5').update('buyerapi-secret' + row.id).digest('hex'));
  assert.equal(digiRequest(row, { ...env, DIGIFLAZZ_TESTING: 'false' }).testing, undefined);
});

test('checkout stays disabled without explicit operator flag', async () => {
  let calls = 0;
  const handler = createHandler({ pool: { query() { calls++; throw Error('db touched'); } }, fetchImpl: withAuth(() => { calls++; throw Error('external touched'); }), env: { ...env, CHECKOUT_ENABLED: 'false' } });
  const server = createServer(handler).listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/checkout`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders }, body: JSON.stringify({ productId: 'ml10', userId: '123', zoneId: '100' }) });
    assert.equal(response.status, 503);
    assert.equal(calls, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('forged notification never touches database or Digi', async () => {
  let called = 0;
  const handler = createHandler({ pool: { query() { called++; throw Error('db touched'); } }, fetchImpl() { called++; throw Error('digi touched'); }, env });
  const server = createServer(handler).listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/webhooks/midtrans`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ order_id: '1', transaction_status: 'settlement', signature_key: 'forged' }) });
    assert.equal(response.status, 401);
    assert.equal(called, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('sandbox payment cannot trigger live Digiflazz', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const n = { order_id: id, status_code: '200', gross_amount: '25000.00', transaction_status: 'settlement' };
  n.signature_key = createHash('sha512').update(id + n.status_code + n.gross_amount + env.MIDTRANS_SERVER_KEY).digest('hex');
  let called = 0;
  const handler = createHandler({ pool: { query() { called++; throw Error('db touched'); } }, fetchImpl() { called++; throw Error('api touched'); }, env: { ...env, DIGIFLAZZ_TESTING: 'false' } });
  const server = createServer(handler).listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/webhooks/midtrans`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(n) });
    assert.equal(res.status, 503);
    assert.equal(called, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('invalid checkout returns useful 400 JSON without touching DB', async () => {
  let calls = 0;
  const server = createServer(createHandler({ pool: { query() { calls++; throw Error('db touched'); } }, env, fetchImpl: withAuth(() => { throw Error('unexpected external request'); }) })).listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/checkout`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders }, body: JSON.stringify({ productId: 'x', userId: {}, zoneId: '1' }) });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /tidak valid/i);
    assert.equal(calls, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('checkout uses server price and returns expected frontend contract', async () => {
  let amount, inserts = 0;
  const pool = { async query(sql, params) {
    if (sql.startsWith('SELECT id, name, price')) return { rows: [{ id: 'ml10', name: '10 Diamonds', price: 25000, digi_sku: 'ML10', customer_format: 'ml_concat' }] };
    if (sql.startsWith('INSERT INTO orders')) { inserts++; assert.equal(params[3], 25000); return { rows: [] }; }
    if (sql.startsWith('UPDATE orders SET redirect_url')) return { rows: [] };
    throw Error('unexpected SQL');
  } };
  const handler = createHandler({ pool, env, fetchImpl: withAuth(async (url, options) => {
    amount = JSON.parse(options.body).transaction_details.gross_amount;
    return { ok: true, json: async () => ({ redirect_url: 'https://app.sandbox.midtrans.com/snap/v2/vtweb/token' }) };
  }) });
  const server = createServer(handler).listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/checkout`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders }, body: JSON.stringify({ productId: 'ml10', userId: '12345', zoneId: '100', price: 1 }) });
    assert.equal(response.status, 201);
    assert.deepEqual(Object.keys(await response.json()).sort(), ['orderId', 'redirectUrl']);
    assert.equal(inserts, 1);
    assert.equal(amount, 25000);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('public products and owned order expose only frontend contract fields', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const pool = { async query(sql) {
    if (sql.startsWith('SELECT id, name, game')) return { rows: [{ id: 'ml10', name: '10 Diamonds', game: 'Mobile Legends', price: 25000 }] };
    if (sql.startsWith('SELECT id, status, product_name')) { assert.match(sql, /WHERE owner_id = \$1 AND id = \$2/); return { rows: [{ id, status: 'pending', productName: '10 Diamonds', price: 25000, userId: '123', zoneId: '100' }] }; }
    throw Error('unexpected SQL');
  } };
  const server = createServer(createHandler({ pool, env, fetchImpl: withAuth(() => { throw Error('unexpected external request'); }) })).listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const products = await (await fetch(base + '/api/products')).json();
    assert.deepEqual(products, { products: [{ id: 'ml10', name: '10 Diamonds', game: 'Mobile Legends', price: 25000 }], checkoutAvailable: true });
    const order = await (await fetch(base + '/api/orders/' + id, { headers: authHeaders })).json();
    assert.deepEqual(order, { order: { id, status: 'pending', productName: '10 Diamonds', price: 25000, userId: '123', zoneId: '100' } });
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('pending Digi response stays pending and duplicate webhook never retries', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  let claimed = false, status = 'pending', calls = 0;
  const pool = { async query(sql) {
    if (sql.includes('SET status = CASE')) { if (status === 'pending') status = 'payment_paid'; return { rows: [{ id, price: 25000 }] }; }
    if (sql.includes('digiflazz_claimed_at = now()')) {
      if (claimed) return { rows: [] };
      claimed = true; status = 'fulfillment_pending';
      return { rows: [{ id, digi_sku: 'ml10', customer_no: '123100', price: 25000 }] };
    }
    if (sql.includes('SET status = $2')) { status = 'fulfillment_pending'; return { rows: [] }; }
    throw Error(`unexpected SQL: ${sql}`);
  } };
  const handler = createHandler({ pool, env, fetchImpl: async () => { calls++; return { ok: true, json: async () => ({ data: { ref_id: id, buyer_sku_code: 'ml10', customer_no: '123100', status: 'Pending', rc: '03' } }) }; } });
  const server = createServer(handler).listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const notice = { order_id: id, status_code: '200', gross_amount: '25000.00', transaction_status: 'settlement' };
    notice.signature_key = createHash('sha512').update(id + notice.status_code + notice.gross_amount + env.MIDTRANS_SERVER_KEY).digest('hex');
    const send = () => fetch(`http://127.0.0.1:${server.address().port}/api/webhooks/midtrans`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(notice) });
    assert.equal((await send()).status, 200);
    assert.equal((await send()).status, 200);
    assert.equal(calls, 1);
    assert.equal(status, 'fulfillment_pending');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('duplicate paid notification claims exactly one Digi request', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  let status = 'pending', calls = 0, claimed = false;
  const pool = { async query(sql) {
    if (sql.includes('SET status = CASE')) { status = status === 'pending' ? 'payment_paid' : status; return { rows: [{ id, price: 25000 }] }; }
    if (sql.includes('digiflazz_claimed_at = now()')) {
      if (status !== 'payment_paid' || claimed) return { rows: [] };
      claimed = true; status = 'fulfillment_pending';
      return { rows: [{ id, digi_sku: 'ml10', customer_no: '12345678' }] };
    }
    if (sql.includes('SET status = $2')) { status = 'fulfilled'; return { rows: [] }; }
    throw Error(`unexpected SQL: ${sql}`);
  } };
  const handler = createHandler({ pool, env, fetchImpl: async () => { calls++; return { ok: true, json: async () => ({ data: { ref_id: id, buyer_sku_code: 'ml10', customer_no: '12345678', status: 'Sukses', rc: '00' } }) }; } });
  const server = createServer(handler).listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const notification = { order_id: id, status_code: '200', gross_amount: '25000.00', transaction_status: 'settlement' };
    notification.signature_key = createHash('sha512').update(id + notification.status_code + notification.gross_amount + env.MIDTRANS_SERVER_KEY).digest('hex');
    const url = `http://127.0.0.1:${server.address().port}/api/webhooks/midtrans`;
    const send = () => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(notification) });
    const results = await Promise.all([send(), send()]);
    assert.deepEqual(results.map(r => r.status), [200, 200]);
    assert.equal(calls, 1);
    assert.equal(status, 'fulfilled');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

const supplierFixtures = [
  { buyer_sku_code: 'ml10', product_name: '10 Diamond', brand: 'MOBILE LEGENDS', category: 'Games', price: 3057, buyer_product_status: true, seller_product_status: true, stock: '10' },
  { buyer_sku_code: 'ff12', product_name: 'Free Fire 12 Diamond', brand: 'FREE FIRE', category: 'Games', price: 1605, buyer_product_status: true, seller_product_status: true, unlimited_stock: true },
];
const supplierFetch = (catalog, onCall) => withAuth(async url => {
  if (url === 'https://api.digiflazz.com/v1/price-list') { if (onCall) onCall(); return { ok: true, json: async () => ({ data: catalog }) }; }
  throw Error('unexpected external request: ' + url);
});

test('empty public catalog never exposes supplier costs', async () => {
  let supplierCalls = 0;
  const pool = { async query(sql) { if (sql.startsWith('SELECT id, name, game')) return { rows: [] }; throw Error('unexpected SQL: ' + sql); } };
  const server = createServer(createHandler({ pool, env, fetchImpl: withAuth(async url => { supplierCalls++; throw Error('supplier touched: ' + url); }) })).listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const body = await (await fetch(`http://127.0.0.1:${server.address().port}/api/products`)).json();
    assert.deepEqual(body, { products: [], checkoutAvailable: true });
    assert.equal(supplierCalls, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('supplier costs stay behind the admin role', async () => {
  const catalog = [...supplierFixtures, { buyer_sku_code: 'ax10', product_name: 'AXIS 10.000', brand: 'AXIS', category: 'Pulsa', price: 10000, buyer_product_status: true, seller_product_status: true, stock: '5' }];
  let isAdmin = false, supplierCalls = 0;
  const pool = { async query(sql) {
    if (sql.startsWith('SELECT user_id FROM admin_users')) return { rows: isAdmin ? [{ user_id: ownerId }] : [] };
    if (sql.startsWith('SELECT id, name, game, price, enabled')) return { rows: [{ id: 'ml10', name: '10 Diamond', game: 'MOBILE LEGENDS', price: 22000, enabled: true }, { id: 'done1', name: 'Produk lama', game: 'MOBILE LEGENDS', price: 5000, enabled: true }] };
    throw Error('unexpected SQL: ' + sql);
  } };
  const server = createServer(createHandler({ pool, env, fetchImpl: supplierFetch(catalog, () => supplierCalls++) })).listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(base + '/api/admin/supplier-products', { headers: authHeaders })).status, 403);
    assert.equal(supplierCalls, 0);
    isAdmin = true;
    const response = await fetch(base + '/api/admin/supplier-products', { headers: authHeaders });
    assert.equal(response.status, 200);
    const { products } = await response.json();
    assert.deepEqual(products, [
      { sku: 'ml10', name: '10 Diamond', game: 'MOBILE LEGENDS', category: 'Games', cost: 3057, supported: true, price: 22000, enabled: true },
      { sku: 'ff12', name: 'Free Fire 12 Diamond', game: 'FREE FIRE', category: 'Games', cost: 1605, supported: false, price: null, enabled: false },
      { sku: 'ax10', name: 'AXIS 10.000', game: 'AXIS', category: 'Pulsa', cost: 10000, supported: false, price: null, enabled: false },
      { sku: 'done1', name: 'Produk lama', game: 'MOBILE LEGENDS', category: null, cost: null, supported: true, missing: true, price: 5000, enabled: true },
    ]);
    assert.equal(supplierCalls, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('admin pricing sets selling price, blocks unsupported formats and missing SKUs', async () => {
  let isAdmin = true, inserts = 0, supplierCalls = 0, last;
  const pool = { async query(sql, params) {
    if (sql.startsWith('SELECT user_id FROM admin_users')) return { rows: isAdmin ? [{ user_id: ownerId }] : [] };
    if (sql.startsWith('INSERT INTO products')) { inserts++; last = params; return { rows: [{ id: params[0], name: params[1], game: params[2], price: params[3], enabled: params[4] }] }; }
    if (sql.startsWith('UPDATE products')) return { rows: [{ id: params[0], name: 'Produk lama', game: 'MOBILE LEGENDS', price: params[1], enabled: false }] };
    throw Error('unexpected SQL: ' + sql);
  } };
  const server = createServer(createHandler({ pool, env, fetchImpl: supplierFetch(supplierFixtures, () => supplierCalls++) })).listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const put = (sku, payload) => fetch(`${base}/api/admin/products/${sku}`, { method: 'PUT', headers: { 'content-type': 'application/json', ...authHeaders }, body: JSON.stringify(payload) });
    assert.equal((await put('ml10', { price: 12.5, enabled: true })).status, 400);
    assert.equal(supplierCalls, 0);
    assert.equal((await put('ff12', { price: 3000, enabled: true })).status, 422);
    const ok = await put('ml10', { price: 22000, enabled: true });
    assert.equal(ok.status, 200);
    assert.deepEqual((await ok.json()).product, { sku: 'ml10', name: '10 Diamond', game: 'MOBILE LEGENDS', category: 'Games', cost: 3057, supported: true, missing: false, price: 22000, enabled: true });
    assert.equal(last[3], 22000);
    const draft = await put('ff12', { price: 3000, enabled: false });
    assert.equal(draft.status, 200);
    assert.equal((await draft.json()).product.enabled, false);
    assert.equal(inserts, 2);
    assert.equal((await put('ghost', { price: 1000, enabled: true })).status, 409);
    const stale = await put('done1', { price: 4000, enabled: false });
    assert.equal(stale.status, 200);
    assert.deepEqual((await stale.json()).product, { sku: 'done1', name: 'Produk lama', game: 'MOBILE LEGENDS', category: null, cost: null, supported: true, missing: true, price: 4000, enabled: false });
    isAdmin = false;
    assert.equal((await put('ml10', { price: 22000, enabled: true })).status, 403);
    assert.equal(supplierCalls, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
