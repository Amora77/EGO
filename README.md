# EGO

An online clothing store for the Egyptian market. Plain HTML/CSS/JS frontend,
a small Node/Express + SQLite backend, prices in EGP, delivery restricted to
Egypt, a fixed EGP 75.00 shipping fee per order, and **Cash on Delivery**
as the only active payment method for now (Stripe code exists but is
disabled; a local gateway like Paymob is planned for a later phase).

## Features

- Home, Shop, Sale, Product detail, Cart, About and Contact pages
- Customer accounts — signup/login, email verification, password reset,
  order history (`account.html`)
- Client-side cart (localStorage) — add to cart, change quantity, remove items
- Checkout: **Cash on Delivery** (customer enters a full delivery address,
  order gets an order number like `EGO-00042` for you to hand to a courier)
  plus a fixed **EGP 75.00 shipping fee** added to every order, computed
  server-side (card payments via Stripe are implemented too but disabled —
  see **Payments** below)
- Admin panel (`/admin`) — login, product catalog management (including
  image upload), per-size stock/inventory, sale pricing (old price / new
  price / % off), order list with delivery addresses, and marking Cash on
  Delivery orders as delivered
- Per-size stock tracking — customers can't select or order a sold-out size;
  stock is atomically validated and decremented server-side when a Cash on
  Delivery order is placed, so two concurrent orders can never both claim
  the last unit (see **Inventory** below)
- Order confirmation emails (optional, via any SMTP provider)
- SQLite database (`data/ego.db`) — products, orders, accounts

## Project structure

```
public/                 static frontend (served as-is, no build step)
  index.html, shop.html, sale.html, product.html, cart.html,
  about.html, contact.html, account.html                customer-facing pages
  verify-email.html, reset-password.html                 account flows
  success.html, cancel.html                               post-checkout
  admin/                                                   admin panel (login, products, orders, sale)
  css/style.css          all styling
  js/*.js                cart, rendering, checkout, account, admin logic
db/index.js              SQLite connection + schema (auto-migrates on boot)
lib/auth.js              password hashing, JWT sessions, auth middleware
lib/email.js             order confirmation / verification / reset emails
routes/auth.js           signup, login, logout, verify email, password reset
routes/products.js       product catalog API + admin CRUD (with image upload)
routes/orders.js         checkout (card + COD), order lookup, admin order actions
scripts/seed-products.js one-time seed of the starter catalog
scripts/make-admin.js    create/promote an admin user from the command line
server.js                wires everything together; Stripe webhook; security
                         middleware (helmet, rate limiting)
```

Prices are only ever read from the database on the **server** — the browser
cannot influence how much a customer is actually charged. Cart item
validation (product exists, quantity in range, valid size) happens
server-side for both the card and Cash on Delivery checkout paths. The same
applies to shipping: the fixed fee is added to the order total entirely
server-side (`SHIPPING_FEE_CENTS` in `routes/orders.js`) — nothing sent by
the client affects it.

## 1. Install dependencies

```bash
npm install
```

Requires **Node 22.5+** (uses Node's built-in `node:sqlite` — no native
module compilation needed).

## 2. Set up your environment

```bash
cp .env.example .env
```

Fill in:

- `JWT_SECRET` — required for login (admin and customers) to work at all.
  Generate one with:
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- `CLIENT_URL` — your site's URL (`http://localhost:3000` locally)
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` — only if you want card
  payments (see **Payments** below — read the caveat first)
- `SMTP_*` / `EMAIL_FROM` — optional, for order confirmation / verification /
  password reset emails. Works with any SMTP provider (Resend, Gmail app
  password, SendGrid, Mailgun, etc). Leave `SMTP_HOST` blank to skip sending
  emails entirely — everything else still works, emails are just silently
  skipped.

## 3. Seed the database and create an admin account

```bash
node scripts/seed-products.js
node scripts/make-admin.js you@example.com yourpassword
```

`seed-products.js` is safe to re-run (it won't duplicate existing products).
`make-admin.js` creates the account if it doesn't exist, or promotes/resets
the password of an existing one.

## 4. Run it

```bash
npm start
```

Visit http://localhost:3000, and log into the admin panel at
http://localhost:3000/admin/login.html with the account you just created.

## Shipping

Every order — card or Cash on Delivery — is charged a **fixed EGP 75.00
shipping fee**, once per order regardless of item count or quantity. It is
not stored per-order in the database; it's a single backend constant,
`SHIPPING_FEE_CENTS = 7500` (piastres, same convention as `price_cents`) in
`routes/orders.js`, added to the server-computed products subtotal for both
checkout paths (`/api/create-checkout-session` and `/api/orders/cod`) before
the order is written to the database. To change the fee, edit that one
constant — nothing else needs to change, and it's applied consistently to
whichever payment method is active. An empty cart is rejected before this
fee is ever applied, so it's impossible to be charged shipping alone.

Every page that shows an order total (cart, order confirmation, account
order history, confirmation emails) breaks it down as Subtotal + Shipping =
Total. The cart page's shipping line is a display-only mirror of the same
constant; every other total shown comes directly from the server's own
calculation, never recomputed or trusted from the browser.

## Inventory

Stock is tracked per product **size** (a `product_stock` table keyed on
`(product_id, size)`), not per product — `products.sizes` still just lists
which size labels a product offers, unchanged from before; `product_stock`
separately tracks how many of each are left. Manage it from the same
Add/Edit Product form in the admin panel (`/admin/products.html`) — a number
input appears per size, live-updated as you edit the size list.

On the product page, a size with 0 stock is shown disabled with a "Sold Out"
label and can't be selected; "Add to Cart" is disabled if the selected size
has none left. That's a UX convenience only — **the server is the actual
authority**. `POST /api/orders/cod` re-validates and decrements stock for
every line itself, regardless of what the browser showed, inside one SQL
transaction per order:

```sql
UPDATE product_stock SET stock = stock - ? WHERE product_id = ? AND size = ? AND stock >= ?
```

The "is there enough?" check and the decrement happen in that single
statement — that's what makes it safe against two customers checking out
the same last unit at the same time; whichever request's `UPDATE` runs first
wins, and the second's `WHERE stock >= ?` simply matches zero rows. If any
item in an order can't be fulfilled, the whole order is rolled back — no
partial decrements, and stock can never go negative (`CHECK (stock >= 0)` on
the column itself, as a second guarantee independent of the application
code). A brand new database seeds every existing product's sizes with a
placeholder stock of **10** on first boot — replace with real numbers via
the admin panel before/after launch.

Order cancellation/restocking isn't built yet — `order_items` already
records exactly what was ordered (product, size, quantity) if that's added
later.

## Payments

**Cash on Delivery is the only active payment method right now**, by
deliberate choice — no setup needed, it works out of the box.

**Stripe is implemented in the code but intentionally disabled** (no
`STRIPE_SECRET_KEY` configured). It's not just a matter of preference either:
Stripe does not support merchant accounts registered in Egypt, so it
wouldn't work for a real Egypt-based business even if enabled. The
integration is kept in the codebase — including the same fixed shipping fee
applied as its own Stripe line item — in case you register a business
somewhere Stripe does support, or as a reference implementation.

**A local Egyptian payment gateway (Paymob) is planned for a later phase**
and is not implemented yet — see **Known limitations** below.

If you ever do enable Stripe with a working account:
1. Get your API keys from https://dashboard.stripe.com (test mode keys to start)
2. Set `STRIPE_SECRET_KEY` and `CLIENT_URL` in `.env`
3. For webhook-confirmed orders (recommended): create a webhook endpoint in
   the Stripe dashboard pointing at `https://your-domain.com/webhook`, or run
   `stripe listen --forward-to localhost:3000/webhook` locally, and set
   `STRIPE_WEBHOOK_SECRET` to the printed `whsec_...` value
4. Test with [Stripe's test cards](https://stripe.com/docs/testing), e.g.
   `4242 4242 4242 4242`, any future expiry, any CVC

## Customize

- **Products, prices, sale pricing, images**: manage all of this from the
  admin panel (`/admin/products.html`, `/admin/sale.html`) — no code changes
  needed day-to-day
- **Branding**: colors and fonts live in `public/css/style.css` under the
  `:root` CSS variables at the top
- **Delivery country**: currently Egypt-only (`ALLOWED_COUNTRIES` in
  `routes/orders.js`, plus the country `<select>` in `public/js/cart-page.js`)
- **Shipping fee**: fixed at EGP 75.00 per order (`SHIPPING_FEE_CENTS` in
  `routes/orders.js` — see **Shipping** above)

## Deploying

This is a standard Node app — it runs on any host that runs Node 22.5+
(Render, Railway, Fly.io, a VPS, etc). Before you deploy, read this:

**The database is a SQLite file (`data/ego.db` by default) on local disk,
and uploaded product images are plain files (`public/images/products/` by
default) on local disk too.** Neither survives a host with an ephemeral
filesystem (e.g. most free-tier container platforms reset the filesystem on
every redeploy or restart) — you would lose all products, orders, accounts,
and uploaded images on the next deploy. `DATA_DIR` and `UPLOADS_DIR` (see
`.env.example`) exist specifically so you can point both at a persistent
disk instead.

### Render (paid Web Service + Persistent Disk)

1. Create the Web Service from this repo. Build command: `npm install`.
   Start command: `npm start`.
2. Add a **Persistent Disk** to the service (Render dashboard → your service
   → Disks), e.g. mounted at `/var/data`. A few GB is plenty to start.
3. Set these environment variables on the service:
   - `DATA_DIR=/var/data`
   - `UPLOADS_DIR=/var/data/uploads/products`
   - `NODE_ENV=production` — makes the login cookie `Secure` (HTTPS-only)
   - `JWT_SECRET` (generate a fresh one — don't reuse a local dev value),
     `CLIENT_URL` (your real `https://...` Render URL or custom domain),
     and the `SMTP_*` / `STRIPE_*` vars you want to use (see `.env.example`)
4. Deploy. Both directories are created automatically on first boot if they
   don't already exist on the disk (see `db/index.js` and
   `routes/products.js`) — no manual `mkdir` step needed.
5. Run `node scripts/seed-products.js` and `node scripts/make-admin.js
   you@example.com yourpassword` once against the deployed service (e.g. via
   Render's shell) to seed the catalog and create your first admin login.
6. If using Stripe: point its webhook at `https://your-real-domain.com/webhook`
   and switch to live keys only once ready to accept real payments.
7. Update the **placeholder EGP prices** in the admin panel — the starter
   catalog's prices were carried over from an earlier USD version and are
   currently far too low for EGP (e.g. a puffer jacket at EGP 158.00).

Without `DATA_DIR`/`UPLOADS_DIR` set, the app falls back to its original
local paths (`data/ego.db`, `public/images/products/`) — fine for local
development, but on Render specifically that means the ephemeral (non-disk)
filesystem, so set both for any real Render deployment.

## Known limitations

- **No local Egyptian payment gateway yet.** Cash on Delivery works;
  card payments need either a non-Egypt Stripe account or a swap to
  Paymob/Kashier (not built).
- **Admin roles are all-or-nothing** — any account with `is_admin` has full
  access to products, orders, and pricing. No per-permission roles.
- **No automated tests.** Changes should be smoke-tested manually (or with a
  quick Playwright script) before deploying.
- Product images are plain files under `public/images/` (including
  admin-uploaded ones under `public/images/products/`) — no CDN/resizing.
