import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8')

function bodyOf(name) {
  const start = source.indexOf(`function ${name}(`)
  assert.ok(start >= 0, `${name} harus ada di App.jsx`)
  const end = source.indexOf('\n  }', start)
  assert.ok(end > start, `${name} harus punya badan fungsi`)
  return source.slice(start, end)
}

// Setiap aksi yang mengubah data harus memberi umpan balik yang terlihat.
// Konvensi app: sukses -> toast popup, gagal -> pesan inline role=alert.
test('tombol simpan memberi popup sukses, bukan cuma pesan inline', () => {
  const expects = [
    ['saveProfile', 'Profil tersimpan'],
    ['savePassword', 'Kata sandi tersimpan'],
    ['verifyTwoStepCode', 'Verifikasi 2 langkah aktif'],
    ['syncCatalog', 'Katalog diperbarui'],
    ['saveSellingPrice', 'Harga tersimpan'],
    ['saveAllChanges', 'harga tersimpan'],
    ['applyBrandMargin', 'harga draft terisi'],
  ]
  for (const [fn, text] of expects) {
    const body = bodyOf(fn)
    assert.ok(body.includes('showToast('), `${fn} harus memanggil showToast`)
    assert.ok(body.includes(text), `${fn} harus menyebut "${text}" di popup`)
  }
})

test('aksi yang sudah punya popup tidak kehilangan popupnya', () => {
  const keep = [
    ['signOutAccount', 'Kamu sudah keluar'],
    ['cutSession', 'Sesi berakhir'],
  ]
  for (const [fn, text] of keep) {
    assert.ok(bodyOf(fn).includes(text), `${fn} harus tetap punya toast "${text}"`)
  }
  assert.ok(source.includes("showToast('ok', 'Berhasil masuk'"), 'login sukses harus tetap memberi toast')
})
