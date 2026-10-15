import { createHash } from 'node:crypto';

// ponytail: Digiflazz membatasi frekuensi pull price-list (rc 83), jadi server menariknya hanya saat sinkron,
// menyimpannya di tabel supplier_products, dan panel admin membaca basis data, bukan memanggil API setiap kali dibuka.
// Batas panjang ini harus sama dengan CHECK tabel supplier_products: satu baris aneh tidak boleh menggagalkan seluruh sinkron.
const LIMITS = { name: 160, game: 80, category: 80, variant: 80 };

export async function fetchSupplierCatalog(fetchImpl, env) {
  const { DIGIFLAZZ_USERNAME: username, DIGIFLAZZ_API_KEY: key } = env;
  if (!username || !key) throw new Error('Konfigurasi katalog Digiflazz belum lengkap.');
  const response = await fetchImpl('https://api.digiflazz.com/v1/price-list', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cmd: 'prepaid', username, sign: createHash('md5').update(username + key + 'pricelist').digest('hex') }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(body?.data)) {
    const failure = new Error('Katalog Digiflazz belum bisa dimuat.');
    failure.rc = String(body?.data?.rc || '');
    throw failure;
  }
  const items = new Map();
  for (const row of body.data) {
    if (row.buyer_product_status !== true || row.seller_product_status !== true) continue;
    if (!(row.unlimited_stock === true || Number(row.stock) > 0)) continue;
    if (typeof row.product_name !== 'string' || typeof row.brand !== 'string' || typeof row.category !== 'string' || typeof row.buyer_sku_code !== 'string') continue;
    if (!Number.isSafeInteger(Number(row.price)) || Number(row.price) <= 0) continue;
    const item = { id: row.buyer_sku_code, name: row.product_name.trim(), game: row.brand.trim(), category: row.category.trim(), variant: typeof row.type === 'string' ? row.type.trim() : '', price: Number(row.price) };
    if (!item.id || !item.name || !item.game || !item.category) continue;
    if (item.name.length > LIMITS.name || item.game.length > LIMITS.game || item.category.length > LIMITS.category || item.variant.length > LIMITS.variant) continue;
    // SKU yang muncul dua kali di price-list: yang terakhir menang, karena INSERT sinkron memakai ON CONFLICT (sku).
    items.set(item.id, item);
  }
  return [...items.values()];
}
