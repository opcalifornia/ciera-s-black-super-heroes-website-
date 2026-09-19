-- Book storefront schema (SQLite).
-- site_settings is a key/value table so new settings can be added without a migration.

CREATE TABLE IF NOT EXISTS site_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS products (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  price       INTEGER NOT NULL DEFAULT 0,
  compare_at  INTEGER,
  inventory   INTEGER,
  badge       TEXT NOT NULL DEFAULT '',
  sort        INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_images (
  id         TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id);

CREATE TABLE IF NOT EXISTS orders (
  id                       TEXT PRIMARY KEY,
  number                   INTEGER NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'pending_payment',
  customer_name            TEXT NOT NULL DEFAULT '',
  customer_email           TEXT NOT NULL DEFAULT '',
  customer_address         TEXT NOT NULL DEFAULT '',
  customer_note            TEXT NOT NULL DEFAULT '',
  subtotal                 INTEGER NOT NULL DEFAULT 0,
  shipping                 INTEGER NOT NULL DEFAULT 0,
  total                    INTEGER NOT NULL DEFAULT 0,
  stripe_checkout_session_id TEXT,
  stripe_payment_intent_id   TEXT,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_number ON orders(number);
CREATE INDEX IF NOT EXISTS idx_orders_stripe_session ON orders(stripe_checkout_session_id);

CREATE TABLE IF NOT EXISTS order_lines (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  unit_price  INTEGER NOT NULL DEFAULT 0,
  qty         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_order_lines_order ON order_lines(order_id);

CREATE TABLE IF NOT EXISTS subscribers (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  email      TEXT NOT NULL DEFAULT '',
  phone      TEXT NOT NULL DEFAULT '',
  message    TEXT NOT NULL DEFAULT '',
  read       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
