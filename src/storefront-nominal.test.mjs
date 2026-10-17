import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('./store.css', import.meta.url), 'utf8')

test('halaman pilih nominal mengelompokkan produk per jenis', () => {
  assert.match(source, /const orderKinds = groupByKind\(/)
  assert.match(source, /orderKinds\.map\(\(kind\) => <Fragment key=\{kind\.name\}>/)
  assert.match(source, /kind\.items\.map\(\(item\) => <button/)
  assert.match(source, /className="product-kind"/)
  assert.match(source, /\{kind\.items\.length\} nominal/)
  assert.match(css, /\.product-kind\{/)
  assert.match(css, /\.product-kind-count\{/)
})

test('brand yang jenisnya cuma satu tampil tanpa judul kelompok', () => {
  assert.match(source, /\{orderKinds\.length > 1 && <p className="product-kind">/)
})
