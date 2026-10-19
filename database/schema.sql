-- Clean install only. Existing orders tables are not altered by IF NOT EXISTS:
-- audit and backfill each order from a trustworthy account linkage before adding
-- owner_id uuid NOT NULL REFERENCES auth.users(id). Never infer owner from order ID.
-- Instalasi lama (produk sudah ada) harus memperbarui constraint CHECK secara manual:
--   ALTER TABLE products DROP CONSTRAINT products_customer_format_check;
--   ALTER TABLE products ADD CONSTRAINT products_customer_format_check CHECK (customer_format IN ('ml_concat', 'plain', 'uid_server', 'riot'));
--   ALTER TABLE orders DROP CONSTRAINT orders_user_id_check;
--   ALTER TABLE orders ADD CONSTRAINT orders_user_id_check CHECK (user_id ~ '^[A-Za-z0-9 ._#-]{1,64}$');
--   ALTER TABLE orders DROP CONSTRAINT orders_customer_no_check;
--   ALTER TABLE orders ADD CONSTRAINT orders_customer_no_check CHECK (length(customer_no) BETWEEN 1 AND 128);
--   ALTER TABLE orders DROP CONSTRAINT orders_zone_id_check;
--   ALTER TABLE orders ADD CONSTRAINT orders_zone_id_check CHECK (zone_id ~ '^[A-Za-z0-9_-]{0,64}$');
-- Instalasi lama juga menjalankan blok CREATE TABLE IF NOT EXISTS account_checks/account_check_logs (beserta RLS/REVOKE) dari file ini.
-- Fitur wajib (halaman legal, notifikasi email, refund, indikator gangguan) menambah kolom & status berikut pada instalasi lama:
--   ALTER TABLE products ADD COLUMN IF NOT EXISTS gangguan boolean NOT NULL DEFAULT false;
--   ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment_sn text;
--   ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment_note text;
--   ALTER TABLE orders ADD COLUMN IF NOT EXISTS refunded_at timestamptz;
--   ALTER TABLE orders ADD COLUMN IF NOT EXISTS contact_email text;
--   ALTER TABLE orders ADD COLUMN IF NOT EXISTS contact_phone text;
--   ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_note text;
--   ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at timestamptz;
--   ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_environment text;
--   CREATE INDEX IF NOT EXISTS orders_environment_paid_at_idx ON orders (payment_environment, paid_at) WHERE paid_at IS NOT NULL;
--   ALTER TABLE orders DROP CONSTRAINT orders_status_check;
--   ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('pending', 'payment_failed', 'payment_paid', 'fulfillment_pending', 'fulfilled', 'fulfillment_failed', 'manual_review', 'refunded'));
--   ALTER TABLE orders DROP CONSTRAINT orders_claimed_check;
--   ALTER TABLE orders ADD CONSTRAINT orders_claimed_check CHECK (digiflazz_claimed_at IS NULL OR status IN ('fulfillment_pending', 'fulfilled', 'fulfillment_failed', 'manual_review', 'refunded'));
CREATE TABLE IF NOT EXISTS products (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  game text NOT NULL CHECK (length(game) BETWEEN 1 AND 80),
  price integer NOT NULL CHECK (price BETWEEN 1 AND 100000000),
  digi_sku text NOT NULL CHECK (length(digi_sku) BETWEEN 1 AND 80),
  -- ponytail: Format tujuan harus terdaftar di server (MOBILE LEGENDS: ml_concat, GENSHIN/HONKAI: uid_server, VALORANT: riot, lainnya: plain); verifikasi SKU/format sebelum aktif.
  customer_format text NOT NULL DEFAULT 'ml_concat' CHECK (customer_format IN ('ml_concat', 'plain', 'uid_server', 'riot')),
  enabled boolean NOT NULL DEFAULT false,
  -- ponytail: 'auto' = harga jual dihitung ulang dari modal + aturan kategori tiap sinkron katalog supplier; 'manual' = dikunci admin.
  price_mode text NOT NULL DEFAULT 'auto' CHECK (price_mode IN ('auto', 'manual')),
  -- ponytail: tanda gangguan penyedia. Produk gangguan disembunyikan dari katalog pembeli, tidak bisa dipakai voucher, dan checkout-nya ditolak.
  gangguan boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS products_enabled_idx ON products (game, id) WHERE enabled;

-- Cermin katalog supplier. Diisi server lewat POST /api/admin/supplier-products/sync (pull price-list Digiflazz),
-- dibaca panel admin dari DB supaya tidak memanggil Digiflazz tiap kali dibuka (limitasi rc 83).
CREATE TABLE IF NOT EXISTS supplier_products (
  sku text PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  game text NOT NULL CHECK (length(game) BETWEEN 1 AND 80),
  category text NOT NULL CHECK (length(category) BETWEEN 1 AND 80),
  variant text NOT NULL DEFAULT '' CHECK (length(variant) <= 80),
  price integer NOT NULL CHECK (price BETWEEN 1 AND 100000000),
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id),
  product_id text NOT NULL REFERENCES products(id),
  product_name text NOT NULL,
  price integer NOT NULL CHECK (price BETWEEN 1 AND 100000000),
  digi_sku text NOT NULL,
  customer_no text NOT NULL CHECK (length(customer_no) BETWEEN 1 AND 128),
  user_id text NOT NULL CHECK (user_id ~ '^[A-Za-z0-9 ._#-]{1,64}$'),
  zone_id text NOT NULL CHECK (zone_id ~ '^[A-Za-z0-9_-]{0,64}$'),
  -- ponytail: kontak pesanan diisi pembeli di halaman checkout; boleh beda dari email akun.
  contact_email text CHECK (contact_email IS NULL OR length(contact_email) BETWEEN 3 AND 120),
  contact_phone text CHECK (contact_phone IS NULL OR length(contact_phone) BETWEEN 8 AND 20),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'payment_failed', 'payment_paid', 'fulfillment_pending', 'fulfilled', 'fulfillment_failed', 'manual_review', 'refunded')),
  redirect_url text,
  payment_channel text,
  payment_detail jsonb,
  payment_expires_at timestamptz,
  discount integer NOT NULL DEFAULT 0 CHECK (discount >= 0),
  voucher_code text,
  -- ponytail: SN dari penyedia + catatan kegagalan; dipakai struk dan email notifikasi.
  fulfillment_sn text,
  fulfillment_note text,
  refunded_at timestamptz,
  paid_at timestamptz,
  payment_environment text CHECK (payment_environment IS NULL OR payment_environment IN ('sandbox', 'production')),
  refund_note text,
  digiflazz_claimed_at timestamptz,
  digi_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (digiflazz_claimed_at IS NULL OR status IN ('fulfillment_pending', 'fulfilled', 'fulfillment_failed', 'manual_review', 'refunded'))
);
CREATE INDEX IF NOT EXISTS orders_owner_created_idx ON orders (owner_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS orders_attention_idx ON orders (updated_at) WHERE status IN ('payment_paid', 'fulfillment_pending', 'manual_review', 'fulfillment_failed');
CREATE INDEX IF NOT EXISTS orders_environment_paid_at_idx ON orders (payment_environment, paid_at) WHERE paid_at IS NOT NULL;

-- Jejak audit tindakan refund. Admin tidak dijadikan foreign key agar catatan tetap utuh bila akun admin dihapus.
CREATE TABLE IF NOT EXISTS refund_events (
  id bigserial PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  admin_id uuid NOT NULL,
  method text NOT NULL CHECK (method IN ('midtrans', 'manual')),
  amount integer NOT NULL CHECK (amount >= 0),
  note text CHECK (note IS NULL OR length(note) <= 200),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refund_events_order_idx ON refund_events (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS refund_events_admin_idx ON refund_events (admin_id, created_at DESC);


-- Penilaian pembeli setelah pesanan selesai. Satu pesanan hanya punya satu penilaian,
-- dan hanya pesanan berstatus fulfilled yang boleh dinilai.
CREATE TABLE IF NOT EXISTS order_ratings (
  order_id uuid PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  score smallint NOT NULL CHECK (score BETWEEN 1 AND 5),
  note text CHECK (note IS NULL OR length(note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_ratings_owner_idx ON order_ratings (owner_id);


-- Voucher grand opening. Kuota, masa berlaku, dan batas per akun dijaga di server; browser hanya menampilkan hasilnya.
CREATE TABLE IF NOT EXISTS vouchers (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z0-9_-]{3,24}$'),
  label text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'fixed' CHECK (kind IN ('fixed', 'percent')),
  value integer NOT NULL CHECK (value BETWEEN 1 AND 10000000),
  min_order integer NOT NULL DEFAULT 0 CHECK (min_order >= 0),
  max_discount integer CHECK (max_discount IS NULL OR max_discount > 0),
  quota integer CHECK (quota IS NULL OR quota > 0),
  used integer NOT NULL DEFAULT 0 CHECK (used >= 0),
  per_user integer NOT NULL DEFAULT 1 CHECK (per_user BETWEEN 1 AND 100),
  new_buyers_only boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS voucher_redemptions (
  order_id uuid PRIMARY KEY,
  code text NOT NULL REFERENCES vouchers(code) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id),
  amount integer NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS voucher_redemptions_code_idx ON voucher_redemptions (code, owner_id);

-- Cache global hasil cek nickname per (brand, User ID, Zone ID). Baris dianggap segar 30 hari oleh server; baris gagal tidak disimpan.
CREATE TABLE IF NOT EXISTS account_checks (
  game text NOT NULL CHECK (length(game) BETWEEN 1 AND 80),
  user_id text NOT NULL CHECK (user_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  zone_id text NOT NULL DEFAULT '' CHECK (zone_id ~ '^[A-Za-z0-9_-]{0,64}$'),
  nickname text NOT NULL CHECK (length(nickname) BETWEEN 1 AND 120),
  region text NOT NULL DEFAULT '' CHECK (length(region) <= 40),
  checked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game, user_id, zone_id)
);

-- Catatan pemakaian cek per akun pembeli, untuk batas harian (kuota di server/check.mjs).
CREATE TABLE IF NOT EXISTS account_check_logs (
  id bigserial PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id),
  game text NOT NULL CHECK (length(game) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_check_logs_owner_idx ON account_check_logs (owner_id, created_at DESC);

-- Berikan akses admin secara manual dengan UUID auth.users yang sudah diverifikasi.
-- Tidak ada admin bawaan; akun baru selalu buyer.
CREATE TABLE IF NOT EXISTS admin_users (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Browser hanya boleh mengakses API server. Tidak ada kebijakan RLS untuk klien:
-- koneksi postgres server tetap bisa mengelola tabel; anon/authenticated tidak.
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_products ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON products, orders, admin_users, supplier_products FROM anon, authenticated;
ALTER TABLE account_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_check_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON account_checks, account_check_logs FROM anon, authenticated;
ALTER TABLE vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE voucher_redemptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON vouchers, voucher_redemptions FROM anon, authenticated;
ALTER TABLE refund_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON refund_events FROM anon, authenticated;
