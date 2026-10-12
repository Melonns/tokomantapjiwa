import { createHash, timingSafeEqual } from 'node:crypto';

export function validateCheckout(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('Data checkout tidak valid.');
  const { productId, userId, zoneId } = body;
  if (typeof productId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(productId) ||
      typeof userId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(userId)) throw Error('Produk, User ID, atau Zone ID tidak valid.');
  if (zoneId !== undefined && (typeof zoneId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(zoneId))) throw Error('Produk, User ID, atau Zone ID tidak valid.');
  return { productId, userId, zoneId: zoneId ?? '' };
}

// ponytail: Format tujuan menentukan nomor tujuan yang dikirim ke Digiflazz; jangan menebak bentuk lain.
export function customerNo(format, input) {
  if (format === 'plain') return input.userId;
  if (format !== 'ml_concat' || !input.zoneId) throw Error('Format tujuan produk ini belum didukung checkout.');
  return input.userId + input.zoneId;
}

export function verifiedPayment(body, key) {
  if (!key || !body || typeof body !== 'object' ||
      ![body.order_id, body.status_code, body.gross_amount, body.signature_key, body.transaction_status].every(v => typeof v === 'string') ||
      !/^[a-f0-9]{128}$/i.test(body.signature_key) || body.status_code !== '200' ||
      !['settlement', 'capture'].includes(body.transaction_status) ||
      (body.transaction_status === 'capture' && body.fraud_status !== 'accept') ||
      (body.fraud_status && body.fraud_status !== 'accept') ||
      !/^\d+\.00$/.test(body.gross_amount)) return false;
  const actual = createHash('sha512').update(body.order_id + body.status_code + body.gross_amount + key).digest();
  return timingSafeEqual(actual, Buffer.from(body.signature_key, 'hex'));
}
