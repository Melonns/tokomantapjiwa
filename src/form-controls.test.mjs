import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const css = await readFile(new URL('./store.css', import.meta.url), 'utf8')

test('input boxes shrink to 44px with 16px text (checkout 14.4px bug fixed)', () => {
  assert.match(css, /\.search-field input,\.checkout-form input,\.order-panel input,\.checkout-form select\{[^}]*min-height:44px[^}]*font-size:1rem\}/)
  assert.match(css, /\.home-search input\{[^}]*min-height:44px[^}]*\}/)
  assert.match(css, /\.profile-form input\{width:100%;min-width:0;min-height:44px\}/)
})

test('paired buttons follow the compact input height', () => {
  assert.match(css, /\.home-search button\{[^}]*min-height:44px[^}]*\}/)
  assert.match(css, /\.order-input button\{[^}]*min-height:44px\}/)
  assert.match(css, /\.profile-form>button\{min-height:44px\}/)
  assert.match(css, /\.checkout-button\{[^}]*min-height:48px[^}]*\}/)
})

test('register submit uses the brand primary style, never the browser default', () => {
  assert.match(css, /\.profile-form>button:not\(\.secondary-button\)\{[^}]*background:var\(--lime\)[^}]*\}/)
  assert.match(css, /\.profile-form>button:not\(\.secondary-button\):disabled\{[^}]*background:#455545/)
})

test('no oversized input rule remains (48px+)', () => {
  assert.doesNotMatch(css, /input\{[^}]*min-height:(?:48|50|54)px/)
})

test('profile panel compacts on wide screens without touching other forms', () => {
  assert.match(css, /@media\(min-width:761px\)\{\.profile-cols \.profile-form input\{min-height:40px;padding-block:8px\}/)
})

test('account fields keep labels close and separate adjacent fields', async () => {
  const source = await readFile(new URL('./App.jsx', import.meta.url), 'utf8')
  assert.match(css, /\.profile-form\{display:grid;gap:18px\}/)
  assert.match(css, /\.profile-field\{display:grid;gap:8px\}/)
  assert.match(css, /\.profile-field \.order-input\{margin-top:0\}/)
  assert.match(source, /<form className="profile-form" onSubmit=\{signIn\}>/)
  for (const id of ['register-email', 'register-password', 'register-phone', 'register-username', 'login-password']) {
    assert.match(source, new RegExp(`<div className="profile-field"><label htmlFor="${id}">`))
  }
})

test('supporting text stays separate from headings and checkout inputs', () => {
  assert.match(css, /\.account-layout h2\+p,\.order-layout h2\+p\{margin-top:14px;line-height:1\.6\}/)
  assert.match(css, /\.checkout-form \.field-hint\{margin:14px 0\}/)
})

test('login and SMS forms keep labels, actions, and messages separate', () => {
  assert.match(css, /\.order-panel>\.profile-form\{margin-top:20px\}/);
  assert.match(css, /\.order-panel \.code-form\{display:grid;gap:8px;margin-top:22px\}/);
  assert.match(css, /\.order-panel \.code-form \.order-input\{margin-top:0\}/);
  assert.match(css, /\.order-panel>\.link-button\{margin-top:18px\}/);
})

test('sign out is a red danger action in its own separated zone', () => {
  assert.match(css, /:root\{[^}]*--danger:#ff8f83/)
  assert.match(css, /\.signout-button\{[^}]*var\(--danger\)/)
  assert.match(css, /\.signout-zone\{[^}]*border-top:1px solid var\(--line\)/)
})

test('setiap input mematikan riwayat/autofill browser (kredensial & OTP tetap semantik)', async () => {
  const source = await readFile(new URL('./App.jsx', import.meta.url), 'utf8')
  const tags = source.match(/<input\b[\s\S]*?\/>/g) ?? []
  assert.equal(tags.length, (source.match(/<input\b/g) ?? []).length, 'ekstraksi tag input gagal')
  assert.ok(tags.length >= 18, `hanya ${tags.length} input terbaca`)
  for (const tag of tags) {
    assert.doesNotMatch(tag, /autoComplete="(?:email|name|nickname|tel|username|on)"/, tag)
    const exempt = /type="(?:checkbox|radio|hidden)"/.test(tag) || /readOnly/.test(tag)
    if (!exempt) assert.match(tag, /autoComplete="(?:off|one-time-code|current-password|new-password)"/, tag)
  }
})

test('checkout meminta Zone ID hanya untuk produk ml_concat dan pilih server untuk uid_server', async () => {
  const source = await readFile(new URL('./App.jsx', import.meta.url), 'utf8')
  assert.match(source, /\{orderFormat === 'ml_concat' && <label>Zone ID/)
  assert.match(source, /\{orderFormat === 'uid_server' && <label>Server <select/)
  assert.match(source, /selected\.format === 'plain' \|\| selected\.format === 'riot' \? \{ productId: selected\.id, userId: userId\.trim\(\) \} : \{ productId: selected\.id, userId: userId\.trim\(\), zoneId: zoneId\.trim\(\) \}/)
})

test('zona 2 langkah: baris aksi rapat dan tombol nonaktif jelas', () => {
  assert.match(css, /\.two-step-zone \.code-actions\{display:flex;flex-wrap:wrap;align-items:center;gap:4px 20px\}/)
  assert.match(css, /\.two-step-zone \.code-actions \.link-button\{margin-top:0\}/)
  assert.match(css, /\.link-button:disabled,\.secondary-button:disabled\{color:#849e80;cursor:not-allowed\}/)
})

test('form profil nggak melar ngikutin tinggi kolom kanan', () => {
  assert.match(css, /\.profile-col \.profile-form\{flex:0 1 auto;align-content:start\}/)
  assert.equal(css.includes('align-content:space-between'), false)
})
