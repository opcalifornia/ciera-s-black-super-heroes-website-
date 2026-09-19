// Book storefront backend — Express + SQLite datastore + Stripe Checkout.
require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const helmet = require("helmet");
const compression = require("compression");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");
const store = require("./db");
const { getStripe } = require("./lib/stripe");
const { sendOrderConfirmation, sendOwnerOrderAlert, sendContactAlert } = require("./lib/email");
const { upload, resizeAndSave, deleteUploadedFile, UPLOAD_DIR } = require("./lib/uploads");
const auth = require("./lib/auth");
const { injectMeta } = require("./lib/meta");
const {
  validate,
  newsletterSchema,
  contactSchema,
  orderSchema,
  loginSchema,
  siteUpdateSchema,
  productCreateSchema,
  productUpdateSchema,
  orderStatusSchema,
  messageReadSchema,
  imagesReorderSchema,
  searchQuerySchema,
} = require("./lib/schemas");

const PORT = process.env.PORT || 3000;
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const SHIP_COUNTRIES = (process.env.SHIP_COUNTRIES || "US,CA")
  .split(",")
  .map((c) => c.trim())
  .filter(Boolean);
const PUBLIC_DIR = path.join(__dirname, "public");

const clean = (s, max = 2000) =>
  String(s ?? "")
    .trim()
    .slice(0, max);
const slugify = (s) =>
  clean(s, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const absoluteUrl = (p) => (p ? (p.startsWith("http") ? p : `${PUBLIC_URL}${p}`) : "");

// ---------- app ----------
const app = express();
app.set("trust proxy", 1);

// Stripe webhook needs the raw body for signature verification, so it must
// be registered before the global express.json() body parser below.
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), handleStripeWebhook);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // The admin panel is a single inline <script>; a stricter policy
        // would need per-request nonces, which this static-file setup
        // doesn't support.
        scriptSrc: ["'self'", "'unsafe-inline'", "https://js.stripe.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'", "https://api.stripe.com"],
        frameSrc: ["https://js.stripe.com", "https://hooks.stripe.com"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
  })
);
app.use(compression());
if (process.env.NODE_ENV !== "test") {
  app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
}
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());
app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "30d" }));

// ---------- SEO: per-page meta tags, sitemap, robots ----------
// These routes render the static HTML shells with server-injected <title>,
// description, and Open Graph/Twitter tags (and, for products, JSON-LD) so
// crawlers that don't execute the client JS still see real content. They
// must be registered before express.static() below, which would otherwise
// serve the raw, un-injected files for the same paths.
function sendPage(res, file, meta) {
  const html = fs.readFileSync(path.join(PUBLIC_DIR, file), "utf8");
  res.type("html").send(injectMeta(html, meta));
}

app.get("/", (req, res) => {
  const site = store.getSite();
  const title = site.bookTitle ? `${site.bookTitle} | ${site.storeName}` : site.storeName;
  sendPage(res, "index.html", {
    title,
    description: site.metaDescription,
    url: `${PUBLIC_URL}/`,
    image: absoluteUrl(site.heroImageUrl),
  });
});
app.get("/catalog", (req, res) => {
  const site = store.getSite();
  sendPage(res, "catalog.html", {
    title: `Catalog | ${site.storeName}`,
    description: site.metaDescription,
    url: `${PUBLIC_URL}/catalog`,
  });
});
app.get("/contact", (req, res) => {
  const site = store.getSite();
  sendPage(res, "contact.html", {
    title: `Contact | ${site.storeName}`,
    description: site.contactIntro || site.metaDescription,
    url: `${PUBLIC_URL}/contact`,
  });
});
app.get("/privacy", (req, res) => {
  const site = store.getSite();
  sendPage(res, "privacy.html", {
    title: `Privacy policy | ${site.storeName}`,
    description: site.metaDescription,
    url: `${PUBLIC_URL}/privacy`,
  });
});

app.get("/robots.txt", (req, res) => {
  res.type("text/plain").send(`User-agent: *\nDisallow: /admin\n\nSitemap: ${PUBLIC_URL}/sitemap.xml\n`);
});
app.get("/sitemap.xml", (req, res) => {
  const staticPaths = ["/", "/catalog", "/contact", "/privacy"];
  const productPaths = store.listProducts({ activeOnly: true }).map((p) => `/products/${p.slug}`);
  const urls = [...staticPaths, ...productPaths].map((p) => `  <url><loc>${absoluteUrl(p)}</loc></url>`).join("\n");
  res
    .type("application/xml")
    .send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
    );
});

app.use(express.static(PUBLIC_DIR, { extensions: ["html"] }));

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

app.get("/api/search", validate(searchQuerySchema, "query"), (req, res) => {
  const q = req.validated.q.toLowerCase();
  if (!q) return res.json([]);
  res.json(store.searchProducts(q));
});

app.post("/api/newsletter", rateLimit, validate(newsletterSchema), (req, res) => {
  const email = req.body.email.toLowerCase();
  if (!store.findSubscriber(email)) store.addSubscriber(email);
  res.json({ ok: true, message: "You're on the list." });
});

app.post("/api/contact", rateLimit, validate(contactSchema), (req, res) => {
  const { name, email, phone, message } = req.body;
  const saved = store.addMessage({ name, email, phone, message });
  sendContactAlert(saved).catch((e) => console.error("Contact alert email error:", e.message));
  res.json({ ok: true, message: "Message sent. We'll reply by email." });
});

// Checkout: prices are always recalculated server-side from the catalog.
// Creates a pending order, then a Stripe Checkout Session priced from it.
// The shipping address is collected by Stripe, not by our own form.
app.post("/api/orders", rateLimit, validate(orderSchema), async (req, res) => {
  const { items, customer } = req.body;

  const lines = [];
  for (const it of items) {
    const p = store.getProductById(it.id);
    if (!p || !p.active) return res.status(400).json({ error: "An item in your cart is no longer available." });
    if (p.inventory !== null && p.inventory < it.qty)
      return res.status(400).json({ error: `Only ${p.inventory} left of "${p.title}".` });
    if (p.price <= 0) return res.status(400).json({ error: `"${p.title}" doesn't have a price set yet.` });
    lines.push({ productId: p.id, title: p.title, unitPrice: p.price, qty: it.qty });
  }
  const site = store.getSite();
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  const shipping = subtotal >= site.freeShippingThreshold && site.freeShippingThreshold > 0 ? 0 : site.flatShipping;

  // Inventory is decremented on payment confirmation (the webhook), not here.
  const order = store.createOrder({
    customer: { name: customer.name, email: customer.email, address: "", note: customer.note },
    lines,
    subtotal,
    shipping,
    total: subtotal + shipping,
  });

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: order.customer.email,
      client_reference_id: order.id,
      metadata: { orderId: order.id, orderNumber: String(order.number) },
      line_items: lines.map((l) => ({
        quantity: l.qty,
        price_data: { currency: "usd", unit_amount: l.unitPrice, product_data: { name: l.title } },
      })),
      shipping_address_collection: SHIP_COUNTRIES.length ? { allowed_countries: SHIP_COUNTRIES } : undefined,
      shipping_options: [
        {
          shipping_rate_data: {
            type: "fixed_amount",
            fixed_amount: { amount: shipping, currency: "usd" },
            display_name: shipping ? "Standard shipping" : "Free shipping",
          },
        },
      ],
      success_url: `${PUBLIC_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${PUBLIC_URL}/cancel.html`,
    });
    store.setOrderStripeSession(order.id, session.id);
    res.json({ ok: true, url: session.url, orderNumber: order.number });
  } catch (err) {
    console.error("Stripe checkout session error:", err.message);
    res.status(502).json({ error: "Couldn't start checkout. Please try again in a moment." });
  }
});

// Public, minimal status lookup for the success page (no PII beyond what
// the shopper themselves already has: their own order number and status).
app.get("/api/orders/by-session/:sessionId", (req, res) => {
  const order = store.getOrderByStripeSession(req.params.sessionId);
  if (!order) return res.status(404).json({ error: "Order not found." });
  res.json({ orderNumber: order.number, status: order.status, total: order.total });
});

// ---------- Stripe webhook ----------
async function handleStripeWebhook(req, res) {
  const sig = req.headers["stripe-signature"];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;
  try {
    const stripe = getStripe();
    if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set.");
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const orderId = session.metadata && session.metadata.orderId;
    const order = (orderId && store.getOrderById(orderId)) || store.getOrderByStripeSession(session.id);
    if (order && order.status !== "paid") {
      const shipping = session.shipping_details || session.shipping || {};
      const addr = shipping.address || (session.customer_details && session.customer_details.address) || null;
      const addressLines = addr
        ? [addr.line1, addr.line2, [addr.city, addr.state, addr.postal_code].filter(Boolean).join(", "), addr.country]
            .filter(Boolean)
            .join("\n")
        : "";
      if (addressLines) store.db.prepare("UPDATE orders SET customer_address = ? WHERE id = ?").run(addressLines, order.id);
      for (const line of order.lines) store.decrementInventory(line.productId, line.qty);
      const paid = store.markOrderPaid(order.id, { paymentIntentId: session.payment_intent });
      sendOrderConfirmation(paid).catch((e) => console.error("Order confirmation email error:", e.message));
      sendOwnerOrderAlert(paid).catch((e) => console.error("Owner order alert email error:", e.message));
    }
  }

  res.json({ received: true });
}

// ---------- admin auth (cookie session + CSRF) ----------
const loginAttempts = new Map();
function loginRateLimit(req, res, next) {
  const key = req.ip;
  const t = Date.now();
  const list = (loginAttempts.get(key) || []).filter((x) => t - x < 15 * 60_000);
  if (list.length >= 8) return res.status(429).json({ error: "Too many attempts. Try again in a few minutes." });
  list.push(t);
  loginAttempts.set(key, list);
  next();
}

app.post("/api/admin/login", loginRateLimit, validate(loginSchema), (req, res) => {
  if (!auth.verifyPassword(req.body.password)) return res.status(401).json({ error: "Wrong admin password." });
  const { token, csrfToken } = auth.createSession();
  res.cookie(auth.SESSION_COOKIE, token, auth.cookieOptions());
  res.json({ ok: true, csrfToken });
});
app.post("/api/admin/logout", (req, res) => {
  auth.destroySession(req.cookies && req.cookies[auth.SESSION_COOKIE]);
  res.clearCookie(auth.SESSION_COOKIE, { path: "/" });
  res.json({ ok: true });
});
app.get("/api/admin/session", auth.requireSession, (req, res) => res.json({ ok: true, csrfToken: req.adminSession.csrfToken }));

const A = express.Router();
A.use(auth.requireSession);
A.use(auth.requireCsrf);

A.get("/summary", (req, res) => res.json(store.summary()));

A.get("/site", (req, res) => res.json(store.getSite()));
A.put("/site", validate(siteUpdateSchema), (req, res) => res.json(store.updateSite(req.body)));

A.get("/products", (req, res) => res.json(store.listProducts()));
A.post("/products", validate(productCreateSchema), (req, res) => {
  const b = req.body;
  let slug = slugify(b.slug || b.title);
  const p = {
    id: crypto.randomUUID(),
    slug,
    title: b.title,
    description: b.description,
    price: b.price,
    compareAt: b.compareAt ?? null,
    inventory: b.inventory ?? null,
    badge: b.badge,
    sort: b.sort || store.listProducts().length + 1,
    active: b.active,
  };
  if (store.slugExists(p.slug)) p.slug += "-" + p.id.slice(0, 4);
  res.json(store.createProduct(p));
});
A.put("/products/:id", validate(productUpdateSchema), (req, res) => {
  const existing = store.getProductById(req.params.id);
  if (!existing) return res.status(404).json({ error: "Product not found." });
  const b = req.body;
  const patch = {};
  if ("title" in b) patch.title = b.title;
  if ("slug" in b && slugify(b.slug)) patch.slug = slugify(b.slug);
  if ("description" in b) patch.description = b.description;
  if ("price" in b) patch.price = b.price;
  if ("compareAt" in b) patch.compareAt = b.compareAt ?? null;
  if ("inventory" in b) patch.inventory = b.inventory ?? null;
  if ("badge" in b) patch.badge = b.badge;
  if ("sort" in b) patch.sort = b.sort || 0;
  if ("active" in b) patch.active = b.active;
  res.json(store.updateProduct(req.params.id, patch));
});
A.delete("/products/:id", (req, res) => {
  const p = store.getProductById(req.params.id);
  if (p) p.images.forEach((img) => deleteUploadedFile(img.url));
  store.deleteProduct(req.params.id);
  res.json({ ok: true });
});

// ---------- image uploads ----------
function uploadErrorHandler(err, req, res, next) {
  if (!err) return next();
  const message = err.code === "LIMIT_FILE_SIZE" ? "Image is larger than 8MB." : err.message || "Upload failed.";
  res.status(400).json({ error: message });
}

A.post("/uploads/hero", upload.single("file"), uploadErrorHandler, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose an image to upload." });
  try {
    const url = await resizeAndSave(req.file.buffer, { maxWidth: 2400 });
    const site = store.getSite();
    if (site.heroImageUrl) deleteUploadedFile(site.heroImageUrl);
    store.updateSite({ heroImageUrl: url });
    res.json({ url });
  } catch (err) {
    res.status(400).json({ error: err.message || "Couldn't process that image." });
  }
});
A.delete("/uploads/hero", (req, res) => {
  const site = store.getSite();
  if (site.heroImageUrl) deleteUploadedFile(site.heroImageUrl);
  store.updateSite({ heroImageUrl: "" });
  res.json({ ok: true });
});

A.post("/products/:id/images", upload.single("file"), uploadErrorHandler, async (req, res) => {
  const p = store.getProductById(req.params.id);
  if (!p) return res.status(404).json({ error: "Product not found." });
  if (p.images.length >= 4) return res.status(400).json({ error: "This product already has 4 photos. Remove one first." });
  if (!req.file) return res.status(400).json({ error: "Choose an image to upload." });
  try {
    const url = await resizeAndSave(req.file.buffer, { maxWidth: 1600 });
    const image = store.addProductImage(p.id, url);
    res.json(image);
  } catch (err) {
    res.status(400).json({ error: err.message || "Couldn't process that image." });
  }
});
A.delete("/products/:id/images/:imageId", (req, res) => {
  const p = store.getProductById(req.params.id);
  if (!p) return res.status(404).json({ error: "Product not found." });
  const image = p.images.find((i) => i.id === req.params.imageId);
  if (image) deleteUploadedFile(image.url);
  store.deleteProductImage(p.id, req.params.imageId);
  res.json({ ok: true });
});
A.put("/products/:id/images/reorder", validate(imagesReorderSchema), (req, res) => {
  const p = store.getProductById(req.params.id);
  if (!p) return res.status(404).json({ error: "Product not found." });
  const order = req.body.order;
  const valid = order.length === p.images.length && order.every((id) => p.images.some((i) => i.id === id));
  if (!valid) return res.status(400).json({ error: "Image order doesn't match this product's photos." });
  store.reorderProductImages(p.id, order);
  res.json(store.getProductById(p.id));
});

A.get("/subscribers", (req, res) => res.json(store.listSubscribers()));
A.get("/subscribers.csv", (req, res) => {
  res.type("text/csv").attachment("subscribers.csv");
  res.send(
    "email,subscribed_at\n" +
      store
        .listSubscribers()
        .map((s) => `${s.email},${s.createdAt}`)
        .join("\n")
  );
});
A.delete("/subscribers/:id", (req, res) => {
  store.deleteSubscriber(req.params.id);
  res.json({ ok: true });
});

A.get("/messages", (req, res) => res.json(store.listMessages()));
A.put("/messages/:id", validate(messageReadSchema), (req, res) => {
  const m = store.updateMessage(req.params.id, { read: req.body.read });
  if (!m) return res.status(404).json({ error: "Message not found." });
  res.json(m);
});

A.get("/orders", (req, res) => res.json(store.listOrders()));
A.put("/orders/:id", validate(orderStatusSchema), (req, res) => {
  const o = store.getOrderById(req.params.id);
  if (!o) return res.status(404).json({ error: "Order not found." });
  res.json(store.updateOrderStatus(req.params.id, req.body.status));
});

app.use("/api/admin", A);

// product pages: /products/:slug -> product.html, with Book + Product JSON-LD
app.get("/products/:slug", (req, res) => {
  const site = store.getSite();
  const p = store.getProductBySlug(req.params.slug, { activeOnly: true });
  if (!p) return res.status(404).sendFile(path.join(PUBLIC_DIR, "404.html"));

  const url = `${PUBLIC_URL}/products/${p.slug}`;
  const image = absoluteUrl((p.images[0] && p.images[0].url) || site.heroImageUrl);
  const description = clean(p.description, 300) || site.metaDescription;
  const inStock = p.inventory === null || p.inventory > 0;
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Book", "@id": `${url}#book`, name: p.title, description, url, bookFormat: "https://schema.org/Hardcover" },
      {
        "@type": "Product",
        "@id": `${url}#product`,
        name: p.title,
        description,
        url,
        sku: p.id,
        ...(image ? { image: [image] } : {}),
        ...(p.price > 0
          ? {
              offers: {
                "@type": "Offer",
                url,
                priceCurrency: "USD",
                price: (p.price / 100).toFixed(2),
                availability: inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
              },
            }
          : {}),
      },
    ],
  };
  sendPage(res, "product.html", { title: `${p.title} | ${site.storeName}`, description, url, image, jsonLd });
});
app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC_DIR, "404.html")));

if (require.main === module) {
  app.listen(PORT, () => console.log(`Book site running on http://localhost:${PORT}`));
}

module.exports = app;
