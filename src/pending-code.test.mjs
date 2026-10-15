import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PENDING_CODE_KEY, PENDING_CODE_TTL_MS, clearPendingCode, readPendingCode, writePendingCode } from './pending-code.mjs'

function fakeStorage() {
  const map = new Map()
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    dump: () => map,
  }
}

test('draf kode yang dikirim pulih setelah refresh, lengkap dengan sisa hitungan kirim ulang', () => {
  const storage = fakeStorage()
  const now = 1_700_000_000_000
  writePendingCode(storage, { email: 'pembeli@contoh.com', purpose: 'signup', sentAt: now - 5_000 })
  const pending = readPendingCode(storage, now)
  assert.equal(pending.email, 'pembeli@contoh.com')
  assert.equal(pending.purpose, 'signup')
  assert.equal(pending.resendWait, 55)
})

test('draf kode yang sudah lewat 1 jam dibuang, bukan dipulihkan', () => {
  const storage = fakeStorage()
  const now = 1_700_000_000_000
  writePendingCode(storage, { email: 'pembeli@contoh.com', purpose: 'login', sentAt: now - PENDING_CODE_TTL_MS })
  assert.equal(readPendingCode(storage, now), null)
})

test('draf kode rusak, kosong, atau aneh dianggap tidak ada', () => {
  const storage = fakeStorage()
  const now = 1_700_000_000_000
  assert.equal(readPendingCode(storage, now), null)
  storage.setItem(PENDING_CODE_KEY, '{bukan json')
  assert.equal(readPendingCode(storage, now), null)
  storage.setItem(PENDING_CODE_KEY, JSON.stringify({ email: '   ', purpose: 'signup', sentAt: now }))
  assert.equal(readPendingCode(storage, now), null)
  storage.setItem(PENDING_CODE_KEY, JSON.stringify({ email: 'a@b.com', purpose: 'admin', sentAt: now }))
  assert.equal(readPendingCode(storage, now), null)
  storage.setItem(PENDING_CODE_KEY, JSON.stringify({ email: 'a@b.com', purpose: 'login', sentAt: 'kemarin' }))
  assert.equal(readPendingCode(storage, now), null)
})

test('draf kode dibersihkan setelah verifikasi sukses', () => {
  const storage = fakeStorage()
  writePendingCode(storage, { email: 'pembeli@contoh.com', purpose: 'signup', sentAt: Date.now() })
  clearPendingCode(storage)
  assert.equal(readPendingCode(storage, Date.now()), null)
  assert.equal(storage.dump().size, 0)
})
