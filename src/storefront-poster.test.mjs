// Kartu katalog memakai gaya poster besar dengan efek hover.
// Tujuannya supaya gambar layanan menonjol dan mudah dipindai mata.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const app = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('./store.css', import.meta.url), 'utf8')

test('katalog memakai grid poster dan kartu poster', () => {
  assert.match(app, /className="game-grid poster-grid"/)
  assert.match(app, /className="game-card poster"/)
  assert.match(app, /className="poster-art"/)
  assert.match(app, /className="poster-blur"/)
  assert.match(app, /<span className="poster-chip"><img className="poster-img"/)
  assert.match(app, /className="poster-img poster-img-foto"/)
  assert.match(app, /className="poster-text"/)
  assert.match(app, /className="poster-hint"/)
  assert.match(app, /className="poster-initial"/)
})

test('kartu poster punya proporsi tegak dan efek hover', () => {
  assert.match(css, /\.game-card\.poster\{[^}]*aspect-ratio:3\/4/)
  assert.match(css, /\.game-card\.poster:hover,[^{]*\{[^}]*translateY\(-4px\)/)
  assert.match(css, /\.poster-blur\{[^}]*filter:blur\(/)
  assert.match(css, /\.game-card\.poster:hover \.poster-chip,[^{]*\{[^}]*scale\(1\.05\)/)
  assert.match(css, /\.game-card\.poster:hover \.poster-text strong\{[^}]*color:var\(--lime\)/)
  assert.match(css, /\.game-card\.poster:hover \.poster-hint,[^{]*\{[^}]*color:var\(--lime\)/)
})

test('poster menyesuaikan layar kecil dan menghormati gerak minimal', () => {
  assert.match(css, /@media\(max-width:620px\)\{\.poster-grid\{grid-template-columns:repeat\(auto-fill,minmax\(140px,1fr\)/)
  assert.match(css, /@media\(max-width:460px\)\{\.poster-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}\}/)
  assert.match(css, /\.poster-text strong\{font-size:\.85rem\}\r?\n\.poster-hint\{display:inline-flex\}/)
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{[^}]*\.poster-hint/)
})

test('skip navigation moves keyboard focus to main content', () => {
  assert.match(app, /<main id="main" tabIndex=\{-1\}>/)
})
