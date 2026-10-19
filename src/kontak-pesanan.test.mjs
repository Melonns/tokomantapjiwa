// Detail kontak saat membeli harus bisa diisi dan diubah, untuk member maupun bukan.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const app = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('./store.css', import.meta.url), 'utf8')
const core = readFileSync(new URL('../server/core.mjs', import.meta.url), 'utf8')
const server = readFileSync(new URL('../server/app.mjs', import.meta.url), 'utf8')
const schema = readFileSync(new URL('../database/schema.sql', import.meta.url), 'utf8')

test('kolom kontak bisa diketik, bukan terkunci', () => {
  assert.match(app, /<input value=\{contactEmail\} onChange=\{\(event\) => setContactEmail\(event\.target\.value\)\} type="email"/)
  assert.match(app, /<input value=\{contactPhone\} onChange=\{\(event\) => setContactPhone\(event\.target\.value\)\} type="tel"/)
  assert.equal(/readOnly aria-describedby="kontak-bisa-diubah"/.test(app), false, 'kolom kontak tidak boleh readOnly')
  assert.equal(/disabled aria-describedby="kontak-bisa-diubah"/.test(app), false, 'kolom kontak tidak boleh disabled')
  assert.equal(/field-locked/.test(app), false, 'tidak ada kolom kontak yang ditandai terkunci')
})

test('kontak terisi dari profil tetapi tetap bisa diubah', () => {
  assert.match(app, /setContactEmail\(\(current\) => current \|\| profilEmail\)/)
  assert.match(app, /setContactPhone\(\(current\) => current \|\| profilPhone\)/)
  assert.match(app, /Terisi dari profil akun\./);
  assert.match(app, /Masuk ke akun untuk menyelesaikan pesanan\./);
})

test('kontak ikut dikirim dan disimpan di pesanan', () => {
  assert.match(app, /contactEmail: contactEmail\.trim\(\), contactPhone: contactPhone\.trim\(\)/)
  assert.match(core, /contactEmail !== undefined && \(typeof contactEmail !== 'string'/)
  assert.match(core, /if \(contactEmail\) input\.contactEmail = contactEmail\.trim\(\)/)
  assert.match(server, /INSERT INTO orders \([^)]*contact_email, contact_phone, payment_environment\)/)
  assert.match(server, /COALESCE\(o\.contact_email, \(SELECT email FROM auth\.users/)
  assert.match(schema, /contact_email text CHECK \(contact_email IS NULL OR length\(contact_email\) BETWEEN 3 AND 120\)/)
  assert.match(schema, /contact_phone text CHECK \(contact_phone IS NULL OR length\(contact_phone\) BETWEEN 8 AND 20\)/)
})

test('email kontak divalidasi sebelum pesanan dibuat', () => {
  assert.match(app, /Isi email kontak yang valid sebelum membuat pesanan\./)
  assert.match(app, /Isi nomor HP kontak yang valid sebelum membuat pesanan\./)
})

test('email di halaman profil tetap ditandai terkunci', () => {
  assert.match(app, /<label htmlFor="profile-email">Email<span className="field-badge"><IkonGembok \/>Terkunci<\/span><\/label>/)
  assert.match(css, /\.field-badge\{[^}]*border-radius:var\(--r-pill\)/)
  assert.match(css, /\.field-badge-edit\{/)
})

test('kontak pesanan tampil di daftar transaksi admin', () => {
  assert.match(server, /contact_phone AS "contactPhone", COALESCE\(contact_email, \(SELECT email FROM auth\.users WHERE id = orders\.owner_id\)\) AS "contactEmail"/)
  assert.match(app, /className="order-contact"/)
  assert.match(app, /https:\/\/wa\.me\/\$\{order\.contactPhone\.replace/)
  assert.match(css, /\.order-contact\{color:var\(--muted\)/)
})

test('radius memakai skala tetap, bukan nilai acak', () => {
  assert.match(css, /--r-pill:999px;--r-card:22px;--r-tile:14px;--r-round:50%/)
  assert.equal(/border-radius:\s*(5|6|8|9|10|12|14|16|18)px/.test(css), false, 'radius harus memakai token var(--r-*), bukan piksel acak')
  assert.match(css, /\.home-search input\{[^}]*border-radius:var\(--r-pill\)/)
  assert.match(css, /\.game-card\{[^}]*border-radius:var\(--r-card\)/)
  assert.match(css, /\.step-badge\{[^}]*border-radius:var\(--r-tile\)/)
})
