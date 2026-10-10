import { createHash } from 'node:crypto';

const { DIGIFLAZZ_USERNAME: username, DIGIFLAZZ_API_KEY: key } = process.env;
if (!username || !key) {
  console.error('Konfigurasi Digiflazz belum lengkap.');
  process.exitCode = 1;
} else {
  try {
    const response = await fetch('https://api.digiflazz.com/v1/price-list', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cmd: 'prepaid', username, sign: createHash('md5').update(username + key + 'pricelist').digest('hex') }),
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.json();
    if (!response.ok || !Array.isArray(body.data)) {
      console.error(JSON.stringify({ status: response.status, code: /^[0-9]{2}$/.test(body.data?.rc) ? body.data.rc : null, error: 'Katalog Digiflazz belum bisa diambil.' }));
      process.exitCode = 1;
    } else {
      const products = body.data.filter(p => p.buyer_product_status === true && p.seller_product_status === true && (p.unlimited_stock === true || Number(p.stock) > 0));
      console.log(JSON.stringify({ total: body.data.length, active: products.length, categories: [...new Set(products.map(p => p.category))].sort(), sample: products.slice(0, 5).map(p => ({ name: p.product_name, category: p.category, brand: p.brand, supplierPrice: p.price })) }, null, 2));
    }
  } catch {
    console.error('Koneksi atau respons katalog Digiflazz gagal.');
    process.exitCode = 1;
  }
}
