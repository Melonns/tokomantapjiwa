import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { paymentSignature, validateCheckout, verifiedPayment, customerNo as buildCustomerNo } from './core.mjs';
import { fetchSupplierCatalog } from './catalog.mjs';
import { checkableGame, checkReady, checkRequest, checkResult, maxChecksPerDay } from './check.mjs';
import { suggestPrice, voucherDiscount } from '../src/pricing.mjs';
import { mailReady, orderEmail, sendOrderEmail } from './mail.mjs';
import { clientIp, createRateLimiter } from './ratelimit.mjs';
import { refreshGameIcons } from './game-icons.mjs';

const idPattern = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
// ponytail: Format tujuan per brand. Brand di luar daftar ini hanya dapat disimpan sebagai draf harga
// sampai format tujuannya dipastikan. Telco/e-money/PLN/TV = input polos (nomor tujuan apa adanya).
// Genshin/Honkai memakai uid_server (UID|server; token server mengikuti petunjuk seller "[UID]|[Server]"); Valorant memakai Riot ID bertag apa adanya (riot).
const customerFormats = {
  'MOBILE LEGENDS': 'ml_concat',
  'FREE FIRE': 'plain',
  'GENSHIN IMPACT': 'uid_server', 'HONKAI STAR RAIL': 'uid_server',
  'VALORANT': 'riot',
  'SPEED DRIFTERS': 'plain', 'PERTAMINA GAS': 'plain',
  'TELKOMSEL': 'plain', 'INDOSAT': 'plain', 'XL': 'plain', 'AXIS': 'plain', 'TRI': 'plain', 'SMARTFREN': 'plain', 'BY.U': 'plain',
  'DANA': 'plain', 'GO PAY': 'plain', 'OVO': 'plain', 'SHOPEE PAY': 'plain',
  'PLN': 'plain', 'K-VISION DAN GOL': 'plain',
};
const formatFor = game => customerFormats[String(game || '').toUpperCase()] || null;
const error = (status, message) => Object.assign(new Error(message), { status });
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const ready = env => Boolean(env.DATABASE_URL && env.MIDTRANS_SERVER_KEY && env.DIGIFLAZZ_USERNAME && env.DIGIFLAZZ_API_KEY && ((env.MIDTRANS_ENV === 'sandbox' && env.DIGIFLAZZ_TESTING === 'true') || (env.MIDTRANS_ENV === 'production' && env.DIGIFLAZZ_TESTING === 'false')));
const checkoutReady = env => env.CHECKOUT_ENABLED === 'true' && ready(env);
// ponytail: Kanal pembayaran spesifik memakai Core API /v2/charge. Halaman invoice ini sendiri yang menampilkan QR/VA, bukan pengalihan ke Snap.
// Semua id di bawah sudah diverifikasi 200 di /v2/charge sandbox; samakan dengan PAYMENT_METHODS di src/App.jsx dan kanal aktif di dashboard Midtrans.
// ponytail: fee VA/Mandiri flat (Rp 4.000 + PPN) cuma masuk akal di pesanan besar - kanal ini ditolak di bawah ambang.
const VA_MIN_ORDER = 100000;
const VA_METHOD_IDS = new Set(['bca_va', 'bni_va', 'bri_va', 'permata_va', 'mandiri_bill']);
// ponytail: QRIS dapat dibuat lewat beberapa acquirer. Urutannya diambil dari MIDTRANS_QRIS_ACQUIRERS (dipisah koma);
// nama lama MIDTRANS_QRIS_ACQUIRER tetap dihormati. Bila kanal pertama sedang gangguan, kanal berikutnya dicoba
// memakai order_id yang sama, dan Midtrans menolak order_id ganda sehingga tidak mungkin ada tagihan dobel.
const qrisAcquirers = (env) => {
  const daftar = String(env.MIDTRANS_QRIS_ACQUIRERS || env.MIDTRANS_QRIS_ACQUIRER || 'airpay shopee,gopay')
    .split(',').map((item) => item.trim()).filter(Boolean);
  const unik = [...new Set(daftar)];
  return unik.length ? unik : ['airpay shopee'];
};
const PAYMENT_METHODS = {
  qris: (id, storeUrl, env) => ({ payment_type: 'qris', qris: { acquirer: qrisAcquirers(env)[0] } }),
  bca_va: () => ({ payment_type: 'bank_transfer', bank: 'bca' }),
  bni_va: () => ({ payment_type: 'bank_transfer', bank: 'bni' }),
  bri_va: () => ({ payment_type: 'bank_transfer', bank: 'bri' }),
  permata_va: () => ({ payment_type: 'bank_transfer', bank: 'permata' }),
  mandiri_bill: () => ({ payment_type: 'echannel', echannel: { bill_info1: 'Pembayaran pesanan', bill_info2: 'Melonbyte' } }),
  gopay: (id, storeUrl) => ({ payment_type: 'gopay', gopay: { enable_callback: true, callback_url: `${storeUrl}/#struk/${id}` } }),
  shopeepay: (id, storeUrl) => ({ payment_type: 'shopeepay', shopeepay: { callback_url: `${storeUrl}/#struk/${id}` } }),
};
// ponytail: satu daftar kolom dipakai pembacaan struk dan rekonsiliasi supaya bentuk respons selalu sama.
const PAYMENT_DETAIL_COLUMNS = 'payment_channel AS "paymentChannel", payment_detail AS "paymentDetail", payment_expires_at AS "paymentExpiresAt", redirect_url AS "redirectUrl", created_at AS "createdAt"';

// ponytail: simpan hanya field yang dipakai halaman invoice; URL dari Midtrans divalidasi supaya tidak ada tautan asing yang dirender.
function paymentDetail(method, charge) {
  const actionUrl = (name) => (Array.isArray(charge?.actions) ? charge.actions.find((item) => item?.name === name) : null)?.url;
  const safeUrl = (value, schemes) => (typeof value === 'string' && schemes.some((scheme) => value.startsWith(scheme)) ? value : undefined);
  if (method === 'qris') {
    const qrUrl = safeUrl(actionUrl('generate-qr-code'), ['https://api.']);
    return qrUrl ? { qrUrl } : null;
  }
  if (method === 'gopay' || method === 'shopeepay') {
    const qrUrl = safeUrl(actionUrl('generate-qr-code'), ['https://api.']);
    const deeplink = safeUrl(actionUrl('deeplink-redirect'), ['https://', 'gojek://', 'shopee://']);
    return qrUrl || deeplink ? { ...(qrUrl ? { qrUrl } : {}), ...(deeplink ? { deeplink } : {}) } : null;
  }
  if (method === 'mandiri_bill') {
    return typeof charge?.bill_key === 'string' && typeof charge?.biller_code === 'string' ? { billerCode: charge.biller_code, billKey: charge.bill_key } : null;
  }
  const va = Array.isArray(charge?.va_numbers) ? charge.va_numbers.find((item) => typeof item?.va_number === 'string') : null;
  const vaNumber = va?.va_number || (typeof charge?.permata_va_number === 'string' ? charge.permata_va_number : null);
  return vaNumber ? { bank: String(va?.bank || method.replace(/_va$/, '')), vaNumber } : null;
}

// ponytail: expiry_time ditulis di jam Jakarta tanpa zona; parse sebagai +07:00 supaya hitung mundur invoice benar.
function expiryDate(raw) {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw.replace(' ', 'T')}+07:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

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
  if (!response.ok) {
    const failure = error(502, 'Layanan eksternal gagal.');
    failure.upstreamStatus = response.status;
    throw failure;
  }
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
  if (!user.email_confirmed_at && !user.phone_confirmed_at) throw error(403, 'Verifikasi email atau nomor HP akun Anda terlebih dahulu.');
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
    const sn = typeof data?.sn === 'string' && data.sn.trim() ? data.sn.trim().slice(0, 120) : null;
    const note = typeof data?.message === 'string' && data.message.trim() ? data.message.trim().slice(0, 200) : null;
    const { rows: done } = await pool.query("UPDATE orders SET status = $2, fulfillment_sn = COALESCE($3, fulfillment_sn), fulfillment_note = COALESCE($4, fulfillment_note), updated_at = now() WHERE id = $1 AND status = 'fulfillment_pending' RETURNING id, status", [row.id, status, sn, note]);
    if (done[0]?.status === 'fulfilled') notifyOrder(pool, fetchImpl, env, 'fulfilled', row.id);
    else if (done[0]?.status === 'fulfillment_failed') notifyOrder(pool, fetchImpl, env, 'failed', row.id);
  } catch (err) {
    console.error('Digiflazz request unresolved; reconcile ref_id manually:', row.id, err?.upstreamStatus ? `HTTP ${err.upstreamStatus}` : '', err.message);
    await pool.query("UPDATE orders SET status = 'manual_review', updated_at = now() WHERE id = $1 AND status = 'fulfillment_pending'", [row.id]);
  }
}

// ponytail: Transisi "sudah dibayar" digunakan oleh notifikasi webhook dan rekonsiliasi tarik-status; claim atomik mencegah submit Digi ganda.
async function claimAndFulfill(pool, fetchImpl, env, orderId) {
  // Atomic claim across processes; never auto-resubmit after a network timeout/crash.
  const claim = await pool.query(`UPDATE orders SET status = 'fulfillment_pending', digiflazz_claimed_at = now(), updated_at = now()
    WHERE id = $1 AND status = 'payment_paid' AND digiflazz_claimed_at IS NULL
    RETURNING id, digi_sku, customer_no, price`, [orderId]);
  if (!claim.rows[0]) return false;
  notifyOrder(pool, fetchImpl, env, 'paid', orderId);
  await submitDigi(pool, fetchImpl, env, claim.rows[0]);
  return true;
}

// ponytail: aturan voucher dijaga di server (kuota, masa berlaku, batas per akun, khusus pembeli baru) - browser cuma menampilkan hasil hitungannya.
async function voucherFor(pool, code, ownerId, total) {
  if (!code) return null;
  const { rows } = await pool.query('SELECT code, label, kind, value, min_order, max_discount, quota, used, per_user, new_buyers_only, active, ends_at FROM vouchers WHERE code = $1', [code]);
  const voucher = rows[0];
  if (!voucher || !voucher.active) return { error: 'Kode voucher tidak dikenal atau sudah tidak aktif.' };
  if (voucher.ends_at && new Date(voucher.ends_at).getTime() < Date.now()) return { error: 'Voucher sudah kedaluwarsa.' };
  if (voucher.quota != null && voucher.used >= voucher.quota) return { error: 'Kuota voucher sudah habis.' };
  if (total < voucher.min_order) return { error: `Voucher berlaku mulai belanja Rp ${new Intl.NumberFormat('id-ID').format(voucher.min_order)}.` };
  const { rows: mine } = await pool.query('SELECT count(*)::int AS count FROM voucher_redemptions WHERE code = $1 AND owner_id = $2', [voucher.code, ownerId]);
  if (mine[0].count >= voucher.per_user) return { error: 'Anda sudah memakai voucher ini.' };
  if (voucher.new_buyers_only) {
    const { rows: buys } = await pool.query("SELECT count(*)::int AS count FROM orders WHERE owner_id = $1 AND status IN ('payment_paid','fulfillment_pending','fulfilled')", [ownerId]);
    if (buys[0].count > 0) return { error: 'Voucher ini khusus pembeli baru.' };
  }
  const discount = voucherDiscount(voucher, total);
  if (discount <= 0) return { error: 'Voucher tidak dapat digunakan untuk pesanan ini.' };
  return { voucher, discount };
}
async function redeemVoucher(pool, voucher, orderId, ownerId, discount) {
  const { rows } = await pool.query('UPDATE vouchers SET used = used + 1 WHERE code = $1 AND active = true AND (quota IS NULL OR used < quota) RETURNING used', [voucher.code]);
  if (!rows[0]) return false;
  await pool.query('INSERT INTO voucher_redemptions (order_id, code, owner_id, amount) VALUES ($1,$2,$3,$4) ON CONFLICT (order_id) DO NOTHING', [orderId, voucher.code, ownerId, discount]);
  return true;
}
// ponytail: pesanan yang gagal atau kedaluwarsa mengembalikan kuota agar pembeli tidak kehilangan vouchernya karena kesalahan di sisi kami.
async function releaseVoucher(pool, orderId) {
  const { rows } = await pool.query('DELETE FROM voucher_redemptions WHERE order_id = $1 RETURNING code', [orderId]);
  if (!rows[0]) return false;
  await pool.query('UPDATE vouchers SET used = GREATEST(used - 1, 0) WHERE code = $1', [rows[0].code]);
  return true;
}

async function applyPaid(pool, fetchImpl, env, orderId, grossAmount) {
  const paid = await pool.query(`UPDATE orders SET status = CASE WHEN status = 'pending' THEN 'payment_paid' ELSE status END, updated_at = now()
    WHERE id = $1 AND price = $2 AND status NOT IN ('payment_failed') RETURNING id, price`, [orderId, grossAmount]);
  if (!paid.rows[0]) return false;
  await claimAndFulfill(pool, fetchImpl, env, orderId);
  return true;
}

// ponytail: pembayaran yang kedaluwarsa, ditolak, atau dibatalkan menutup pesanan dan mengembalikan kuota voucher; satu tempat untuk webhook dan rekonsiliasi.
async function failPayment(pool, orderId, grossAmount) {
  const { rows } = await pool.query("UPDATE orders SET status = 'payment_failed', updated_at = now() WHERE id = $1 AND price = $2 AND status = 'pending' RETURNING voucher_code", [orderId, grossAmount]);
  if (!rows[0]) return false;
  if (rows[0].voucher_code) await releaseVoucher(pool, orderId);
  return true;
}

// ponytail: Jaring pengaman saat notifikasi Midtrans tak sampai (tunnel mati, server sempat down): status ditarik langsung dari Midtrans
// tiap kali struk pesanan pending dibuka/di-poll. Best-effort: error apa pun dikembalikan sebagai status tersimpan agar struk tetap tampil.
export async function reconcilePending(pool, fetchImpl, env, order) {
  if (!['pending', 'payment_paid', 'fulfillment_pending'].includes(order.status) || !ready(env)) return order;
  try {
    if (order.status === 'pending') {
      const status = await externalJson(fetchImpl, `https://api.${env.MIDTRANS_ENV === 'production' ? '' : 'sandbox.'}midtrans.com/v2/${order.id}/status`, {
        method: 'GET', headers: { accept: 'application/json', authorization: `Basic ${Buffer.from(env.MIDTRANS_SERVER_KEY + ':').toString('base64')}` }
      });
      const notice = String(status?.transaction_status || '');
      if (Number(status?.gross_amount) !== order.price) return order;
      if (['settlement', 'capture'].includes(notice)) await applyPaid(pool, fetchImpl, env, order.id, Number(status.gross_amount));
      else if (['expire', 'deny', 'cancel'].includes(notice)) await failPayment(pool, order.id, Number(status.gross_amount));
      else return order;
      console.error('[reconcile] midtrans:', order.id, notice, 'diterapkan');
    } else if (order.status === 'payment_paid') {
      if (!await claimAndFulfill(pool, fetchImpl, env, order.id)) return order; // sudah diklaim; jangan kirim ulang
      console.error('[reconcile] fulfillment:', order.id, 'diklaim ulang');
    } else {
      // ponytail: ref_id yang sama = cek status, bukan transaksi baru; dibatasi sekali per menit supaya tidak membanjiri Digiflazz.
      const { rows } = await pool.query(`UPDATE orders SET digi_checked_at = now(), updated_at = now()
        WHERE id = $1 AND status = 'fulfillment_pending' AND digiflazz_claimed_at < now() - interval '1 minute'
          AND (digi_checked_at IS NULL OR digi_checked_at < now() - interval '1 minute')
        RETURNING id, digi_sku, customer_no, price`, [order.id]);
      if (!rows[0]) return order;
      await submitDigi(pool, fetchImpl, env, rows[0]);
      console.error('[reconcile] fulfillment:', order.id, 'diperiksa ulang ke Digiflazz');
    }
    const { rows } = await pool.query(`SELECT id, status, product_name AS "productName", price, user_id AS "userId", zone_id AS "zoneId", fulfillment_sn AS "sn", ${PAYMENT_DETAIL_COLUMNS} FROM orders WHERE id = $1`, [order.id]);
    return rows[0] || order;
  } catch (err) {
    console.error('[reconcile] midtrans gagal:', order.id, err?.message || String(err));
    return order;
  }
}

// ponytail: pull Digiflazz hanya saat sinkron diminta; INSERT + DELETE memakai tanda synced_at yang sama supaya pembacaan konsisten.
// ponytail: harga produk mode 'auto' dihitung ulang dari modal + aturan kategori tiap katalog supplier disinkronkan,
// sehingga admin tidak perlu mengetik harga satu per satu; baris 'manual' tidak pernah disentuh.
async function repriceAutoProducts(pool) {
  const { rows } = await pool.query(`SELECT p.id, p.price, s.category, s.price AS cost FROM products p JOIN supplier_products s ON s.sku = p.digi_sku WHERE p.price_mode = 'auto'`);
  const changes = [];
  for (const row of rows) {
    const next = suggestPrice(Number(row.cost), row.category);
    if (next == null || next === Number(row.price)) continue;
    changes.push({ sku: row.id, from: Number(row.price), to: next });
  }
  for (const change of changes) await pool.query('UPDATE products SET price = $2 WHERE id = $1', [change.sku, change.to]);
  return changes;
}

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
    if (err?.rc === '83') throw error(502, 'Digiflazz membatasi pemeriksaan katalog (beberapa kali dalam beberapa menit). Coba lagi nanti.');
    throw error(502, 'Katalog supplier belum dapat dimuat. Coba lagi nanti.');
  }
}

// ponytail: webhook Digiflazz ditandatangani HMAC-SHA1 atas body mentah, sehingga body dibaca sebagai teks terlebih dahulu, bukan JSON.
async function readRaw(req, limit = 16384) {
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw error(415, 'Gunakan JSON.');
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > limit) throw error(413, 'Data terlalu besar.');
  }
  return text;
}

// ponytail: status ketika dana sudah masuk tetapi item belum terkirim; satu-satunya status yang boleh direfund.
const REFUNDABLE_STATUSES = ['payment_paid', 'fulfillment_pending', 'fulfillment_failed', 'manual_review'];
const refundableSql = `(${REFUNDABLE_STATUSES.map((status) => `'${status}'`).join(', ')})`;

// ponytail: notifikasi email best-effort - dikirim setelah perubahan status tersimpan; gagal kirim tidak pernah menahan atau menggagalkan pesanan.
function notifyOrder(pool, fetchImpl, env, event, orderId) {
  if (!mailReady(env)) return;
  void (async () => {
    try {
      const { rows } = await pool.query(`SELECT o.id, o.status, o.product_name AS "productName", o.price, o.discount, o.voucher_code AS "voucherCode", o.user_id AS "userId", o.zone_id AS "zoneId", o.fulfillment_sn AS "sn", o.refund_note AS "refundNote", COALESCE(o.contact_email, (SELECT email FROM auth.users WHERE id = o.owner_id)) AS email FROM orders o WHERE o.id = $1`, [orderId]);
      const order = rows[0];
      const message = order?.email ? orderEmail(event, order, env) : null;
      if (!message) return;
      const result = await sendOrderEmail(fetchImpl, env, order.email, message);
      if (!result.ok) console.error('[mail]', event, orderId, result.error || 'gagal terkirim');
    } catch (err) {
      console.error('[mail]', event, orderId, err?.message || String(err));
    }
  })();
}

// ponytail: nomor WhatsApp support opsional - kosong berarti tombol WA tidak ditampilkan, email tetap ada.
function whatsappLink(input) {
  const digits = String(input || '').replace(/\D/g, '');
  if (!digits) return null;
  const normalized = digits.startsWith('0') ? `62${digits.slice(1)}` : digits.startsWith('62') ? digits : `62${digits}`;
  return normalized.length >= 9 && normalized.length <= 15 ? `https://wa.me/${normalized}` : null;
}

export function createHandler({ pool, fetchImpl = fetch, env = process.env }) {
  // ponytail: Pembatas percobaan per IP untuk endpoint yang mudah disalahgunakan. Batas dapat diubah lewat env.
  const limit = (name, fallback, windowMs) => createRateLimiter({ windowMs, max: Number(env[`RATE_LIMIT_${name}_MAX`]) > 0 ? Number(env[`RATE_LIMIT_${name}_MAX`]) : fallback });
  const limits = {
    login: limit('LOGIN', 10, 15 * 60 * 1000),
    checkout: limit('CHECKOUT', 20, 10 * 60 * 1000),
    checkAccount: limit('CHECKACCOUNT', 30, 10 * 60 * 1000),
    voucher: limit('VOUCHER', 30, 10 * 60 * 1000),
    deletion: limit('DELETION', 3, 60 * 60 * 1000),
  };
  const limitsOff = env.RATE_LIMIT_DISABLED === '1';
  return async (req, res) => {
    const guard = (name) => {
      if (limitsOff) return;
      const result = limits[name].check(`${name}:${clientIp(req)}`);
      if (result.allowed) return;
      res.setHeader('Retry-After', String(result.retryAfterSec));
      throw error(429, 'Terlalu banyak percobaan dari jaringan ini. Tunggu sebentar, lalu coba lagi.');
    };
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      // ponytail: titik kesehatan untuk pemantauan uptime, memastikan API dan basis data benar-benar hidup.
      if ((req.method === 'GET' || req.method === 'HEAD') && path === '/api/health') {
        try {
          await pool.query('SELECT 1');
          return send(res, 200, { ok: true, db: 'ok', time: new Date().toISOString() });
        } catch {
          return send(res, 503, { ok: false, db: 'error' });
        }
      }
      if (req.method === 'GET' && path === '/api/products') {
        const { rows } = await pool.query('SELECT p.id, p.name, p.game, p.price, p.customer_format AS "format", p.gangguan, COALESCE(s.category, \'\') AS category FROM products p LEFT JOIN supplier_products s ON s.sku = p.id WHERE p.enabled = true ORDER BY p.game, p.id');
        return send(res, 200, { products: rows.map(({ gangguan, ...p }) => ({ ...p, id: String(p.id), category: String(p.category || ''), checkable: Boolean(checkableGame(p.game)), ...(gangguan === true ? { gangguan: true } : {}) })), checkoutAvailable: checkoutReady(env), checkAvailable: checkReady(env) });
      }
      // ponytail: kontak dukungan dibaca dari env agar dapat diganti tanpa menyentuh kode.
      if (req.method === 'GET' && path === '/api/contact') {
        const whatsapp = whatsappLink(env.SUPPORT_WHATSAPP);
        const email = String(env.SUPPORT_EMAIL || 'halo@melonbyte.id').trim();
        return send(res, 200, { email, whatsapp, whatsappLabel: whatsapp ? `+${whatsapp.split('/').pop()}` : null });
      }
      if (req.method === 'GET' && path === '/api/me') {
        const ownerId = await authenticatedOwner(req, fetchImpl, env);
        const { rows } = await pool.query('SELECT user_id FROM admin_users WHERE user_id = $1', [ownerId]);
        return send(res, 200, { role: rows[0] ? 'admin' : 'buyer' });
      }
      if (req.method === 'GET' && path === '/api/admin/orders') {
        await authenticatedAdmin(req, pool, fetchImpl, env);
        const { rows } = await pool.query('SELECT id, status, product_name AS "productName", price, owner_id AS "ownerId", created_at AS "createdAt", contact_phone AS "contactPhone", COALESCE(contact_email, (SELECT email FROM auth.users WHERE id = orders.owner_id)) AS "contactEmail" FROM orders ORDER BY created_at DESC, id DESC LIMIT 100');
        return send(res, 200, { orders: rows });
      }
      if (req.method === 'GET' && path === '/api/admin/supplier-products') {
        await authenticatedAdmin(req, pool, fetchImpl, env);
        const { rows: catalogRows } = await pool.query(`SELECT sku, name, game, category, variant, price, synced_at FROM supplier_products WHERE ${supplierRowWhere}`);
        const catalog = catalogRows.map(row => ({ id: row.sku, name: row.name, game: row.game, category: row.category, variant: row.variant, price: Number(row.price) }));
        const syncedAt = catalogRows.length ? new Date(Math.max(...catalogRows.map(row => new Date(row.synced_at).getTime()))) : null;
        const { rows } = await pool.query('SELECT id, name, game, price, enabled, price_mode FROM products');
        const saved = new Map(rows.map(row => [row.id, row]));
        const q = (new URL(req.url, 'http://localhost').searchParams.get('q') || '').trim().toLowerCase();
        const match = (name, game, sku) => !q || name.toLowerCase().includes(q) || game.toLowerCase().includes(q) || sku.toLowerCase().includes(q);
        const products = catalog.filter(item => match(item.name, item.game, item.id)).map(item => ({
          sku: item.id, name: item.name, game: item.game, category: item.category, variant: item.variant, cost: item.price,
          supported: Boolean(formatFor(item.game)),
          price: saved.get(item.id)?.price ?? null,
          enabled: saved.get(item.id)?.enabled ?? false,
          priceMode: saved.get(item.id)?.price_mode === 'manual' ? 'manual' : 'auto',
        }));
        const catalogIds = new Set(catalog.map(item => item.id));
        const missing = rows.filter(row => !catalogIds.has(row.id) && match(row.name, row.game, row.id)).map(row => ({
          sku: row.id, name: row.name, game: row.game, category: null, variant: null, cost: null,
          supported: Boolean(formatFor(row.game)), missing: true, price: row.price, enabled: row.enabled,
          priceMode: row.price_mode === 'manual' ? 'manual' : 'auto',
        }));
        return send(res, 200, { products: products.concat(missing), catalogFetchedAt: syncedAt ? syncedAt.toISOString() : null, catalogStale: !syncedAt || Date.now() - syncedAt.getTime() > 10 * 60 * 1000 });
      }
      if (req.method === 'POST' && path === '/api/admin/supplier-products/sync') {
        await authenticatedAdmin(req, pool, fetchImpl, env);
        const { items, syncedAt } = await saveSupplierCatalog(pool, fetchImpl, env);
        const repriced = await repriceAutoProducts(pool);
        return send(res, 200, { synced: items.length, catalogFetchedAt: syncedAt.toISOString(), autoPriced: repriced.length, priceChanges: repriced.slice(0, 5) });
      }
      // ponytail: ikon game diambil ulang dari App Store agar tidak ketinggalan saat ada kolaborasi atau ulang tahun.
      if (req.method === 'POST' && path === '/api/admin/game-icons/refresh') {
        await authenticatedAdmin(req, pool, fetchImpl, env);
        const icons = await refreshGameIcons({ fetchImpl, folders: ['public/logo/game', 'dist/logo/game'] });
        return send(res, 200, { ok: icons.every((item) => item.ok), icons });
      }
      if (req.method === 'PUT' && path.startsWith('/api/admin/products/')) {
        const sku = path.slice('/api/admin/products/'.length);
        await authenticatedAdmin(req, pool, fetchImpl, env);
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(sku)) throw error(404, 'Produk tidak ditemukan.');
        let body;
        try { body = await readJson(req); } catch (err) { throw err.status ? err : error(400, err.message); }
        const { price, enabled, priceMode } = body ?? {};
        if (!Number.isSafeInteger(price) || price < 1 || price > 100000000) throw error(400, 'Harga jual tidak valid.');
        if (typeof enabled !== 'boolean') throw error(400, 'Status produk tidak valid.');
        if (priceMode != null && priceMode !== 'auto' && priceMode !== 'manual') throw error(400, 'Mode harga tidak valid.');
        const mode = priceMode === 'manual' ? 'manual' : 'auto';
        // ponytail: katalog dibaca dari tabel sinkron; SKU baru yang belum tersinkron tetap ditolak sampai sinkron berikutnya.
        const { rows: supplierRows } = await pool.query(`SELECT name, game, category, variant, price FROM supplier_products WHERE sku = $1 AND ${supplierRowWhere}`, [sku]);
        const item = supplierRows[0];
        if (!item && enabled) throw error(409, 'SKU tidak ada di katalog supplier aktif.');
        if (item && enabled && !formatFor(item.game)) throw error(422, 'Format tujuan produk ini belum didukung checkout.');
        const { rows } = item
          ? await pool.query(`INSERT INTO products (id, name, game, price, digi_sku, customer_format, enabled, price_mode) VALUES ($1, $2, $3, $4, $1, $6, $5, $7)
            ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, game = EXCLUDED.game, price = EXCLUDED.price, digi_sku = EXCLUDED.digi_sku, enabled = EXCLUDED.enabled, price_mode = EXCLUDED.price_mode
            RETURNING id, name, game, price, enabled, price_mode, gangguan`, [sku, item.name, item.game, price, enabled, formatFor(item.game), mode])
          : await pool.query('UPDATE products SET price = $2, enabled = false, price_mode = $3 WHERE id = $1 RETURNING id, name, game, price, enabled, price_mode, gangguan', [sku, price, mode]);
        if (!rows[0]) throw error(404, 'Produk tidak ditemukan.');
        return send(res, 200, { product: {
          sku: rows[0].id, name: rows[0].name, game: rows[0].game, category: item?.category ?? null, variant: item?.variant ?? null, cost: item?.price ?? null,
          supported: Boolean(formatFor(item ? item.game : rows[0].game)),
          missing: !item, price: rows[0].price, enabled: rows[0].enabled, priceMode: rows[0].price_mode === 'manual' ? 'manual' : 'auto', ...(rows[0].gangguan === true ? { gangguan: true } : {}),
        } });
      }
      if (path === '/api/admin/vouchers' || path.startsWith('/api/admin/vouchers/')) {
        await authenticatedAdmin(req, pool, fetchImpl, env);
        const list = async () => {
          const { rows } = await pool.query('SELECT code, label, kind, value, min_order, max_discount, quota, used, per_user, new_buyers_only, active, ends_at FROM vouchers ORDER BY created_at DESC, code ASC');
          return rows.map(row => ({ code: row.code, label: row.label, kind: row.kind, value: row.value, minOrder: row.min_order, maxDiscount: row.max_discount, quota: row.quota, used: row.used, perUser: row.per_user, newBuyersOnly: row.new_buyers_only, active: row.active, endsAt: row.ends_at ? new Date(row.ends_at).toISOString() : null }));
        };
        if (req.method === 'GET' && path === '/api/admin/vouchers') return send(res, 200, { vouchers: await list() });
        if (req.method === 'POST' && path === '/api/admin/vouchers') {
          let body;
          try { body = await readJson(req); } catch (err) { throw err.status ? err : error(400, err.message); }
          const code = String(body?.code || '').trim().toUpperCase();
          const kind = body?.kind === 'percent' ? 'percent' : 'fixed';
          const value = Number(body?.value);
          const minOrder = Number(body?.minOrder ?? 0);
          const maxDiscount = body?.maxDiscount == null ? null : Number(body.maxDiscount);
          const quota = body?.quota == null || body?.quota === '' ? null : Number(body.quota);
          const perUser = Number(body?.perUser ?? 1);
          const days = Number(body?.days ?? 30);
          const cap = kind === 'percent' ? 90 : 1000000;
          if (!/^[A-Z0-9_-]{3,24}$/.test(code)) throw error(400, 'Kode voucher 3-24 karakter, hanya huruf, angka, tanda hubung, dan garis bawah.');
          if (!Number.isSafeInteger(value) || value < 1 || value > cap) throw error(400, kind === 'percent' ? 'Persentase potongan harus 1-90.' : 'Nominal potongan tidak valid.');
          if (!Number.isSafeInteger(minOrder) || minOrder < 0 || minOrder > 100000000) throw error(400, 'Minimum belanja tidak valid.');
          if (maxDiscount != null && (!Number.isSafeInteger(maxDiscount) || maxDiscount < 1)) throw error(400, 'Plafon potongan tidak valid.');
          if (quota != null && (!Number.isSafeInteger(quota) || quota < 1 || quota > 100000)) throw error(400, 'Kuota tidak valid.');
          if (!Number.isSafeInteger(perUser) || perUser < 1 || perUser > 100) throw error(400, 'Batas per akun tidak valid.');
          if (!Number.isSafeInteger(days) || days < 1 || days > 365) throw error(400, 'Masa berlaku harus 1-365 hari.');
          const { rows } = await pool.query(`INSERT INTO vouchers (code, label, kind, value, min_order, max_discount, quota, per_user, new_buyers_only, active, ends_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true, now() + ($10 || ' days')::interval)
            ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, kind = EXCLUDED.kind, value = EXCLUDED.value, min_order = EXCLUDED.min_order,
              max_discount = EXCLUDED.max_discount, quota = EXCLUDED.quota, per_user = EXCLUDED.per_user, new_buyers_only = EXCLUDED.new_buyers_only,
              active = true, ends_at = EXCLUDED.ends_at RETURNING code`, [code, String(body?.label || '').slice(0, 80), kind, value, minOrder, maxDiscount, quota, perUser, body?.newBuyersOnly === true, String(days)]);
          return send(res, 201, { code: rows[0].code, vouchers: await list() });
        }
        if (req.method === 'PATCH' && path.startsWith('/api/admin/vouchers/')) {
          const code = decodeURIComponent(path.slice('/api/admin/vouchers/'.length)).toUpperCase();
          let body;
          try { body = await readJson(req); } catch (err) { throw err.status ? err : error(400, err.message); }
          if (typeof body?.active !== 'boolean') throw error(400, 'Status voucher tidak valid.');
          const { rows } = await pool.query('UPDATE vouchers SET active = $2 WHERE code = $1 RETURNING code', [code, body.active]);
          if (!rows[0]) throw error(404, 'Voucher tidak ditemukan.');
          return send(res, 200, { code: rows[0].code, vouchers: await list() });
        }
        throw error(404, 'Voucher tidak ditemukan.');
      }
      // ponytail: pratinjau voucher di checkout. Hitungannya sama dengan yang dipakai saat pesanan dibuat, jadi angka di layar = angka yang ditagih.
      if (req.method === 'POST' && path === '/api/voucher') {
        guard('voucher');
        const ownerId = await authenticatedOwner(req, fetchImpl, env);
        let body;
        try { body = await readJson(req); } catch (err) { throw err.status ? err : error(400, err.message); }
        const code = String(body?.code || '').trim().toUpperCase();
        if (!/^[A-Z0-9_-]{3,24}$/.test(code)) throw error(400, 'Kode voucher tidak valid.');
        const { rows } = await pool.query('SELECT id, name, price, gangguan FROM products WHERE id = $1 AND enabled = true', [body?.productId]);
        if (!rows[0]) throw error(404, 'Produk tidak tersedia.');
        if (rows[0].gangguan === true) throw error(409, 'Produk ini sedang mengalami gangguan. Pilih nominal lain atau coba kembali beberapa saat lagi.');
        const picked = await voucherFor(pool, code, ownerId, rows[0].price);
        if (!picked) throw error(400, 'Kode voucher tidak valid.');
        if (picked.error) throw error(400, picked.error);
        return send(res, 200, { voucher: { code: picked.voucher.code, label: picked.voucher.label, discount: picked.discount, total: rows[0].price - picked.discount } });
      }
      if (req.method === 'POST' && path === '/api/checkout') {
        guard('checkout');
        const ownerId = await authenticatedOwner(req, fetchImpl, env);
        let input;
        try { input = validateCheckout(await readJson(req)); } catch (err) { throw err.status ? err : error(400, err.message); }
        if (!checkoutReady(env)) throw error(503, 'Checkout belum siap.');
        const { rows } = await pool.query('SELECT id, name, price, digi_sku, customer_format, gangguan FROM products WHERE id = $1 AND enabled = true', [input.productId]);
        const product = rows[0];
        if (!product) throw error(404, 'Produk tidak tersedia.');
        if (product.gangguan === true) throw error(409, 'Produk ini sedang mengalami gangguan. Pilih nominal lain atau coba kembali beberapa saat lagi.');
        if (!Object.values(customerFormats).includes(product.customer_format)) throw error(422, 'Format tujuan belum didukung.');
        const picked = input.voucherCode ? await voucherFor(pool, input.voucherCode, ownerId, product.price) : null;
        if (picked?.error) throw error(400, picked.error);
        const discount = picked?.discount ?? 0;
        // ponytail: price = jumlah yang benar-benar ditagih (setelah potongan) karena webhook mencocokkan gross_amount dengan price.
        const amount = product.price - discount;
        const methodId = input.paymentMethod || 'qris';
        const method = PAYMENT_METHODS[methodId];
        if (!method) throw error(400, 'Metode pembayaran tidak dikenal.');
        if (VA_METHOD_IDS.has(methodId) && amount < VA_MIN_ORDER) throw error(400, `Virtual Account & Mandiri Bill tersedia untuk pesanan mulai Rp ${new Intl.NumberFormat('id-ID').format(VA_MIN_ORDER)}.`);
        const id = randomUUID();
        let customerNo;
        try { customerNo = buildCustomerNo(product.customer_format, input); } catch (err) { throw error(400, err.message); }
        await pool.query('INSERT INTO orders (id, product_id, product_name, price, digi_sku, customer_no, user_id, zone_id, owner_id, discount, voucher_code, contact_email, contact_phone) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)', [id, product.id, product.name, amount, product.digi_sku, customerNo, input.userId, input.zoneId, ownerId, discount, picked?.voucher.code ?? null, input.contactEmail ?? null, input.contactPhone ?? null]);
        if (picked && !await redeemVoucher(pool, picked.voucher, id, ownerId, discount)) throw error(400, 'Kuota voucher baru saja habis. Coba kembali tanpa voucher.');
        const storeUrl = (env.STORE_URL || req.headers.origin || 'http://localhost:5173').replace(/\/+$/, '');
        // ponytail: Core API charge (bukan Snap) supaya QR/VA tampil di halaman invoice sendiri. Tolakan tegas (4xx) menutup pesanan;
        // kegagalan ambigu (5xx/timeout) dibiarkan pending untuk rekonsiliasi dan order_id tidak pernah digunakan ulang.

        let charge;
        let chargeError;
        const kandidat = methodId === 'qris'
          ? qrisAcquirers(env).map((acquirer) => ({ payment_type: 'qris', qris: { acquirer } }))
          : [method(id, storeUrl, env)];
        // ponytail: coba kanal berurutan dan berhenti pada kanal pertama yang berhasil. order_id tidak berubah,
        // jadi percobaan ulang tidak dapat membuat tagihan dobel. Kegagalan ambigu (tanpa status atau 5xx) dibiarkan
        // untuk rekonsiliasi, sedangkan 406 berarti kanal tersebut memang tidak tersedia.
        for (const [urutan, kanal] of kandidat.entries()) {
          try {
            charge = await externalJson(fetchImpl, `https://api.${env.MIDTRANS_ENV === 'production' ? '' : 'sandbox.'}midtrans.com/v2/charge`, {
              method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Basic ${Buffer.from(env.MIDTRANS_SERVER_KEY + ':').toString('base64')}` },
              body: JSON.stringify({ ...kanal, transaction_details: { order_id: id, gross_amount: amount } })
            });
            if (urutan > 0) console.warn('[checkout] QRIS dialihkan ke acquirer', kanal.qris.acquirer);
            break;
          } catch (err) {
            chargeError = err;
            const status = Number(err?.upstreamStatus);
            const layakUlang = urutan < kandidat.length - 1 && (!status || status >= 500 || status === 406);
            console.error('[checkout] charge gagal:', kanal?.qris?.acquirer ? `acquirer ${kanal.qris.acquirer}` : '', status ? `HTTP ${status}` : '', err?.message || String(err));
            if (!layakUlang) break;
          }
        }
        if (!charge) {
          const err = chargeError;
          if (Number(err?.upstreamStatus) >= 400 && Number(err?.upstreamStatus) < 500) await pool.query("UPDATE orders SET status = 'payment_failed', updated_at = now() WHERE id = $1 AND status = 'pending'", [id]);
          if (picked) await releaseVoucher(pool, id);
          throw error(502, 'Pembayaran belum dapat dibuat. Coba lagi atau pilih metode lain.');
        }
        const detail = paymentDetail(methodId, charge);
        if (!detail) throw error(502, 'Respons pembayaran tidak valid.');
        const expiresAt = expiryDate(charge?.expiry_time);
        await pool.query('UPDATE orders SET payment_channel = $2, payment_detail = $3, payment_expires_at = $4, updated_at = now() WHERE id = $1', [id, methodId, detail, expiresAt]);
        notifyOrder(pool, fetchImpl, env, 'created', id);
        return send(res, 201, { orderId: id, paymentChannel: methodId, paymentDetail: detail, paymentExpiresAt: expiresAt ? expiresAt.toISOString() : null });
      }
      // ponytail: periksa nickname adalah layanan pemeriksaan per brand (ML memakai cek ML, FF memakai cek FF); hasil disimpan agar tidak membayar berulang.
      if (req.method === 'POST' && path === '/api/check-account') {
        guard('checkAccount');
        const ownerId = await authenticatedOwner(req, fetchImpl, env);
        let body, input;
        try { body = await readJson(req); input = validateCheckout(body); } catch (err) { throw err.status ? err : error(400, err.message); }
        const { rows } = await pool.query('SELECT id, game, customer_format FROM products WHERE id = $1 AND enabled = true', [input.productId]);
        const product = rows[0];
        if (!product) throw error(404, 'Produk tidak tersedia.');
        const checkGame = checkableGame(product.game);
        if (!checkGame) throw error(422, 'Fitur periksa nickname belum tersedia untuk layanan ini.');
        if (!checkReady(env)) throw error(503, 'Fitur periksa nickname belum aktif di server ini.');
        try { buildCustomerNo(product.customer_format, input); } catch (err) { throw error(400, err.message); }
        const brand = String(product.game || '').toUpperCase();
        if (body?.force !== true) {
          const cached = await pool.query("SELECT nickname, region, checked_at FROM account_checks WHERE game = $1 AND user_id = $2 AND zone_id = $3 AND checked_at > now() - interval '30 days'", [brand, input.userId, input.zoneId]);
          if (cached.rows[0]) return send(res, 200, { check: { nickname: cached.rows[0].nickname, region: cached.rows[0].region || '', cached: true, checkedAt: new Date(cached.rows[0].checked_at).toISOString() } });
        }
        const used = await pool.query("SELECT count(*)::int AS count FROM account_check_logs WHERE owner_id = $1 AND created_at > now() - interval '24 hours'", [ownerId]);
        if (used.rows[0].count >= maxChecksPerDay) throw error(429, 'Batas pemeriksaan nickname harian tercapai. Coba lagi besok.');
        let payload;
        try {
          const provider = checkRequest(env, checkGame, input);
          const response = await fetchImpl(provider.url, provider.options);
          if (!response.ok) throw error(502, 'Fitur periksa nickname sedang tidak tersedia. Coba lagi nanti.');
          payload = await response.json();
        } catch (err) { throw err.status ? err : error(502, 'Fitur periksa nickname sedang tidak tersedia. Coba lagi nanti.'); }
        const result = checkResult(payload);
        if (!result) throw error(404, 'Akun tidak ditemukan. Periksa kembali User ID dan Zone ID.');
        await pool.query('INSERT INTO account_checks (game, user_id, zone_id, nickname, region, checked_at) VALUES ($1,$2,$3,$4,$5, now()) ON CONFLICT (game, user_id, zone_id) DO UPDATE SET nickname = EXCLUDED.nickname, region = EXCLUDED.region, checked_at = now()', [brand, input.userId, input.zoneId, result.nickname, result.region]);
        await pool.query('INSERT INTO account_check_logs (owner_id, game) VALUES ($1, $2)', [ownerId, brand]);
        return send(res, 200, { check: { nickname: result.nickname, region: result.region, cached: false, checkedAt: new Date().toISOString() } });
      }
      if (req.method === 'GET' && path === '/api/ratings') {
        const game = (new URL(req.url, 'http://localhost').searchParams.get('game') || '').trim();
        if (!game) throw error(400, 'Nama layanan wajib diisi.');
        const { rows } = await pool.query("SELECT count(*)::int AS count, avg(r.score)::float AS average FROM order_ratings r JOIN orders o ON o.id = r.order_id JOIN products p ON p.id = o.product_id WHERE p.game = $1 AND o.status = 'fulfilled'", [game]);
        const average = rows[0]?.average ? Math.round(Number(rows[0].average) * 10) / 10 : null;
        return send(res, 200, { rating: { count: Number(rows[0]?.count || 0), average } });
      }
      if (req.method === 'GET' && path === '/api/orders') {
        const ownerId = await authenticatedOwner(req, fetchImpl, env);
        const { rows } = await pool.query('SELECT id, status, product_name AS "productName", price, discount, voucher_code AS "voucherCode", user_id AS "userId", zone_id AS "zoneId", created_at AS "createdAt" FROM orders WHERE owner_id = $1 ORDER BY created_at DESC, id DESC', [ownerId]);
        return send(res, 200, { orders: rows });
      }
      if (req.method === 'GET' && path.startsWith('/api/orders/')) {
        const ownerId = await authenticatedOwner(req, fetchImpl, env);
        const id = path.slice('/api/orders/'.length);
        if (!idPattern.test(id)) throw error(404, 'Pesanan tidak ditemukan.');
        const { rows } = await pool.query(`SELECT id, status, product_name AS "productName", price, discount, voucher_code AS "voucherCode", user_id AS "userId", zone_id AS "zoneId", fulfillment_sn AS "sn", fulfillment_note AS "fulfillmentNote", refund_note AS "refundNote", refunded_at AS "refundedAt", ${PAYMENT_DETAIL_COLUMNS}, (SELECT score FROM order_ratings WHERE order_id = orders.id) AS "ratingScore", (SELECT note FROM order_ratings WHERE order_id = orders.id) AS "ratingNote" FROM orders WHERE owner_id = $1 AND id = $2`, [ownerId, id]);
        if (!rows[0]) throw error(404, 'Pesanan tidak ditemukan.');
        return send(res, 200, { order: await reconcilePending(pool, fetchImpl, env, rows[0]) });
      }
      if (req.method === 'POST' && /^\/api\/orders\/[^/]+\/rating$/.test(path)) {
        const ownerId = await authenticatedOwner(req, fetchImpl, env);
        const id = path.split('/')[3];
        if (!idPattern.test(id)) throw error(404, 'Pesanan tidak ditemukan.');
        const body = await readJson(req);
        const score = Number(body?.score);
        if (!Number.isInteger(score) || score < 1 || score > 5) throw error(400, 'Pilih nilai 1 sampai 5 bintang.');
        const note = String(body?.note || '').trim();
        if (note.length > 500) throw error(400, 'Catatan penilaian maksimal 500 karakter.');
        const { rows } = await pool.query('SELECT status FROM orders WHERE owner_id = $1 AND id = $2', [ownerId, id]);
        if (!rows[0]) throw error(404, 'Pesanan tidak ditemukan.');
        if (rows[0].status !== 'fulfilled') throw error(409, 'Penilaian bisa dikirim setelah pesanan selesai.');
        await pool.query('INSERT INTO order_ratings (order_id, owner_id, score, note) VALUES ($1, $2, $3, $4) ON CONFLICT (order_id) DO UPDATE SET score = EXCLUDED.score, note = EXCLUDED.note, updated_at = now()', [id, ownerId, score, note || null]);
        return send(res, 200, { rating: { score, note: note || null } });
      }
      if (req.method === 'POST' && path === '/api/webhooks/midtrans') {
        const notice = await readJson(req);
        const noticeStatus = String(notice?.transaction_status || '');
        const sah = paymentSignature(notice, env.MIDTRANS_SERVER_KEY);
        const idToko = idPattern.test(String(notice?.order_id || ''));
        console.error('[webhook] midtrans:', String(notice?.order_id).slice(0, 80), noticeStatus.slice(0, 40), sah ? (idToko ? 'sah' : 'sah (id di luar toko)') : 'TIDAK SAH');
        if (!sah) throw error(401, 'Notifikasi tidak sah.');
        // ponytail: notifikasi sah selalu dijawab 200 supaya Midtrans berhenti mengulang kirim dan berhenti mengirim surel peringatan; id di luar pola pesanan toko cukup diabaikan tanpa menyentuh basis data.
        if (['settlement', 'capture'].includes(noticeStatus)) {
          if (!verifiedPayment(notice, env.MIDTRANS_SERVER_KEY) || !idToko) return send(res, 200, { received: true, applied: false });
          if (!ready(env)) throw error(503, 'Webhook belum siap.');
          if (!await applyPaid(pool, fetchImpl, env, notice.order_id, Number(notice.gross_amount))) return send(res, 200, { received: true, applied: false });
        } else if (['expire', 'deny', 'cancel'].includes(noticeStatus) && idToko) {
          await failPayment(pool, notice.order_id, Number(notice.gross_amount));
        }
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
        if (!rows[0]) throw error(409, 'Belum waktunya diperiksa atau status tidak sesuai.');
        await submitDigi(pool, fetchImpl, env, rows[0]);
        return send(res, 200, { checked: true });
      }
      // ponytail: tanda gangguan per produk; satu-satunya cara menonaktifkan satu nominal tanpa mengubah harga atau status tampil.
      if (req.method === 'POST' && /^\/api\/admin\/products\/[^/]+\/outage$/.test(path)) {
        const sku = path.split('/')[4];
        await authenticatedAdmin(req, pool, fetchImpl, env);
        let body;
        try { body = await readJson(req); } catch (err) { throw err.status ? err : error(400, err.message); }
        if (typeof body?.gangguan !== 'boolean') throw error(400, 'Status gangguan tidak valid.');
        const { rows } = await pool.query('UPDATE products SET gangguan = $2 WHERE id = $1 RETURNING id, gangguan', [sku, body.gangguan]);
        if (!rows[0]) throw error(404, 'Produk tidak ada di katalog toko.');
        return send(res, 200, { product: { sku: rows[0].id, gangguan: rows[0].gangguan === true } });
      }
      // ponytail: webhook Digiflazz (HMAC-SHA1 di header X-Hub-Signature) menutup celah status "Pending" saat balasan sinkron belum final.
      if (req.method === 'POST' && path === '/api/webhooks/digiflazz') {
        if (!env.DIGIFLAZZ_WEBHOOK_SECRET) throw error(503, 'Webhook Digiflazz belum dikonfigurasi.');
        const raw = await readRaw(req);
        const provided = String(req.headers['x-hub-signature'] || '').replace(/^sha1=/i, '').trim().toLowerCase();
        const expected = createHmac('sha1', env.DIGIFLAZZ_WEBHOOK_SECRET).update(raw, 'utf8').digest('hex');
        const valid = /^[a-f\d]{40}$/.test(provided) && timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
        if (!valid) {
          console.error('[webhook] digiflazz: tanda tangan tidak sah');
          throw error(401, 'Tanda tangan tidak sah.');
        }
        let notice;
        try { notice = JSON.parse(raw); } catch { throw error(400, 'JSON tidak valid.'); }
        const event = String(req.headers['x-digiflazz-event'] || '').trim().toLowerCase();
        if (event === 'ping') {
          console.error('[webhook] digiflazz: ping diterima, konfigurasi webhook sudah benar');
          return send(res, 200, { received: true });
        }
        const data = notice?.data;
        const refId = String(data?.ref_id || '');
        // ponytail: ref id di luar pola pesanan toko cukup dijawab 200 supaya Digiflazz tidak mengulang kirim.
        if (!idPattern.test(refId)) {
          console.error(`[webhook] digiflazz: notifikasi tanpa ref id pesanan diabaikan (event: ${event || 'tanpa header'})`);
          return send(res, 200, { received: true, applied: false });
        }
        const status = String(data?.status || '');
        if (status === 'Pending') {
          await pool.query("UPDATE orders SET updated_at = now() WHERE id = $1 AND status = 'fulfillment_pending'", [refId]);
          return send(res, 200, { received: true });
        }
        const next = status === 'Sukses' && String(data?.rc) === '00' ? 'fulfilled' : status === 'Gagal' && String(data?.rc) === '02' ? 'fulfillment_failed' : 'manual_review';
        const sn = typeof data?.sn === 'string' && data.sn.trim() ? data.sn.trim().slice(0, 120) : null;
        const note = typeof data?.message === 'string' && data.message.trim() ? data.message.trim().slice(0, 200) : null;
        const { rows } = await pool.query("UPDATE orders SET status = $2, fulfillment_sn = COALESCE($3, fulfillment_sn), fulfillment_note = COALESCE($4, fulfillment_note), updated_at = now() WHERE id = $1 AND status IN ('fulfillment_pending', 'manual_review') RETURNING id, status", [refId, next, sn, note]);
        if (!rows[0]) return send(res, 200, { received: true });
        if (next === 'fulfilled') notifyOrder(pool, fetchImpl, env, 'fulfilled', refId);
        else if (next === 'fulfillment_failed') notifyOrder(pool, fetchImpl, env, 'failed', refId);
        return send(res, 200, { received: true });
      }
      // ponytail: refund hanya untuk pesanan yang sudah dibayar tetapi itemnya belum terkirim; 'manual' menandai dana yang dikembalikan di luar sistem.
      if (req.method === 'GET' && path === '/api/admin/refunds') {
        await authenticatedAdmin(req, pool, fetchImpl, env);
        const { rows } = await pool.query(`SELECT id, status, product_name AS "productName", price, discount, user_id AS "userId", zone_id AS "zoneId", fulfillment_note AS "fulfillmentNote", refunded_at AS "refundedAt", refund_note AS "refundNote", created_at AS "createdAt" FROM orders WHERE status IN ${refundableSql} ORDER BY updated_at ASC, id ASC LIMIT 100`);
        const { rows: refunded } = await pool.query("SELECT id, product_name AS \"productName\", price, refunded_at AS \"refundedAt\", refund_note AS \"refundNote\" FROM orders WHERE status = 'refunded' ORDER BY refunded_at DESC NULLS LAST, id DESC LIMIT 20");
        return send(res, 200, { orders: rows, refunded });
      }
      if (req.method === 'POST' && /^\/api\/admin\/orders\/[^/]+\/refund$/.test(path)) {
        const id = path.split('/')[4];
        await authenticatedAdmin(req, pool, fetchImpl, env);
        if (!idPattern.test(id)) throw error(404, 'Pesanan tidak ditemukan.');
        let body;
        try { body = await readJson(req); } catch (err) { throw err.status ? err : error(400, err.message); }
        const manual = body?.manual === true;
        const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 200) : '';
        if (manual && note.length < 3) throw error(400, 'Isi catatan refund manual (contoh: transfer bank BCA).');
        const { rows } = await pool.query('SELECT id, status, price FROM orders WHERE id = $1', [id]);
        const order = rows[0];
        if (!order) throw error(404, 'Pesanan tidak ditemukan.');
        if (order.status === 'refunded') throw error(409, 'Pesanan ini sudah direfund.');
        if (!REFUNDABLE_STATUSES.includes(order.status)) throw error(409, 'Status pesanan ini tidak dapat direfund.');
        if (!manual) {
          if (!env.MIDTRANS_SERVER_KEY) throw error(503, 'Refund otomatis belum dikonfigurasi. Gunakan penandaan manual.');
          try {
            const refund = await externalJson(fetchImpl, `https://api.${env.MIDTRANS_ENV === 'production' ? '' : 'sandbox.'}midtrans.com/v2/${order.id}/refund`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Basic ${Buffer.from(env.MIDTRANS_SERVER_KEY + ':').toString('base64')}` },
              body: JSON.stringify({ refund_key: `${order.id}-refund`, amount: Number(order.price), reason: 'Pesanan tidak dapat dipenuhi' })
            });
            if (String(refund?.status_code || '') !== '200') throw error(502, 'Midtrans menolak refund ini.');
          } catch (err) {
            console.error('[refund] midtrans gagal:', order.id, err?.upstreamStatus ? `HTTP ${err.upstreamStatus}` : '', err?.message || String(err));
            throw error(502, 'Midtrans menolak refund ini. Periksa dashboard Midtrans, atau gunakan penandaan manual dengan catatan.');
          }
        }
        const { rows: done } = await pool.query(`UPDATE orders SET status = 'refunded', refunded_at = now(), refund_note = $2, updated_at = now() WHERE id = $1 AND status IN ${refundableSql} RETURNING id`, [id, manual ? `Manual: ${note}` : 'Refund otomatis melalui Midtrans']);
        if (!done[0]) throw error(409, 'Status pesanan berubah; muat ulang halaman.');
        await releaseVoucher(pool, id);
        notifyOrder(pool, fetchImpl, env, 'refunded', id);
        return send(res, 200, { refunded: true, manual });
      }
      // ponytail: Penghapusan akun diajukan lewat surel supaya pemilik akun dapat diverifikasi manual sebelum data dihapus.
      if (req.method === 'POST' && path === '/api/account/deletion-request') {
        guard('deletion');
        const ownerId = await authenticatedOwner(req, fetchImpl, env);
        const to = String(env.SUPPORT_EMAIL || env.MAIL_FROM || '').trim();
        if (!mailReady(env) || !to) throw error(503, 'Pengajuan penghapusan belum dapat diproses. Hubungi kontak dukungan.');
        const { rows } = await pool.query('SELECT email FROM auth.users WHERE id = $1', [ownerId]);
        const requestedAt = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
        const mail = await sendOrderEmail(fetchImpl, env, to, {
          subject: `Pengajuan penghapusan akun ${String(ownerId).slice(0, 8)}`,
          html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6"><p>Pengguna berikut mengajukan penghapusan akun:</p><ul><li>Email terdaftar: ${escapeHtml(rows[0]?.email || 'tidak diketahui')}</li><li>ID akun: ${escapeHtml(ownerId)}</li><li>Waktu pengajuan: ${escapeHtml(requestedAt)} WIB</li></ul><p>Hapus data akun paling lambat 14 hari kerja, lalu kirim konfirmasi ke email terdaftar. Riwayat transaksi tetap disimpan sesuai kewajiban pembukuan.</p></div>`,
        });
        if (!mail.ok) throw error(502, 'Pengajuan belum dapat dikirim. Coba lagi atau hubungi kontak dukungan.');
        return send(res, 200, { requested: true });
      }
      // ponytail: login nomor HP menukar nomor jadi sesi lewat metadata akun; email hanya keluar setelah kata sandi terbukti benar.
      if (req.method === 'POST' && path === '/api/auth/login') {
        guard('login');
        let url;
        try { url = new URL(env.SUPABASE_URL); } catch { throw error(503, 'Autentikasi belum siap.'); }
        if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !env.SUPABASE_ANON_KEY) throw error(503, 'Autentikasi belum siap.');
        let body;
        try { body = await readJson(req); } catch (err) { throw err.status ? err : error(400, err.message); }
        const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
        const password = typeof body?.password === 'string' ? body.password : '';
        if (!/^\+[1-9]\d{7,14}$/.test(phone) || password.length < 1 || password.length > 200) throw error(400, 'Nomor HP atau kata sandi tidak valid.');
        const { rows } = await pool.query("SELECT email FROM auth.users WHERE raw_user_meta_data->>'requested_phone' = $1 ORDER BY created_at ASC LIMIT 5", [phone]);
        for (const row of rows) {
          let response;
          try {
            response = await fetchImpl(new URL('/auth/v1/token?grant_type=password', url).href, {
              method: 'POST', headers: { apikey: env.SUPABASE_ANON_KEY, 'content-type': 'application/json' },
              body: JSON.stringify({ email: row.email, password }), redirect: 'error', signal: AbortSignal.timeout(12000)
            });
          } catch { throw error(502, 'Autentikasi tidak tersedia.'); }
          if (response.ok) {
            let session;
            try { session = await response.json(); } catch { throw error(502, 'Respons autentikasi tidak valid.'); }
            if (typeof session?.access_token !== 'string' || typeof session?.refresh_token !== 'string') throw error(502, 'Respons autentikasi tidak valid.');
            return send(res, 200, { session: { access_token: session.access_token, refresh_token: session.refresh_token } });
          }
          let failure = '';
          try { failure = JSON.stringify(await response.json()); } catch {}
          if (response.status === 400 && /email not confirmed|email_not_confirmed/i.test(failure)) return send(res, 200, { needsConfirmation: true, email: row.email });
          if (response.status !== 400) throw error(502, 'Autentikasi tidak tersedia.');
        }
        throw error(401, 'Nomor HP atau kata sandi salah.');
      }
      throw error(404, 'Endpoint tidak ditemukan.');
    } catch (err) {
      if (!err.status) console.error('API error:', err);
      send(res, err.status || 500, { error: err.status ? err.message : 'Kesalahan server. Coba lagi nanti.' });
    }
  };
}
