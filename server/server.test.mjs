import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { validateCheckout, verifiedPayment, customerNo } from './core.mjs';
import { createHandler, digiRequest } from './app.mjs';
import { checkGames } from './check.mjs';

const env = { MIDTRANS_SERVER_KEY: 'sandbox-secret', DIGIFLAZZ_USERNAME: 'buyer', DIGIFLAZZ_API_KEY: 'api-secret', MIDTRANS_ENV: 'sandbox', DIGIFLAZZ_TESTING: 'true', CHECKOUT_ENABLED: 'true', DATABASE_URL: 'test', SUPABASE_URL: 'https://sample.supabase.co', SUPABASE_ANON_KEY: 'public-key' };
const ownerId = '22222222-2222-4222-8222-222222222222';
const authHeaders = { authorization: 'Bearer buyer-token' };
const withAuth = next => async (url, options) => url === 'https://sample.supabase.co/auth/v1/user'
  ? { ok: true, status: 200, json: async () => ({ id: ownerId, email_confirmed_at: '2026-01-01T00:00:00Z' }) }
  : next(url, options);

test('checkout validates identifiers and rejects non-scalar/oversized input', () => {
  assert.deepEqual(validateCheckout({ productId: 'ml-1', userId: '12345', zoneId: '1234' }), { productId: 'ml-1', userId: '12345', zoneId: '1234' });
  assert.deepEqual(validateCheckout({ productId: 'ff-1', userId: '12345' }), { productId: 'ff-1', userId: '12345', zoneId: '' });
  assert.deepEqual(validateCheckout({ productId: 'val5', userId: 'Nama Kamu#1234' }), { productId: 'val5', userId: 'Nama Kamu#1234', zoneId: '' });
  assert.deepEqual(validateCheckout({ productId: 'gi60', userId: '800123456', zoneId: 'os_asia' }), { productId: 'gi60', userId: '800123456', zoneId: 'os_asia' });
  for (const body of [{ productId: 'x', userId: {}, zoneId: '1' }, { productId: 'x', userId: '123', zoneId: 'a b' }, { productId: 'x', userId: '1'.repeat(65), zoneId: '1' }, { productId: 'x/../', userId: '1', zoneId: '1' }, { productId: 'x', userId: '123', zoneId: '' }]) assert.throws(() => validateCheckout(body));
});

test('customer number follows the destination format of the product', () => {
  assert.equal(customerNo('ml_concat', { userId: '123', zoneId: '100' }), '123100');
  assert.equal(customerNo('plain', { userId: '123', zoneId: '' }), '123');
  assert.throws(() => customerNo('ml_concat', { userId: '123', zoneId: '' }), /belum didukung/);
  assert.throws(() => customerNo('voucher', { userId: '123', zoneId: '100' }), /belum didukung/);
  assert.equal(customerNo('uid_server', { userId: '800123456', zoneId: 'os_asia' }), '800123456|os_asia');
  assert.throws(() => customerNo('uid_server', { userId: '800123456', zoneId: '' }), /Server wajib/);
  assert.equal(customerNo('riot', { userId: 'Nama Kamu#1234', zoneId: '' }), 'Nama Kamu#1234');
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

test('plain format checkout sends the user id alone as customer number', async () => {
  let customer, zone;
  const pool = { async query(sql, params) {
    if (sql.startsWith('SELECT id, name, price')) return { rows: [{ id: 'ff12', name: 'Free Fire 12 Diamond', price: 20000, digi_sku: 'FF12', customer_format: 'plain' }] };
    if (sql.startsWith('INSERT INTO orders')) { customer = params[5]; zone = params[7]; return { rows: [] }; }
    if (sql.startsWith('UPDATE orders SET redirect_url')) return { rows: [] };
    throw Error('unexpected SQL');
  } };
  const handler = createHandler({ pool, env, fetchImpl: withAuth(async () => ({ ok: true, json: async () => ({ redirect_url: 'https://app.sandbox.midtrans.com/snap/v2/vtweb/token' }) })) });
  const server = createServer(handler).listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/checkout`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders }, body: JSON.stringify({ productId: 'ff12', userId: '12345' }) });
    assert.equal(response.status, 201);
    assert.equal(customer, '12345');
    assert.equal(zone, '');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('public products and owned order expose only frontend contract fields', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const pool = { async query(sql) {
    if (sql.startsWith('SELECT p.id, p.name, p.game')) { assert.match(sql, /LEFT JOIN supplier_products/); return { rows: [{ id: 'ml10', name: '10 Diamonds', game: 'Mobile Legends', price: 25000, format: 'ml_concat', category: 'Games' }] }; }
    if (sql.startsWith('SELECT id, status, product_name')) { assert.match(sql, /WHERE owner_id = \$1 AND id = \$2/); return { rows: [{ id, status: 'pending', productName: '10 Diamonds', price: 25000, userId: '123', zoneId: '100' }] }; }
    throw Error('unexpected SQL');
  } };
  const server = createServer(createHandler({ pool, env, fetchImpl: withAuth(() => { throw Error('unexpected external request'); }) })).listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const products = await (await fetch(base + '/api/products')).json();
    assert.deepEqual(products, { products: [{ id: 'ml10', name: '10 Diamonds', game: 'Mobile Legends', price: 25000, format: 'ml_concat', category: 'Games', checkable: true }], checkoutAvailable: true, checkAvailable: false });
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
  { buyer_sku_code: 'ml10', product_name: '10 Diamond', brand: 'MOBILE LEGENDS', type: 'Indonesia', category: 'Games', price: 3057, buyer_product_status: true, seller_product_status: true, stock: '10' },
  { buyer_sku_code: 'ff12', product_name: 'Free Fire 12 Diamond', brand: 'FREE FIRE', type: 'Umum', category: 'Games', price: 1605, buyer_product_status: true, seller_product_status: true, unlimited_stock: true },
  { buyer_sku_code: 'ax10', product_name: 'AXIS 10.000', brand: 'AXIS', type: 'Umum', category: 'Pulsa', price: 10000, buyer_product_status: true, seller_product_status: true, stock: '5' },
];
const supplierFetch = (catalog, onCall) => withAuth(async url => {
  if (url === 'https://api.digiflazz.com/v1/price-list') { if (onCall) onCall(); return { ok: true, json: async () => ({ data: catalog }) }; }
  throw Error('unexpected external request: ' + url);
});

test('empty public catalog never exposes supplier costs', async () => {
  let supplierCalls = 0;
  const pool = { async query(sql) { if (sql.startsWith('SELECT p.id, p.name, p.game')) { assert.match(sql, /LEFT JOIN supplier_products/); return { rows: [] }; } throw Error('unexpected SQL: ' + sql); } };
  const server = createServer(createHandler({ pool, env, fetchImpl: withAuth(async url => { supplierCalls++; throw Error('supplier touched: ' + url); }) })).listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const body = await (await fetch(`http://127.0.0.1:${server.address().port}/api/products`)).json();
    assert.deepEqual(body, { products: [], checkoutAvailable: true, checkAvailable: false });
    assert.equal(supplierCalls, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('sinkron katalog yang dibatasi Digiflazz memakai pesan tunggu, bukan error generik', async () => {
  let writes = 0;
  const pool = { query: (sql) => { if (!sql.startsWith('SELECT user_id FROM admin_users')) writes++; return Promise.resolve({ rows: sql.startsWith('SELECT user_id FROM admin_users') ? [{ user_id: ownerId }] : [] }); } };
  const server = createServer(createHandler({ pool, env, fetchImpl: withAuth(async url => {
    if (url === 'https://api.digiflazz.com/v1/price-list') return { ok: true, json: async () => ({ data: { rc: '83', message: 'limitasi pengecekan pricelist' } }) };
    throw Error('unexpected external request: ' + url);
  }) })).listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/supplier-products/sync`, { method: 'POST', headers: authHeaders });
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /membatasi cek katalog/);
    assert.equal(writes, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('supplier costs stay behind the admin role and the panel reads them from the database', async () => {
  const syncedAt = new Date();
  const mirror = [
    { sku: 'ml10', name: '10 Diamond', game: 'MOBILE LEGENDS', category: 'Games', variant: 'Indonesia', price: 3057, synced_at: syncedAt },
    { sku: 'ff12', name: 'Free Fire 12 Diamond', game: 'FREE FIRE', category: 'Games', variant: 'Umum', price: 1605, synced_at: syncedAt },
    { sku: 'ax10', name: 'AXIS 10.000', game: 'AXIS', category: 'Pulsa', variant: 'Umum', price: 10000, synced_at: syncedAt },
    { sku: 'stm50', name: 'Steam Wallet 50.000', game: 'STEAM', category: 'Voucher', variant: 'Umum', price: 50000, synced_at: syncedAt },
  ];
  let isAdmin = false, supplierCalls = 0;
  const pool = { async query(sql) {
    if (sql.startsWith('SELECT user_id FROM admin_users')) return { rows: isAdmin ? [{ user_id: ownerId }] : [] };
    if (sql.startsWith('SELECT sku, name, game, category, variant, price, synced_at FROM supplier_products')) return { rows: mirror };
    if (sql.startsWith('SELECT id, name, game, price, enabled')) return { rows: [{ id: 'ml10', name: '10 Diamond', game: 'MOBILE LEGENDS', price: 22000, enabled: true }, { id: 'done1', name: 'Produk lama', game: 'MOBILE LEGENDS', price: 5000, enabled: true }] };
    throw Error('unexpected SQL: ' + sql);
  } };
  const server = createServer(createHandler({ pool, env, fetchImpl: supplierFetch(supplierFixtures, () => supplierCalls++) })).listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(base + '/api/admin/supplier-products', { headers: authHeaders })).status, 403);
    assert.equal(supplierCalls, 0);
    isAdmin = true;
    const response = await fetch(base + '/api/admin/supplier-products', { headers: authHeaders });
    assert.equal(response.status, 200);
    const { products, catalogFetchedAt, catalogStale } = await response.json();
    assert.deepEqual(products, [
      { sku: 'ml10', name: '10 Diamond', game: 'MOBILE LEGENDS', category: 'Games', variant: 'Indonesia', cost: 3057, supported: true, price: 22000, enabled: true },
      { sku: 'ff12', name: 'Free Fire 12 Diamond', game: 'FREE FIRE', category: 'Games', variant: 'Umum', cost: 1605, supported: true, price: null, enabled: false },
      { sku: 'ax10', name: 'AXIS 10.000', game: 'AXIS', category: 'Pulsa', variant: 'Umum', cost: 10000, supported: true, price: null, enabled: false },
      { sku: 'stm50', name: 'Steam Wallet 50.000', game: 'STEAM', category: 'Voucher', variant: 'Umum', cost: 50000, supported: false, price: null, enabled: false },
      { sku: 'done1', name: 'Produk lama', game: 'MOBILE LEGENDS', category: null, variant: null, cost: null, supported: true, missing: true, price: 5000, enabled: true },
    ]);
    // inti perubahan: membuka panel tidak menyentuh Digiflazz sama sekali.
    assert.equal(supplierCalls, 0);
    assert.equal(catalogFetchedAt, syncedAt.toISOString());
    assert.equal(catalogStale, false);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('sinkron katalog menyimpan hasil pull ke tabel supplier_products', async () => {
  const statements = [];
  let supplierCalls = 0;
  const pool = { async query(sql, params) {
    if (sql.startsWith('SELECT user_id FROM admin_users')) return { rows: [{ user_id: ownerId }] };
    statements.push({ sql, params });
    if (sql.startsWith('INSERT INTO supplier_products') || sql.startsWith('DELETE FROM supplier_products')) return { rows: [] };
    throw Error('unexpected SQL: ' + sql);
  } };
  const server = createServer(createHandler({ pool, env, fetchImpl: supplierFetch(supplierFixtures, () => supplierCalls++) })).listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/supplier-products/sync`, { method: 'POST', headers: authHeaders });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.synced, 3);
    assert.ok(Number.isFinite(Date.parse(body.catalogFetchedAt)));
    assert.equal(supplierCalls, 1);
    const insert = statements.find(statement => statement.sql.startsWith('INSERT INTO supplier_products'));
    assert.match(insert.sql, /ON CONFLICT \(sku\) DO UPDATE/);
    assert.deepEqual(insert.params.slice(0, 7), [insert.params[0], 'ml10', '10 Diamond', 'MOBILE LEGENDS', 'Games', 'Indonesia', 3057]);
    assert.equal(insert.params.length, 1 + 3 * 6);
    const cleanup = statements.find(statement => statement.sql.startsWith('DELETE FROM supplier_products'));
    assert.deepEqual(cleanup.params, [insert.params[0]]);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('admin pricing sets selling price, blocks unsupported formats and missing SKUs', async () => {
  let isAdmin = true, inserts = 0, supplierCalls = 0, last;
  const mirror = [
    { sku: 'ml10', name: '10 Diamond', game: 'MOBILE LEGENDS', category: 'Games', variant: 'Indonesia', price: 3057 },
    { sku: 'ff12', name: 'Free Fire 12 Diamond', game: 'FREE FIRE', category: 'Games', variant: 'Umum', price: 1605 },
    { sku: 'stm50', name: 'Steam Wallet 50.000', game: 'STEAM', category: 'Voucher', variant: 'Umum', price: 50000 },
  ];
  const pool = { async query(sql, params) {
    if (sql.startsWith('SELECT user_id FROM admin_users')) return { rows: isAdmin ? [{ user_id: ownerId }] : [] };
    if (sql.startsWith('SELECT name, game, category, variant, price FROM supplier_products')) return { rows: mirror.filter(row => row.sku === params[0]) };
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
    assert.equal((await put('stm50', { price: 55000, enabled: true })).status, 422);
    const ok = await put('ml10', { price: 22000, enabled: true });
    assert.equal(ok.status, 200);
    assert.deepEqual((await ok.json()).product, { sku: 'ml10', name: '10 Diamond', game: 'MOBILE LEGENDS', category: 'Games', variant: 'Indonesia', cost: 3057, supported: true, missing: false, price: 22000, enabled: true });
    assert.equal(last[3], 22000);
    assert.equal(last[5], 'ml_concat');
    assert.equal(supplierCalls, 0);
    const draft = await put('ff12', { price: 3000, enabled: false });
    assert.equal(draft.status, 200);
    assert.equal((await draft.json()).product.enabled, false);
    assert.equal(inserts, 2);
    const live = await put('ff12', { price: 3000, enabled: true });
    assert.equal(live.status, 200);
    assert.equal(last[5], 'plain');
    assert.deepEqual((await live.json()).product, { sku: 'ff12', name: 'Free Fire 12 Diamond', game: 'FREE FIRE', category: 'Games', variant: 'Umum', cost: 1605, supported: true, missing: false, price: 3000, enabled: true });
    assert.equal(inserts, 3);
    assert.equal((await put('ghost', { price: 1000, enabled: true })).status, 409);
    const stale = await put('done1', { price: 4000, enabled: false });
    assert.equal(stale.status, 200);
    assert.deepEqual((await stale.json()).product, { sku: 'done1', name: 'Produk lama', game: 'MOBILE LEGENDS', category: null, variant: null, cost: null, supported: true, missing: true, price: 4000, enabled: false });
    isAdmin = false;
    assert.equal((await put('ml10', { price: 22000, enabled: true })).status, 403);
    assert.equal(supplierCalls, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('produk menandai dukungan cek per brand dan status cek mengikuti konfigurasi server', async () => {
  const rows = [
    { id: 'ml10', name: '10 Diamonds', game: 'MOBILE LEGENDS', price: 25000, format: 'ml_concat', category: 'Games' },
    { id: 'ff12', name: 'Free Fire 12 Diamond', game: 'FREE FIRE', price: 20000, format: 'plain', category: 'Games' },
    { id: 'ax10', name: 'AXIS 10.000', game: 'AXIS', price: 10000, format: 'plain', category: 'Pulsa' },
  ];
  const pool = { async query(sql) { if (sql.startsWith('SELECT p.id, p.name, p.game')) return { rows }; throw Error('unexpected SQL: ' + sql); } };
  const open = (serverEnv) => createServer(createHandler({ pool, env: serverEnv, fetchImpl: withAuth(() => { throw Error('unexpected external request'); }) })).listen(0, '127.0.0.1');
  const first = open(env);
  try {
    await new Promise(resolve => first.once('listening', resolve));
    const body = await (await fetch(`http://127.0.0.1:${first.address().port}/api/products`)).json();
    assert.deepEqual(body.products.map(product => product.checkable), [true, true, false]);
    assert.equal(body.checkAvailable, false);
  } finally { await new Promise(resolve => first.close(resolve)); }
  const second = open({ ...env, CHECK_API_URL: 'https://check.example/v1/account', CHECK_API_KEY: 'check-key' });
  try {
    await new Promise(resolve => second.once('listening', resolve));
    const body = await (await fetch(`http://127.0.0.1:${second.address().port}/api/products`)).json();
    assert.equal(body.checkAvailable, true);
  } finally { await new Promise(resolve => second.close(resolve)); }
});

const checkEnv = { ...env, CHECK_API_URL: 'https://check.example/v1/account', CHECK_API_KEY: 'check-key' };

test('cek nickname memakai layanan sesuai brand produk, menyimpan hasil, dan mencatat pemakaian', async () => {
  const statements = [];
  let provider = null;
  const pool = { async query(sql, params) {
    statements.push({ sql, params });
    if (sql.startsWith('SELECT id, game, customer_format FROM products')) return { rows: [{ id: 'ml10', game: 'MOBILE LEGENDS', customer_format: 'ml_concat' }] };
    if (sql.startsWith('SELECT nickname, region, checked_at FROM account_checks')) return { rows: [] };
    if (sql.startsWith('SELECT count(*)::int AS count FROM account_check_logs')) return { rows: [{ count: 0 }] };
    if (sql.startsWith('INSERT')) return { rows: [] };
    throw Error('unexpected SQL: ' + sql);
  } };
  const handler = createHandler({ pool, env: checkEnv, fetchImpl: withAuth(async (url, options) => {
    provider = { url, options };
    return { ok: true, status: 200, json: async () => ({ error: false, code: 200, message: 'Success', data: { product: { name: 'Mobile Legends', code: 'MLBB' }, account: { region: 'ID', nickname: 'Purbaya Sadewa. RI' } } }) };
  }) });
  const server = createServer(handler).listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/check-account`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders }, body: JSON.stringify({ productId: 'ml10', userId: '12345', zoneId: '100' }) });
    assert.equal(response.status, 200);
    const { check } = await response.json();
    assert.equal(check.nickname, 'Purbaya Sadewa. RI');
    assert.equal(check.region, 'ID');
    assert.equal(check.cached, false);
    assert.equal(checkGames['MOBILE LEGENDS'].code, 'MLBB');
    assert.equal(provider.url, 'https://check.example/v1/account');
    assert.equal(provider.options.headers['x-api-key'], 'check-key');
    assert.deepEqual(JSON.parse(provider.options.body), { game: 'MLBB', user_id: '12345', zone_id: '100' });
    const saved = statements.find(item => item.sql.startsWith('INSERT INTO account_checks'));
    assert.match(saved.sql, /ON CONFLICT \(game, user_id, zone_id\) DO UPDATE SET nickname = EXCLUDED\.nickname/);
    assert.deepEqual(saved.params, ['MOBILE LEGENDS', '12345', '100', 'Purbaya Sadewa. RI', 'ID']);
    assert.equal(statements.filter(item => item.sql.startsWith('INSERT INTO account_check_logs')).length, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('hasil tersimpan yang masih segar menjawab tanpa provider dan tanpa tulis ulang', async () => {
  const checkedAt = new Date('2026-10-10T09:30:00Z');
  const statements = [];
  let providerCalls = 0;
  const pool = { async query(sql) {
    statements.push(sql);
    if (sql.startsWith('SELECT id, game, customer_format FROM products')) return { rows: [{ id: 'ml10', game: 'MOBILE LEGENDS', customer_format: 'ml_concat' }] };
    if (sql.startsWith('SELECT nickname, region, checked_at FROM account_checks')) return { rows: [{ nickname: 'Purbaya Sadewa. RI', region: 'ID', checked_at: checkedAt }] };
    throw Error('unexpected SQL: ' + sql);
  } };
  const handler = createHandler({ pool, env: checkEnv, fetchImpl: withAuth(async () => { providerCalls++; return { ok: true, json: async () => ({}) }; }) });
  const server = createServer(handler).listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/check-account`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders }, body: JSON.stringify({ productId: 'ml10', userId: '12345', zoneId: '100' }) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { check: { nickname: 'Purbaya Sadewa. RI', region: 'ID', cached: true, checkedAt: checkedAt.toISOString() } });
    assert.equal(providerCalls, 0);
    assert.ok(statements.every(sql => !sql.startsWith('INSERT')));
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('brand Free Fire memakai layanan cek Free Fire tanpa Zone ID; force melewati simpanan', async () => {
  const bodies = [];
  const statements = [];
  const pool = { async query(sql) {
    statements.push(sql);
    if (sql.startsWith('SELECT id, game, customer_format FROM products')) return { rows: [{ id: 'ff12', game: 'FREE FIRE', customer_format: 'plain' }] };
    if (sql.startsWith('SELECT count(*)::int AS count FROM account_check_logs')) return { rows: [{ count: 3 }] };
    if (sql.startsWith('INSERT')) return { rows: [] };
    throw Error('unexpected SQL: ' + sql);
  } };
  const handler = createHandler({ pool, env: checkEnv, fetchImpl: withAuth(async (url, options) => {
    bodies.push(JSON.parse(options.body));
    return { ok: true, status: 200, json: async () => ({ data: { account: { region: 'ID', nickname: 'FreeFire Player' } } }) };
  }) });
  const server = createServer(handler).listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/check-account`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders }, body: JSON.stringify({ productId: 'ff12', userId: '456', force: true }) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).check.nickname, 'FreeFire Player');
    assert.deepEqual(bodies, [{ game: checkGames['FREE FIRE'].code, user_id: '456', zone_id: '' }]);
    assert.ok(statements.every(sql => !sql.startsWith('SELECT nickname')));
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('kuota harian habis ditolak sebelum provider dipanggil', async () => {
  let providerCalls = 0;
  const pool = { async query(sql) {
    if (sql.startsWith('SELECT id, game, customer_format FROM products')) return { rows: [{ id: 'ml10', game: 'MOBILE LEGENDS', customer_format: 'ml_concat' }] };
    if (sql.startsWith('SELECT nickname, region, checked_at FROM account_checks')) return { rows: [] };
    if (sql.startsWith('SELECT count(*)::int AS count FROM account_check_logs')) return { rows: [{ count: 10 }] };
    throw Error('unexpected SQL: ' + sql);
  } };
  const handler = createHandler({ pool, env: checkEnv, fetchImpl: withAuth(async () => { providerCalls++; return { ok: true, json: async () => ({}) }; }) });
  const server = createServer(handler).listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/check-account`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders }, body: JSON.stringify({ productId: 'ml10', userId: '12345', zoneId: '100' }) });
    assert.equal(response.status, 429);
    assert.match((await response.json()).error, /Batas cek nickname harian/);
    assert.equal(providerCalls, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('ID tidak ketemu dan provider mati tidak disimpan', async () => {
  let inserts = 0;
  let mode = 'missing';
  const pool = { async query(sql) {
    if (sql.startsWith('SELECT id, game, customer_format FROM products')) return { rows: [{ id: 'ml10', game: 'MOBILE LEGENDS', customer_format: 'ml_concat' }] };
    if (sql.startsWith('SELECT nickname, region, checked_at FROM account_checks')) return { rows: [] };
    if (sql.startsWith('SELECT count(*)::int AS count FROM account_check_logs')) return { rows: [{ count: 1 }] };
    if (sql.startsWith('INSERT')) { inserts++; return { rows: [] }; }
    throw Error('unexpected SQL: ' + sql);
  } };
  const handler = createHandler({ pool, env: checkEnv, fetchImpl: withAuth(async () => mode === 'missing'
    ? { ok: true, status: 200, json: async () => ({ error: true, code: 404, message: 'Account not found', data: null }) }
    : { ok: false, status: 500, json: async () => ({}) }) });
  const server = createServer(handler).listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/check-account`;
    const call = () => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders }, body: JSON.stringify({ productId: 'ml10', userId: '999', zoneId: '1' }) });
    const missing = await call();
    assert.equal(missing.status, 404);
    assert.match((await missing.json()).error, /tidak ditemukan/);
    mode = 'down';
    const down = await call();
    assert.equal(down.status, 502);
    assert.match((await down.json()).error, /tidak tersedia/);
    assert.equal(inserts, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('brand tanpa layanan cek ditolak jelas (422)', async () => {
  const pool = { async query(sql) { if (sql.startsWith('SELECT id, game, customer_format FROM products')) return { rows: [{ id: 'ax10', game: 'AXIS', customer_format: 'plain' }] }; throw Error('unexpected SQL: ' + sql); } };
  const handler = createHandler({ pool, env: checkEnv, fetchImpl: withAuth(() => { throw Error('unexpected external request'); }) });
  const server = createServer(handler).listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/check-account`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders }, body: JSON.stringify({ productId: 'ax10', userId: '0812345' }) });
    assert.equal(response.status, 422);
    assert.match((await response.json()).error, /belum tersedia/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('cek nickname menolak tanpa sesi terverifikasi dan saat provider belum diset', async () => {
  const unauthorized = createServer(createHandler({ pool: { query() { throw Error('db touched'); } }, env: checkEnv, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }) })).listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => unauthorized.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${unauthorized.address().port}/api/check-account`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productId: 'ml10', userId: '12345', zoneId: '100' }) });
    assert.equal(response.status, 401);
  } finally { await new Promise(resolve => unauthorized.close(resolve)); }
  let fetchCalls = 0;
  const inactive = createServer(createHandler({ pool: { async query(sql) { if (sql.startsWith('SELECT id, game, customer_format FROM products')) return { rows: [{ id: 'ml10', game: 'MOBILE LEGENDS', customer_format: 'ml_concat' }] }; throw Error('unexpected SQL: ' + sql); } }, env, fetchImpl: withAuth(async () => { fetchCalls++; return { ok: true, json: async () => ({}) }; }) })).listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => inactive.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${inactive.address().port}/api/check-account`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders }, body: JSON.stringify({ productId: 'ml10', userId: '12345', zoneId: '100' }) });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /belum aktif/);
    assert.equal(fetchCalls, 0);
  } finally { await new Promise(resolve => inactive.close(resolve)); }
});


test('brand baru (Genshin/Honkai uid_server dan Valorant riot) bisa diaktifkan', async () => {
  const inserts = [];
  const mirror = [
    { sku: 'gi60', name: 'Genshin 60 Genesis Crystals', game: 'Genshin Impact', category: 'Games', variant: 'Indonesia', price: 15000 },
    { sku: 'val5', name: 'Valorant 5 Points', game: 'Valorant', category: 'Games', variant: 'Indonesia', price: 8000 },
  ];
  const pool = { async query(sql, params) {
    if (sql.startsWith('SELECT user_id FROM admin_users')) return { rows: [{ user_id: ownerId }] };
    if (sql.startsWith('SELECT name, game, category, variant, price FROM supplier_products')) return { rows: mirror.filter(row => row.sku === params[0]) };
    if (sql.startsWith('INSERT INTO products')) { inserts.push(params); return { rows: [{ id: params[0], name: params[1], game: params[2], price: params[3], enabled: params[4] }] }; }
    throw Error('unexpected SQL: ' + sql);
  } };
  const server = createServer(createHandler({ pool, env, fetchImpl: withAuth(async url => { throw Error('unexpected external request: ' + url); }) })).listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const put = (sku, payload) => fetch(`${base}/api/admin/products/${sku}`, { method: 'PUT', headers: { 'content-type': 'application/json', ...authHeaders }, body: JSON.stringify(payload) });
    const genshin = await put('gi60', { price: 20000, enabled: true });
    assert.equal(genshin.status, 200);
    assert.equal((await genshin.json()).product.supported, true);
    assert.equal(inserts[0][5], 'uid_server');
    const valorant = await put('val5', { price: 12000, enabled: true });
    assert.equal(valorant.status, 200);
    assert.equal(inserts[1][5], 'riot');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('panel katalog mengirim semua baris supplier aktif tanpa dipotong', async () => {
  const rows = Array.from({ length: 230 }, (_, index) => ({ sku: `sku${index}`, name: `Item ${index}`, game: 'GENSHIN IMPACT', category: 'Games', variant: '', price: 1000 + index, synced_at: '2026-10-12T04:00:00Z' }));
  const pool = { async query(sql) {
    if (sql.startsWith('SELECT user_id FROM admin_users')) return { rows: [{ user_id: ownerId }] };
    if (sql.startsWith('SELECT sku, name, game, category, variant, price, synced_at FROM supplier_products')) return { rows };
    if (sql.startsWith('SELECT id, name, game, price, enabled FROM products')) return { rows: [] };
    throw Error('unexpected SQL: ' + sql);
  } };
  const server = createServer(createHandler({ pool, env, fetchImpl: withAuth(async url => { throw Error('unexpected external request: ' + url); }) })).listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/supplier-products`, { headers: authHeaders });
    assert.equal(response.status, 200);
    const { products } = await response.json();
    assert.equal(products.length, 230);
    assert.equal(products.every(item => item.supported), true);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
