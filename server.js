require("dotenv").config();

const path = require("path");
const express = require("express");
const { PRODUCTS } = require("./public/js/products.js");

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecretKey ? require("stripe")(stripeSecretKey) : null;

const PORT = process.env.PORT || 3000;
const CLIENT_URL = process.env.CLIENT_URL || `http://localhost:${PORT}`;
const MAX_QTY_PER_ITEM = 20;

const app = express();

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
      console.log(`Order completed: session ${session.id}, amount ${session.amount_total}`);
      // TODO: persist the order, send confirmation email, etc.
    }

    res.json({ received: true });
  }
);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.post("/create-checkout-session", async (req, res) => {
  if (!stripe) {
    return res.status(500).json({
      error: "Payments are not configured yet. Set STRIPE_SECRET_KEY on the server."
    });
  }

  const { items } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Your cart is empty." });
  }

  const line_items = [];

  for (const item of items) {
    const product = PRODUCTS.find((p) => p.id === item.productId);
    if (!product) {
      return res.status(400).json({ error: `Unknown product: ${item.productId}` });
    }

    const qty = Number.parseInt(item.qty, 10);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY_PER_ITEM) {
      return res.status(400).json({ error: `Invalid quantity for ${product.name}.` });
    }

    if (item.size && !product.sizes.includes(item.size)) {
      return res.status(400).json({ error: `Invalid size for ${product.name}.` });
    }

    line_items.push({
      price_data: {
        currency: "usd",
        product_data: {
          name: item.size ? `${product.name} (${item.size})` : product.name
        },
        unit_amount: product.price
      },
      quantity: qty
    });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items,
      shipping_address_collection: { allowed_countries: ["US", "CA", "GB", "AU"] },
      success_url: `${CLIENT_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${CLIENT_URL}/cancel.html`
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe checkout session error:", err.message);
    res.status(500).json({ error: "Unable to start checkout. Please try again." });
  }
});

app.listen(PORT, () => {
  console.log(`EGO store running at http://localhost:${PORT}`);
  if (!stripe) {
    console.warn("STRIPE_SECRET_KEY is not set — checkout will be disabled until configured.");
  }
});
