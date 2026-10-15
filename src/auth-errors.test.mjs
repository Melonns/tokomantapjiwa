import { test } from 'node:test'
import assert from 'node:assert/strict'
import { authErrorMessage } from './auth-errors.mjs'

test('common Supabase auth failures get short honest Indonesian messages', () => {
  assert.equal(authErrorMessage('Invalid login credentials'), 'Email atau password salah.')
  assert.match(authErrorMessage('Email not confirmed'), /belum dikonfirmasi/)
  assert.match(authErrorMessage('Password should be at least 6 characters'), /minimal 6 karakter/)
  assert.match(authErrorMessage('User already registered'), /sudah terdaftar/)
  assert.match(authErrorMessage('For security purposes, you can only request this after 47 seconds'), /Tunggu sebentar/)
  assert.match(authErrorMessage('Token has expired or is invalid'), /kedaluwarsa/)
})

test('unknown failures fall back safely and never render empty text', () => {
  assert.equal(authErrorMessage(''), 'Gagal memproses. Coba lagi.')
  assert.equal(authErrorMessage(undefined), 'Gagal memproses. Coba lagi.')
  assert.equal(authErrorMessage('Kaboom dari server'), 'Kaboom dari server')
})
