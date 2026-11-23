import { randomUUID } from 'node:crypto';
import { customerNo } from './core.mjs';

// SKU cek adalah transaksi Otomax terpisah dari alur top-up Buyer API.
export const checkGames = {
  'MOBILE LEGENDS': { sku: 'mlcek' },
  'FREE FIRE': { sku: 'pre34729032' },
};

export const maxChecksPerDay = 10;
const timeoutMs = 12000;
const otomaxUrl = 'https://api.digiflazz.com/v1/buyer/otomax/transaction';

export const checkableGame = game => checkGames[String(game || '').toUpperCase()] || null;
export const checkReady = env => Boolean(env.DIGIFLAZZ_OTOMAX_ID && env.DIGIFLAZZ_OTOMAX_PIN && env.DIGIFLAZZ_OTOMAX_USER && env.DIGIFLAZZ_OTOMAX_PASS && ['true', 'false'].includes(env.DIGIFLAZZ_OTOMAX_TESTING));

export function checkRequest(env, game, input, product, price, refId = randomUUID()) {
  const customer = customerNo(product.customer_format, input);
  const url = new URL(otomaxUrl);
  for (const [key, value] of Object.entries({
    id: env.DIGIFLAZZ_OTOMAX_ID,
    pin: env.DIGIFLAZZ_OTOMAX_PIN,
    user: env.DIGIFLAZZ_OTOMAX_USER,
    pass: env.DIGIFLAZZ_OTOMAX_PASS,
    kodeproduk: game.sku,
    tujuan: customer,
    idtrx: refId,
    hargamax: price,
  })) url.searchParams.set(key, String(value));
  if (env.DIGIFLAZZ_OTOMAX_TESTING === 'true') url.searchParams.set('testing', 'true');
  return {
    url: url.toString(),
    options: { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(timeoutMs) },
    expected: { refId, customerNo: customer, sku: game.sku },
  };
}

export function checkResult(reply, expected) {
  if (typeof reply !== 'string') return null;
  const sku = expected.sku.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const customer = expected.customerNo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pending = new RegExp(`^Request\\s+${sku}\\s+ke\\s+${customer}\\s+segera\\s+diproses\\b`, 'i');
  const success = new RegExp(`^TRX\\s+${sku}\\.${customer}\\s+BERHASIL,\\s*HRG:\\s*[^\\s]+(?:\\s+SN:\\s*([\\s\\S]+?))?(?:\\.\\s*SISA\\s+SALDO\\b[\\s\\S]*|\\s+SISA\\s+SALDO\\b[\\s\\S]*|\\s+CLIENTID=[\\s\\S]*|$)`, 'i');
  const failed = new RegExp(`^TRX\\s+${sku}\\.${customer}\\s+GAGAL,`, 'i');
  if (pending.test(reply.trim())) return { status: 'pending' };
  if (failed.test(reply.trim())) return { status: 'failed' };
  const match = reply.trim().match(success);
  if (!match) return null;
  const nickname = typeof match[1] === 'string' ? match[1].trim().replace(/\.$/, '').slice(0, 120) : '';
  if (!nickname) return { status: 'unavailable' };
  return { status: 'success', nickname, region: '' };
}
