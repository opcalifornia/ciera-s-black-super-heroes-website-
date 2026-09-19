// SQLite datastore (better-sqlite3). Replaces the old JSON-file datastore
// while keeping the same shapes the API routes and frontend already expect.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "store.db");
const SEED_PATH = path.join(DATA_DIR, "seed.json");
const SCHEMA_PATH = path.join(__dirname, "schema.sql");

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(fs.readFileSync(SCHEMA_PATH, "utf8"));

const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();

// ---------- site settings (key/value) ----------
// Keys starting with "_" are internal (e.g. admin password hash) and never
// serialized back out through the public/admin site-settings API.
const NUMERIC_SITE_KEYS = new Set(["flatShipping", "freeShippingThreshold"]);
const DEFAULT_SITE_KEYS = [
  "storeName", "announcement", "bookTitle", "heroSubline", "endorsementQuote",
  "endorsementName", "endorsementCredentials", "ctaLabel", "amazonUrl", "amazonLabel",
  "releaseNote", "newsletterHeading", "newsletterBody", "contactIntro", "contactEmail",
  "privacyPolicy", "metaDescription", "flatShipping", "freeShippingThreshold", "heroImageUrl",
];

function getSiteRaw() {
  const rows = db.prepare("SELECT key, value FROM site_settings").all();
  const map = {};
  for (const r of rows) map[r.key] = r.value;
  return map;
}

function getSite() {
  const map = getSiteRaw();
  const site = {};
  for (const k of DEFAULT_SITE_KEYS) {
    if (k === "heroImageUrl") continue; // internal-ish, only used for rendering, but keep exposed
    site[k] = NUMERIC_SITE_KEYS.has(k) ? Number(map[k] || 0) : map[k] ?? "";
  }
  site.heroImageUrl = map.heroImageUrl || "";
  return site;
}

const upsertSetting = db.prepare(
  "INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
);

function setSiteValues(patch) {
  const tx = db.transaction((entries) => {
    for (const [k, v] of entries) upsertSetting.run(k, String(v));
  });
  tx(Object.entries(patch));
}

function updateSite(patch) {
  const current = getSite();
  const toWrite = {};
  for (const k of Object.keys(current)) {
    if (!(k in patch)) continue;
    toWrite[k] = NUMERIC_SITE_KEYS.has(k) ? Math.max(0, Number(patch[k]) || 0) : patch[k];
  }
  setSiteValues(toWrite);
  return getSite();
}

function getInternalSetting(key) {
  const row = db.prepare("SELECT value FROM site_settings WHERE key = ?").get(key);
  return row ? row.value : null;
}
function setInternalSetting(key, value) {
  upsertSetting.run(key, value);
}

// ---------- products ----------
function rowToProduct(row) {
  if (!row) return null;
  const images = db
    .prepare("SELECT id, url, position FROM product_images WHERE product_id = ? ORDER BY position ASC")
    .all(row.id);
  return {
    id: row.id, slug: row.slug, title: row.title, description: row.description,
    price: row.price, compareAt: row.compare_at, inventory: row.inventory,
    badge: row.badge, sort: row.sort, active: !!row.active,
    images: images.map((i) => ({ id: i.id, url: i.url })),
  };
}

function listProducts({ activeOnly = false } = {}) {
  const rows = activeOnly
    ? db.prepare("SELECT * FROM products WHERE active = 1").all()
    : db.prepare("SELECT * FROM products").all();
  return rows.map(rowToProduct);
}
function getProductBySlug(slug, { activeOnly = false } = {}) {
  const row = activeOnly
    ? db.prepare("SELECT * FROM products WHERE slug = ? AND active = 1").get(slug)
    : db.prepare("SELECT * FROM products WHERE slug = ?").get(slug);
  return rowToProduct(row);
}
function getProductById(pid) {
  return rowToProduct(db.prepare("SELECT * FROM products WHERE id = ?").get(pid));
}
function searchProducts(q) {
  const rows = db
    .prepare("SELECT * FROM products WHERE active = 1 AND (lower(title) LIKE ? OR lower(description) LIKE ?)")
    .all(`%${q}%`, `%${q}%`);
  return rows.map(rowToProduct);
}
function slugExists(slug) {
  return !!db.prepare("SELECT 1 FROM products WHERE slug = ?").get(slug);
}
function createProduct(p) {
  const ts = now();
  db.prepare(
    `INSERT INTO products (id, slug, title, description, price, compare_at, inventory, badge, sort, active, created_at, updated_at)
     VALUES (@id, @slug, @title, @description, @price, @compareAt, @inventory, @badge, @sort, @active, @createdAt, @updatedAt)`
  ).run({
    id: p.id, slug: p.slug, title: p.title, description: p.description, price: p.price,
    compareAt: p.compareAt, inventory: p.inventory, badge: p.badge, sort: p.sort,
    active: p.active ? 1 : 0, createdAt: ts, updatedAt: ts,
  });
  return getProductById(p.id);
}
function updateProduct(pid, patch) {
  const existing = db.prepare("SELECT * FROM products WHERE id = ?").get(pid);
  if (!existing) return null;
  const merged = {
    slug: patch.slug ?? existing.slug,
    title: patch.title ?? existing.title,
    description: patch.description ?? existing.description,
    price: patch.price ?? existing.price,
    compare_at: "compareAt" in patch ? patch.compareAt : existing.compare_at,
    inventory: "inventory" in patch ? patch.inventory : existing.inventory,
    badge: patch.badge ?? existing.badge,
    sort: patch.sort ?? existing.sort,
    active: "active" in patch ? (patch.active ? 1 : 0) : existing.active,
    updated_at: now(),
    id: pid,
  };
  db.prepare(
    `UPDATE products SET slug=@slug, title=@title, description=@description, price=@price,
     compare_at=@compare_at, inventory=@inventory, badge=@badge, sort=@sort, active=@active, updated_at=@updated_at
     WHERE id=@id`
  ).run(merged);
  return getProductById(pid);
}
function deleteProduct(pid) {
  db.prepare("DELETE FROM products WHERE id = ?").run(pid);
}
function decrementInventory(pid, qty) {
  db.prepare(
    "UPDATE products SET inventory = CASE WHEN inventory IS NULL THEN NULL ELSE MAX(0, inventory - ?) END, updated_at = ? WHERE id = ?"
  ).run(qty, now(), pid);
}

// ---------- product images ----------
function addProductImage(pid, url) {
  const row = db.prepare("SELECT COALESCE(MAX(position), -1) AS m FROM product_images WHERE product_id = ?").get(pid);
  const imgId = id();
  db.prepare("INSERT INTO product_images (id, product_id, url, position, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(imgId, pid, url, row.m + 1, now());
  return { id: imgId, url };
}
function deleteProductImage(pid, imageId) {
  db.prepare("DELETE FROM product_images WHERE id = ? AND product_id = ?").run(imageId, pid);
}
function reorderProductImages(pid, orderedIds) {
  const tx = db.transaction((ids) => {
    ids.forEach((imgId, idx) => {
      db.prepare("UPDATE product_images SET position = ? WHERE id = ? AND product_id = ?").run(idx, imgId, pid);
    });
  });
  tx(orderedIds);
}
function countProductImages(pid) {
  return db.prepare("SELECT COUNT(*) AS n FROM product_images WHERE product_id = ?").get(pid).n;
}

// ---------- subscribers ----------
function findSubscriber(email) {
  return db.prepare("SELECT * FROM subscribers WHERE email = ?").get(email);
}
function addSubscriber(email) {
  const s = { id: id(), email, createdAt: now() };
  db.prepare("INSERT INTO subscribers (id, email, created_at) VALUES (?, ?, ?)").run(s.id, s.email, s.createdAt);
  return s;
}
function listSubscribers() {
  return db.prepare("SELECT id, email, created_at AS createdAt FROM subscribers ORDER BY created_at DESC").all();
}
function deleteSubscriber(sid) {
  db.prepare("DELETE FROM subscribers WHERE id = ?").run(sid);
}

// ---------- messages ----------
function addMessage(m) {
  const row = { id: id(), name: m.name, email: m.email, phone: m.phone || "", message: m.message, read: 0, createdAt: now() };
  db.prepare("INSERT INTO messages (id, name, email, phone, message, read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)")
    .run(row.id, row.name, row.email, row.phone, row.message, row.createdAt);
  return { ...row, read: false };
}
function listMessages() {
  return db
    .prepare("SELECT id, name, email, phone, message, read, created_at AS createdAt FROM messages ORDER BY created_at DESC")
    .all()
    .map((m) => ({ ...m, read: !!m.read }));
}
function updateMessage(mid, patch) {
  const existing = db.prepare("SELECT * FROM messages WHERE id = ?").get(mid);
  if (!existing) return null;
  const readVal = "read" in patch ? (patch.read ? 1 : 0) : existing.read;
  db.prepare("UPDATE messages SET read = ? WHERE id = ?").run(readVal, mid);
  return { ...existing, read: !!readVal };
}

// ---------- orders ----------
function nextOrderNumber() {
  const row = db.prepare("SELECT COALESCE(MAX(number), 1000) AS m FROM orders").get();
  return row.m + 1;
}
function rowToOrder(row) {
  if (!row) return null;
  const lines = db
    .prepare("SELECT product_id AS productId, title, unit_price AS unitPrice, qty FROM order_lines WHERE order_id = ?")
    .all(row.id);
  return {
    id: row.id, number: row.number, status: row.status,
    customer: { name: row.customer_name, email: row.customer_email, address: row.customer_address, note: row.customer_note },
    lines, subtotal: row.subtotal, shipping: row.shipping, total: row.total,
    stripeCheckoutSessionId: row.stripe_checkout_session_id,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
function createOrder({ customer, lines, subtotal, shipping, total }) {
  const orderId = id();
  const ts = now();
  const number = nextOrderNumber();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO orders (id, number, status, customer_name, customer_email, customer_address, customer_note,
        subtotal, shipping, total, created_at, updated_at)
       VALUES (?, ?, 'pending_payment', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(orderId, number, customer.name, customer.email, customer.address || "", customer.note || "", subtotal, shipping, total, ts, ts);
    for (const l of lines) {
      db.prepare("INSERT INTO order_lines (id, order_id, product_id, title, unit_price, qty) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id(), orderId, l.productId, l.title, l.unitPrice, l.qty);
    }
  });
  tx();
  return getOrderById(orderId);
}
function getOrderById(orderId) {
  return rowToOrder(db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId));
}
function getOrderByStripeSession(sessionId) {
  return rowToOrder(db.prepare("SELECT * FROM orders WHERE stripe_checkout_session_id = ?").get(sessionId));
}
function listOrders() {
  return db.prepare("SELECT id FROM orders ORDER BY created_at DESC").all().map((r) => getOrderById(r.id));
}
function setOrderStripeSession(orderId, sessionId) {
  db.prepare("UPDATE orders SET stripe_checkout_session_id = ?, updated_at = ? WHERE id = ?").run(sessionId, now(), orderId);
}
function updateOrderStatus(orderId, status) {
  db.prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?").run(status, now(), orderId);
  return getOrderById(orderId);
}
function markOrderPaid(orderId, { paymentIntentId } = {}) {
  db.prepare(
    "UPDATE orders SET status = 'paid', stripe_payment_intent_id = ?, updated_at = ? WHERE id = ? AND status != 'paid'"
  ).run(paymentIntentId || null, now(), orderId);
  return getOrderById(orderId);
}

// ---------- summary ----------
function summary() {
  const products = db.prepare("SELECT COUNT(*) AS n FROM products").get().n;
  const subscribers = db.prepare("SELECT COUNT(*) AS n FROM subscribers").get().n;
  const unreadMessages = db.prepare("SELECT COUNT(*) AS n FROM messages WHERE read = 0").get().n;
  const orders = db.prepare("SELECT COUNT(*) AS n FROM orders").get().n;
  const revenue = db
    .prepare("SELECT COALESCE(SUM(total), 0) AS s FROM orders WHERE status IN ('paid', 'shipped')")
    .get().s;
  return { products, subscribers, unreadMessages, orders, revenue };
}

// ---------- first-run seed ----------
function seedIfEmpty() {
  const hasSite = db.prepare("SELECT COUNT(*) AS n FROM site_settings").get().n > 0;
  const hasProducts = db.prepare("SELECT COUNT(*) AS n FROM products").get().n > 0;
  if (hasSite && hasProducts) return;
  if (!fs.existsSync(SEED_PATH)) return;
  const seed = JSON.parse(fs.readFileSync(SEED_PATH, "utf8"));
  const tx = db.transaction(() => {
    if (!hasSite && seed.site) {
      for (const [k, v] of Object.entries(seed.site)) upsertSetting.run(k, String(v));
    }
    if (!hasProducts && Array.isArray(seed.products)) {
      for (const p of seed.products) {
        createProduct({
          id: p.id || id(), slug: p.slug, title: p.title, description: p.description,
          price: p.price || 0, compareAt: p.compareAt ?? null, inventory: p.inventory ?? null,
          badge: p.badge || "", sort: p.sort || 0, active: p.active !== false,
        });
      }
    }
  });
  tx();
}
seedIfEmpty();

module.exports = {
  db,
  getSite, updateSite, getInternalSetting, setInternalSetting,
  listProducts, getProductBySlug, getProductById, searchProducts, slugExists,
  createProduct, updateProduct, deleteProduct, decrementInventory,
  addProductImage, deleteProductImage, reorderProductImages, countProductImages,
  findSubscriber, addSubscriber, listSubscribers, deleteSubscriber,
  addMessage, listMessages, updateMessage,
  createOrder, getOrderById, getOrderByStripeSession, listOrders, setOrderStripeSession,
  updateOrderStatus, markOrderPaid,
  summary,
};
