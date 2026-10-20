// Warna merek dipakai sebagai cahaya latar poster, supaya kartu tidak tampak gelap mati.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { brandLogo, brandWarna } from './brand-logo.mjs'

const app = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('./store.css', import.meta.url), 'utf8')

test('warna merek dikenali walau penulisan namanya berbeda', () => {
  assert.equal(brandWarna('GO PAY'), '#00aed6')
  assert.equal(brandWarna('gopay'), '#00aed6')
  assert.equal(brandWarna('Free Fire'), '#ff6a00')
  assert.equal(brandWarna('MOBILE LEGENDS'), '#2a3f8f')
  assert.equal(brandWarna('TELKOMSEL'), '#ed0226')
  assert.equal(brandWarna('  dana  '), '#118eea')
  assert.equal(brandWarna('Merek Antah Berantah'), null)
  assert.equal(brandWarna(''), null)
})

test('setiap merek yang punya logo juga punya warna', () => {
  for (const nama of ['MOBILE LEGENDS', 'FREE FIRE', 'GENSHIN IMPACT', 'HONKAI STAR RAIL', 'SPEED DRIFTERS', 'VALORANT', 'STEAM WALLET (IDR)', 'PLAYSTATION', 'GO PAY', 'SHOPEE PAY', 'DANA', 'OVO', 'TELKOMSEL', 'INDOSAT', 'XL', 'AXIS', 'SMARTFREN', 'BY.U', 'PLN', 'PERTAMINA GAS']) {
    assert.ok(brandLogo(nama), `logo ${nama} tidak ada`)
    assert.match(brandWarna(nama) || '', /^#[0-9a-f]{6}$/, `warna ${nama} tidak ada`)
  }
})

test('poster memakai warna merek dan chip logo yang terang', () => {
  assert.match(app, /'--brand': brandWarna\(item\) \|\| '#3d5a35'/)
  assert.match(app, /'--brand-dark': brandGelap\(item\) \|\| '#22331d'/)
  assert.match(app, /<span className="poster-chip"><img className="poster-img"/)
  assert.match(css, /\.poster-art\{[^}]*var\(--brand-dark,#22331d\)/)
  assert.match(css, /\.poster-chip\{[^}]*background:#f4f7ef/)
  assert.match(css, /\.poster-img-foto\{[^}]*object-fit:cover/)
  assert.equal(/color-mix/.test(css), false, 'color-mix tidak boleh dipakai, browser lama tidak mendukung')
})
