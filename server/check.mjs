import { createHash, randomUUID } from 'node:crypto';
import { customerNo } from './core.mjs';

// SKU cek adalah transaksi Digiflazz biasa, tapi disembunyikan dari katalog produk toko.
export const checkGames = {
  'MOBILE LEGENDS': { sku: 'mlcek' },
  'FREE FIRE': { sku: 'pre34729032' },
};

export const maxChecksPerDay = 10;
const timeoutMs = 12000;

export const checkableGame = game => checkGames[String(game || '').toUpperCase()] || null;
export const checkReady = env => Boolean(env.DIGIFLAZZ_USERNAME && env.DIGIFLAZZ_API_KEY && env.DIGIFLAZZ_TESTING === 'false');

export function checkRequest(env, game, input, product, price) {
  const refId = randomUUID();
  const customer = customerNo(product.customer_format, input);
  return {
    url: 'https://api.digiflazz.com/v1/transaction',
    options: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: env.DIGIFLAZZ_USERNAME,
        buyer_sku_code: game.sku,
        customer_no: customer,
        max_price: price,
        ref_id: refId,
        sign: createHash('md5').update(env.DIGIFLAZZ_USERNAME + env.DIGIFLAZZ_API_KEY + refId).digest('hex'),
        ...(env.DIGIFLAZZ_TESTING === 'true' ? { testing: true } : {}),
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    },
    expected: { refId, customerNo: customer, sku: game.sku },
  };
}

export function checkResult(payload, expected) {
  const data = payload?.data;
  if (data?.ref_id !== expected.refId || data?.customer_no !== expected.customerNo || data?.buyer_sku_code !== expected.sku) return null;
  if (data?.status !== 'Sukses' || String(data?.rc) !== '00') return null;
  const nickname = typeof data?.sn === 'string' ? data.sn.trim().slice(0, 120) : '';
  if (!nickname) return null;
  return { nickname, region: '' };
}
