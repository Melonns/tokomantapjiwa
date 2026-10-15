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
  assert.equal(redirects.length, 6)
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
  assert.match(source, /Masuk tanpa password \(kirim kode ke email\)/)
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

test('back/forward cache restore releases the stuck Google button and reports a cancel', () => {
  assert.match(source, /addEventListener\('pageshow', handleHistoryRestore\)/)
  assert.match(source, /if \(!event\.persisted \|\| loginState !== 'loading'\) return/)
  assert.match(source, /removeEventListener\('pageshow', handleHistoryRestore\)/)
})

test('kode email bisa diverifikasi untuk daftar dan login, plus kirim ulang', () => {
  assert.match(source, /verifyOtp\(\{ email: emailCodeFor, token: emailCode, type \}\)/)
  assert.match(source, /const type = emailCodePurpose === 'signup' \? 'signup' : 'email'/)
  assert.match(source, /async function resendEmailCode\(\)/)
  assert.match(source, /supabase\.auth\.resend\(\{ type: 'signup', email: emailCodeFor/)
  assert.match(source, /id="email-code"/)
  assert.match(source, /autoComplete="one-time-code"/)
})

test('verifikasi 2 langkah dikonfirmasi pakai kode email saat nyala dan mati', () => {
  assert.ok(source.includes('const twoStepOn = session?.user?.user_metadata?.two_step === true'))
  assert.ok(source.includes('async function requestTwoStepChange()'))
  assert.ok(source.includes('async function resendTwoStepCode()'))
  assert.ok(source.includes('async function verifyTwoStepCode(event)'))
  assert.ok(source.includes("verifyOtp({ email: session.user.email, token: twoStepCode, type: 'email' })"))
  assert.ok(source.includes('updateUser({ data: { ...session.user.user_metadata, two_step: twoStepNext } })'))
  assert.ok(source.includes('id="two-step-code"'))
  assert.ok(source.includes('Verifikasi 2 langkah'))
  assert.ok(source.includes('aria-pressed={twoStepOn}'))
  assert.ok(source.includes('cancelTwoStepChange'))
  assert.equal(source.includes('async function toggleTwoStep()'), false)
  assert.equal(source.includes('setCodeTarget('), false)
})

test('nama dari akun Google dipakai di sapaan dan profil', () => {
  assert.ok(source.includes('user_metadata?.name || session?.user.user_metadata?.full_name || session?.user.user_metadata?.username'))
  assert.ok(source.includes("setProfileName(meta.name || meta.full_name || '')"))
  assert.ok(source.includes('data.user?.user_metadata?.name || data.user?.user_metadata?.full_name'))
})

test('login nomor HP lewat server tetap pakai kata sandi, verifikasi tetap lewat email', () => {
  assert.match(source, /fetch\('\/api\/auth\/login', \{ method: 'POST'/)
  assert.match(source, /JSON\.stringify\(\{ phone: identity\.phone, password: loginPassword \}\)/)
  assert.match(source, /supabase\.auth\.setSession\(\{ access_token: data\.session\.access_token, refresh_token: data\.session\.refresh_token \}\)/)
  assert.match(source, /needsConfirmation/)
  assert.doesNotMatch(source, /signInWithOtp\(\{ phone:/)
  assert.doesNotMatch(source, /verifyOtp\(\{ phone:/)
  assert.doesNotMatch(source, /id="sms-code"/)
  assert.doesNotMatch(source, /phone-change-code/)
  assert.doesNotMatch(source, /Login pakai nomor HP belum aktif/)
})

test('kolom login menerima email atau nomor HP dan kata sandinya selalu tampil', () => {
  assert.match(source, /Email atau nomor HP/)
  assert.match(source, /<div className="profile-field"><label htmlFor="login-password">Password<\/label>/)
  assert.equal(source.includes("contactIdentity.email || contactIdentity.phone ? 'Masuk' : 'Lanjut'"), false)
  assert.equal(source.includes('(contactIdentity.email || contactIdentity.phone) && <div className="profile-field">'), false)
})

test('kode email menerima 6 sampai 10 digit sesuai setelan Supabase', () => {
  assert.equal([...source.matchAll(/pattern="\[0-9\]\{6,10\}"/g)].length, 2)
  assert.equal([...source.matchAll(/maxLength="10"/g)].length, 2)
  assert.equal(source.includes('maxLength="6"'), false)
  assert.equal(source.includes('6 digit'), false)
})

test('draf kode bertahan setelah refresh atau koneksi putus di step kode', () => {
  assert.ok(source.includes('readPendingCode(window.localStorage, Date.now())'))
  assert.ok(source.includes('clearPendingCode(window.localStorage)'))
  assert.equal([...source.matchAll(/writePendingCode\(window\.localStorage/g)].length, 6)
})

test('email yang sudah terdaftar langsung dikirimi kode masuk, bukan jalan buntu', () => {
  assert.ok(source.includes('await sendLoginEmail(email)'))
  assert.ok(source.includes('Email ini sudah terdaftar — kamu langsung masuk ke akun itu.'))
  assert.equal(source.includes('Masuk aja, atau pakai'), false)
})

test('login dengan email belum dikonfirmasi langsung dikirimi kode konfirmasi baru', () => {
  assert.ok(source.includes("if (identity?.email && /email not confirmed/i.test(error.message || ''))"))
  assert.ok(source.includes("supabase.auth.resend({ type: 'signup', email: identity.email"))
  assert.ok(source.includes('Email kamu belum dikonfirmasi. Kode konfirmasi baru sudah dikirim'))
  assert.ok(source.includes("writePendingCode(window.localStorage, { email: identity.email, purpose: 'signup', sentAt: Date.now() })"))
})
