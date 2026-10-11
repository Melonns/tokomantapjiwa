import { test } from 'node:test'
import assert from 'node:assert/strict'
import { authReturnFromUrl, restoreSession } from './auth.mjs'

function page(href) {
  const location = new URL(href)
  const history = { state: null, replaceState(_state, _title, url) { location.href = new URL(url, location).href } }
  return { location, history }
}

test('legacy OAuth callback clears secrets before verifying session', async () => {
  const { location, history } = page('http://localhost:5173/?campaign=store#access_token=test-only&refresh_token=test-refresh&provider_token=test-provider&expires_in=3600&token_type=bearer')
  const session = { user: { user_metadata: { username: 'melon_24' } } }
  const auth = {
    async setSession(tokens) {
      assert.equal(location.hash, '')
      assert.equal(location.search, '?campaign=store')
      assert.deepEqual(tokens, { access_token: 'test-only', refresh_token: 'test-refresh' })
      return { data: { session }, error: null }
    },
  }
  assert.equal(await restoreSession(auth, location, history), session)
})

test('failed callback removes secrets and reports safe error', async () => {
  const { location, history } = page('http://localhost:5173/#access_token=test-only&refresh_token=test-refresh')
  await assert.rejects(restoreSession({ async setSession() { throw new Error('secret-test-only') } }, location, history), { message: 'Sesi login gagal dibaca. Coba masuk lagi.' })
  assert.equal(location.hash, '')
})

test('PKCE callback clears code before exchanging and restores session', async () => {
  const { location, history } = page('http://localhost:5173/?code=test-code&sb_flow_id=test-flow&campaign=store')
  const session = { user: { id: 'test-user' } }
  assert.equal(await restoreSession({ async exchangeCodeForSession(code, options) {
    assert.equal(code, 'test-code')
    assert.deepEqual(options, { flowId: 'test-flow' })
    assert.equal(location.search, '?campaign=store')
    return { data: { session }, error: null }
  } }, location, history), session)
})

test('ordinary account URL preserves route and recovers stored session', async () => {
  const { location, history } = page('http://localhost:5173/#akun')
  const session = { user: { id: 'test-user' } }
  assert.equal(await restoreSession({ async getSession() { return { data: { session }, error: null } } }, location, history), session)
  assert.equal(location.hash, '#akun')
})

test('incomplete token callback fails closed instead of showing signed-in state', async () => {
  const { location, history } = page('http://localhost:5173/#access_token=test-only')
  await assert.rejects(restoreSession({}, location, history), { message: 'Sesi login gagal dibaca. Coba masuk lagi.' })
  assert.equal(location.hash, '')
})

test('OAuth error description is removed and never displayed verbatim', async () => {
  const { location, history } = page('http://localhost:5173/#error=access_denied&error_description=secret-test-only')
  await assert.rejects(restoreSession({}, location, history), { message: 'Sesi login gagal dibaca. Coba masuk lagi.' })
  assert.equal(location.hash, '')
})

test('OAuth cancel return is detected as cancelled', () => {
  assert.deepEqual(authReturnFromUrl('http://localhost:5173/?error=access_denied&error_description=secret-test-only'), { kind: 'cancelled' })
  assert.deepEqual(authReturnFromUrl('http://localhost:5173/#error=access_denied'), { kind: 'cancelled' })
})

test('OAuth failure keeps kind but never exposes description', () => {
  const info = authReturnFromUrl('http://localhost:5173/?error=server_error&error_description=secret-test-only')
  assert.equal(info.kind, 'error')
  assert.equal(JSON.stringify(info).includes('secret-test-only'), false)
})

test('PKCE and legacy returns are detected for success feedback', () => {
  assert.deepEqual(authReturnFromUrl('http://localhost:5173/?code=test-code&sb_flow_id=test-flow'), { kind: 'pkce' })
  assert.deepEqual(authReturnFromUrl('http://localhost:5173/?access_token=test-only&refresh_token=test-refresh'), { kind: 'session' })
})

test('broken token return fails closed', () => {
  assert.deepEqual(authReturnFromUrl('http://localhost:5173/#access_token=test-only'), { kind: 'error' })
})

test('ordinary routes are not auth returns', () => {
  assert.equal(authReturnFromUrl('http://localhost:5173/'), null)
  assert.equal(authReturnFromUrl('http://localhost:5173/#akun'), null)
})
