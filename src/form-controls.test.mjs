import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const css = await readFile(new URL('./store.css', import.meta.url), 'utf8')

test('input boxes shrink to 44px with 16px text (checkout 14.4px bug fixed)', () => {
  assert.match(css, /\.search-field input,\.checkout-form input,\.order-panel input\{[^}]*min-height:44px[^}]*font-size:1rem\}/)
  assert.match(css, /\.home-search input\{[^}]*min-height:44px[^}]*\}/)
  assert.match(css, /\.profile-form input\{width:100%;min-width:0;min-height:44px\}/)
})

test('paired buttons follow the compact input height', () => {
  assert.match(css, /\.home-search button\{[^}]*min-height:44px[^}]*\}/)
  assert.match(css, /\.order-input button\{[^}]*min-height:44px\}/)
  assert.match(css, /\.profile-form>button\{min-height:44px\}/)
  assert.match(css, /\.checkout-button\{[^}]*min-height:48px[^}]*\}/)
})

test('no oversized input rule remains (48px+)', () => {
  assert.doesNotMatch(css, /input\{[^}]*min-height:(?:48|50|54)px/)
})

test('profile panel compacts on wide screens without touching other forms', () => {
  assert.match(css, /@media\(min-width:761px\)\{\.profile-cols \.profile-form input\{min-height:40px;padding-block:8px\}/)
})

test('sign out is a red danger action in its own separated zone', () => {
  assert.match(css, /:root\{[^}]*--danger:#ff8f83/)
  assert.match(css, /\.signout-button\{[^}]*var\(--danger\)/)
  assert.match(css, /\.signout-zone\{[^}]*border-top:1px solid var\(--line\)/)
})


