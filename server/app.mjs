import { createHash, randomUUID } from 'node:crypto';
import { validateCheckout, verifiedPayment, customerNo as buildCustomerNo } from './core.mjs';
import { fetchSupplierCatalog } from './catalog.mjs';

const idPattern = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
// ponytail: Format tujuan per brand. Brand di luar daftar ini hanya bisa disimpan sebagai draf harga
// sampai format tujuannya dipastikan. Telco/e-money/PLN/TV = input polos (nomor tujuan apa adanya).
const customerFormats = {
  'MOBILE LEGENDS': 'ml_concat',
  'FREE FIRE': 'plain',
  'TELKOMSEL': 'plain', 'INDOSAT': 'plain', 'XL': 'plain', 'AXIS': 'plain', 'TRI': 'plain', 'SMARTFREN': 'plain', 'BY.U': 'plain',
  'DANA': 'plain', 'GO PAY': 'plain', 'OVO': 'plain', 'SHOPEE PAY': 'plain',
  'PLN': 'plain', 'K-VISION DAN GOL': 'plain',
};
const formatFor = game => customerFormats[String(game || '').toUpperCase()] || null;
const error = (status, message) => Object.assign(new Error(message), { status });
const ready = env => Boolean(env.DATABASE_URL && env.MIDTRANS_SERVER_KEY && env.DIGIFLAZZ_USERNAME && env.DIGIFLAZZ_API_KEY && ((env.MIDTRANS_ENV === 'sandbox' && env.DIGIFLAZZ_TESTING === 'true') || (env.MIDTRANS_ENV === 'production' && env.DIGIFLAZZ_TESTING === 'false')));
const checkoutReady = env => env.CHECKOUT_ENABLED === 'true' && ready(env);
// ponytail: cermin katalog supplier disimpan di DB; pembacaan selalu memakai hasil sinkron terakhir.
const supplierRowWhere = 'synced_at = (SELECT max(synced_at) FROM supplier_products)';

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

// ponytail: pull Digiflazz hanya saat sinkron diminta; INSERT + DELETE memakai tanda synced_at yang sama supaya pembacaan konsisten.
async function saveSupplierCatalog(pool, fetchImpl, env) {
  const items = await supplierList(env, fetchImpl);
  if (!items.length) throw error(502, 'Katalog supplier kosong; sinkron dibatalkan agar daftar lama tidak terhapus.');
  const syncedAt = new Date();
  const params = [syncedAt];
  const values = items.map(item => {
    const base = params.length + 1;
    params.push(item.id, item.name, item.game, item.category, item.variant, item.price);
    return `($${base}, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $1)`;
  });
  await pool.query(`INSERT INTO supplier_products (sku, name, game, category, variant, price, synced_at) VALUES ${values.join(', ')}
    ON CONFLICT (sku) DO UPDATE SET name = EXCLUDED.name, game = EXCLUDED.game, category = EXCLUDED.category, variant = EXCLUDED.variant, price = EXCLUDED.price, synced_at = EXCLUDED.synced_at`, params);
  await pool.query('DELETE FROM supplier_products WHERE synced_at < $1', [syncedAt]);
  return { items, syncedAt };
}

async function supplierList(env, fetchImpl) {
  if (!env.DIGIFLAZZ_USERNAME || !env.DIGIFLAZZ_API_KEY) throw error(503, 'Katalog supplier belum dikonfigurasi di server.');
  try { return await fetchSupplierCatalog(fetchImpl, env); } catch (err) {
    // ponytail: rc 83 = Digiflazz membatasi cek pricelist; pesannya dibedakan supaya admin tahu harus menunggu, bukan server rusak.
    if (err?.rc === '83') throw error(502, 'Digiflazz membatasi cek katalog (beberapa kali dalam beberapa menit). Coba lagi nanti.');
    throw error(502, 'Katalog supplier belum bisa dimuat. Coba lagi nanti.');
  }
}

export function createHandler({ pool, fetchImpl = fetch, env = process.env }) {
  return async (req, res) => {
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/api/products') {
        const { rows } = await pool.query('SELECT p.id, p.name, p.game, p.price, p.customer_format AS "format", COALESCE(s.category, \'\') AS category FROM products p LEFT JOIN supplier_products s ON s.sku = p.id WHERE p.enabled = true ORDER BY p.game, p.id');
        return send(res, 200, { products: rows.map(p => ({ ...p, id: String(p.id), category: String(p.category || '') })), checkoutAvailable: checkoutReady(env) });
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
      if (req.method === 'GET' && path === '/api/admin/supplier-products') {
        await authenticatedAdmin(req, pool, fetchImpl, env);
        const { rows: catalogRows } = await pool.query(`SELECT sku, name, game, category, variant, price, synced_at FROM supplier_products WHERE ${supplierRowWhere}`);
        const catalog = catalogRows.map(row => ({ id: row.sku, name: row.name, game: row.game, category: row.category, variant: row.variant, price: Number(row.price) }));
        const syncedAt = catalogRows.length ? new Date(Math.max(...catalogRows.map(row => new Date(row.synced_at).getTime()))) : null;
        const { rows } = await pool.query('SELECT id, name, game, price, enabled FROM products');
        const saved = new Map(rows.map(row => [row.id, row]));
        const q = (new URL(req.url, 'http://localhost').searchParams.get('q') || '').trim().toLowerCase();
        const match = (name, game, sku) => !q || name.toLowerCase().includes(q) || game.toLowerCase().includes(q) || sku.toLowerCase().includes(q);
        const products = catalog.filter(item => match(item.name, item.game, item.id)).slice(0, 200).map(item => ({
          sku: item.id, name: item.name, game: item.game, category: item.category, variant: item.variant, cost: item.price,
          supported: Boolean(formatFor(item.game)),
          price: saved.get(item.id)?.price ?? null,
          enabled: saved.get(item.id)?.enabled ?? false,
        }));
        const catalogIds = new Set(catalog.map(item => item.id));
        const missing = rows.filter(row => !catalogIds.has(row.id) && match(row.name, row.game, row.id)).map(row => ({
          sku: row.id, name: row.name, game: row.game, category: null, variant: null, cost: null,
          supported: Boolean(formatFor(row.game)), missing: true, price: row.price, enabled: row.enabled,
        }));
        return send(res, 200, { products: products.concat(missing), catalogFetchedAt: syncedAt ? syncedAt.toISOString() : null, catalogStale: !syncedAt || Date.now() - syncedAt.getTime() > 10 * 60 * 1000 });
      }
      if (req.method === 'POST' && path === '/api/admin/supplier-products/sync') {
        await authenticatedAdmin(req, pool, fetchImpl, env);
        const { items, syncedAt } = await saveSupplierCatalog(pool, fetchImpl, env);
        return send(res, 200, { synced: items.length, catalogFetchedAt: syncedAt.toISOString() });
      }
      if (req.method === 'PUT' && path.startsWith('/api/admin/products/')) {
        const sku = path.slice('/api/admin/products/'.length);
        await authenticatedAdmin(req, pool, fetchImpl, env);
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(sku)) throw error(404, 'Produk tidak ditemukan.');
        let body;
        try { body = await readJson(req); } catch (err) { throw err.status ? err : error(400, err.message); }
        const { price, enabled } = body ?? {};
        if (!Number.isSafeInteger(price) || price < 1 || price > 100000000) throw error(400, 'Harga jual tidak valid.');
        if (typeof enabled !== 'boolean') throw error(400, 'Status produk tidak valid.');
        // ponytail: katalog dibaca dari tabel sinkron; SKU baru yang belum tersinkron tetap ditolak sampai sinkron berikutnya.
        const { rows: supplierRows } = await pool.query(`SELECT name, game, category, variant, price FROM supplier_products WHERE sku = $1 AND ${supplierRowWhere}`, [sku]);
        const item = supplierRows[0];
        if (!item && enabled) throw error(409, 'SKU tidak ada di katalog supplier aktif.');
        if (item && enabled && !formatFor(item.game)) throw error(422, 'Format tujuan produk ini belum didukung checkout.');
        const { rows } = item
          ? await pool.query(`INSERT INTO products (id, name, game, price, digi_sku, customer_format, enabled) VALUES ($1, $2, $3, $4, $1, $6, $5)
            ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, game = EXCLUDED.game, price = EXCLUDED.price, digi_sku = EXCLUDED.digi_sku, enabled = EXCLUDED.enabled
            RETURNING id, name, game, price, enabled`, [sku, item.name, item.game, price, enabled, formatFor(item.game)])
          : await pool.query('UPDATE products SET price = $2, enabled = false WHERE id = $1 RETURNING id, name, game, price, enabled', [sku, price]);
        if (!rows[0]) throw error(404, 'Produk tidak ditemukan.');
        return send(res, 200, { product: {
          sku: rows[0].id, name: rows[0].name, game: rows[0].game, category: item?.category ?? null, variant: item?.variant ?? null, cost: item?.price ?? null,
          supported: Boolean(formatFor(item ? item.game : rows[0].game)),
          missing: !item, price: rows[0].price, enabled: rows[0].enabled,
        } });
      }
      if (req.method === 'POST' && path === '/api/checkout') {
        const ownerId = await authenticatedOwner(req, fetchImpl, env);
        let input;
        try { input = validateCheckout(await readJson(req)); } catch (err) { throw err.status ? err : error(400, err.message); }
        if (!checkoutReady(env)) throw error(503, 'Checkout belum siap.');
        const { rows } = await pool.query('SELECT id, name, price, digi_sku, customer_format FROM products WHERE id = $1 AND enabled = true', [input.productId]);
        const product = rows[0];
        if (!product) throw error(404, 'Produk tidak tersedia.');
        if (!Object.values(customerFormats).includes(product.customer_format)) throw error(422, 'Format tujuan belum didukung.');
        const id = randomUUID();
        let customerNo;
        try { customerNo = buildCustomerNo(product.customer_format, input); } catch (err) { throw error(400, err.message); }
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
