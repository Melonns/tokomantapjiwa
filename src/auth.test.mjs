import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./App.jsx', import.meta.url), 'utf8')

test('client uses PKCE and callback restoration instead of automatic fragment handling', () => {
  assert.match(source, /flowType: 'pkce'/)
  assert.match(source, /detectSessionInUrl: false/)
  assert.match(source, /restoreSession\(supabase\.auth/)
})

test('storefront has one shared search input and no login explainer notes', () => {
  assert.equal([...source.matchAll(/type="search"/g)].length, 1)
  assert.equal(source.includes('className="auth-note"'), false)
})

test('Google and email callbacks leave URL fragment free for Supabase session', () => {
  const redirects = [...source.matchAll(/(?:emailRedirectTo|redirectTo):\s*(window\.location\.origin\s*\+\s*'[^']*')/g)]
  assert.equal(redirects.length, 3)
  for (const [, expression] of redirects) {
    const redirect = Function('window', `return ${expression}`)({ location: { origin: 'http://localhost:5173' } })
    assert.equal(new URL(redirect).hash, '', 'Auth redirect must not contain app hash route')
    const callback = new URL(redirect + '#access_token=test-only&refresh_token=test-only')
    assert.equal(new URLSearchParams(callback.hash.slice(1)).has('access_token'), true)
  }
})

test('logout clears the session locally even if the server call hangs or fails', () => {
  assert.match(source, /async function signOutAccount\(\)/)
  assert.match(source, /signOut\(\{ scope: 'local' \}\)/)
  assert.match(source, /onClick=\{signOutAccount\}/)
  assert.doesNotMatch(source, /onClick=\{\(\) => supabase\.auth\.signOut\(\)\}/)
  assert.match(source, /addEventListener\('storage', syncSignOutAcrossTabs\)/)
})

test('email sign-in uses password login with an email-link fallback', () => {
  assert.match(source, /signInWithPassword\(\{ email: identity\.email, password: loginPassword \}\)/)
  assert.match(source, /async function sendEmailLink\(\)/)
  assert.match(source, /Masuk tanpa password \(kirim tautan ke email\)/)
  assert.match(source, /updateUser\(\{ password: passwordDraft \}\)/)
  assert.match(source, /password: registerPassword/)
})

test('profile page carries name, username, email, phone and the password change block', () => {
  assert.match(source, /id="profile-name"/)
  assert.match(source, /id="profile-email"/)
  assert.match(source, /readOnly/)
  assert.match(source, /id="account-current-password"/)
  assert.match(source, /id="account-password-confirm"/)
  assert.match(source, /Kata sandi baru/)
  assert.match(source, /profile-cols/)
  assert.match(source, /profile-field/)
  assert.match(source, /signout-zone/)
  assert.match(source, /signInWithPassword\(\{ email: session\.user\.email, password: passwordCurrent \}\)/)
})

