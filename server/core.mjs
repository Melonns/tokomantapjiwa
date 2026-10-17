import { createHash, timingSafeEqual } from 'node:crypto';

export function validateCheckout(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('Data checkout tidak valid.');
  const { productId, userId, zoneId, paymentMethod, voucherCode, contactEmail, contactPhone } = body;
  if (typeof productId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(productId) ||
      typeof userId !== 'string' || !/^[a-zA-Z0-9 ._#-]{1,64}$/.test(userId)) throw Error('Produk, User ID, atau Zone ID tidak valid.');
  if (zoneId !== undefined && (typeof zoneId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(zoneId))) throw Error('Produk, User ID, atau Zone ID tidak valid.');
  if (paymentMethod !== undefined && (typeof paymentMethod !== 'string' || !/^[a-z][a-z0-9_]{1,23}$/.test(paymentMethod))) throw Error('Metode pembayaran tidak valid.');
  if (voucherCode !== undefined && (typeof voucherCode !== 'string' || !/^[A-Za-z0-9_-]{3,24}$/.test(voucherCode))) throw Error('Kode voucher tidak valid.');
  // ponytail: kontak pesanan boleh berbeda dari email akun; disimpan per pesanan supaya struk dan notifikasi sampai ke pembeli yang benar.
  if (contactEmail !== undefined && (typeof contactEmail !== 'string' || contactEmail.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contactEmail.trim()))) throw Error('Email kontak tidak valid.');
  if (contactPhone !== undefined && (typeof contactPhone !== 'string' || !/^[0-9+()\s-]{8,20}$/.test(contactPhone.trim()))) throw Error('Nomor HP kontak tidak valid.');
  const input = { productId, userId, zoneId: zoneId ?? '', paymentMethod };
  if (contactEmail) input.contactEmail = contactEmail.trim();
  if (contactPhone) input.contactPhone = contactPhone.trim();
  // ponytail: kunci voucherCode hanya muncul kalau pembeli memang memakai voucher, supaya kontrak lama tidak berubah.
  if (voucherCode) input.voucherCode = voucherCode.toUpperCase();
  return input;
}

// ponytail: Format tujuan menentukan nomor tujuan yang dikirim ke Digiflazz; jangan menebak bentuk lain.
export function customerNo(format, input) {
  if (format === 'plain' || format === 'riot') return input.userId;
  if (format === 'uid_server') {
    if (!input.zoneId) throw Error('Server wajib dipilih untuk produk ini.');
    return `${input.userId}|${input.zoneId}`;
  }
  if (format !== 'ml_concat' || !input.zoneId) throw Error('Format tujuan produk ini belum didukung checkout.');
  return input.userId + input.zoneId;
}

// ponytail: tanda tangan SHA512 atas order_id + status_code + gross_amount + server key; berlaku untuk semua notifikasi Midtrans, termasuk yang bukan pelunasan.
export function paymentSignature(body, key) {
  if (!key || !body || typeof body !== 'object' ||
      ![body.order_id, body.status_code, body.gross_amount, body.signature_key].every(v => typeof v === 'string') ||
      !/^[a-f0-9]{128}$/i.test(body.signature_key)) return false;
  const actual = createHash('sha512').update(body.order_id + body.status_code + body.gross_amount + key).digest();
  return timingSafeEqual(actual, Buffer.from(body.signature_key, 'hex'));
}

// ponytail: hanya notifikasi lunas yang boleh memicu pengiriman barang.
export function verifiedPayment(body, key) {
  return paymentSignature(body, key) && body.status_code === '200' &&
    typeof body.transaction_status === 'string' && ['settlement', 'capture'].includes(body.transaction_status) &&
    (body.transaction_status !== 'capture' || body.fraud_status === 'accept') &&
    (!body.fraud_status || body.fraud_status === 'accept') &&
    /^\d+\.00$/.test(body.gross_amount);
}
