import io

ROOT = r'C:\Users\user\Documents\GitHub\tokomantapjiwa'

def read(path):
    with io.open(path, 'r', encoding='utf-8', newline='') as fh:
        text = fh.read()
    nl = '\r\n' if '\r\n' in text else '\n'
    return text.replace('\r\n', '\n'), nl

def write(path, text, nl):
    with io.open(path, 'w', encoding='utf-8', newline='') as fh:
        fh.write(text.replace('\n', nl))

def sub(text, old, new, count, label):
    found = text.count(old)
    assert found == count, '%s: ketemu %d, harusnya %d' % (label, found, count)
    print('OK  %s (x%d)' % (label, found))
    return text.replace(old, new)

# ---------------- database/schema.sql ----------------
path = ROOT + r'\database\schema.sql'
text, nl = read(path)
text = sub(text,
    "  payment_expires_at timestamptz,\n",
    "  payment_expires_at timestamptz,\n  discount integer NOT NULL DEFAULT 0 CHECK (discount >= 0),\n  voucher_code text,\n",
    1, 'schema: kolom discount + voucher_code di orders')
text = sub(text,
    "-- Cache global hasil cek nickname per (brand, User ID, Zone ID).",
    "-- Voucher grand opening. Kuota, masa berlaku, dan batas per akun dijaga di server; browser hanya menampilkan hasilnya.\n"
    "CREATE TABLE IF NOT EXISTS vouchers (\n"
    "  code text PRIMARY KEY CHECK (code ~ '^[A-Z0-9_-]{3,24}$'),\n"
    "  label text NOT NULL DEFAULT '',\n"
    "  kind text NOT NULL DEFAULT 'fixed' CHECK (kind IN ('fixed', 'percent')),\n"
    "  value integer NOT NULL CHECK (value BETWEEN 1 AND 10000000),\n"
    "  min_order integer NOT NULL DEFAULT 0 CHECK (min_order >= 0),\n"
    "  max_discount integer CHECK (max_discount IS NULL OR max_discount > 0),\n"
    "  quota integer CHECK (quota IS NULL OR quota > 0),\n"
    "  used integer NOT NULL DEFAULT 0 CHECK (used >= 0),\n"
    "  per_user integer NOT NULL DEFAULT 1 CHECK (per_user BETWEEN 1 AND 100),\n"
    "  new_buyers_only boolean NOT NULL DEFAULT false,\n"
    "  active boolean NOT NULL DEFAULT true,\n"
    "  ends_at timestamptz,\n"
    "  created_at timestamptz NOT NULL DEFAULT now()\n"
    ");\n"
    "CREATE TABLE IF NOT EXISTS voucher_redemptions (\n"
    "  order_id uuid PRIMARY KEY,\n"
    "  code text NOT NULL REFERENCES vouchers(code) ON DELETE CASCADE,\n"
    "  owner_id uuid NOT NULL REFERENCES auth.users(id),\n"
    "  amount integer NOT NULL CHECK (amount > 0),\n"
    "  created_at timestamptz NOT NULL DEFAULT now()\n"
    ");\n"
    "CREATE INDEX IF NOT EXISTS voucher_redemptions_code_idx ON voucher_redemptions (code, owner_id);\n\n"
    "-- Cache global hasil cek nickname per (brand, User ID, Zone ID).",
    1, 'schema: tabel vouchers + voucher_redemptions')
text = sub(text,
    "REVOKE ALL ON account_checks, account_check_logs FROM anon, authenticated;",
    "REVOKE ALL ON account_checks, account_check_logs FROM anon, authenticated;\n"
    "ALTER TABLE vouchers ENABLE ROW LEVEL SECURITY;\n"
    "ALTER TABLE voucher_redemptions ENABLE ROW LEVEL SECURITY;\n"
    "REVOKE ALL ON vouchers, voucher_redemptions FROM anon, authenticated;",
    1, 'schema: RLS + REVOKE tabel voucher')
write(path, text, nl)

# ---------------- src/pricing.mjs ----------------
path = ROOT + r'\src\pricing.mjs'
text, nl = read(path)
assert 'voucherDiscount' not in text
text = text.rstrip('\n') + '\n' + '\n'.join([
    '',
    '// ponytail: potongan voucher = fungsi murni yang sama dipakai server dan klien, biar angka di layar tidak pernah beda dengan yang ditagih.',
    'export function voucherDiscount(voucher, total) {',
    '  const harga = Number(total)',
    '  const nilai = Number(voucher?.value)',
    '  if (!Number.isFinite(harga) || harga <= 0 || !Number.isFinite(nilai) || nilai <= 0) return 0',
    '  if (harga < (Number(voucher.min_order) || 0)) return 0',
    '  if (voucher.kind === \'percent\') {',
    '    const cap = Number(voucher.max_discount) || 0',
    '    const raw = Math.floor((harga * Math.min(nilai, 90)) / 100)',
    '    return cap > 0 ? Math.min(raw, cap) : raw',
    '  }',
    '  return Math.min(nilai, harga - 1)',
    '}',
]) + '\n'
write(path, text, nl)
print('OK  pricing.mjs: voucherDiscount')

# ---------------- src/pricing.test.mjs ----------------
path = ROOT + r'\src\pricing.test.mjs'
text, nl = read(path)
assert 'voucherDiscount' not in text
text = text.rstrip('\n') + '\n' + '\n'.join([
    '',
    "test('voucherDiscount: potongan tetap, persen dengan plafon, dan syarat minimum', () => {",
    "  assert.equal(voucherDiscount({ kind: 'fixed', value: 1000, min_order: 10000 }, 25000), 1000);",
    "  assert.equal(voucherDiscount({ kind: 'fixed', value: 1000, min_order: 10000 }, 9999), 0);",
    "  assert.equal(voucherDiscount({ kind: 'fixed', value: 5000, min_order: 0 }, 2000), 1999);",
    "  assert.equal(voucherDiscount({ kind: 'percent', value: 10, min_order: 0, max_discount: 2000 }, 64500), 2000);",
    "  assert.equal(voucherDiscount({ kind: 'percent', value: 10, min_order: 0, max_discount: 0 }, 64500), 6450);",
    "  assert.equal(voucherDiscount({ kind: 'percent', value: 200, min_order: 0 }, 64500), 58050);",
    "  assert.equal(voucherDiscount(null, 64500), 0);",
    "  assert.equal(voucherDiscount({ kind: 'fixed', value: 1000 }, 0), 0);",
    "  assert.equal(voucherDiscount({ kind: 'fixed', value: 'abc' }, 25000), 0);",
    "});",
]) + '\n'
write(path, text, nl)
print('OK  pricing.test.mjs: golden voucher')

# ---------------- server/core.mjs ----------------
path = ROOT + r'\server\core.mjs'
text, nl = read(path)
text = sub(text,
    "  const { productId, userId, zoneId, paymentMethod } = body;",
    "  const { productId, userId, zoneId, paymentMethod, voucherCode } = body;",
    1, 'core: baca voucherCode')
text = sub(text,
    "  return { productId, userId, zoneId: zoneId ?? '', paymentMethod };",
    "  if (voucherCode !== undefined && (typeof voucherCode !== 'string' || !/^[A-Za-z0-9_-]{3,24}$/.test(voucherCode))) throw Error('Kode voucher tidak valid.');\n"
    "  return { productId, userId, zoneId: zoneId ?? '', paymentMethod, voucherCode: voucherCode ? voucherCode.toUpperCase() : undefined };",
    1, 'core: validasi + normalisasi voucherCode')
write(path, text, nl)

# ---------------- server/app.mjs ----------------
path = ROOT + r'\server\app.mjs'
text, nl = read(path)
lines = text.split('\n')
idx = next(i for i, line in enumerate(lines) if "from '../src/pricing.mjs'" in line)
if 'voucherDiscount' not in lines[idx]:
    head = lines[idx].split('{')[1].split('}')[0].strip()
    lines[idx] = lines[idx].replace('{' + head + '}', '{ ' + head + ', voucherDiscount }')
text = '\n'.join(lines)
print('OK  app.mjs: impor voucherDiscount')

text = sub(text,
    "async function applyPaid(pool, fetchImpl, env, orderId, grossAmount) {",
    "// ponytail: aturan voucher dijaga di server (kuota, masa berlaku, batas per akun, khusus pembeli baru) - browser cuma menampilkan hasil hitungannya.\n"
    "async function voucherFor(pool, code, ownerId, total) {\n"
    "  if (!code) return null;\n"
    "  const { rows } = await pool.query('SELECT code, label, kind, value, min_order, max_discount, quota, used, per_user, new_buyers_only, active, ends_at FROM vouchers WHERE code = $1', [code]);\n"
    "  const voucher = rows[0];\n"
    "  if (!voucher || !voucher.active) return { error: 'Kode voucher tidak dikenal atau sudah tidak aktif.' };\n"
    "  if (voucher.ends_at && new Date(voucher.ends_at).getTime() < Date.now()) return { error: 'Voucher sudah kedaluwarsa.' };\n"
    "  if (voucher.quota != null && voucher.used >= voucher.quota) return { error: 'Kuota voucher sudah habis.' };\n"
    "  if (total < voucher.min_order) return { error: `Voucher berlaku mulai belanja Rp ${new Intl.NumberFormat('id-ID').format(voucher.min_order)}.` };\n"
    "  const { rows: mine } = await pool.query('SELECT count(*)::int AS count FROM voucher_redemptions WHERE code = $1 AND owner_id = $2', [voucher.code, ownerId]);\n"
    "  if (mine[0].count >= voucher.per_user) return { error: 'Voucher ini sudah kamu pakai.' };\n"
    "  if (voucher.new_buyers_only) {\n"
    "    const { rows: buys } = await pool.query(\"SELECT count(*)::int AS count FROM orders WHERE owner_id = $1 AND status IN ('payment_paid','fulfillment_pending','fulfilled')\", [ownerId]);\n"
    "    if (buys[0].count > 0) return { error: 'Voucher ini khusus pembeli baru.' };\n"
    "  }\n"
    "  const discount = voucherDiscount(voucher, total);\n"
    "  if (discount <= 0) return { error: 'Voucher tidak bisa dipakai untuk pesanan ini.' };\n"
    "  return { voucher, discount };\n"
    "}\n"
    "async function redeemVoucher(pool, voucher, orderId, ownerId, discount) {\n"
    "  const { rows } = await pool.query('UPDATE vouchers SET used = used + 1 WHERE code = $1 AND active = true AND (quota IS NULL OR used < quota) RETURNING used', [voucher.code]);\n"
    "  if (!rows[0]) return false;\n"
    "  await pool.query('INSERT INTO voucher_redemptions (order_id, code, owner_id, amount) VALUES ($1,$2,$3,$4) ON CONFLICT (order_id) DO NOTHING', [orderId, voucher.code, ownerId, discount]);\n"
    "  return true;\n"
    "}\n"
    "// ponytail: pesanan yang gagal/kedaluwarsa mengembalikan kuota supaya pembeli tidak kehilangan vouchernya karena error di sisi kita.\n"
    "async function releaseVoucher(pool, orderId) {\n"
    "  const { rows } = await pool.query('DELETE FROM voucher_redemptions WHERE order_id = $1 RETURNING code', [orderId]);\n"
    "  if (!rows[0]) return false;\n"
    "  await pool.query('UPDATE vouchers SET used = GREATEST(used - 1, 0) WHERE code = $1', [rows[0].code]);\n"
    "  return true;\n"
    "}\n\n"
    "async function applyPaid(pool, fetchImpl, env, orderId, grossAmount) {",
    1, 'app.mjs: helper voucher')

text = sub(text,
    "      else if (['expire', 'deny', 'cancel'].includes(notice)) await pool.query(\"UPDATE orders SET status = 'payment_failed', updated_at = now() WHERE id = $1 AND price = $2 AND status = 'pending'\", [order.id, Number(status.gross_amount)]);",
    "      else if (['expire', 'deny', 'cancel'].includes(notice)) {\n"
    "        await pool.query(\"UPDATE orders SET status = 'payment_failed', updated_at = now() WHERE id = $1 AND price = $2 AND status = 'pending'\", [order.id, Number(status.gross_amount)]);\n"
    "        await releaseVoucher(pool, order.id);\n"
    "      }",
    1, 'app.mjs: kembalikan kuota saat kedaluwarsa')

# endpoint admin voucher + pratinjau voucher (sebelum handler checkout)
text = sub(text,
    "      if (req.method === 'POST' && path === '/api/checkout') {",
    "      if (path === '/api/admin/vouchers' || path.startsWith('/api/admin/vouchers/')) {\n"
    "        await authenticatedAdmin(req, pool, fetchImpl, env);\n"
    "        const list = async () => {\n"
    "          const { rows } = await pool.query('SELECT code, label, kind, value, min_order, max_discount, quota, used, per_user, new_buyers_only, active, ends_at FROM vouchers ORDER BY created_at DESC, code ASC');\n"
    "          return rows.map(row => ({ code: row.code, label: row.label, kind: row.kind, value: row.value, minOrder: row.min_order, maxDiscount: row.max_discount, quota: row.quota, used: row.used, perUser: row.per_user, newBuyersOnly: row.new_buyers_only, active: row.active, endsAt: row.ends_at ? new Date(row.ends_at).toISOString() : null }));\n"
    "        };\n"
    "        if (req.method === 'GET' && path === '/api/admin/vouchers') return send(res, 200, { vouchers: await list() });\n"
    "        if (req.method === 'POST' && path === '/api/admin/vouchers') {\n"
    "          let body;\n"
    "          try { body = await readJson(req); } catch (err) { throw err.status ? err : error(400, err.message); }\n"
    "          const code = String(body?.code || '').trim().toUpperCase();\n"
    "          const kind = body?.kind === 'percent' ? 'percent' : 'fixed';\n"
    "          const value = Number(body?.value);\n"
    "          const minOrder = Number(body?.minOrder ?? 0);\n"
    "          const maxDiscount = body?.maxDiscount == null ? null : Number(body.maxDiscount);\n"
    "          const quota = body?.quota == null || body?.quota === '' ? null : Number(body.quota);\n"
    "          const perUser = Number(body?.perUser ?? 1);\n"
    "          const days = Number(body?.days ?? 30);\n"
    "          const cap = kind === 'percent' ? 90 : 1000000;\n"
    "          if (!/^[A-Z0-9_-]{3,24}$/.test(code)) throw error(400, 'Kode voucher 3-24 karakter, huruf/angka/-/_ saja.');\n"
    "          if (!Number.isSafeInteger(value) || value < 1 || value > cap) throw error(400, kind === 'percent' ? 'Persen potongan harus 1-90.' : 'Nominal potongan tidak valid.');\n"
    "          if (!Number.isSafeInteger(minOrder) || minOrder < 0 || minOrder > 100000000) throw error(400, 'Minimum belanja tidak valid.');\n"
    "          if (maxDiscount != null && (!Number.isSafeInteger(maxDiscount) || maxDiscount < 1)) throw error(400, 'Plafon potongan tidak valid.');\n"
    "          if (quota != null && (!Number.isSafeInteger(quota) || quota < 1 || quota > 100000)) throw error(400, 'Kuota tidak valid.');\n"
    "          if (!Number.isSafeInteger(perUser) || perUser < 1 || perUser > 100) throw error(400, 'Batas per akun tidak valid.');\n"
    "          if (!Number.isSafeInteger(days) || days < 1 || days > 365) throw error(400, 'Masa berlaku harus 1-365 hari.');\n"
    "          const { rows } = await pool.query(`INSERT INTO vouchers (code, label, kind, value, min_order, max_discount, quota, per_user, new_buyers_only, active, ends_at)\n"
    "            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true, now() + ($10 || ' days')::interval)\n"
    "            ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, kind = EXCLUDED.kind, value = EXCLUDED.value, min_order = EXCLUDED.min_order,\n"
    "              max_discount = EXCLUDED.max_discount, quota = EXCLUDED.quota, per_user = EXCLUDED.per_user, new_buyers_only = EXCLUDED.new_buyers_only,\n"
    "              active = true, ends_at = EXCLUDED.ends_at RETURNING code`, [code, String(body?.label || '').slice(0, 80), kind, value, minOrder, maxDiscount, quota, perUser, body?.newBuyersOnly === true, String(days)]);\n"
    "          return send(res, 201, { code: rows[0].code, vouchers: await list() });\n"
    "        }\n"
    "        if (req.method === 'PATCH' && path.startsWith('/api/admin/vouchers/')) {\n"
    "          const code = decodeURIComponent(path.slice('/api/admin/vouchers/'.length)).toUpperCase();\n"
    "          let body;\n"
    "          try { body = await readJson(req); } catch (err) { throw err.status ? err : error(400, err.message); }\n"
    "          if (typeof body?.active !== 'boolean') throw error(400, 'Status voucher tidak valid.');\n"
    "          const { rows } = await pool.query('UPDATE vouchers SET active = $2 WHERE code = $1 RETURNING code', [code, body.active]);\n"
    "          if (!rows[0]) throw error(404, 'Voucher tidak ditemukan.');\n"
    "          return send(res, 200, { code: rows[0].code, vouchers: await list() });\n"
    "        }\n"
    "        throw error(404, 'Voucher tidak ditemukan.');\n"
    "      }\n"
    "      // ponytail: pratinjau voucher di checkout. Hitungannya sama dengan yang dipakai saat pesanan dibuat, jadi angka di layar = angka yang ditagih.\n"
    "      if (req.method === 'POST' && path === '/api/voucher') {\n"
    "        const ownerId = await authenticatedOwner(req, fetchImpl, env);\n"
    "        let body;\n"
    "        try { body = await readJson(req); } catch (err) { throw err.status ? err : error(400, err.message); }\n"
    "        const code = String(body?.code || '').trim().toUpperCase();\n"
    "        if (!/^[A-Z0-9_-]{3,24}$/.test(code)) throw error(400, 'Kode voucher tidak valid.');\n"
    "        const { rows } = await pool.query('SELECT id, name, price FROM products WHERE id = $1 AND enabled = true', [body?.productId]);\n"
    "        if (!rows[0]) throw error(404, 'Produk tidak tersedia.');\n"
    "        const picked = await voucherFor(pool, code, ownerId, rows[0].price);\n"
    "        if (!picked) throw error(400, 'Kode voucher tidak valid.');\n"
    "        if (picked.error) throw error(400, picked.error);\n"
    "        return send(res, 200, { voucher: { code: picked.voucher.code, label: picked.voucher.label, discount: picked.discount, total: rows[0].price - picked.discount } });\n"
    "      }\n"
    "      if (req.method === 'POST' && path === '/api/checkout') {",
    1, 'app.mjs: endpoint voucher admin + pratinjau')

text = sub(text,
    "        const methodId = input.paymentMethod || 'qris';",
    "        const picked = input.voucherCode ? await voucherFor(pool, input.voucherCode, ownerId, product.price) : null;\n"
    "        if (picked?.error) throw error(400, picked.error);\n"
    "        const discount = picked?.discount ?? 0;\n"
    "        // ponytail: price = jumlah yang benar-benar ditagih (setelah potongan) karena webhook mencocokkan gross_amount dengan price.\n"
    "        const amount = product.price - discount;\n"
    "        const methodId = input.paymentMethod || 'qris';",
    1, 'app.mjs: hitung potongan sebelum metode')

text = sub(text,
    "        if (VA_METHOD_IDS.has(methodId) && product.price < VA_MIN_ORDER) throw error(400,",
    "        if (VA_METHOD_IDS.has(methodId) && amount < VA_MIN_ORDER) throw error(400,",
    1, 'app.mjs: batas VA pakai jumlah setelah potongan')

text = sub(text,
    "        await pool.query('INSERT INTO orders (id, product_id, product_name, price, digi_sku, customer_no, user_id, zone_id, owner_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id, product.id, product.name, product.price, product.digi_sku, customerNo, input.userId, input.zoneId, ownerId]);",
    "        await pool.query('INSERT INTO orders (id, product_id, product_name, price, digi_sku, customer_no, user_id, zone_id, owner_id, discount, voucher_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [id, product.id, product.name, amount, product.digi_sku, customerNo, input.userId, input.zoneId, ownerId, discount, picked?.voucher.code ?? null]);\n"
    "        if (picked && !await redeemVoucher(pool, picked.voucher, id, ownerId, discount)) throw error(400, 'Kuota voucher baru saja habis. Coba lagi tanpa voucher.');",
    1, 'app.mjs: simpan potongan + pakai kuota')

text = sub(text,
    "            body: JSON.stringify({ ...method(id, storeUrl), transaction_details: { order_id: id, gross_amount: product.price } })",
    "            body: JSON.stringify({ ...method(id, storeUrl), transaction_details: { order_id: id, gross_amount: amount } })",
    1, 'app.mjs: tagih jumlah setelah potongan')

text = sub(text,
    "          if (Number(err?.upstreamStatus) >= 400 && Number(err?.upstreamStatus) < 500) await pool.query(\"UPDATE orders SET status = 'payment_failed', updated_at = now() WHERE id = $1 AND status = 'pending'\", [id]);",
    "          if (Number(err?.upstreamStatus) >= 400 && Number(err?.upstreamStatus) < 500) await pool.query(\"UPDATE orders SET status = 'payment_failed', updated_at = now() WHERE id = $1 AND status = 'pending'\", [id]);\n"
    "          if (picked) await releaseVoucher(pool, id);",
    1, 'app.mjs: kuota kembali kalau charge gagal')

# detail pesanan + daftar pesanan bawa potongan
text = sub(text,
    "        const { rows } = await pool.query('SELECT id, status, product_name AS \"productName\", price, user_id AS \"userId\", zone_id AS \"zoneId\" FROM orders WHERE owner_id = $1 ORDER BY created_at DESC, id DESC', [ownerId]);",
    "        const { rows } = await pool.query('SELECT id, status, product_name AS \"productName\", price, discount, voucher_code AS \"voucherCode\", user_id AS \"userId\", zone_id AS \"zoneId\" FROM orders WHERE owner_id = $1 ORDER BY created_at DESC, id DESC', [ownerId]);",
    1, 'app.mjs: daftar pesanan bawa potongan')

text = sub(text,
    "        const { rows } = await pool.query(`SELECT id, status, product_name AS \"productName\", price, user_id AS \"userId\", zone_id AS \"zoneId\", ${PAYMENT_DETAIL_COLUMNS} FROM orders WHERE owner_id = $1 AND id = $2`, [ownerId, id]);",
    "        const { rows } = await pool.query(`SELECT id, status, product_name AS \"productName\", price, discount, voucher_code AS \"voucherCode\", user_id AS \"userId\", zone_id AS \"zoneId\", ${PAYMENT_DETAIL_COLUMNS} FROM orders WHERE owner_id = $1 AND id = $2`, [ownerId, id]);",
    1, 'app.mjs: detail pesanan bawa potongan')

write(path, text, nl)
print('SEMUA_PATCH_SERVER_OK')
