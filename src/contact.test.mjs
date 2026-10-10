import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseContact, parseRegistration, tryParseContact } from './contact.mjs'

test('email and phone share one field without ambiguous fallback', () => {
  assert.deepEqual(parseContact(' aku@example.com '), { email: 'aku@example.com' })
  assert.deepEqual(parseContact('081234567890'), { phone: '+6281234567890' })
  assert.deepEqual(parseContact('6281234567890'), { phone: '+6281234567890' })
  assert.deepEqual(parseContact(' +6281234567890 '), { phone: '+6281234567890' })
  for (const input of ['bukan-email', 'aku@', '0812 3456 7890', '0812abc', '12345678', '+62081234567890', '']) {
    assert.throws(() => parseContact(input), /Masukkan email valid/)
  }
})

test('registration stores three distinct fields only after validation', () => {
  const profile = parseRegistration(' aku@example.com ', '081234567890', ' melon_24 ')
  assert.equal(profile.email, 'aku@example.com')
  assert.equal(profile.requested_phone, parseContact('081234567890').phone)
  assert.equal(profile.username, 'melon_24')
  for (const [email, phone, username] of [
    ['bad', '081234567890', 'melon_24'],
    ['aku@example.com', 'not-a-phone', 'melon_24'],
    ['aku@example.com', '081234567890', 'x'],
    ['aku@example.com', '081234567890', ' nama pakai spasi '],
  ]) assert.throws(() => parseRegistration(email, phone, username))
})

test('tryParseContact stays silent while the visitor is still typing', () => {
  assert.deepEqual(tryParseContact('a@b'), {})
  assert.deepEqual(tryParseContact('0812'), {})
  assert.deepEqual(tryParseContact(''), {})
  assert.deepEqual(tryParseContact('aku@example.com'), { email: 'aku@example.com' })
})
