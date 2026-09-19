// Book storefront backend — Express + SQLite datastore.
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const store = require("./db");

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-me";

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
app.get("/api/site", (req, res) => res.json(store.getSite()));

app.get("/api/products", (req, res) => {
  res.json(store.listProducts({ activeOnly: true }).sort((a, b) => a.sort - b.sort));
});

app.get("/api/products/:slug", (req, res) => {
  const p = store.getProductBySlug(req.params.slug, { activeOnly: true });
  if (!p) return res.status(404).json({ error: "Product not found." });
  res.json(p);
});

app.get("/api/search", (req, res) => {
  const q = clean(req.query.q, 100).toLowerCase();
  if (!q) return res.json([]);
  res.json(store.searchProducts(q));
});

app.post("/api/newsletter", rateLimit, (req, res) => {
  const email = clean(req.body.email, 200).toLowerCase();
  if (!isEmail(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (!store.findSubscriber(email)) store.addSubscriber(email);
  res.json({ ok: true, message: "You're on the list." });
});

app.post("/api/contact", rateLimit, (req, res) => {
  const { name, email, phone, message } = req.body || {};
  if (!clean(name)) return res.status(400).json({ error: "Enter your name." });
  if (!isEmail(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (!clean(message)) return res.status(400).json({ error: "Enter a message." });
  store.addMessage({
    name: clean(name, 120), email: clean(email, 200), phone: clean(phone, 40), message: clean(message, 5000),
  });
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
    const p = store.getProductById(it.id);
    const qty = Math.max(1, Math.min(20, parseInt(it.qty, 10) || 1));
    if (!p || !p.active) return res.status(400).json({ error: "An item in your cart is no longer available." });
    if (p.inventory !== null && p.inventory < qty)
      return res.status(400).json({ error: `Only ${p.inventory} left of "${p.title}".` });
    lines.push({ productId: p.id, title: p.title, unitPrice: p.price, qty });
  }
  const site = store.getSite();
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  const shipping = subtotal >= site.freeShippingThreshold ? 0 : site.flatShipping;
  // Inventory is decremented on payment confirmation (Stripe webhook), not here.
  const order = store.createOrder({
    customer: {
      name: clean(customer.name, 120), email: clean(customer.email, 200),
      address: clean(customer.address, 500), note: clean(customer.note, 1000),
    },
    lines, subtotal, shipping, total: subtotal + shipping,
  });
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

A.get("/summary", (req, res) => res.json(store.summary()));

A.get("/site", (req, res) => res.json(store.getSite()));
A.put("/site", (req, res) => res.json(store.updateSite(req.body || {})));

A.get("/products", (req, res) => res.json(store.listProducts()));
A.post("/products", (req, res) => {
  const b = req.body || {};
  if (!clean(b.title)) return res.status(400).json({ error: "Enter a product title." });
  let slug = slugify(b.slug || b.title);
  const p = {
    id: crypto.randomUUID(), slug, title: clean(b.title, 200),
    description: clean(b.description, 5000), price: Math.max(0, parseInt(b.price, 10) || 0),
    compareAt: b.compareAt ? parseInt(b.compareAt, 10) : null,
    inventory: b.inventory === "" || b.inventory == null ? null : parseInt(b.inventory, 10),
    badge: clean(b.badge, 40), sort: parseInt(b.sort, 10) || store.listProducts().length + 1,
    active: b.active !== false,
  };
  if (store.slugExists(p.slug)) p.slug += "-" + p.id.slice(0, 4);
  res.json(store.createProduct(p));
});
A.put("/products/:id", (req, res) => {
  const existing = store.getProductById(req.params.id);
  if (!existing) return res.status(404).json({ error: "Product not found." });
  const b = req.body || {};
  const patch = {};
  if ("title" in b) patch.title = clean(b.title, 200);
  if ("slug" in b && slugify(b.slug)) patch.slug = slugify(b.slug);
  if ("description" in b) patch.description = clean(b.description, 5000);
  if ("price" in b) patch.price = Math.max(0, parseInt(b.price, 10) || 0);
  if ("compareAt" in b) patch.compareAt = b.compareAt ? parseInt(b.compareAt, 10) : null;
  if ("inventory" in b) patch.inventory = b.inventory === "" || b.inventory == null ? null : parseInt(b.inventory, 10);
  if ("badge" in b) patch.badge = clean(b.badge, 40);
  if ("sort" in b) patch.sort = parseInt(b.sort, 10) || 0;
  if ("active" in b) patch.active = !!b.active;
  res.json(store.updateProduct(req.params.id, patch));
});
A.delete("/products/:id", (req, res) => {
  store.deleteProduct(req.params.id);
  res.json({ ok: true });
});

A.get("/subscribers", (req, res) => res.json(store.listSubscribers()));
A.get("/subscribers.csv", (req, res) => {
  res.type("text/csv").attachment("subscribers.csv");
  res.send("email,subscribed_at\n" + store.listSubscribers().map((s) => `${s.email},${s.createdAt}`).join("\n"));
});
A.delete("/subscribers/:id", (req, res) => {
  store.deleteSubscriber(req.params.id);
  res.json({ ok: true });
});

A.get("/messages", (req, res) => res.json(store.listMessages()));
A.put("/messages/:id", (req, res) => {
  const m = store.updateMessage(req.params.id, { read: !!req.body.read });
  if (!m) return res.status(404).json({ error: "Message not found." });
  res.json(m);
});

A.get("/orders", (req, res) => res.json(store.listOrders()));
A.put("/orders/:id", (req, res) => {
  const o = store.getOrderById(req.params.id);
  if (!o) return res.status(404).json({ error: "Order not found." });
  const allowed = ["pending_payment", "paid", "shipped", "cancelled", "refunded"];
  if (!allowed.includes(req.body.status)) return res.status(400).json({ error: "Unknown status." });
  res.json(store.updateOrderStatus(req.params.id, req.body.status));
});

app.use("/api/admin", A);

// product pages: /products/:slug -> product.html
app.get("/products/:slug", (req, res) => res.sendFile(path.join(__dirname, "public", "product.html")));
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, "public", "404.html")));

if (require.main === module) {
  app.listen(PORT, () => console.log(`Book site running on http://localhost:${PORT}`));
}

module.exports = app;
