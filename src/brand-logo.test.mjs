import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { brandLogo } from './brand-logo.mjs'

test('merek yang punya logo mengembalikan berkas gambar', () => {
  assert.equal(brandLogo('MOBILE LEGENDS').src, '/logo/game/mobile-legends.jpg')
  assert.equal(brandLogo('MOBILE LEGENDS').cover, true)
  assert.equal(brandLogo('Free Fire').src, '/logo/game/free-fire.jpg')
  assert.equal(brandLogo('FREE FIRE MAX').src, '/logo/game/free-fire.jpg')
  assert.equal(brandLogo('GO PAY').src, '/logo/gopay.svg')
  assert.equal(brandLogo('GO PAY').cover, undefined)
  assert.equal(brandLogo('Shopee Pay').src, '/logo/shopeepay.svg')
  assert.equal(brandLogo('by.U').src, '/logo/byu.svg')
  assert.equal(brandLogo('by.U').invert, true)
  assert.equal(brandLogo('Pertamina Gas').src, '/logo/pertamina.svg')
  assert.equal(brandLogo('  telkomsel  ').src, '/logo/telkomsel.svg')
  assert.equal(brandLogo('Merek Tanpa Logo'), null)
  assert.equal(brandLogo(''), null)
  assert.equal(brandLogo(null), null)
})

test('setiap logo yang dirujuk benar-benar ada dan berkasnya sehat', () => {
  const publik = new URL('../public/', import.meta.url)
  for (const nama of ['MOBILE LEGENDS', 'FREE FIRE', 'Genshin Impact', 'Honkai Star Rail', 'Valorant', 'GO PAY', 'SHOPEE PAY', 'DANA', 'OVO', 'TELKOMSEL', 'INDOSAT', 'XL', 'AXIS', 'SMARTFREN', 'by.U', 'PLN', 'Pertamina Gas']) {
    const logo = brandLogo(nama)
    assert.ok(logo, `logo ${nama} belum dipetakan`)
    const berkas = new URL(logo.src.replace(/^\//, ''), publik)
    assert.ok(existsSync(berkas), `berkas ${logo.src} tidak ada`)
    if (logo.src.endsWith('.svg')) {
      const isi = readFileSync(berkas, 'utf8')
      assert.match(isi, /<svg[\s>]/i, `${logo.src} bukan svg`)
      assert.match(isi, /viewBox=/i, `${logo.src} tanpa viewBox`)
      assert.doesNotMatch(isi, /<script/i, `${logo.src} memuat script`)
      assert.ok(isi.length > 200, `${logo.src} terlalu kecil`)
    } else {
      const buf = readFileSync(berkas)
      assert.equal(buf[0], 0xff, `${logo.src} bukan jpeg`)
      assert.equal(buf[1], 0xd8, `${logo.src} bukan jpeg`)
      assert.ok(buf.length > 20000, `${logo.src} terlalu kecil`)
    }
  }
})


