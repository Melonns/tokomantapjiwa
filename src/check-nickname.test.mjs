import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./App.jsx', import.meta.url), 'utf8')
const css = await readFile(new URL('./store.css', import.meta.url), 'utf8')

test('memilih nominal tidak mengubah target pemeriksaan nickname', () => {
  assert.match(source, /\{checkProduct && \(/)
  assert.match(source, /const checkProduct = orderItems\.find\(\(item\) => item\.checkable === true\) \|\| null/)
  assert.doesNotMatch(source, /const checkProduct = selected\?\.checkable/)
})

test('tidak ada tombol periksa; permintaan berjalan sendiri setelah ID diisi', () => {
  assert.doesNotMatch(source, /className="check-again-button"|Periksa ulang/)
  assert.match(source, /setTimeout\(\(\) => \{ checkNickname\(false\) \}, 600\)/)
})

test('permintaan pemeriksaan memakai produk dari brand terpilih', () => {
  assert.match(source, /request\('\/api\/check-account', \{/)
  assert.match(source, /productId: checkProduct\.id, userId: id/)
  assert.match(source, /zoneId: zone, force: force === true/)
})

test('loading tetap tampil selama permintaan dan menunggu status pending', () => {
  assert.match(source, /\(checkState === 'loading' \|\| checkState === 'pending'\) && <p className="check-status" role="status">/)
  assert.match(source, /Memeriksa nickname\.\.\./)
  assert.match(source, /checkState === 'pending' \? 'Menunggu\.\.\.' : 'Memeriksa nickname\.\.\.'/)
  assert.doesNotMatch(source, /Digiflazz masih memproses/)
  assert.match(source, /className="check-spinner"/)
})

test('pending cek status cepat tanpa mengulang transaksi Digiflazz sebelum jatuh tempo', () => {
  assert.match(source, /async function checkNickname\(force, statusOnly = false\)/)
  assert.match(source, /if \(statusOnly\) body\.statusOnly = true/)
  assert.match(source, /statusOnly \? Math\.min\(2000, retryAfterSeconds \* 1000\) : 2000/)
  assert.match(source, /checkNickname\(false, statusOnly \? retryAfterSeconds > 0 : true\)/)
  assert.doesNotMatch(source, /pending_stopped|polls < 3|checkPollsRef/)
})

test('error sementara mempertahankan loading dan lanjut cek status dalam 2 detik', () => {
  assert.match(source, /const checkPendingRef = useRef\(false\)/)
  assert.match(source, /checkPendingRef\.current && \(error\?\.status === 429 \|\| error\?\.status >= 500 \|\| error instanceof TypeError \|\| error\?\.name === 'AbortError'\)/)
  assert.match(source, /checkNickname\(false, true\)[\s\S]*}, Math\.min\(10000, 2000 \* 2 \*\*/)
  assert.match(source, /checkRetryRef\.current = setTimeout\(\(\) => \{[\s\S]*checkNickname\(false, statusOnly \? retryAfterSeconds > 0 : true\)[\s\S]*statusOnly \? Math\.min\(2000, retryAfterSeconds \* 1000\) : 2000/)
  assert.match(source, /error\.status = response\.status/)
})

test('hasil pemeriksaan menampilkan nama dan asal data tanpa tombol', () => {
  assert.match(source, /Nickname: <strong>\{checkResult\.nickname\}<\/strong>/)
  assert.match(source, /'hasil tersimpan' : 'baru diperiksa'/)
  assert.doesNotMatch(source, /className="check-again-button"|Periksa ulang/)
})

test('kegagalan pemeriksaan ditampilkan apa adanya dan tidak mengunci checkout', () => {
  assert.match(source, /setCheckError\(error\.message\)/)
  assert.match(source, /Periksa nickname belum tersedia saat ini\./)
  assert.match(source, /checkState === 'error' && <p className="check-error" role="alert">\{checkError\}<\/p>/)
  assert.doesNotMatch(source, /className="check-again-button"|Periksa ulang/)
})

test('hasil pemeriksaan lama dibuang saat ID atau pilihan berubah', () => {
  assert.match(source, /\}, \[userId, zoneId, checkProduct\?\.id, checkFormat, checkAvailable, loggedIn\]\)/)
  assert.match(source, /if \(run !== checkRunRef\.current\) return/)
})

test('kelas gaya periksa nickname tersedia di stylesheet', () => {
  assert.match(css, /\.check-status\{/)
  assert.match(css, /\.check-spinner\{/)
  assert.match(css, /\.check-result\{/)
  assert.match(css, /\.check-error\{/)
  assert.doesNotMatch(css, /\.check-again-button/)
})
