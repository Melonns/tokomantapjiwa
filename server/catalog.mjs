import { createHash } from 'node:crypto';

export function supplierCatalog(fetchImpl, env) {
  let cached;
  let expires = 0;
  let pending;
  return async () => {
    if (cached && Date.now() < expires) return cached;
    if (pending) return pending;
    pending = (async () => {
      const { DIGIFLAZZ_USERNAME: username, DIGIFLAZZ_API_KEY: key } = env;
      if (!username || !key) throw new Error('Konfigurasi katalog Digiflazz belum lengkap.');
      const response = await fetchImpl('https://api.digiflazz.com/v1/price-list', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cmd: 'prepaid', username, sign: createHash('md5').update(username + key + 'pricelist').digest('hex') }),
        signal: AbortSignal.timeout(15000),
      });
      const body = await response.json();
      if (!response.ok || !Array.isArray(body.data)) throw new Error('Katalog Digiflazz belum bisa dimuat.');
      cached = body.data.filter(p => p.buyer_product_status === true && p.seller_product_status === true && (p.unlimited_stock === true || Number(p.stock) > 0))
        .filter(p => typeof p.product_name === 'string' && typeof p.brand === 'string' && typeof p.category === 'string' && typeof p.buyer_sku_code === 'string' && Number.isSafeInteger(Number(p.price)) && Number(p.price) > 0)
        .map(p => ({ id: p.buyer_sku_code, name: p.product_name, game: p.brand, category: p.category, price: Number(p.price) }));
      // ponytail: cache 10 menit; daftar ini dipakai panel admin untuk menetapkan harga jual, bukan untuk pembeli.
      expires = Date.now() + 10 * 60 * 1000;
      return cached;
    })();
    try { return await pending; } finally { pending = null; }
  };
}
