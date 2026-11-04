import { timingSafeEqual } from 'node:crypto';

export const sumopodMethods = { qris: 'QRIS', qris_instant: 'QRIS_INSTANT' };

export function paymentProvider(env) {
  return env.PAYMENT_PROVIDER === 'sumopod' ? 'sumopod' : 'midtrans';
}

export function sumopodConfig(env) {
  if (paymentProvider(env) !== 'sumopod') return null;
  const mode = env.SUMOPOD_ENV === 'production' ? 'production' : 'sandbox';
  const key = String(mode === 'production' ? env.SUMOPOD_PRODUCTION_KEY || '' : env.SUMOPOD_SANDBOX_KEY || '').trim();
  const fallback = mode === 'production' ? 'https://api-pay.sumopod.com' : 'https://api-pay-sandbox.sumopod.com';
  const apiBase = String(env.SUMOPOD_API_URL || fallback).replace(/\/+$/, '');
  return { mode, key, apiBase };
}

export const sumopodReady = (env) => Boolean(sumopodConfig(env)?.key && env.SUMOPOD_WEBHOOK_TOKEN);

export function sumopodBody({ orderId, amount, methodId, returnUrl }) {
  const code = sumopodMethods[methodId];
  if (!code) throw new Error('Metode pembayaran tidak dikenal.');
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(String(orderId))) throw new Error('Nomor pesanan tidak valid.');
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Nominal pembayaran tidak valid.');
  const body = {
    order_id: orderId,
    amount,
    currency: 'IDR',
    expires_in_hours: 24,
    payment_method_type_code: code,
  };
  if (typeof returnUrl === 'string' && /^https?:\/\/[^\s]+$/i.test(returnUrl)) {
    body.success_return_url = returnUrl;
    body.cancel_return_url = returnUrl;
  }
  return body;
}

export function sumopodPaymentDetail(payload) {
  let url;
  try { url = new URL(String(payload?.payment_link_url || '')); } catch { return null; }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
  const detail = { provider: 'sumopod', redirectUrl: url.href };
  if (typeof payload?.payment_id === 'string' && /^[a-f0-9-]{36}$/i.test(payload.payment_id)) detail.paymentId = payload.payment_id;
  if (Number.isFinite(Number(payload?.fee))) detail.fee = Number(payload.fee);
  if (Number.isFinite(Number(payload?.net_amount))) detail.netAmount = Number(payload.net_amount);
  return detail;
}

export function sumopodExpiresAt(payload) {
  const value = Date.parse(payload?.expires_at);
  return Number.isFinite(value) ? new Date(value) : null;
}

export function sumopodWebhook(payload) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  const event = String(payload?.event_type || '').toLowerCase();
  const status = String(data?.status || '').toLowerCase();
  return {
    event,
    orderId: String(data?.order_id || ''),
    amount: Number(data?.amount),
    status,
    paid: event === 'payment.completed' || ['completed', 'paid', 'settled'].includes(status),
    failed: ['payment.failed', 'payment.expired'].includes(event) || ['failed', 'expired', 'cancelled', 'canceled'].includes(status),
  };
}

export function sumopodTokenValid(env, received) {
  const expected = String(env.SUMOPOD_WEBHOOK_TOKEN || '');
  if (!expected) return false;
  const left = Buffer.from(String(received || ''));
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
