# Book storefront template

A single-book store: home page with hero + endorsement, editions grid, product pages,
slide-out cart, search, checkout, contact form, email signup, privacy page, and an admin panel.
All copy is bracketed placeholder text and all images are labeled placeholder boxes.

## Run it
    npm install
    ADMIN_PASSWORD=pick-a-strong-one npm start
    # store:  http://localhost:3000
    # admin:  http://localhost:3000/admin

On first start, `data/seed.json` is copied to `data/db.json` (the live datastore).
Delete `db.json` to reset to the placeholders.

## Filling it in
Everything text-based is editable in **Admin → Site content** and **Admin → Products**
(prices are in cents: 2999 = $29.99). Setting the Amazon link shows an "also on Amazon"
link in the hero; leave it blank to hide it.

## Swapping in images
Each placeholder box says what goes there and the shape it needs:
- Hero: `pages.home` in `public/js/app.js` — replace the `.ph` div with an `<img>` (3:2, 2400px+ wide).
- Product cards / product page / cart: `productCard`, `pages.product`, `renderCart` in the same file (4:5 portrait).
To make images editable from admin, add an `image` field to products and render it in those three spots.

## Structure
    server.js            Express API + static hosting
    data/seed.json       Placeholder content (site copy + 3 editions)
    public/*.html        Page shells (home, catalog, product, checkout, contact, privacy, 404, admin)
    public/js/app.js     Layout, cart, search, newsletter, per-page logic
    public/css/styles.css

## API
Public: GET /api/site, /api/products, /api/products/:slug, /api/search?q=
        POST /api/newsletter, /api/contact, /api/orders
Admin (header `Authorization: Bearer <ADMIN_PASSWORD>`): /api/admin/summary, site, products,
        orders, messages, subscribers, subscribers.csv

## Before going live
1. ~~**Payments.**~~ Done — `/api/orders` creates a pending order, then a Stripe Checkout
   Session priced server-side from the catalog, and returns its URL for the frontend to
   redirect to. `/api/stripe/webhook` verifies the event signature, marks the order paid,
   stores the Stripe session/payment-intent IDs, and decrements inventory. Set
   `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `PUBLIC_URL` — see `.env.example`.
2. **Emails.** Send order confirmations and contact-form alerts (Resend, Postmark, SendGrid)
   from `/api/orders` and `/api/contact`, and sync `/api/newsletter` to her mailing list tool.
3. **Database.** The JSON file is fine for launch-scale traffic on a single server. On
   hosts with ephemeral disks (Render free tier, Heroku), use a persistent disk or move to Postgres.
4. **Privacy policy.** Replace the placeholder with attorney-approved text.
5. Set a strong `ADMIN_PASSWORD` and serve over HTTPS.
