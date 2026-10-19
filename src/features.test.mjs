import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { OUTAGE_NOTE, allOutage, isOutage } from './outage.mjs';
import { LEGAL_LINKS, LEGAL_PAGES, contactChannels } from './legal.mjs';

const source = await readFile(new URL('./App.jsx', import.meta.url), 'utf8');
const css = await readFile(new URL('./store.css', import.meta.url), 'utf8');

test('aturan gangguan digunakan di katalog, checkout, dan panel admin', () => {
  assert.equal(isOutage({ gangguan: true }), true);
  assert.equal(isOutage({ gangguan: false }), false);
  assert.equal(isOutage(null), false);
  assert.equal(allOutage([{ gangguan: true }, { gangguan: true }]), true);
  assert.equal(allOutage([{ gangguan: true }, {}]), false);
  assert.equal(allOutage([]), false);
  assert.match(OUTAGE_NOTE, /gangguan/i);
  assert.match(source, /import \{ OUTAGE_NOTE, allOutage, isOutage \} from '\.\/outage\.mjs'/);
  assert.match(source, /disabled=\{isOutage\(item\)\}/);
  assert.match(source, /if \(selected && isOutage\(selected\)\)/);
  assert.match(source, /notice notice-warn/);
  assert.match(source, /tandai gangguan/i);
  assert.match(css, /\.product\.is-outage\{/);
  assert.match(css, /\.notice-warn\{/);
});

test('halaman legal berisi aturan yang benar-benar berlaku, bukan template pasal', () => {
  for (const id of ['terms', 'privacy', 'contact']) {
    const page = LEGAL_PAGES[id];
    assert.ok(page?.title && page?.intro, `${id} punya judul dan intro`);
    assert.ok(page.sections.length >= 3, `${id} punya minimal tiga bagian`);
    for (const section of page.sections) assert.ok(section.title && (section.body || section.items), `${id}: bagian "${section.title}" berisi`);
  }
  const danger = LEGAL_PAGES.terms.sections.filter((section) => section.danger === true);
  assert.equal(danger.length, 1);
  assert.match(danger[0].body, /tetap terkirim/);
  const termsText = LEGAL_PAGES.terms.sections.map((section) => `${section.body || ''} ${(section.items || []).join(' ')}`).join(' ');
  assert.match(termsText, /dikembalikan penuh/);
  assert.match(termsText, /Tidak ada biaya tambahan/);
  assert.deepEqual(LEGAL_LINKS.map((link) => link.path), ['/syarat', '/privasi', '/kontak']);
});

test('kanal kontak dibentuk dari jawaban server dan tidak pernah jadi tautan mati', () => {
  assert.deepEqual(contactChannels(null), []);
  assert.deepEqual(contactChannels({ email: 'bukan-email', whatsapp: '08' }), []);
  const channels = contactChannels({ email: 'halo@melonbyte.id', whatsapp: 'https://wa.me/6281234567890', whatsappLabel: '+6281234567890' });
  assert.deepEqual(channels.map((channel) => channel.id), ['whatsapp', 'email']);
  assert.equal(channels[0].href, 'https://wa.me/6281234567890');
  assert.equal(channels[1].href, 'mailto:halo@melonbyte.id');
});

test('halaman legal, footer, dan kontak terhubung ke rute yang nyata', () => {
  assert.match(source, /import \{ LEGAL_LINKS, LEGAL_PAGES, contactChannels \} from '\.\/legal\.mjs'/);
  assert.match(source, /if \(path === '\/syarat'\) return \{ view: 'terms'/);
  assert.match(source, /if \(path === '\/privasi'\) return \{ view: 'privacy'/);
  assert.match(source, /if \(path === '\/kontak'\) return \{ view: 'contact'/);
  assert.match(source, /<LegalPage view=\{view\} info=\{contactInfo\} state=\{contactState\} \/>/);
  assert.match(source, /className="footer-links"/);
  assert.match(source, /request\('\/api\/contact'\)/);
  assert.match(css, /\.legal-page\{/);
});

test('refund punya status sendiri, panel admin, dan baris struk', () => {
  assert.match(source, /refunded: 'Dana dikembalikan'/);
  assert.match(source, /if \(path === '\/admin\/refund'\) return \{ view: 'admin', adminPage: 'refunds'/);
  assert.match(source, /Refund melalui Midtrans/);
  assert.match(source, /Tandai manual/);
  assert.match(source, /\/api\/admin\/orders\/\$\{encodeURIComponent\(order\.id\)\}\/refund/);
  assert.match(source, /\{receipt\.refundNote && <div><dt>Refund<\/dt>/);
  assert.match(source, /\{receipt\.sn && <div><dt>Nomor seri<\/dt>/);
  assert.match(css, /\.refund-card\{/);
});

test('setiap perubahan status pesanan memanggil notifikasi email di server', async () => {
  const server = await readFile(new URL('../server/app.mjs', import.meta.url), 'utf8');
  assert.match(server, /import \{ mailReady, orderEmail, sendOrderEmail \} from '\.\/mail\.mjs'/);
  for (const event of ['created', 'paid', 'fulfilled', 'failed', 'refunded']) {
    assert.ok(server.includes(`notifyOrder(pool, fetchImpl, env, '${event}'`), `event ${event} tidak dipanggil`);
  }
  assert.match(server, /timingSafeEqual/);
  assert.match(server, /api\/webhooks\/digiflazz/);
});
