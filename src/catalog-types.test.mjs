import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./App.jsx', import.meta.url), 'utf8')

test('katalog membangun tipe dari kategori supplier, bukan tab statis', () => {
  assert.match(source, /const CATALOG_TYPES = \[/)
  assert.match(source, /const GENERIC_CATALOG_BLUEPRINT = \{/)
  assert.match(source, /const genericCatalogType = \(category\) =>/)
  assert.match(source, /const catalogTypesFor = \(products = \[\]\) =>/)
  assert.match(source, /const catalogTypeOf = \(item, types = CATALOG_TYPES\) =>/)
  assert.match(source, /const \[category, setCategory\] = useState\('game'\)/)
  assert.doesNotMatch(source, /const ALL_CATALOG_TYPES = \[\.\.\.CATALOG_TYPES, OTHER_CATALOG_TYPE\]/)
  for (const category of ["'Games'", "'Pulsa'", "'Data'", "'E-Money'", "'PLN'", "'TV'"]) {
    assert.ok(source.includes(category), `kategori ${category} hilang dari peta tipe`)
  }
  assert.doesNotMatch(source, /\['Game', 'Pulsa', 'Hiburan'\]/)
})

test('tab, grid brand, dan empty state mengikuti tipe aktif', () => {
  assert.match(source, /const catalogTypes = catalogTypesFor\(products\)/)
  assert.match(source, /const activeType = catalogTypes\.find\(\(type\) => type\.id === category\) \|\| CATALOG_TYPES\[0\]/)
  assert.match(source, /const typeTabs = catalogTypes/)
  assert.match(source, /\{typeTabs\.map\(\(type\) => <button key=\{type\.id\} type="button" className=\{activeType\.id === type\.id \? 'active' : ''\}/)
  assert.match(source, /const activeBrands = \[\.\.\.new Set\(products\.filter\(\(item\) => catalogTypeOf\(item, catalogTypes\)\.id === activeType\.id\)\.map\(\(item\) => item\.game\)\.filter\(Boolean\)\)\]/)
  assert.match(source, /\{activeBrands\.map\(\(item\) => \{ const logo = brandLogo\(item\); return <button key=\{item\} type="button" className="game-card poster"/)
  assert.match(source, /<strong>\{activeType\.label\} belum tersedia\.<\/strong>/)
})

test('kotak tujuan memakai salinan per tipe layanan', () => {
  assert.match(source, /const orderType = catalogTypeOf\(selected \|\| orderItems\[0\] \|\| \{\}, catalogTypes\)/)
  assert.match(source, /<span className="step-badge" aria-hidden="true">1<\/span><h3>\{orderType\.targetTitle\}<\/h3>/)
  assert.match(source, /<label>\{orderFormat === 'riot' \? 'Riot ID' : orderType\.targetLabel\} <input/)
  assert.match(source, /placeholder=\{orderFormat === 'riot' \? 'Nama#1234' : orderType\.targetPlaceholder\}/)
  assert.equal(source.includes('Pastikan User ID dan Zone ID sesuai akun game tujuan.'), false)
  assert.match(source, /\{orderFormat === 'plain' \? orderType\.targetHint : orderFormat === 'ml_concat' \? 'User ID dan Zone ID berupa angka\. Jangan memasukkan kata sandi\.'/)
})
