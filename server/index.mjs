import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { createHandler, reconcilePending } from './app.mjs';

if (!process.env.DATABASE_URL) throw Error('DATABASE_URL wajib diisi.');
// ponytail: Sertifikat akar Supabase lama dipakai hanya bila berkasnya ada. Berkas itu tidak ikut Git
// (lihat .gitignore), jadi hasil klon baru di VPS tetap hidup dengan daftar akar bawaan Node.
let ca;
try {
  ca = readFileSync(new URL('../prod-ca-2021.crt', import.meta.url), 'utf8');
} catch {
  ca = undefined;
}
console.log(ca ? '[db] memakai sertifikat akar lokal prod-ca-2021.crt' : '[db] memakai daftar akar bawaan Node');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: true }, max: 10 });
const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('PORT tidak valid.');
// ponytail: API hanya mendengarkan loopback; Caddy adalah satu-satunya pintu masuk publik.
// HOST tetap dapat diubah untuk pengujian lokal, tetapi produksi memakai 127.0.0.1.
const host = process.env.HOST || '127.0.0.1';
const server = createServer(createHandler({ pool }));
server.requestTimeout = 20000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 5000;
server.timeout = 30000;
server.maxHeadersCount = 50;
server.maxRequestsPerSocket = 1000;
server.listen(port, host, () => console.log(`Melonbyte API listening on ${host}:${port}`));
// ponytail: Jaring pengaman rekonsiliasi. Webhook tetap jalur utama; sapuan ini hanya memproses pesanan yang belum tuntas
// agar notifikasi yang hilang tidak menggantung. Matikan dengan RECONCILE_INTERVAL_MINUTES=0.
const reconcileMinutes = Number(process.env.RECONCILE_INTERVAL_MINUTES ?? 10);
async function reconcileSweep() {
  try {
    const { rows } = await pool.query(`SELECT id, status, price FROM orders
      WHERE status IN ('pending', 'payment_paid', 'fulfillment_pending')
        AND created_at > now() - interval '2 days'
        AND updated_at < now() - interval '10 minutes'
      ORDER BY updated_at ASC LIMIT 20`);
    for (const order of rows) await reconcilePending(pool, fetch, process.env, order);
    if (rows.length) console.log(`[reconcile] ${rows.length} pesanan disapu`);
  } catch (err) {
    console.error('[reconcile] gagal:', err?.message || String(err));
  }
}
if (Number.isFinite(reconcileMinutes) && reconcileMinutes > 0) {
  setInterval(reconcileSweep, reconcileMinutes * 60 * 1000).unref();
  console.log(`[reconcile] jaring pengaman aktif setiap ${reconcileMinutes} menit`);
}

// Tutup koneksi dengan rapi, tetapi jangan biarkan systemd menunggu selamanya.
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  server.close(() => {
    Promise.resolve(pool.end()).finally(() => process.exit(0));
  });
  setTimeout(() => {
    server.closeAllConnections?.();
    process.exit(1);
  }, 10000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
