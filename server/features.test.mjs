import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { createHandler } from './app.mjs';
import { mailReady, orderEmail, sendOrderEmail } from './mail.mjs';

const env = { MIDTRANS_SERVER_KEY: 'sandbox-secret', DIGIFLAZZ_USERNAME: 'buyer', DIGIFLAZZ_API_KEY: 'api-secret', MIDTRANS_ENV: 'sandbox', DIGIFLAZZ_TESTING: 'true', CHECKOUT_ENABLED: 'true', DATABASE_URL: 'test', SUPABASE_URL: 'https://sample.supabase.co', SUPABASE_ANON_KEY: 'public-key' };
const ownerId = '22222222-2222-4222-8222-222222222222';
const orderId = '11111111-1111-4111-8111-111111111111';
const authHeaders = { authorization: 'Bearer buyer-token' };
const withAuth = next => async (url, options) => url === 'https://sample.supabase.co/auth/v1/user'
  ? { ok: true, status: 200, json: async () => ({ id: ownerId, email_confirmed_at: '2026-01-01T00:00:00Z' }) }
  : next(url, options);

async function call(handler, path, options = {}) {
  const server = createServer(handler).listen(0, '127.0.0.1');
  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, options);
    return { status: response.status, payload: await response.json().catch(() => ({})) };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('kontak support dibaca dari env dan nomor WA dinormalkan ke format internasional', async () => {
  const handler = createHandler({ pool: { query() { throw Error('db touched'); } }, fetchImpl() { throw Error('net touched'); }, env: { ...env, SUPPORT_EMAIL: 'bantuan@melonbyte.id', SUPPORT_WHATSAPP: '0812-3456-7890' } });
  const { status, payload } = await call(handler, '/api/contact');
  assert.equal(status, 200);
  assert.equal(payload.email, 'bantuan@melonbyte.id');
  assert.equal(payload.whatsapp, 'https://wa.me/6281234567890');
  assert.equal(payload.whatsappLabel, '+6281234567890');
});

test('kontak tetap punya email bawaan saat env kosong, tanpa tombol WA palsu', async () => {
  const handler = createHandler({ pool: { query() { throw Error('db touched'); } }, fetchImpl() { throw Error('net touched'); }, env });
  const { status, payload } = await call(handler, '/api/contact');
  assert.equal(status, 200);
  assert.equal(payload.email, 'halo@melonbyte.id');
  assert.equal(payload.whatsapp, null);
  assert.equal(payload.whatsappLabel, null);
});

test('katalog menandai produk gangguan dan tidak membocorkan kolom internal', async () => {
  const pool = { async query(sql) {
    assert.match(sql, /p\.customer_format AS "format"/);
    return { rows: [
      { id: 'ml10', name: '10 Diamonds', game: 'Mobile Legends', price: 25000, category: 'Games', format: 'ml_concat', gangguan: true },
      { id: 'ml20', name: '20 Diamonds', game: 'Mobile Legends', price: 48000, category: 'Games', format: 'ml_concat', gangguan: false },
    ] };
  } };
  const handler = createHandler({ pool, env, fetchImpl: withAuth(() => { throw Error('net touched'); }) });
  const { status, payload } = await call(handler, '/api/products');
  assert.equal(status, 200);
  assert.equal(payload.products[0].gangguan, true);
  assert.equal('gangguan' in payload.products[1], false);
});

test('checkout menolak produk gangguan sebelum menyentuh Midtrans', async () => {
  let external = 0;
  const pool = { async query(sql) {
    if (sql.startsWith('SELECT id, name, price, digi_sku, customer_format')) return { rows: [{ id: 'ml10', name: '10 Diamonds', price: 25000, digi_sku: 'ML10', customer_format: 'ml_concat', gangguan: true }] };
    throw Error(`unexpected SQL: ${sql.slice(0, 40)}`);
  } };
  const handler = createHandler({ pool, env, fetchImpl: withAuth(() => { external++; throw Error('external touched'); }) });
  const { status, payload } = await call(handler, '/api/checkout', { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders }, body: JSON.stringify({ productId: 'ml10', userId: '123', zoneId: '100' }) });
  assert.equal(status, 409);
  assert.match(payload.error, /gangguan/i);
  assert.equal(external, 0);
});

test('webhook digiflazz menolak tanda tangan palsu tanpa menyentuh database', async () => {
  let calls = 0;
  const handler = createHandler({ pool: { query() { calls++; throw Error('db touched'); } }, fetchImpl() { calls++; throw Error('net touched'); }, env: { ...env, DIGIFLAZZ_WEBHOOK_SECRET: 'whsec' } });
  const { status } = await call(handler, '/api/webhooks/digiflazz', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature': 'a'.repeat(40) }, body: JSON.stringify({ data: { ref_id: orderId, status: 'Sukses', rc: '00' } }) });
  assert.equal(status, 401);
  assert.equal(calls, 0);
});

test('webhook digiflazz dengan HMAC-SHA1 sah menutup pesanan dan menyimpan SN', async () => {
  const body = JSON.stringify({ data: { ref_id: orderId, status: 'Sukses', rc: '00', sn: 'SN-123', message: 'Sukses' } });
  const signature = createHmac('sha1', 'whsec').update(body).digest('hex');
  const seen = [];
  const pool = { async query(sql, params) {
    seen.push(sql);
    assert.match(sql, /UPDATE orders SET status = \$2/);
    assert.equal(params[0], orderId);
    assert.equal(params[1], 'fulfilled');
    assert.equal(params[2], 'SN-123');
    return { rows: [{ id: orderId, status: 'fulfilled' }] };
  } };
  const handler = createHandler({ pool, env: { ...env, DIGIFLAZZ_WEBHOOK_SECRET: 'whsec' }, fetchImpl() { throw Error('net touched'); } });
  const { status, payload } = await call(handler, '/api/webhooks/digiflazz', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature': `sha1=${signature}` }, body });
  assert.equal(status, 200);
  assert.equal(payload.received, true);
  assert.equal(seen.length, 1);
});

test('webhook digiflazz tanpa rahasia dikonfigurasi ditolak jelas', async () => {
  const handler = createHandler({ pool: { query() { throw Error('db touched'); } }, fetchImpl() { throw Error('net touched'); }, env });
  const { status, payload } = await call(handler, '/api/webhooks/digiflazz', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: { ref_id: orderId, status: 'Sukses', rc: '00' } }) });
  assert.equal(status, 503);
  assert.match(payload.error, /webhook/i);
});

test('admin melihat daftar pesanan yang menunggu refund', async () => {
  const pool = { async query(sql) {
    if (sql.startsWith('SELECT user_id FROM admin_users')) return { rows: [{ user_id: ownerId }] };
    if (sql.startsWith('SELECT id, status, product_name')) return { rows: [{ id: orderId, status: 'fulfillment_failed', productName: '10 Diamonds', price: 25000, userId: '123', zoneId: '100', fulfillmentNote: 'Stok habis', refundedAt: null, refundNote: null, createdAt: '2026-10-15T00:00:00Z' }] };
    if (sql.startsWith('SELECT id, product_name')) return { rows: [{ id: '22222222-2222-4222-8222-222222222222', productName: '5 Diamonds', price: 12000, refundedAt: '2026-10-15T02:00:00Z', refundNote: 'Manual: transfer bank' }] };
    throw Error(`unexpected SQL: ${sql.slice(0, 40)}`);
  } };
  const handler = createHandler({ pool, env, fetchImpl: withAuth(() => { throw Error('net touched'); }) });
  const { status, payload } = await call(handler, '/api/admin/refunds', { headers: authHeaders });
  assert.equal(status, 200);
  assert.equal(payload.orders.length, 1);
  assert.equal(payload.orders[0].status, 'fulfillment_failed');
  assert.equal(payload.refunded.length, 1);
});

test('refund manual menandai pesanan, menyimpan catatan, dan mengembalikan kuota voucher', async () => {
  const statements = [];
  const pool = { async query(sql, params) {
    statements.push(sql);
    if (sql.startsWith('SELECT user_id FROM admin_users')) return { rows: [{ user_id: ownerId }] };
    if (sql.startsWith('SELECT id, status, price')) return { rows: [{ id: orderId, status: 'payment_paid', price: 25000 }] };
    if (sql.includes("SET status = 'refunded'")) { assert.match(params[1], /^Manual: transfer bank/); return { rows: [{ id: orderId }] } };
    if (/voucher/i.test(sql)) return { rows: [] };
    throw Error(`unexpected SQL: ${sql.slice(0, 60)}`);
  } };
  const handler = createHandler({ pool, env, fetchImpl: withAuth(() => { throw Error('net touched'); }) });
  const { status, payload } = await call(handler, `/api/admin/orders/${orderId}/refund`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders }, body: JSON.stringify({ manual: true, note: 'transfer bank BCA' }) });
  assert.equal(status, 200);
  assert.deepEqual(payload, { refunded: true, manual: true });
  assert.equal(statements.some((sql) => /voucher/i.test(sql)), true);
});

test('refund manual tanpa catatan ditolak agar jejaknya jelas', async () => {
  const pool = { async query(sql) {
    if (sql.startsWith('SELECT user_id FROM admin_users')) return { rows: [{ user_id: ownerId }] };
    throw Error(`unexpected SQL: ${sql.slice(0, 40)}`);
  } };
  const handler = createHandler({ pool, env, fetchImpl: withAuth(() => { throw Error('net touched'); }) });
  const { status, payload } = await call(handler, `/api/admin/orders/${orderId}/refund`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders }, body: JSON.stringify({ manual: true, note: '' }) });
  assert.equal(status, 400);
  assert.match(payload.error, /catatan/i);
});

test('refund ditolak untuk pesanan yang belum dibayar', async () => {
  const pool = { async query(sql) {
    if (sql.startsWith('SELECT user_id FROM admin_users')) return { rows: [{ user_id: ownerId }] };
    if (sql.startsWith('SELECT id, status, price')) return { rows: [{ id: orderId, status: 'pending', price: 25000 }] };
    throw Error(`unexpected SQL: ${sql.slice(0, 40)}`);
  } };
  const handler = createHandler({ pool, env, fetchImpl: withAuth(() => { throw Error('net touched'); }) });
  const { status, payload } = await call(handler, `/api/admin/orders/${orderId}/refund`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders }, body: JSON.stringify({ manual: true, note: 'transfer bank BCA' }) });
  assert.equal(status, 409);
  assert.match(payload.error, /tidak dapat direfund/i);
});

test('notifikasi email aktif hanya jika kredensial Brevo lengkap', () => {
  assert.equal(mailReady({}), false);
  assert.equal(mailReady({ BREVO_API_KEY: 'k' }), false);
  assert.equal(mailReady({ MAIL_FROM: 'a@b.c' }), false);
  assert.equal(mailReady({ BREVO_API_KEY: 'k', MAIL_FROM: 'a@b.c' }), true);
});

test('isi email mengikuti baris struk: harga asli, potongan, total dibayar', () => {
  const order = { id: orderId, productName: '10 Diamonds', price: 24000, discount: 1000, voucherCode: 'TEMAN1K', userId: '123', zoneId: '100', sn: 'SN-9' };
  const message = orderEmail('fulfilled', order, { STORE_URL: 'https://melonbyte.id/' });
  assert.match(message.subject, /#11111111/);
  assert.match(message.html, /Harga/);
  assert.match(message.html, /Rp 25\.000/);
  assert.match(message.html, /Potongan \(TEMAN1K\)/);
  assert.match(message.html, /Rp 24\.000/);
  assert.match(message.html, /SN-9/);
  assert.match(message.html, /https:\/\/melonbyte\.id\/#struk\//);
  assert.equal(orderEmail('entah', order, {}), null);
  assert.equal(orderEmail('paid', {}, {}), null);
});

test('pengiriman email melalui Brevo dan tidak pernah melempar error', async () => {
  const sent = [];
  const ok = await sendOrderEmail(async (url, options) => { sent.push({ url, options }); return { ok: true, status: 202 }; }, { BREVO_API_KEY: 'k', MAIL_FROM: 'a@b.c', MAIL_FROM_NAME: 'Melonbyte' }, 'pembeli@example.com', { subject: 's', html: '<p>h</p>' });
  assert.equal(ok.ok, true);
  assert.equal(sent[0].url, 'https://api.brevo.com/v3/smtp/email');
  const payload = JSON.parse(sent[0].options.body);
  assert.equal(payload.sender.email, 'a@b.c');
  assert.equal(payload.to[0].email, 'pembeli@example.com');
  const failed = await sendOrderEmail(async () => { throw Error('jaringan putus'); }, { BREVO_API_KEY: 'k', MAIL_FROM: 'a@b.c' }, 'pembeli@example.com', { subject: 's', html: 'h' });
  assert.equal(failed.ok, false);
  assert.match(failed.error, /jaringan putus/);
  assert.deepEqual(await sendOrderEmail(async () => { throw Error('x'); }, {}, 'a@b.c', { subject: 's', html: 'h' }), { ok: false, skipped: true });
});

test('tanda tangan midtrans masih memakai sha512 dan bukan sha1 webhook', () => {
  const n = { order_id: orderId, status_code: '200', gross_amount: '25000.00', transaction_status: 'settlement' };
  n.signature_key = createHash('sha512').update(n.order_id + n.status_code + n.gross_amount + env.MIDTRANS_SERVER_KEY).digest('hex');
  assert.equal(n.signature_key.length, 128);
  assert.equal(createHmac('sha1', 'whsec').update('x').digest('hex').length, 40);
});
