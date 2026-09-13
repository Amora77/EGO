require("dotenv").config();

const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const db = require("./db");
const { attachUser } = require("./lib/auth");
const { sendOrderConfirmation } = require("./lib/email");
const createAuthRouter = require("./routes/auth");
const productsRouter = require("./routes/products");
const createOrdersRouter = require("./routes/orders");

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecretKey ? require("stripe")(stripeSecretKey) : null;

const PORT = process.env.PORT || 3000;
const CLIENT_URL = process.env.CLIENT_URL || `http://localhost:${PORT}`;

const app = express();

// Deploying behind a reverse proxy (Render, Railway, Fly, or nginx on a VPS —
// i.e. almost any real deployment) means every request arrives from the
// proxy's own IP unless Express is told to read the real client IP from
// X-Forwarded-For. Without this, the rate limiters below would see every
// visitor as one single IP and lock out the whole site after a handful of
// requests total.
app.set("trust proxy", 1);

// Stripe webhook needs the raw request body for signature verification,
// so it must be registered before the global express.json() parser.
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let event = req.body;

    if (webhookSecret && stripe) {
      const signature = req.headers["stripe-signature"];
      try {
        event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
      } catch (err) {
        console.error("Webhook signature verification failed:", err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }
    } else {
      try {
        event = JSON.parse(req.body);
      } catch {
        return res.status(400).send("Invalid payload");
      }
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const orderId = session.metadata && session.metadata.order_id;

      if (orderId) {
        const shipping = session.shipping_details || session.customer_details || null;
        const email = (session.customer_details && session.customer_details.email) || null;

        db.prepare(
          `UPDATE orders
           SET status = 'paid', stripe_session_id = ?, email = ?, amount_total = ?, shipping_address = ?
           WHERE id = ?`
        ).run(session.id, email, session.amount_total, shipping ? JSON.stringify(shipping) : null, orderId);

        const items = db.prepare("SELECT * FROM order_items WHERE order_id = ?").all(orderId);
        // Fire-and-forget: a failed/slow send must not delay the webhook response to Stripe.
        sendOrderConfirmation({
          email,
          amountTotal: session.amount_total,
          items: items.map((i) => ({
            productName: i.product_name,
            qty: i.qty,
            unitAmount: i.unit_amount
          }))
        });
      } else {
        console.warn(`Webhook for session ${session.id} had no order_id in metadata.`);
      }

      console.log(`Order completed: session ${session.id}, amount ${session.amount_total}`);
    }

    res.json({ received: true });
  }
);

// CSP is off: the site relies on inline <script>/<style> throughout and a
// nonce-based rewrite is a bigger job than fits here. Every other helmet
// protection (HSTS, X-Frame-Options, X-Content-Type-Options, etc.) still
// applies and costs nothing to keep on.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(cookieParser());
app.use(attachUser);
app.use(express.static(path.join(__dirname, "public")));
// Serves uploaded product images from wherever UPLOAD_DIR actually resolved
// to (see routes/products.js) at the same URL path the frontend already
// expects. A no-op duplicate of the line above when UPLOADS_DIR isn't set,
// since UPLOAD_DIR is then still inside public/ — only matters once it
// points somewhere else (e.g. a persistent disk mount).
app.use("/images/products", express.static(productsRouter.UPLOAD_DIR));

// Brute-force / abuse protection on the endpoints worth protecting: auth
// (login, signup, password reset) and order creation.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again later." }
});
const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." }
});

app.use("/api/auth", authLimiter, createAuthRouter({ clientUrl: CLIENT_URL }));
app.use("/api", productsRouter);
app.use("/api", createOrdersRouter({ stripe, clientUrl: CLIENT_URL, checkoutLimiter }));

// Catch-all error handler: never leak stack traces or file paths to the
// client (the default Express handler does exactly that), regardless of
// NODE_ENV. The real error still goes to the server log.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error("Unhandled request error:", err);
  const isBadJson = err.type === "entity.parse.failed" || err instanceof SyntaxError;
  res.status(isBadJson ? 400 : 500).json({
    error: isBadJson ? "Invalid request body." : "Something went wrong. Please try again."
  });
});

app.listen(PORT, () => {
  console.log(`EGO store running at http://localhost:${PORT}`);
  if (!stripe) {
    console.warn("STRIPE_SECRET_KEY is not set — checkout will be disabled until configured.");
  }
  if (!process.env.JWT_SECRET) {
    console.warn("JWT_SECRET is not set — admin login will be disabled until configured.");
  }
  if (!process.env.SMTP_HOST) {
    console.warn("SMTP_HOST is not set — order confirmation emails will be skipped until configured.");
  }
});
