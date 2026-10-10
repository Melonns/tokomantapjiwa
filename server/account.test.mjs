import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHandler } from './app.mjs';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const orderId = '33333333-3333-4333-8333-333333333333';
const env = { DATABASE_URL: 'test', SUPABASE_URL: 'https://sample.supabase.co', SUPABASE_ANON_KEY: 'public-key', MIDTRANS_SERVER_KEY: 'sandbox-secret', MIDTRANS_ENV: 'sandbox', DIGIFLAZZ_USERNAME: 'buyer', DIGIFLAZZ_API_KEY: 'api-secret', DIGIFLAZZ_TESTING: 'true', CHECKOUT_ENABLED: 'true' };

async function serve(handler, action) {
  const server = createServer(handler).listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    return await action(`http://127.0.0.1:${server.address().port}`);
  } finally { await new Promise(resolve => server.close(resolve)); }
}

const authorization = { authorization: 'Bearer buyer-token' };

function authFetch(userId = owner) {
  return async (url, options) => {
    assert.equal(url, 'https://sample.supabase.co/auth/v1/user');
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.apikey, 'public-key');
    assert.equal(options.headers.authorization, 'Bearer buyer-token');
    return { ok: true, status: 200, json: async () => ({ id: userId, email_confirmed_at: '2026-01-01T00:00:00Z' }) };
  };
}

test('missing or invalid bearer denies order list, detail, and checkout before DB', async () => {
  let called = 0;
  const handler = createHandler({ env, pool: { query() { called++; throw Error('DB touched'); } }, fetchImpl() { called++; throw Error('auth touched'); } });
  await serve(handler, async base => {
    for (const [method, path, headers] of [['GET', '/api/orders', {}], ['GET', '/api/orders/' + orderId, { authorization: 'Basic nope' }], ['POST', '/api/checkout', { 'content-type': 'application/json', authorization: 'Bearer' }]]) {
      const response = await fetch(base + path, { method, headers, ...(method === 'POST' ? { body: '{}' } : {}) });
      assert.equal(response.status, 401);
    }
  });
  assert.equal(called, 0);
});

test('unverified buyer cannot access account or checkout', async () => {
  let queries = 0;
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ id: owner, email_confirmed_at: null }) });
  const handler = createHandler({ env, pool: { query() { queries++; throw Error('DB touched'); } }, fetchImpl });
  await serve(handler, async base => {
    for (const [method, path] of [['GET', '/api/me'], ['GET', '/api/orders'], ['POST', '/api/checkout']]) {
      const response = await fetch(base + path, { method, headers: { ...authorization, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) }, ...(method === 'POST' ? { body: JSON.stringify({ productId: 'ml10', userId: '123', zoneId: '100' }) } : {}) });
      assert.equal(response.status, 403);
    }
  });
  assert.equal(queries, 0);
});

test('verified phone-only buyer can access owned orders', async () => {
  const pool = { async query(sql, params) {
    assert.match(sql, /WHERE owner_id = \$1/);
    assert.equal(params[0], owner);
    return { rows: [] };
  } };
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ id: owner, email_confirmed_at: null, phone_confirmed_at: '2026-01-01T00:00:00Z' }) });
  await serve(createHandler({ env, pool, fetchImpl }), async base => {
    const response = await fetch(base + '/api/orders', { headers: authorization });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { orders: [] });
  });
});

test('rejected token and malformed identity never query orders', async () => {
  let queries = 0;
  const handler = createHandler({ env, pool: { query() { queries++; throw Error('DB touched'); } }, fetchImpl: async () => ({ ok: false, status: 401 }) });
  await serve(handler, async base => {
    const response = await fetch(base + '/api/orders', { headers: authorization });
    assert.equal(response.status, 401);
  });
  const malformed = createHandler({ env, pool: { query() { queries++; throw Error('DB touched'); } }, fetchImpl: authFetch('not-a-uuid') });
  await serve(malformed, async base => {
    assert.equal((await fetch(base + '/api/orders', { headers: authorization })).status, 401);
  });
  assert.equal(queries, 0);
});

test('missing or non-HTTPS Supabase config fails closed', async () => {
  let calls = 0;
  for (const authEnv of [{ ...env, SUPABASE_ANON_KEY: '' }, { ...env, SUPABASE_URL: 'http://sample.supabase.co' }]) {
    const handler = createHandler({ env: authEnv, pool: { query() { calls++; throw Error('DB touched'); } }, fetchImpl() { calls++; throw Error('fetch touched'); } });
    await serve(handler, async base => {
      assert.equal((await fetch(base + '/api/orders', { headers: authorization })).status, 503);
    });
  }
  assert.equal(calls, 0);
});

test('order list and detail scope SQL to authenticated owner and hide other order', async () => {
  const rows = [{ id: orderId, status: 'pending', productName: '10 Diamonds', price: 25000, userId: '123', zoneId: '100' }];
  const pool = { async query(sql, params) {
    assert.match(sql, /WHERE owner_id = \$1/);
    assert.equal(params[0], owner);
    if (sql.includes('AND id = $2')) { assert.equal(params[1], orderId); return { rows: [] }; }
    assert.match(sql, /ORDER BY created_at DESC/);
    return { rows };
  } };
  await serve(createHandler({ pool, env, fetchImpl: authFetch() }), async base => {
    assert.deepEqual(await (await fetch(base + '/api/orders', { headers: authorization })).json(), { orders: rows });
    const response = await fetch(base + '/api/orders/' + orderId, { headers: authorization });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Pesanan tidak ditemukan.' });
  });
});

test('buyer cannot read admin orders or run admin reconciliation', async () => {
  let adminReads = 0;
  const pool = { async query(sql) {
    if (sql.includes('FROM admin_users')) return { rows: [] };
    adminReads++;
    throw Error('Admin data touched');
  } };
  await serve(createHandler({ pool, env, fetchImpl: authFetch(other) }), async base => {
    const profile = await fetch(base + '/api/me', { headers: authorization });
    assert.deepEqual(await profile.json(), { role: 'buyer' });
    const orders = await fetch(base + '/api/admin/orders', { headers: authorization });
    assert.equal(orders.status, 403);
    const reconcile = await fetch(base + '/api/admin/orders/' + orderId + '/check-digiflazz', { method: 'POST', headers: authorization });
    assert.equal(reconcile.status, 403);
  });
  assert.equal(adminReads, 0);
});

test('admin sees all orders without changing buyer order scope', async () => {
  const rows = [{ id: orderId, status: 'pending', productName: '10 Diamonds', price: 25000, ownerId: other }];
  const pool = { async query(sql, params) {
    if (sql.includes('FROM admin_users')) { assert.equal(params[0], owner); return { rows: [{ user_id: owner }] }; }
    if (sql.includes('FROM orders') && sql.includes('ORDER BY')) {
      assert.doesNotMatch(sql, /WHERE owner_id/);
      return { rows };
    }
    throw Error('Unexpected SQL');
  } };
  await serve(createHandler({ pool, env, fetchImpl: authFetch() }), async base => {
    const profile = await fetch(base + '/api/me', { headers: authorization });
    assert.deepEqual(await profile.json(), { role: 'admin' });
    const response = await fetch(base + '/api/admin/orders', { headers: authorization });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { orders: rows });
  });
});

test('admin reconciliation keeps existing Digiflazz ref_id in test mode', async () => {
  let supplierCalls = 0;
  const pool = { async query(sql, params) {
    if (sql.includes('FROM admin_users')) return { rows: [{ user_id: owner }] };
    if (sql.includes('SET digi_checked_at')) {
      assert.match(sql, /interval '5 minutes'/);
      assert.equal(params[0], orderId);
      return { rows: [{ id: orderId, digi_sku: 'TEST', customer_no: '123100', price: 25000 }] };
    }
    if (sql.includes('SET status = $2')) return { rows: [] };
    throw Error('Unexpected SQL');
  } };
  const fetchImpl = async (url, options) => {
    if (url === 'https://sample.supabase.co/auth/v1/user') return authFetch()(url, options);
    assert.equal(url, 'https://api.digiflazz.com/v1/transaction');
    const body = JSON.parse(options.body);
    assert.equal(body.ref_id, orderId);
    assert.equal(body.testing, true);
    supplierCalls++;
    return { ok: true, json: async () => ({ data: { ref_id: orderId, buyer_sku_code: 'TEST', customer_no: '123100', status: 'Pending', rc: '03' } }) };
  };
  await serve(createHandler({ pool, env, fetchImpl }), async base => {
    const response = await fetch(base + '/api/admin/orders/' + orderId + '/check-digiflazz', { method: 'POST', headers: authorization });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { checked: true });
  });
  assert.equal(supplierCalls, 1);
});

test('checkout stores verified owner UUID, never client-supplied owner', async () => {
  let inserts = 0, snapCalls = 0;
  const pool = { async query(sql, params) {
    if (sql.startsWith('SELECT id, name, price')) return { rows: [{ id: 'ml10', name: '10 Diamonds', price: 25000, digi_sku: 'ML10', customer_format: 'ml_concat' }] };
    if (sql.startsWith('INSERT INTO orders')) {
      assert.match(sql, /owner_id/);
      assert.equal(params[8], owner);
      assert.notEqual(params[8], other);
      inserts++;
      return { rows: [] };
    }
    if (sql.startsWith('UPDATE orders SET redirect_url')) return { rows: [] };
    throw Error('Unexpected SQL');
  } };
  const handler = createHandler({ pool, env, fetchImpl: async (url, options) => {
    if (url === 'https://sample.supabase.co/auth/v1/user') return authFetch()(url, options);
    snapCalls++;
    return { ok: true, status: 200, json: async () => ({ redirect_url: 'https://app.sandbox.midtrans.com/snap/v2/vtweb/token' }) };
  } });
  await serve(handler, async base => {
    const response = await fetch(base + '/api/checkout', { method: 'POST', headers: { ...authorization, 'content-type': 'application/json' }, body: JSON.stringify({ productId: 'ml10', userId: '123', zoneId: '100', ownerId: other }) });
    assert.equal(response.status, 201);
  });
  assert.equal(inserts, 1);
  assert.equal(snapCalls, 1);
});
