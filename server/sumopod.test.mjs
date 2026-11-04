import test from 'node:test';
import assert from 'node:assert/strict';
import { sumopodBody, sumopodConfig, sumopodExpiresAt, sumopodPaymentDetail, sumopodTokenValid, sumopodWebhook } from './sumopod.mjs';

const sandboxEnv = { PAYMENT_PROVIDER: 'sumopod', SUMOPOD_ENV: 'sandbox', SUMOPOD_SANDBOX_KEY: 'sandbox-key', SUMOPOD_PRODUCTION_KEY: 'production-key' };

test('sumopod memilih key sesuai environment', () => {
  assert.equal(sumopodConfig(sandboxEnv).key, 'sandbox-key');
  assert.equal(sumopodConfig({ ...sandboxEnv, SUMOPOD_ENV: 'production' }).key, 'production-key');
  assert.equal(sumopodConfig({ PAYMENT_PROVIDER: 'midtrans' }), null);
});

test('body charge hanya berisi field yang didukung', () => {
  const body = sumopodBody({ orderId: '11111111-1111-4111-8111-111111111111', amount: 25000, methodId: 'qris', returnUrl: 'https://melonbyte.biz.id/struk/1' });
  assert.deepEqual(body, {
    order_id: '11111111-1111-4111-8111-111111111111', amount: 25000, currency: 'IDR', expires_in_hours: 24, payment_method_type_code: 'QRIS',
    success_return_url: 'https://melonbyte.biz.id/struk/1', cancel_return_url: 'https://melonbyte.biz.id/struk/1'
  });
  assert.throws(() => sumopodBody({ orderId: 'x', amount: 1000, methodId: 'va' }), /Metode/);
});

test('payment link harus https dan dipetakan ke detail', () => {
  const detail = sumopodPaymentDetail({ payment_link_url: 'https://sumo.sandbox.pymnt.global/abc', payment_id: '11111111-1111-4111-8111-111111111111', fee: 475, net_amount: 24525 });
  assert.equal(detail.provider, 'sumopod');
  assert.equal(detail.redirectUrl, 'https://sumo.sandbox.pymnt.global/abc');
  assert.equal(detail.fee, 475);
  assert.equal(sumopodPaymentDetail({ payment_link_url: 'http://evil.example' }), null);
});

test('webhook membaca event dan status', () => {
  assert.deepEqual(sumopodWebhook({ event_type: 'payment.completed', data: { order_id: 'abc', amount: 25000, status: 'completed' } }), {
    event: 'payment.completed', orderId: 'abc', amount: 25000, status: 'completed', paid: true, failed: false
  });
  assert.equal(sumopodWebhook({ event_type: 'payment.expired', data: { order_id: 'abc', amount: 25000 } }).failed, true);
  assert.equal(sumopodWebhook({ event_type: 'payment.test', data: {} }).paid, false);
});

test('token webhook dibandingkan persis', () => {
  const env = { SUMOPOD_WEBHOOK_TOKEN: 'whtok_abc' };
  assert.equal(sumopodTokenValid(env, 'whtok_abc'), true);
  assert.equal(sumopodTokenValid(env, 'whtok_abd'), false);
  assert.equal(sumopodTokenValid({}, 'whtok_abc'), false);
});

test('expiry invalid tidak membuat tanggal palsu', () => {
  assert.equal(sumopodExpiresAt({ expires_at: '2026-11-05T09:00:00+07:00' }).toISOString(), '2026-11-05T02:00:00.000Z');
  assert.equal(sumopodExpiresAt({}), null);
});
