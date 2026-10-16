import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { jamWib, labelTanggalJam, tanggalWib } from './waktu.mjs';

const contoh = '2026-10-15T11:12:20.060Z';

test('tanggal WIB memakai nama bulan Indonesia', () => {
  assert.equal(tanggalWib(contoh), '15 Oktober 2026');
  assert.equal(tanggalWib(contoh, true), '15 Okt 2026');
});

test('jam WIB memakai format 24 jam dengan akhiran WIB', () => {
  assert.equal(jamWib(contoh), '18.12 WIB');
  assert.equal(jamWib('2026-10-15T17:05:00.000Z'), '00.05 WIB');
});

test('label gabungan dipakai pada kepala invoice', () => {
  assert.equal(labelTanggalJam(contoh), '15 Oktober 2026 pukul 18.12 WIB');
});

test('nilai kosong atau tidak sah tidak menampilkan teks', () => {
  assert.equal(tanggalWib(''), '');
  assert.equal(tanggalWib(undefined), '');
  assert.equal(jamWib(null), '');
  assert.equal(labelTanggalJam('bukan tanggal'), '');
});

test('invoice menampilkan tanggal, jam, dan batas pembayaran', async () => {
  const source = await readFile(new URL('./App.jsx', import.meta.url), 'utf8');
  const server = await readFile(new URL('../server/app.mjs', import.meta.url), 'utf8');
  const css = await readFile(new URL('./store.css', import.meta.url), 'utf8');
  assert.match(source, /import \{ labelTanggalJam, tanggalWib \} from '\.\/waktu\.mjs'/);
  assert.match(source, /<p className="invoice-meta">Dibuat \{labelTanggalJam\(receipt\.createdAt\)\}<\/p>/);
  assert.match(source, /<dt>Batas pembayaran<\/dt><dd>\{labelTanggalJam\(receipt\.paymentExpiresAt\)\}<\/dd>/);
  assert.match(source, /tanggalWib\(order\.createdAt, true\)/);
  assert.match(server, /created_at AS "createdAt" FROM orders WHERE owner_id = \$1/);
  assert.match(server, /created_at AS "createdAt" FROM orders ORDER BY/);
  assert.match(css, /\.invoice-meta\{/);
});
