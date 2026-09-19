# Book storefront template

A single-book store: home page with hero + endorsement, editions grid, product pages,
slide-out cart, search, checkout, contact form, email signup, privacy page, and an admin panel.
All copy is bracketed placeholder text and all images are labeled placeholder boxes.

## Run it
    npm install
    ADMIN_PASSWORD=pick-a-strong-one npm start
    # store:  http://localhost:3000
    # admin:  http://localhost:3000/admin

On first start, `data/seed.json` populates a new SQLite database at `data/store.db` (the live
datastore). Delete `store.db` to reset to the placeholders.

## Tests & code style
    npm test           # vitest + supertest — products, newsletter, contact, orders,
                        # the Stripe webhook (mocked signature), and admin auth
    npm run lint        # eslint
    npm run format      # prettier --write (server code; see .prettierignore)
    npm run format:check

## Environment variables
Copy `.env.example` to `.env` and fill in real values (loaded automatically via `dotenv`).

| Variable | Required | Notes |
| --- | --- | --- |
| `PORT` | no | Defaults to `3000`. |
| `ADMIN_PASSWORD` | **yes** | Bcrypt-hashed into the database on first run. |
| `NODE_ENV` | production only | Set to `production` so the admin session cookie gets `secure`. |
| `STRIPE_SECRET_KEY` | for payments | From the Stripe dashboard. |
| `STRIPE_WEBHOOK_SECRET` | for payments | See **Stripe webhook setup** below. |
| `PUBLIC_URL` | for payments | This site's public URL, no trailing slash — used for Stripe redirect URLs, the sitemap, and canonical/OG tags. |
| `SHIP_COUNTRIES` | no | Comma-separated ISO country codes Stripe collects a shipping address for. Defaults to `US,CA`. |
| `RESEND_API_KEY` | for email | Without it, emails are logged to the console instead of sent. |
| `RESEND_FROM_EMAIL` | no | Defaults to a Resend sandbox address; set a verified sender once you have one. |
| `ADMIN_EMAIL` | for owner alerts | Where new-order and contact-form alerts go. |
| `DB_PATH` / `UPLOAD_DIR` | no | Override where the SQLite file and uploaded images live (see **Deploying**). |

## Stripe webhook setup
`/api/stripe/webhook` needs `STRIPE_WEBHOOK_SECRET` to verify that events actually came from
Stripe.

**Local testing**, with the [Stripe CLI](https://docs.stripe.com/stripe-cli):
```
stripe login
stripe listen --forward-to localhost:3000/api/stripe/webhook
```
The CLI prints a `whsec_...` value — put that in `.env` as `STRIPE_WEBHOOK_SECRET` and restart
the server. Run `stripe trigger checkout.session.completed` to fire a test event, or just
complete a real test-mode checkout (card `4242 4242 4242 4242`, any future expiry/CVC).

**In production:** Stripe dashboard → Developers → Webhooks → Add endpoint →
`https://<your-domain>/api/stripe/webhook`, listening for `checkout.session.completed`. Copy
the signing secret it gives you into `STRIPE_WEBHOOK_SECRET` on your host.

## Filling it in
Everything text-based is editable in **Admin → Site content** and **Admin → Products**
(prices are in cents: 2999 = $29.99). Setting the Amazon link shows an "also on Amazon"
link in the hero; leave it blank to hide it.

## Swapping in images
Upload images from **Admin → Site content** (hero image) and **Admin → Products → Edit**
(up to 4 photos per product — drag thumbnails to reorder). JPG, PNG, or WEBP, 8MB max; they're
resized on upload and served from `/uploads`. Until an image is uploaded, each spot shows a
placeholder box describing what goes there and the shape it needs (3:2 for the hero, 4:5 for
product photos).

## Structure
    server.js            Express API + static hosting
    db/                  SQLite schema + data-access layer
    lib/                 Stripe, email, and upload helpers
    data/seed.json       Placeholder content (site copy + 3 editions)
    uploads/             Uploaded hero/product images (created at runtime)
    public/*.html        Page shells (home, catalog, product, checkout, success, cancel,
                          contact, privacy, 404, admin)
    public/js/app.js     Layout, cart, search, newsletter, per-page logic
    public/css/styles.css

## API
Public: GET /api/site, /api/products, /api/products/:slug, /api/search?q=,
        /api/orders/by-session/:sessionId
        POST /api/newsletter, /api/contact, /api/orders (returns a Stripe Checkout URL)
        POST /api/stripe/webhook (Stripe only — signature-verified)
Admin (cookie session — see below): POST /api/admin/login, logout; GET session; /api/admin/summary,
        site, products, orders, messages, subscribers, subscribers.csv, uploads/hero,
        products/:id/images, products/:id/images/:imageId, products/:id/images/reorder

## Admin login
Sign in at `/admin` with `ADMIN_PASSWORD`. The password is bcrypt-hashed into the database on
first run (and re-hashed if you change `ADMIN_PASSWORD` and redeploy). A successful login sets
an httpOnly, sameSite=strict session cookie (`secure` too once `NODE_ENV=production`, so serve
admin over HTTPS in production); every admin write additionally requires an `X-CSRF-Token`
header matching the token issued at login, which the built-in admin UI handles for you. Login
attempts are rate-limited per IP.

## Before going live
1. ~~**Payments.**~~ Done — `/api/orders` creates a pending order, then a Stripe Checkout
   Session priced server-side from the catalog, and returns its URL for the frontend to
   redirect to. `/api/stripe/webhook` verifies the event signature, marks the order paid,
   stores the Stripe session/payment-intent IDs, and decrements inventory. Set
   `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `PUBLIC_URL` — see `.env.example`.
2. ~~**Emails.**~~ Done — order confirmations and owner/contact alerts send via Resend
   (`lib/email.js`) from the webhook and `/api/contact`. Without `RESEND_API_KEY` set,
   emails are logged to the console instead of sent, so local dev never breaks. Set
   `ADMIN_EMAIL` to receive owner alerts. `/api/newsletter` still just stores subscribers —
   sync it to a mailing list tool (Mailchimp, Resend Audiences, etc.) when she picks one.
3. ~~**Database.**~~ Done — SQLite via `better-sqlite3` (`db/schema.sql`, `db/index.js`),
   seeded from `data/seed.json` on first run. It's fine for launch-scale traffic on a single
   server. On hosts with ephemeral disks, mount a persistent disk over `data/` and `uploads/`
   (see `render.yaml`) so orders and images survive a redeploy.
4. **Privacy policy.** Replace the placeholder with attorney-approved text.
5. Set a strong `ADMIN_PASSWORD` and serve over HTTPS (set `NODE_ENV=production`).

## Hardening & SEO
- `helmet` (with a CSP allowing Google Fonts and Stripe), `compression`, and `morgan` request
  logging are on by default.
- Every API input is validated with `zod` (`lib/schemas.js`).
- Titles, meta descriptions, and Open Graph/Twitter tags are injected server-side per page from
  site settings and product data, so social previews and crawlers see real content. Product
  pages also carry Book + Product JSON-LD.
- `/robots.txt` (disallows `/admin`) and `/sitemap.xml` (home, catalog, contact, privacy, and
  every active product) are generated automatically.

## Deploying
A `Dockerfile` and `render.yaml` are included.

**Render** (recommended — `render.yaml` is a [Render Blueprint](https://render.com/docs/blueprint-spec)):
1. Push this repo to GitHub/GitLab and create a new Blueprint from it in the Render dashboard
   (or `render blueprints launch` with the Render CLI).
2. Render provisions a web service (built from the `Dockerfile`) plus a 1GB persistent disk
   mounted at `/data`; `DB_PATH` and `UPLOAD_DIR` are already pointed at it in `render.yaml`, so
   the SQLite file and uploaded images survive redeploys. `ADMIN_PASSWORD` is auto-generated —
   find it in the service's Environment tab, or set your own.
3. Fill in the `sync: false` env vars in the Render dashboard: `PUBLIC_URL` (your Render URL or
   custom domain), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and, if you want email,
   `RESEND_API_KEY` / `RESEND_FROM_EMAIL` / `ADMIN_EMAIL`.
4. Add the Stripe webhook endpoint (see above) pointing at your Render URL, and put its signing
   secret into `STRIPE_WEBHOOK_SECRET`.

**Any other Docker host:** `docker build -t book-storefront . && docker run -p 3000:3000
--env-file .env -v book-storefront-data:/data -e DB_PATH=/data/store.db -e
UPLOAD_DIR=/data/uploads book-storefront` — mount a volume at `/data` the same way so the
database and uploads persist across container restarts.
