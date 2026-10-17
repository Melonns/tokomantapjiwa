// Tombol perbarui gambar game di panel admin harus ada dan dilindungi admin.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const server = readFileSync(new URL('../server/app.mjs', import.meta.url), 'utf8')
const app = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8')

test('server menyediakan endpoint perbarui gambar khusus admin', () => {
  const awal = server.indexOf("path === '/api/admin/game-icons/refresh'")
  assert.ok(awal > -1, 'endpoint perbarui gambar belum ada')
  const blok = server.slice(awal, awal + 400)
  assert.match(blok, /authenticatedAdmin\(req, pool, fetchImpl, env\)/)
  assert.match(blok, /refreshGameIcons\(/)
})

test('panel admin punya tombol dan status hasil perbarui gambar', () => {
  assert.match(app, /onClick=\{refreshGameImages\}/)
  assert.match(app, /Perbarui gambar game/)
  assert.match(app, /'\/api\/admin\/game-icons\/refresh'/)
  assert.match(app, /gambarBusy \? 'Memperbarui\.\.\.'/)
  assert.match(app, /gambarNotice && <p className="catalog-sync-notice" role="status">/)
})
