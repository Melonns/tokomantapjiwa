// ponytail: Notifikasi email pesanan memakai Brevo (kuota gratis 300 email/hari). Tanpa BREVO_API_KEY dan MAIL_FROM,
// mailReady() bernilai false dan seluruh pengiriman dilewati agar checkout tetap berjalan di lingkungan pengembangan dan pengujian.

const EVENTS = {
  created: {
    subject: (order) => `Pesanan ${shortId(order.id)} menunggu pembayaran`,
    lead: () => 'Pesanan telah dibuat dan menunggu pembayaran. Selesaikan pembayaran sebelum batas waktu di invoice agar pesanan tidak kedaluwarsa.',
  },
  paid: {
    subject: (order) => `Pembayaran diterima, pesanan ${shortId(order.id)} sedang diproses`,
    lead: () => 'Pembayaran telah diterima dan pesanan diproses otomatis ke penyedia layanan. Hasilnya muncul di halaman pesanan, umumnya dalam beberapa menit.',
  },
  fulfilled: {
    subject: (order) => `Pesanan ${shortId(order.id)} selesai`,
    lead: () => 'Pesanan telah selesai dan item dikirim ke ID tujuan. Simpan email ini sebagai bukti pembelian.',
  },
  failed: {
    subject: (order) => `Pesanan ${shortId(order.id)} gagal, dana akan dikembalikan`,
    lead: () => 'Pesanan tidak dapat diselesaikan oleh penyedia layanan. Dana akan dikembalikan penuh ke metode pembayaran awal tanpa potongan. Kami akan mengirim email kembali setelah dana dikembalikan.',
  },
  refunded: {
    subject: (order) => `Dana pesanan ${shortId(order.id)} sudah dikembalikan`,
    lead: () => 'Dana pesanan sudah dikembalikan ke metode pembayaran awal. Waktu masuknya tergantung bank atau e-wallet, umumnya 1–3 hari kerja.',
  },
};

function shortId(id) {
  const text = String(id || '');
  return text ? `#${text.slice(0, 8).toUpperCase()}` : '';
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function rupiah(value) {
  return `Rp ${new Intl.NumberFormat('id-ID').format(Number(value) || 0)}`;
}

export function mailReady(env = {}) {
  return Boolean(String(env.BREVO_API_KEY || '').trim() && String(env.MAIL_FROM || '').trim());
}

// ponytail: isi email mengikuti baris struk (harga asli, potongan, total dibayar) agar angka di email sama dengan di invoice.
export function orderEmail(event, order, env = {}) {
  const spec = EVENTS[event];
  if (!spec || !order?.id) return null;
  const base = String(env.STORE_URL || '').trim().replace(/\/+$/, '');
  const link = `${base || 'https://melonbyte.id'}/#struk/${encodeURIComponent(order.id)}`;
  const rows = [['Produk', order.productName]];
  if (order.userId) rows.push(['ID tujuan', `${order.userId}${order.zoneId ? ` (${order.zoneId})` : ''}`]);
  if (Number(order.discount) > 0) {
    rows.push(['Harga', rupiah(Number(order.price) + Number(order.discount))]);
    rows.push([`Potongan${order.voucherCode ? ` (${order.voucherCode})` : ''}`, `−${rupiah(order.discount)}`]);
  }
  rows.push(['Total dibayar', rupiah(order.price)]);
  if (order.sn) rows.push(['Nomor seri', order.sn]);
  if (order.refundNote) rows.push(['Catatan refund', order.refundNote]);
  const subject = spec.subject(order);
  const html = `<div style="background:#0b110e;padding:28px 16px;font-family:Arial,Helvetica,sans-serif;color:#edf1e9">
  <div style="max-width:560px;margin:0 auto;background:#172219;border:1px solid #516750;border-radius:10px;padding:26px">
    <p style="margin:0 0 8px;font-size:12px;font-weight:bold;letter-spacing:2px;color:#b8ef72">MELONBYTE</p>
    <h1 style="margin:0 0 12px;font-size:20px;line-height:1.35">${esc(subject)}</h1>
    <p style="margin:0 0 18px;font-size:14px;line-height:1.65;color:#bbcabc">${esc(spec.lead(order))}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      ${rows.map(([label, value]) => `<tr><td style="padding:7px 0;color:#bbcabc;vertical-align:top">${esc(label)}</td><td style="padding:7px 0;text-align:right">${esc(value)}</td></tr>`).join('')}
    </table>
    <p style="margin:22px 0 0"><a href="${esc(link)}" style="display:inline-block;background:#b8ef72;color:#10190f;font-weight:bold;padding:11px 18px;border-radius:6px;text-decoration:none">Lihat pesanan</a></p>
    <p style="margin:18px 0 0;font-size:12px;line-height:1.65;color:#bbcabc">Nomor pesanan: ${esc(order.id)}<br />Email ini dikirim secara otomatis oleh Melonbyte. Balas email ini jika ada kendala.</p>
  </div>
</div>`;
  return { subject, html };
}

// ponytail: pengiriman tidak pernah melempar error. Kegagalan email tidak boleh menggagalkan pesanan yang sudah dibayar.
export async function sendOrderEmail(fetchImpl, env, to, message) {
  if (!mailReady(env) || !to || !message?.subject || !message?.html) return { ok: false, skipped: true };
  try {
    const response = await fetchImpl('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': String(env.BREVO_API_KEY).trim(), 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: String(env.MAIL_FROM).trim(), name: String(env.MAIL_FROM_NAME || 'Melonbyte').trim() || 'Melonbyte' },
        to: [{ email: to }],
        subject: message.subject,
        htmlContent: message.html,
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}
