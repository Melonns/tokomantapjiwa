// ponytail: Pembatas percobaan sederhana per IP. Disimpan di memori proses, cukup untuk satu instance API
// dengan trafik toko kecil dan tanpa Redis. Batas dapat diubah lewat env dan dimatikan dengan RATE_LIMIT_DISABLED=1.

export function createRateLimiter({ windowMs, max, now = () => Date.now() }) {
  const hits = new Map();
  return {
    check(key) {
      const time = now();
      const fresh = (hits.get(key) || []).filter((stamp) => stamp > time - windowMs);
      if (fresh.length >= max) {
        hits.set(key, fresh);
        const retryAfterSec = Math.max(1, Math.ceil((fresh[0] + windowMs - time) / 1000));
        return { allowed: false, retryAfterSec, remaining: 0 };
      }
      fresh.push(time);
      hits.set(key, fresh);
      // ponytail: Pembersihan malas supaya memori tidak tumbuh tanpa batas pada serangan percobaan acak.
      if (hits.size > 2000) {
        for (const [entry, stamps] of hits) {
          if (stamps.every((stamp) => stamp <= time - windowMs)) hits.delete(entry);
        }
      }
      return { allowed: true, retryAfterSec: 0, remaining: max - fresh.length };
    },
    reset() { hits.clear(); },
  };
}

// ponytail: Urutan pembacaan IP mengikuti proxy yang benar-benar dipakai: Cloudflare, lalu reverse proxy (Caddy), lalu socket langsung.
// Caddyfile menimpa X-Forwarded-For dengan alamat asli klien dan membuang Cf-Connecting-Ip, sehingga entri pertama selalu alamat sebenarnya.
export function clientIp(req) {
  const direct = req?.headers?.['cf-connecting-ip'];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const forwarded = req?.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  return req?.socket?.remoteAddress || 'tanpa-ip';
}
