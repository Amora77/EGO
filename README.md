# EGO

An online store for the EGO clothing brand. Plain HTML/CSS/JS frontend with a
small Node/Express backend that only exists to talk to Stripe (a browser can
never hold a Stripe secret key safely).

## Features

- Home, Shop (with category filters), Product detail, Cart, About and Contact pages
- Client-side cart (localStorage) — add to cart, change quantity, remove items
- Real checkout via [Stripe Checkout](https://stripe.com/docs/payments/checkout)
- Order confirmation (`success.html`) and cancelled checkout (`cancel.html`) pages
- Stripe webhook endpoint (`/webhook`) to receive `checkout.session.completed` events

## Project structure

```
public/            static frontend (served as-is, no build step)
  index.html       home page
  shop.html        product catalog + filters
  product.html     product detail page
  cart.html        cart + "Checkout" button
  success.html     shown after a successful payment
  cancel.html      shown if checkout is cancelled
  about.html       brand story
  contact.html     contact form (client-side only for now)
  css/style.css    all styling
  js/products.js   product catalog data (shared with the server)
  js/*.js          cart, rendering, and checkout logic
server.js          Express server: serves public/, creates Stripe Checkout
                   sessions, verifies Stripe webhooks
```

Product prices are only ever read from `public/js/products.js` on the
**server**. The browser cannot influence how much a customer is actually
charged.

## 1. Install dependencies

```bash
npm install
```

## 2. Get your Stripe API keys

You'll need your own Stripe account to accept real payments:

1. Sign up / log in at https://dashboard.stripe.com
2. Go to **Developers → API keys** and copy your **test mode** keys to start
   (switch to live keys only once you're ready to accept real money)
3. Copy `.env.example` to `.env` and fill in:

```bash
cp .env.example .env
```

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
CLIENT_URL=http://localhost:3000
```

The publishable key isn't currently used by the frontend (Stripe Checkout is
hosted, so it isn't needed client-side yet), but it's there for when you add
Stripe Elements or Payment Links.

### Webhook secret (optional but recommended)

To reliably know when an order is paid (e.g. to save it to a database or
send a confirmation email), set up a webhook:

1. Install the [Stripe CLI](https://stripe.com/docs/stripe-cli) locally, or add
   an endpoint at **Developers → Webhooks** in the dashboard pointing to
   `https://your-domain.com/webhook`
2. For local testing: `stripe listen --forward-to localhost:3000/webhook`
3. Copy the printed `whsec_...` value into `STRIPE_WEBHOOK_SECRET` in `.env`

Without this, checkout still works — you just won't get server-side
notification when an order completes (the `success.html` page still shows
the customer their confirmation).

## 3. Run it

```bash
npm start
```

Visit http://localhost:3000

Use [Stripe's test card numbers](https://stripe.com/docs/testing) to test a
purchase, e.g. `4242 4242 4242 4242`, any future expiry, any CVC.

## 4. Customize

- **Products**: edit the `PRODUCTS` array in `public/js/products.js` (id,
  name, category, price in cents, image, description, sizes)
- **Product images**: replace the placeholder SVGs in `public/images/` with
  real product photography (same filenames, or update the `image` field per
  product)
- **Branding**: colors and fonts live in `public/css/style.css` under the
  `:root` CSS variables at the top
- **Shipping countries**: edit `shipping_address_collection.allowed_countries`
  in `server.js`

## Deploying

This is a standard Node app — it can be deployed to any host that runs
Node.js (Render, Railway, Fly.io, a VPS, etc.). Whichever host you use:

1. Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `CLIENT_URL`
   (your real production URL) as environment variables on the host
2. Point your Stripe webhook endpoint at `https://your-real-domain.com/webhook`
3. Switch to live Stripe keys once you're ready to accept real payments
