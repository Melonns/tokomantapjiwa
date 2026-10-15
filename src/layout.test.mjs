import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('./store.css', import.meta.url), 'utf8');
const source = await readFile(new URL('./App.jsx', import.meta.url), 'utf8');

test('header menempel di atas agar kolom pencarian tetap terjangkau saat digulir', () => {
  assert.match(css, /\.site-header\{[^}]*position:sticky[^}]*top:0[^}]*\}/);
  assert.match(css, /\.site-header\{[^}]*background:var\(--bg\)[^}]*\}/);
});

test('halaman akun tamu memakai panel form + kartu pintasan, bukan kolom teks generik', () => {
  assert.match(source, /'account-layout account-wide' : 'account-layout account-auth'/);
  assert.match(source, /<aside className="auth-aside">/);
  assert.match(source, /className="auth-fields"/);
  assert.match(css, /\.account-auth\{[^}]*minmax\(0,1\.45fr\) minmax\(250px,\.75fr\)[^}]*\}/);
  assert.match(css, /\.auth-fields\{[^}]*repeat\(2,minmax\(0,1fr\)\)[^}]*\}/);
  assert.match(css, /@media\(max-width:620px\)\{\.auth-fields\{grid-template-columns:minmax\(0,1fr\)\}\}/);
});
