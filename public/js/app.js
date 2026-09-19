// Shared storefront script: layout, cart drawer, search, newsletter, and per-page logic.
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (cents) => (cents > 0 ? "$" + (cents / 100).toFixed(2) : "[Price]");
const api = async (url, opts = {}) => {
  const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "Something went wrong. Try again.");
  return data;
};
const ICON = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 7h14l-1.2 12.2a1 1 0 0 1-1 .8H7.2a1 1 0 0 1-1-.8z"/><path d="M9 7V5a3 3 0 0 1 6 0v2"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};

// ---------- cart (browser-side; prices are rechecked on the server) ----------
const Cart = {
  key: "book-cart",
  get() { try { return JSON.parse(localStorage.getItem(this.key)) || []; } catch { return []; } },
  set(items) { try { localStorage.setItem(this.key, JSON.stringify(items)); } catch {} renderCart(); },
  add(p, qty = 1) {
    const items = this.get();
    const found = items.find((i) => i.id === p.id);
    if (found) found.qty = Math.min(20, found.qty + qty);
    else items.push({ id: p.id, slug: p.slug, title: p.title, price: p.price, qty, image: p.images && p.images[0] ? p.images[0].url : "" });
    this.set(items);
  },
  update(id, qty) { this.set(this.get().map((i) => (i.id === id ? { ...i, qty: Math.max(1, Math.min(20, qty)) } : i))); },
  remove(id) { this.set(this.get().filter((i) => i.id !== id)); },
  count() { return this.get().reduce((s, i) => s + i.qty, 0); },
  subtotal() { return this.get().reduce((s, i) => s + i.price * i.qty, 0); },
};

let SITE = {};

function layout() {
  const page = document.body.dataset.page;
  const nav = [["/", "Home", "home"], ["/catalog", "Catalog", "catalog"], ["/contact", "Contact", "contact"]];
  $("#app-header").outerHTML = `
    <a class="skip" href="#MainContent">Skip to content</a>
    ${SITE.announcement ? `<div class="announce">${esc(SITE.announcement)}</div>` : ""}
    <header class="header">
      <div class="wrap">
        <button class="icon-btn menu-btn" aria-label="Open menu" aria-expanded="false" id="menuBtn">${ICON.menu}</button>
        <a class="logo" href="/">${esc(SITE.storeName)}</a>
        <nav class="nav" id="nav" aria-label="Main">
          ${nav.map(([h, l, k]) => `<a href="${h}" ${k === page ? 'aria-current="page"' : ""}>${l}</a>`).join("")}
        </nav>
        <div class="icons">
          <button class="icon-btn" id="searchBtn" aria-label="Search">${ICON.search}</button>
          <button class="icon-btn" id="cartBtn" aria-label="Cart">${ICON.cart}<span class="cart-count" id="cartCount" hidden>0</span></button>
        </div>
      </div>
    </header>`;
  $("#app-footer").outerHTML = `
    <section class="newsletter" aria-labelledby="nl-title">
      <div class="wrap">
        <div><h2 id="nl-title">${esc(SITE.newsletterHeading)}</h2><p>${esc(SITE.newsletterBody)}</p></div>
        <div>
          <form class="inline-form" id="nlForm" novalidate>
            <label class="sr-only" for="nlEmail">Email</label>
            <input id="nlEmail" type="email" name="email" placeholder="Email address" autocomplete="email" required>
            <button type="submit">Subscribe</button>
          </form>
          <p class="status" id="nlStatus" role="status"></p>
        </div>
      </div>
    </section>
    <footer class="footer"><div class="wrap">
      <span>© ${new Date().getFullYear()} ${esc(SITE.storeName)}</span>
      <span><a href="/privacy">Privacy policy</a> &nbsp; <a href="/contact">Contact</a></span>
    </div></footer>
    <div class="overlay" id="overlay"></div>
    <aside class="drawer" id="cartDrawer" aria-label="Cart" aria-hidden="true">
      <div class="drawer-head"><h2>Your cart</h2><button class="icon-btn" data-close aria-label="Close cart">${ICON.close}</button></div>
      <div class="drawer-body" id="cartBody"></div>
      <div class="drawer-foot" id="cartFoot"></div>
    </aside>
    <aside class="drawer top" id="searchDrawer" aria-label="Search" aria-hidden="true">
      <form class="search-row" id="searchForm" role="search">
        <label class="sr-only" for="searchInput">Search products</label>
        <input id="searchInput" type="text" placeholder="Search products" autocomplete="off">
        <button class="icon-btn" type="button" data-close aria-label="Close search">${ICON.close}</button>
      </form>
      <div class="search-results" id="searchResults"></div>
    </aside>
    <div class="toast" id="toast" role="status"></div>`;

  document.title = document.title.replace("{store}", SITE.storeName || "");
  const md = document.querySelector('meta[name="description"]');
  if (md && SITE.metaDescription) md.content = SITE.metaDescription;

  $("#menuBtn").onclick = (e) => {
    const open = $("#nav").classList.toggle("open");
    e.currentTarget.setAttribute("aria-expanded", open);
  };
  $("#cartBtn").onclick = () => openDrawer("#cartDrawer");
  $("#searchBtn").onclick = () => { openDrawer("#searchDrawer"); setTimeout(() => $("#searchInput").focus(), 50); };
  $("#overlay").onclick = closeDrawers;
  document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = closeDrawers));
  document.addEventListener("keydown", (e) => e.key === "Escape" && closeDrawers());

  let t;
  $("#searchInput").oninput = (e) => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = e.target.value.trim();
      if (!q) return ($("#searchResults").innerHTML = "");
      const res = await api("/api/search?q=" + encodeURIComponent(q)).catch(() => []);
      $("#searchResults").innerHTML = res.length
        ? res.map((p) => `<a href="/products/${p.slug}"><span>${esc(p.title)}</span><span class="price">${money(p.price)}</span></a>`).join("")
        : `<p>No products match "${esc(q)}". Try a shorter word, or <a href="/catalog">view the full catalog</a>.</p>`;
    }, 200);
  };
  $("#searchForm").onsubmit = (e) => e.preventDefault();

  $("#nlForm").onsubmit = async (e) => {
    e.preventDefault();
    const st = $("#nlStatus");
    try {
      const r = await api("/api/newsletter", { method: "POST", body: JSON.stringify({ email: $("#nlEmail").value }) });
      st.className = "status ok"; st.textContent = r.message; e.target.reset();
    } catch (err) { st.className = "status err"; st.textContent = err.message; }
  };
  renderCart();
}

function openDrawer(sel) {
  closeDrawers();
  $(sel).classList.add("open"); $(sel).setAttribute("aria-hidden", "false");
  $("#overlay").classList.add("show");
}
function closeDrawers() {
  document.querySelectorAll(".drawer.open").forEach((d) => { d.classList.remove("open"); d.setAttribute("aria-hidden", "true"); });
  $("#overlay")?.classList.remove("show");
}
function toast(msg) {
  const el = $("#toast"); el.textContent = msg; el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2200);
}

function renderCart() {
  const body = $("#cartBody"); if (!body) return;
  const items = Cart.get(), n = Cart.count();
  const c = $("#cartCount"); c.textContent = n; c.hidden = n === 0;
  if (!items.length) {
    body.innerHTML = `<div class="empty"><p>Your cart is empty.</p><a class="btn" href="/catalog">Browse the catalog</a></div>`;
    $("#cartFoot").innerHTML = "";
    return;
  }
  body.innerHTML = items.map((i) => `
    <div class="line">
      ${i.image ? `<img src="${esc(i.image)}" alt="">` : `<div class="ph">Cover</div>`}
      <div>
        <a href="/products/${i.slug}">${esc(i.title)}</a>
        <div><span class="qty">
          <button data-dec="${i.id}" aria-label="Decrease quantity">−</button>
          <input value="${i.qty}" data-qty="${i.id}" inputmode="numeric" aria-label="Quantity">
          <button data-inc="${i.id}" aria-label="Increase quantity">+</button>
        </span><button class="remove" data-rm="${i.id}">Remove</button></div>
      </div>
      <div class="price">${money(i.price * i.qty)}</div>
    </div>`).join("");
  $("#cartFoot").innerHTML = `
    <div class="totals"><span>Subtotal</span><span class="price">${money(Cart.subtotal())}</span></div>
    <small>Shipping is calculated at checkout.</small>
    <a class="btn accent block" href="/checkout">Check out</a>`;
  body.querySelectorAll("[data-inc]").forEach((b) => (b.onclick = () => { const i = Cart.get().find((x) => x.id === b.dataset.inc); Cart.update(i.id, i.qty + 1); }));
  body.querySelectorAll("[data-dec]").forEach((b) => (b.onclick = () => { const i = Cart.get().find((x) => x.id === b.dataset.dec); Cart.update(i.id, i.qty - 1); }));
  body.querySelectorAll("[data-qty]").forEach((inp) => (inp.onchange = () => Cart.update(inp.dataset.qty, parseInt(inp.value, 10) || 1)));
  body.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => Cart.remove(b.dataset.rm)));
}

function productCard(p) {
  const cover = p.images && p.images[0];
  return `
    <article class="product-card">
      <a class="media" href="/products/${p.slug}" aria-label="${esc(p.title)}">
        ${cover ? `<img src="${esc(cover.url)}" alt="">` : `<div class="ph">Product photo — book cover or edition shot, 4:5 portrait</div>`}
        ${p.badge ? `<span class="badge">${esc(p.badge)}</span>` : ""}
      </a>
      <h3><a href="/products/${p.slug}">${esc(p.title)}</a></h3>
      <div class="row">
        <span class="price">${money(p.price)}${p.compareAt ? `<s>${money(p.compareAt)}</s>` : ""}</span>
        <button class="btn ghost" data-add="${p.id}">Add to cart</button>
      </div>
    </article>`;
}
function wireAdd(root, products) {
  root.querySelectorAll("[data-add]").forEach((b) => (b.onclick = () => {
    Cart.add(products.find((p) => p.id === b.dataset.add));
    toast("Added to cart"); openDrawer("#cartDrawer");
  }));
}

// ---------- pages ----------
const pages = {
  async home() {
    $("#hero").innerHTML = `
      ${SITE.heroImageUrl
        ? `<img class="hero-img" src="${esc(SITE.heroImageUrl)}" alt="">`
        : `<div class="ph">Hero image — full-width author portrait or book cover photo, 3:2 landscape, min 2400px wide. Keep the lower left darker or simpler so the title stays readable.</div>`}
      <div class="hero-inner">
        <h1>${esc(SITE.bookTitle)}</h1>
        ${SITE.heroSubline ? `<p class="subline">${esc(SITE.heroSubline)}</p>` : ""}
        <blockquote class="quote">
          <p>“${esc(SITE.endorsementQuote)}”</p>
          <cite>— <strong>${esc(SITE.endorsementName)}</strong>, ${esc(SITE.endorsementCredentials)}</cite>
        </blockquote>
        <div class="hero-actions">
          <a class="btn accent" href="/catalog">${esc(SITE.ctaLabel)}</a>
          ${SITE.amazonUrl ? `<a class="textlink" href="${esc(SITE.amazonUrl)}" target="_blank" rel="noopener">${esc(SITE.amazonLabel)}</a>` : ""}
          ${SITE.releaseNote ? `<span class="textlink" style="text-decoration:none">${esc(SITE.releaseNote)}</span>` : ""}
        </div>
      </div>`;
    const products = await api("/api/products");
    $("#featured").innerHTML = products.map(productCard).join("");
    wireAdd($("#featured"), products);
  },

  async catalog() {
    const products = await api("/api/products");
    $("#catalogGrid").innerHTML = products.length ? products.map(productCard).join("") : `<p>No products are listed yet. Add one from the admin panel.</p>`;
    wireAdd($("#catalogGrid"), products);
  },

  async product() {
    const slug = location.pathname.split("/").pop();
    let p;
    try { p = await api("/api/products/" + encodeURIComponent(slug)); }
    catch { $("#pdp").innerHTML = `<div class="page-head"><h1>Product not found</h1><p>This edition may have been removed. <a href="/catalog">View the catalog</a>.</p></div>`; return; }
    document.title = `${p.title} | ${SITE.storeName}`;
    const images = p.images || [];
    const altCaptions = ["Alt photo: spine or back cover", "Alt photo: interior spread", "Alt photo: signed page or packaging"];
    $("#pdp").innerHTML = `
      <div class="pdp">
        <div>
          ${images[0] ? `<img class="main-img" src="${esc(images[0].url)}" alt="">` : `<div class="ph main">Main product photo — front cover or edition shot, 4:5 portrait</div>`}
          <div class="thumbs">${altCaptions.map((cap, i) => images[i + 1] ? `<img src="${esc(images[i + 1].url)}" alt="">` : `<div class="ph">${cap}</div>`).join("")}</div>
        </div>
        <div>
          <h1>${esc(p.title)}</h1>
          <span class="price">${money(p.price)}${p.compareAt ? `<s>${money(p.compareAt)}</s>` : ""}</span>
          ${p.inventory !== null && p.inventory <= 0 ? `<p><strong>Sold out.</strong></p>` : `
          <div><span class="qty"><button id="dec" aria-label="Decrease quantity">−</button><input id="qty" value="1" inputmode="numeric" aria-label="Quantity"><button id="inc" aria-label="Increase quantity">+</button></span></div>
          <button class="btn accent block" id="addBtn">Add to cart</button>`}
          ${p.inventory !== null && p.inventory > 0 && p.inventory < 25 ? `<p class="status">Only ${p.inventory} left.</p>` : ""}
          <div class="desc">${esc(p.description).replace(/\n/g, "<br>")}</div>
        </div>
      </div>`;
    const q = $("#qty"); if (!q) return;
    $("#inc").onclick = () => (q.value = Math.min(20, (+q.value || 1) + 1));
    $("#dec").onclick = () => (q.value = Math.max(1, (+q.value || 1) - 1));
    $("#addBtn").onclick = () => { Cart.add(p, Math.max(1, Math.min(20, +q.value || 1))); toast("Added to cart"); openDrawer("#cartDrawer"); };
  },

  async contact() {
    $("#contactIntro").textContent = SITE.contactIntro;
    $("#contactEmail").textContent = SITE.contactEmail;
    $("#contactForm").onsubmit = async (e) => {
      e.preventDefault();
      const st = $("#contactStatus"), btn = e.target.querySelector("button");
      btn.disabled = true;
      try {
        const r = await api("/api/contact", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(e.target))) });
        st.className = "status ok"; st.textContent = r.message; e.target.reset();
      } catch (err) { st.className = "status err"; st.textContent = err.message; }
      btn.disabled = false;
    };
  },

  async privacy() { $("#policy").textContent = SITE.privacyPolicy; },

  async checkout() {
    const render = () => {
      const items = Cart.get();
      if (!items.length) { $("#summary").innerHTML = `<p>Your cart is empty. <a href="/catalog">Browse the catalog</a>.</p>`; $("#checkoutForm").hidden = true; return; }
      const sub = Cart.subtotal();
      const ship = SITE.freeShippingThreshold && sub >= SITE.freeShippingThreshold ? 0 : SITE.flatShipping;
      $("#summary").innerHTML = items.map((i) => `<div class="totals"><span>${esc(i.title)} × ${i.qty}</span><span>${money(i.price * i.qty)}</span></div>`).join("")
        + `<hr><div class="totals"><span>Subtotal</span><span>${money(sub)}</span></div>
           <div class="totals"><span>Shipping</span><span>${ship ? money(ship) : "Free"}</span></div>
           <div class="totals"><strong>Total</strong><strong>${money(sub + ship)}</strong></div>`;
    };
    render();
    $("#checkoutForm").onsubmit = async (e) => {
      e.preventDefault();
      const st = $("#checkoutStatus"), btn = e.target.querySelector("button");
      btn.disabled = true;
      try {
        const r = await api("/api/orders", { method: "POST", body: JSON.stringify({
          items: Cart.get().map(({ id, qty }) => ({ id, qty })),
          customer: Object.fromEntries(new FormData(e.target)),
        }) });
        location.href = r.url;
      } catch (err) { st.className = "status err"; st.textContent = err.message; btn.disabled = false; }
    };
  },

  async success() {
    const params = new URLSearchParams(location.search);
    const sessionId = params.get("session_id");
    if (!sessionId) { $("#successBody").innerHTML = `<p>We couldn't find that order. <a href="/">Back to home</a>.</p>`; return; }
    try {
      const o = await api("/api/orders/by-session/" + encodeURIComponent(sessionId));
      Cart.set([]);
      const paid = o.status === "paid";
      $("#successBody").innerHTML = `
        <p>${paid ? "Thank you — your order is confirmed." : "Thanks! We're confirming your payment now."}</p>
        <p><strong>Order #${o.orderNumber}</strong> · ${money(o.total)}</p>
        <p>A confirmation email is on its way to you.</p>
        <p style="margin-top:1.5rem"><a class="btn" href="/">Back to home</a></p>`;
    } catch {
      $("#successBody").innerHTML = `<p>We couldn't find that order. If you were charged, <a href="/contact">contact us</a> and we'll sort it out.</p>`;
    }
  },
};

(async () => {
  try { SITE = await api("/api/site"); } catch {}
  layout();
  const page = pages[document.body.dataset.page];
  if (page) page().catch((e) => console.error(e));
})();
