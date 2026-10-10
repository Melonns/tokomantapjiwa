import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isPublicSupabaseKey } from './public-key.mjs'
import config from '../vite.config.js'

test('Vite strips unsafe browser key and blocks production build', () => {
  const guard = config.plugins.find(plugin => plugin.name === 'public-supabase-key-only')
  const dev = { command: 'serve', env: { VITE_SUPABASE_ANON_KEY: 'sb_secret_test_only' } }
  guard.configResolved(dev)
  assert.equal(dev.env.VITE_SUPABASE_ANON_KEY, '')
  assert.equal(dev.env.VITE_SUPABASE_AUTH_ERROR, 'true')
  assert.throws(() => guard.configResolved({ command: 'build', env: { VITE_SUPABASE_ANON_KEY: jwt('service_role') } }), /Build diblokir/)
})

const jwt = (role) => ['test', btoa(JSON.stringify({ role })), 'test'].join('.')
test('browser accepts only publishable or legacy anon key, never secret or service_role', () => {
  assert.equal(isPublicSupabaseKey('sb_publishable_test_only'), true)
  assert.equal(isPublicSupabaseKey(jwt('anon')), true)
  for (const key of ['sb_secret_test_only', jwt('service_role'), jwt('authenticated'), '', undefined, 'garbage']) {
    assert.equal(isPublicSupabaseKey(key), false)
  }
})
