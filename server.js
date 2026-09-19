// Book storefront backend — Express + JSON-file datastore.
// Swap the datastore for Postgres/SQLite and the checkout for Stripe when going live.
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-me";
const DB_PATH = path.join(__dirname, "data", "db.json");
const SEED_PATH = path.join(__dirname, "data", "seed.json");

// ---------- datastore ----------
function load() {
  if (!fs.existsSync(DB_PATH)) fs.copyFileSync(SEED_PATH, DB_PATH);
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}
let db = load();
function save() {
  const tmp = DB_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_PATH);
}
const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const isEmail = (s) => typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
const clean = (s, max = 2000) => String(s ?? "").trim().slice(0, max);
const slugify = (s) => clean(s, 120).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ---------- app ----------
const app = express();
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

// simple per-IP rate limit for public POSTs
const hits = new Map();
function rateLimit(req, res, next) {
  const key = req.ip + req.path;
  const t = Date.now();
  const list = (hits.get(key) || []).filter((x) => t - x < 60_000);
  if (list.length >= 10) return res.status(429).json({ error: "Too many requests. Try again in a minute." });
  list.push(t);
  hits.set(key, list);
  next();
}

// ---------- public API ----------
app.get("/api/site", (req, res) => res.json(db.site));

app.get("/api/products", (req, res) => {
  res.json(db.products.filter((p) => p.active).sort((a, b) => a.sort - b.sort));
});

app.get("/api/products/:slug", (req, res) => {
  const p = db.products.find((x) => x.slug === req.params.slug && x.active);
  if (!p) return res.status(404).json({ error: "Product not found." });
  res.json(p);
});

app.get("/api/search", (req, res) => {
  const q = clean(req.query.q, 100).toLowerCase();
  if (!q) return res.json([]);
  res.json(
    db.products.filter((p) => p.active && (p.title + " " + p.description).toLowerCase().includes(q))
  );
});

app.post("/api/newsletter", rateLimit, (req, res) => {
  const email = clean(req.body.email, 200).toLowerCase();
  if (!isEmail(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (!db.subscribers.find((s) => s.email === email)) {
    db.subscribers.push({ id: id(), email, createdAt: now() });
    save();
  }
  res.json({ ok: true, message: "You're on the list." });
});

app.post("/api/contact", rateLimit, (req, res) => {
  const { name, email, phone, message } = req.body || {};
  if (!clean(name)) return res.status(400).json({ error: "Enter your name." });
  if (!isEmail(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (!clean(message)) return res.status(400).json({ error: "Enter a message." });
  db.messages.push({
    id: id(), name: clean(name, 120), email: clean(email, 200), phone: clean(phone, 40),
    message: clean(message, 5000), read: false, createdAt: now(),
  });
  save();
  res.json({ ok: true, message: "Message sent. We'll reply by email." });
});

// Checkout: prices are always recalculated server-side from the catalog.
// STRIPE INTEGRATION POINT: create a Checkout Session here and return its URL.
app.post("/api/orders", rateLimit, (req, res) => {
  const { items, customer } = req.body || {};
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: "Your cart is empty." });
  if (!customer || !clean(customer.name)) return res.status(400).json({ error: "Enter your name." });
  if (!isEmail(customer.email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (!clean(customer.address)) return res.status(400).json({ error: "Enter a shipping address." });

  const lines = [];
  for (const it of items) {
    const p = db.products.find((x) => x.id === it.id && x.active);
    const qty = Math.max(1, Math.min(20, parseInt(it.qty, 10) || 1));
    if (!p) return res.status(400).json({ error: "An item in your cart is no longer available." });
    if (p.inventory !== null && p.inventory < qty)
      return res.status(400).json({ error: `Only ${p.inventory} left of "${p.title}".` });
    lines.push({ productId: p.id, title: p.title, unitPrice: p.price, qty });
  }
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  const shipping = subtotal >= db.site.freeShippingThreshold ? 0 : db.site.flatShipping;
  for (const l of lines) {
    const p = db.products.find((x) => x.id === l.productId);
    if (p.inventory !== null) p.inventory -= l.qty;
  }
  const order = {
    id: id(), number: 1000 + db.orders.length + 1, status: "pending_payment",
    customer: {
      name: clean(customer.name, 120), email: clean(customer.email, 200),
      address: clean(customer.address, 500), note: clean(customer.note, 1000),
    },
    lines, subtotal, shipping, total: subtotal + shipping, createdAt: now(),
  };
  db.orders.push(order);
  save();
  res.json({ ok: true, orderNumber: order.number, total: order.total });
});

// ---------- admin API (Bearer token = ADMIN_PASSWORD) ----------
function admin(req, res, next) {
  const token = (req.headers.authorization || "").replace(/^Bearer /, "");
  const a = Buffer.from(token), b = Buffer.from(ADMIN_PASSWORD);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
    return res.status(401).json({ error: "Wrong admin password." });
  next();
}
const A = express.Router();
A.use(admin);

A.get("/summary", (req, res) =>
  res.json({
    products: db.products.length, subscribers: db.subscribers.length,
    unreadMessages: db.messages.filter((m) => !m.read).length, orders: db.orders.length,
    revenue: db.orders.filter((o) => o.status === "paid" || o.status === "shipped").reduce((s, o) => s + o.total, 0),
  })
);

A.get("/site", (req, res) => res.json(db.site));
A.put("/site", (req, res) => {
  const b = req.body || {};
  for (const k of Object.keys(db.site)) {
    if (!(k in b)) continue;
    db.site[k] = typeof db.site[k] === "number" ? Math.max(0, Number(b[k]) || 0) : clean(b[k], 5000);
  }
  save();
  res.json(db.site);
});

A.get("/products", (req, res) => res.json(db.products));
A.post("/products", (req, res) => {
  const b = req.body || {};
  if (!clean(b.title)) return res.status(400).json({ error: "Enter a product title." });
  const p = {
    id: id(), slug: slugify(b.slug || b.title), title: clean(b.title, 200),
    description: clean(b.description, 5000), price: Math.max(0, parseInt(b.price, 10) || 0),
    compareAt: b.compareAt ? parseInt(b.compareAt, 10) : null,
    inventory: b.inventory === "" || b.inventory == null ? null : parseInt(b.inventory, 10),
    badge: clean(b.badge, 40), sort: parseInt(b.sort, 10) || db.products.length + 1, active: b.active !== false,
  };
  if (db.products.some((x) => x.slug === p.slug)) p.slug += "-" + p.id.slice(0, 4);
  db.products.push(p);
  save();
  res.json(p);
});
A.put("/products/:id", (req, res) => {
  const p = db.products.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: "Product not found." });
  const b = req.body || {};
  if ("title" in b) p.title = clean(b.title, 200);
  if ("slug" in b && slugify(b.slug)) p.slug = slugify(b.slug);
  if ("description" in b) p.description = clean(b.description, 5000);
  if ("price" in b) p.price = Math.max(0, parseInt(b.price, 10) || 0);
  if ("compareAt" in b) p.compareAt = b.compareAt ? parseInt(b.compareAt, 10) : null;
  if ("inventory" in b) p.inventory = b.inventory === "" || b.inventory == null ? null : parseInt(b.inventory, 10);
  if ("badge" in b) p.badge = clean(b.badge, 40);
  if ("sort" in b) p.sort = parseInt(b.sort, 10) || 0;
  if ("active" in b) p.active = !!b.active;
  save();
  res.json(p);
});
A.delete("/products/:id", (req, res) => {
  db.products = db.products.filter((x) => x.id !== req.params.id);
  save();
  res.json({ ok: true });
});

A.get("/subscribers", (req, res) => res.json(db.subscribers));
A.get("/subscribers.csv", (req, res) => {
  res.type("text/csv").attachment("subscribers.csv");
  res.send("email,subscribed_at\n" + db.subscribers.map((s) => `${s.email},${s.createdAt}`).join("\n"));
});
A.delete("/subscribers/:id", (req, res) => {
  db.subscribers = db.subscribers.filter((x) => x.id !== req.params.id);
  save();
  res.json({ ok: true });
});

A.get("/messages", (req, res) => res.json([...db.messages].reverse()));
A.put("/messages/:id", (req, res) => {
  const m = db.messages.find((x) => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: "Message not found." });
  m.read = !!req.body.read;
  save();
  res.json(m);
});

A.get("/orders", (req, res) => res.json([...db.orders].reverse()));
A.put("/orders/:id", (req, res) => {
  const o = db.orders.find((x) => x.id === req.params.id);
  if (!o) return res.status(404).json({ error: "Order not found." });
  const allowed = ["pending_payment", "paid", "shipped", "cancelled", "refunded"];
  if (!allowed.includes(req.body.status)) return res.status(400).json({ error: "Unknown status." });
  o.status = req.body.status;
  save();
  res.json(o);
});

app.use("/api/admin", A);

// product pages: /products/:slug -> product.html
app.get("/products/:slug", (req, res) => res.sendFile(path.join(__dirname, "public", "product.html")));
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, "public", "404.html")));

app.listen(PORT, () => console.log(`Book site running on http://localhost:${PORT}`));
