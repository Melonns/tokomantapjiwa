import assert from 'node:assert/strict';
import test from 'node:test';
import { clientIp, createRateLimiter } from './ratelimit.mjs';

test('mengizinkan sampai batas, lalu menolak dengan Retry-After', () => {
  let time = 1000;
  const limiter = createRateLimiter({ windowMs: 60000, max: 2, now: () => time });
  assert.equal(limiter.check('a').allowed, true);
  assert.equal(limiter.check('a').allowed, true);
  const blocked = limiter.check('a');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSec, 60);
  time += 30000;
  assert.equal(limiter.check('a').allowed, false);
  time += 31000;
  assert.equal(limiter.check('a').allowed, true);
});

test('batas dihitung terpisah per kunci', () => {
  const limiter = createRateLimiter({ windowMs: 60000, max: 1 });
  assert.equal(limiter.check('a').allowed, true);
  assert.equal(limiter.check('a').allowed, false);
  assert.equal(limiter.check('b').allowed, true);
  limiter.reset();
  assert.equal(limiter.check('a').allowed, true);
});

test('clientIp membaca cf-connecting-ip, lalu x-forwarded-for, lalu socket', () => {
  assert.equal(clientIp({ headers: { 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2' }, socket: { remoteAddress: '3.3.3.3' } }), '1.1.1.1');
  assert.equal(clientIp({ headers: { 'x-forwarded-for': '2.2.2.2, 9.9.9.9' }, socket: { remoteAddress: '3.3.3.3' } }), '2.2.2.2');
  assert.equal(clientIp({ headers: {}, socket: { remoteAddress: '3.3.3.3' } }), '3.3.3.3');
  assert.equal(clientIp({}), 'tanpa-ip');
});
