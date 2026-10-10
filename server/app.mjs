import { createHash, randomUUID } from 'node:crypto';
import { validateCheckout, verifiedPayment } from './core.mjs';

const idPattern = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const error = (status, message) => Object.assign(new Error(message), { status });
const ready = env => Boolean(env.DATABASE_URL && env.MIDTRANS_SERVER_KEY && env.DIGIFLAZZ_USERNAME && env.DIGIFLAZZ_API_KEY && ((env.MIDTRANS_ENV === 'sandbox' && env.DIGIFLAZZ_TESTING === 'true') || (env.MIDTRANS_ENV === 'production' && env.DIGIFLAZZ_TESTING === 'false')));
const checkoutReady = env => env.CHECKOUT_ENABLED === 'true' && ready(env);

function send(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(value));
}

async function readJson(req) {
  if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) throw error(415, 'Gunakan JSON.');
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 8192) throw error(413, 'Data terlalu besar.');
  }
  try { return JSON.parse(text); } catch { throw error(400, 'JSON tidak valid.'); }
}

async function externalJson(fetchImpl, url, options) {
  const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw error(502, 'Layanan eksternal gagal.');
  return response.json();
}

async function authenticatedAdmin(req, pool, fetchImpl, env) {
  const ownerId = await authenticatedOwner(req, fetchImpl, env);
  const { rows } = await pool.query('SELECT user_id FROM admin_users WHERE user_id = $1', [ownerId]);
  if (!rows[0]) throw error(403, 'Akses admin diperlukan.');
  return ownerId;
}

async function authenticatedOwner(req, fetchImpl, env) {
  const token = /^Bearer ([^\s,]{1,8192})$/i.exec(req.headers.authorization || '')?.[1];
  if (!token) throw error(401, 'Silakan masuk terlebih dahulu.');
  let url;
  try { url = new URL(env.SUPABASE_URL); } catch { throw error(503, 'Autentikasi belum siap.'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !env.SUPABASE_ANON_KEY) throw error(503, 'Autentikasi belum siap.');
  let response;
  try {
    response = await fetchImpl(new URL('/auth/v1/user', url).href, {
      method: 'GET', headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${token}` },
      redirect: 'error', signal: AbortSignal.timeout(12000)
    });
  } catch { throw error(502, 'Autentikasi tidak tersedia.'); }
  if (response.status === 401 || response.status === 403) throw error(401, 'Sesi tidak valid.');
  if (!response.ok) throw error(502, 'Autentikasi tidak tersedia.');
  let user;
  try { user = await response.json(); } catch { throw error(502, 'Respons autentikasi tidak valid.'); }
  if (!user || typeof user.id !== 'string' || !idPattern.test(user.id)) throw error(401, 'Sesi tidak valid.');
  if (!user.email_confirmed_at && !user.phone_confirmed_at) throw error(403, 'Verifikasi email atau nomor HP akun dulu.');
  return user.id;
}

export function digiRequest(row, env) {
  return {
    username: env.DIGIFLAZZ_USERNAME,
    buyer_sku_code: row.digi_sku,
    customer_no: row.customer_no,
    ref_id: row.id,
    sign: createHash('md5').update(env.DIGIFLAZZ_USERNAME + env.DIGIFLAZZ_API_KEY + row.id).digest('hex'),
    ...(env.DIGIFLAZZ_TESTING === 'true' ? { testing: true } : {}),
    ...(row.price ? { max_price: row.price } : {})
  };
}

async function submitDigi(pool, fetchImpl, env, row) {
  try {
    const response = await externalJson(fetchImpl, 'https://api.digiflazz.com/v1/transaction', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(digiRequest(row, env))
    });
    const data = response?.data;
    // Ambiguous or mismatched responses require manual review, never an automatic fresh ref_id.
    let status = 'manual_review';
    if (data?.ref_id === row.id && data?.buyer_sku_code === row.digi_sku && data?.customer_no === row.customer_no) {
      if (data.status === 'Sukses' && data.rc === '00') status = 'fulfilled';
      else if (data.status === 'Gagal' && data.rc === '02') status = 'fulfillment_failed';
      else if (data.status === 'Pending') status = 'fulfillment_pending';
    }
    await pool.query("UPDATE orders SET status = $2, updated_at = now() WHERE id = $1 AND status = 'fulfillment_pending'", [row.id, status]);
  } catch (err) {
    console.error('Digiflazz request unresolved; reconcile ref_id manually:', row.id, err.message);
    await pool.query("UPDATE orders SET status = 'manual_review', updated_at = now() WHERE id = $1 AND status = 'fulfillment_pending'", [row.id]);
  }
}

export function createHandler({ pool, fetchImpl = fetch, env = process.env }) {
  return async (req, res) => {
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/api/products') {
        const { rows } = await pool.query('SELECT id, name, game, price FROM products WHERE enabled = true ORDER BY game, id');
        return send(res, 200, { products: rows.map(p => ({ ...p, id: String(p.id) })), checkoutAvailable: checkoutReady(env) });
      }
      if (req.method === 'GET' && path === '/api/me') {
        const ownerId = await authenticatedOwner(req, fetchImpl, env);
        const { rows } = await pool.query('SELECT user_id FROM admin_users WHERE user_id = $1', [ownerId]);
        return send(res, 200, { role: rows[0] ? 'admin' : 'buyer' });
      }
      if (req.method === 'GET' && path === '/api/admin/orders') {
        await authenticatedAdmin(req, pool, fetchImpl, env);
        const { rows } = await pool.query('SELECT id, status, product_name AS "productName", price, owner_id AS "ownerId" FROM orders ORDER BY created_at DESC, id DESC LIMIT 100');
        return send(res, 200, { orders: rows });
      }
      if (req.method === 'POST' && path === '/api/checkout') {
        const ownerId = await authenticatedOwner(req, fetchImpl, env);
        let input;
        try { input = validateCheckout(await readJson(req)); } catch (err) { throw err.status ? err : error(400, err.message); }
        if (!checkoutReady(env)) throw error(503, 'Checkout belum siap.');
        const { rows } = await pool.query('SELECT id, name, price, digi_sku, customer_format FROM products WHERE id = $1 AND enabled = true', [input.productId]);
        const product = rows[0];
        if (!product) throw error(404, 'Produk tidak tersedia.');
        if (product.customer_format !== 'ml_concat') throw error(422, 'Format tujuan belum didukung.');
        const id = randomUUID();
        const customerNo = input.userId + input.zoneId;
        await pool.query('INSERT INTO orders (id, product_id, product_name, price, digi_sku, customer_no, user_id, zone_id, owner_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id, product.id, product.name, product.price, product.digi_sku, customerNo, input.userId, input.zoneId, ownerId]);
        // ponytail: Snap create is one-shot; failed/ambiguous requests stay pending for manual reconciliation, never reuse order_id.
        let snap;
        try {
          snap = await externalJson(fetchImpl, `https://app.${env.MIDTRANS_ENV === 'production' ? '' : 'sandbox.'}midtrans.com/snap/v1/transactions`, {
            method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Basic ${Buffer.from(env.MIDTRANS_SERVER_KEY + ':').toString('base64')}` },
            body: JSON.stringify({ transaction_details: { order_id: id, gross_amount: product.price } })
          });
        } catch (err) { throw error(502, 'Pembayaran belum dapat dibuat. Coba pesanan baru.'); }
        if (typeof snap?.redirect_url !== 'string' || !snap.redirect_url.startsWith(`https://app.${env.MIDTRANS_ENV === 'production' ? '' : 'sandbox.'}midtrans.com/snap/`)) throw error(502, 'Respons pembayaran tidak valid.');
        await pool.query('UPDATE orders SET redirect_url = $2, updated_at = now() WHERE id = $1', [id, snap.redirect_url]);
        return send(res, 201, { orderId: id, redirectUrl: snap.redirect_url });
      }
      if (req.method === 'GET' && path === '/api/orders') {
        const ownerId = await authenticatedOwner(req, fetchImpl, env);
        const { rows } = await pool.query('SELECT id, status, product_name AS "productName", price, user_id AS "userId", zone_id AS "zoneId" FROM orders WHERE owner_id = $1 ORDER BY created_at DESC, id DESC', [ownerId]);
        return send(res, 200, { orders: rows });
      }
      if (req.method === 'GET' && path.startsWith('/api/orders/')) {
        const ownerId = await authenticatedOwner(req, fetchImpl, env);
        const id = path.slice('/api/orders/'.length);
        if (!idPattern.test(id)) throw error(404, 'Pesanan tidak ditemukan.');
        const { rows } = await pool.query('SELECT id, status, product_name AS "productName", price, user_id AS "userId", zone_id AS "zoneId" FROM orders WHERE owner_id = $1 AND id = $2', [ownerId, id]);
        if (!rows[0]) throw error(404, 'Pesanan tidak ditemukan.');
        return send(res, 200, { order: rows[0] });
      }
      if (req.method === 'POST' && path === '/api/webhooks/midtrans') {
        if (!ready(env)) throw error(503, 'Webhook belum siap.');
        const notice = await readJson(req);
        if (!verifiedPayment(notice, env.MIDTRANS_SERVER_KEY) || !idPattern.test(notice.order_id)) throw error(401, 'Notifikasi tidak sah.');
        const { rows } = await pool.query(`UPDATE orders SET status = CASE WHEN status = 'pending' THEN 'payment_paid' ELSE status END, updated_at = now()
          WHERE id = $1 AND price = $2 AND status NOT IN ('payment_failed') RETURNING id, price`, [notice.order_id, Number(notice.gross_amount)]);
        if (!rows[0]) throw error(404, 'Pesanan atau jumlah pembayaran tidak cocok.');
        if (!env.DIGIFLAZZ_USERNAME || !env.DIGIFLAZZ_API_KEY) throw error(503, 'Fulfillment belum siap.');
        // Atomic claim across processes; never auto-resubmit after a network timeout/crash.
        const claim = await pool.query(`UPDATE orders SET status = 'fulfillment_pending', digiflazz_claimed_at = now(), updated_at = now()
          WHERE id = $1 AND status = 'payment_paid' AND digiflazz_claimed_at IS NULL
          RETURNING id, digi_sku, customer_no, price`, [notice.order_id]);
        if (claim.rows[0]) await submitDigi(pool, fetchImpl, env, claim.rows[0]);
        return send(res, 200, { received: true });
      }
      if (req.method === 'POST' && /^\/api\/admin\/orders\/[^/]+\/check-digiflazz$/.test(path)) {
        const id = path.split('/')[4];
        await authenticatedAdmin(req, pool, fetchImpl, env);
        if (!idPattern.test(id)) throw error(404, 'Pesanan tidak ditemukan.');
        if (!ready(env)) throw error(503, 'Pemeriksaan tidak siap.');
        const { rows } = await pool.query(`UPDATE orders SET digi_checked_at = now(), updated_at = now()
          WHERE id = $1 AND status = 'fulfillment_pending' AND digiflazz_claimed_at < now() - interval '5 minutes'
            AND (digi_checked_at IS NULL OR digi_checked_at < now() - interval '5 minutes')
          RETURNING id, digi_sku, customer_no, price`, [id]);
        if (!rows[0]) throw error(409, 'Belum waktunya cek atau status tidak sesuai.');
        await submitDigi(pool, fetchImpl, env, rows[0]);
        return send(res, 200, { checked: true });
      }
      throw error(404, 'Endpoint tidak ditemukan.');
    } catch (err) {
      if (!err.status) console.error('API error:', err);
      send(res, err.status || 500, { error: err.status ? err.message : 'Kesalahan server. Coba lagi nanti.' });
    }
  };
}
