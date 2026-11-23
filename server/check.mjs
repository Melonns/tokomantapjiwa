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

export function cleanNickname(value) {
  if (typeof value !== 'string') return '';
  let text = value.trim().replace(/\.$/, '').trim();
  const match = text.match(/(?:^|\/|\|)\s*(?:username|user\s*name|nickname|nick)\s*[:=-]?\s*(.+)$/i);
  if (match) text = match[1].trim().replace(/\.$/, '').trim();
  return text.slice(0, 120);
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
  const nickname = cleanNickname(match[1]);
  if (!nickname) return { status: 'unavailable' };
  return { status: 'success', nickname, region: '' };
}

export function checkReport(params) {
  const get = key => {
    const raw = params instanceof URLSearchParams ? params.get(key) : params?.[key];
    return typeof raw === 'string' ? raw.trim() : '';
  };
  const refId = get('clientid');
  const rawSku = get('kp');
  const customerNo = get('msisdn');
  const statuscode = get('statuscode');
  const sku = Object.values(checkGames).find(game => game.sku.toLowerCase() === rawSku.toLowerCase())?.sku || '';
  if (!refId || !sku || !customerNo) return null;
  if (statuscode === '2') return { refId, sku, customerNo, status: 'failed', nickname: '' };
  if (statuscode !== '1') return null;
  let nickname = cleanNickname(get('sn'));
  if (!nickname) {
    const msg = get('msg');
    const parsed = msg ? checkResult(msg, { sku, customerNo }) : null;
    if (parsed?.status === 'success') nickname = parsed.nickname;
  }
  if (!nickname) return null;
  return { refId, sku, customerNo, status: 'success', nickname };
}
