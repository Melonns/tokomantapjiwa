-- Clean install only. Existing orders tables are not altered by IF NOT EXISTS:
-- audit and backfill each order from a trustworthy account linkage before adding
-- owner_id uuid NOT NULL REFERENCES auth.users(id). Never infer owner from order ID.
-- Instalasi lama (produk sudah ada) harus memperbarui constraint CHECK secara manual:
--   ALTER TABLE products DROP CONSTRAINT products_customer_format_check;
--   ALTER TABLE products ADD CONSTRAINT products_customer_format_check CHECK (customer_format IN ('ml_concat', 'plain'));
--   ALTER TABLE orders DROP CONSTRAINT orders_customer_no_check;
--   ALTER TABLE orders ADD CONSTRAINT orders_customer_no_check CHECK (length(customer_no) BETWEEN 1 AND 128);
--   ALTER TABLE orders DROP CONSTRAINT orders_zone_id_check;
--   ALTER TABLE orders ADD CONSTRAINT orders_zone_id_check CHECK (zone_id ~ '^[A-Za-z0-9_-]{0,64}$');
CREATE TABLE IF NOT EXISTS products (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  game text NOT NULL CHECK (length(game) BETWEEN 1 AND 80),
  price integer NOT NULL CHECK (price BETWEEN 1 AND 100000000),
  digi_sku text NOT NULL CHECK (length(digi_sku) BETWEEN 1 AND 80),
  -- ponytail: Format tujuan harus terdaftar di server (MOBILE LEGENDS: ml_concat, FREE FIRE: plain); verifikasi SKU/format sebelum aktif.
  customer_format text NOT NULL DEFAULT 'ml_concat' CHECK (customer_format IN ('ml_concat', 'plain')),
  enabled boolean NOT NULL DEFAULT false
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
  user_id text NOT NULL CHECK (user_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  zone_id text NOT NULL CHECK (zone_id ~ '^[A-Za-z0-9_-]{0,64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'payment_failed', 'payment_paid', 'fulfillment_pending', 'fulfilled', 'fulfillment_failed', 'manual_review')),
  redirect_url text,
  digiflazz_claimed_at timestamptz,
  digi_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (digiflazz_claimed_at IS NULL OR status IN ('fulfillment_pending', 'fulfilled', 'fulfillment_failed', 'manual_review'))
);
CREATE INDEX IF NOT EXISTS orders_owner_created_idx ON orders (owner_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS orders_attention_idx ON orders (updated_at) WHERE status IN ('payment_paid', 'fulfillment_pending', 'manual_review', 'fulfillment_failed');

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
