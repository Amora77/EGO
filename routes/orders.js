const crypto = require("crypto");
const express = require("express");
const db = require("../db");
const { requireAdmin, requireAuth } = require("../lib/auth");
const {
  sendOrderConfirmation,
  sendOrderConfirmedEmail,
  sendOrderShippedEmail,
  sendOrderCancelledEmail
} = require("../lib/email");

const MAX_QTY_PER_ITEM = 20;
const ALLOWED_COUNTRIES = ["EG"];

// Fixed shipping fee, in piastres — same smallest-unit convention as
// price_cents (EGP 75.00 = 7500). This is the single source of truth for
// what actually gets charged: it's added to the server-computed products
// subtotal for every order, once per order regardless of item count, and
// nothing sent by the client can influence it. The frontend's own display
// constants (cart-page.js) are cosmetic only — this value is what's billed.
const SHIPPING_FEE_CENTS = 7500;

function serializeOrderItem(row) {
  return {
    productId: row.product_id,
    productName: row.product_name,
    size: row.size,
    qty: row.qty,
    unitAmount: row.unit_amount
  };
}

// Reconstructs the products-subtotal / shipping split for an existing order
// from its immutable order_items snapshot, rather than trusting a stored
// breakdown. Deriving it this way means it stays correct for old orders even
// if SHIPPING_FEE_CENTS is changed later — this order's own total was fixed
// at creation time, so subtracting its own item snapshot from its own total
// always reproduces the shipping fee actually charged on it.
function orderBreakdown(order, items) {
  const subtotal = items.reduce((sum, i) => sum + i.unitAmount * i.qty, 0);
  return { subtotal, shippingFee: order.amount_total - subtotal };
}

function formatOrderNumber(id) {
  return `EGO-${String(id).padStart(5, "0")}`;
}

// Validates cart items against the DB and computes the price server-side —
// never trust a price the client sends. Shared by both the Stripe and Cash
// on Delivery checkout paths. Throws with a user-facing message on failure.
function buildOrderItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Your cart is empty.");
  }

  const orderItems = [];
  let amountTotal = 0;

  for (const item of items) {
    const product = db.prepare("SELECT * FROM products WHERE id = ?").get(item.productId);
    if (!product) {
      throw new Error(`Unknown product: ${item.productId}`);
    }

    const qty = Number.parseInt(item.qty, 10);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY_PER_ITEM) {
      throw new Error(`Invalid quantity for ${product.name}.`);
    }

    // If the product has sizes at all, a valid one is required — not just
    // "valid if provided". Previously this only checked `item.size &&
    // !sizes.includes(...)`, so a client that omitted `size` entirely
    // slipped through unvalidated as size: null, which (now that stock is
    // tracked per size) would also skip stock enforcement for that line.
    // Products with no sizes at all (sizes.length === 0) are unaffected —
    // they're not size- or stock-tracked, same as before.
    const sizes = JSON.parse(product.sizes || "[]");
    if (sizes.length > 0 && !sizes.includes(item.size)) {
      throw new Error(`Please select a valid size for ${product.name}.`);
    }

    const name = item.size ? `${product.name} (${item.size})` : product.name;

    orderItems.push({
      product_id: product.id,
      product_name: name,
      size: item.size || null,
      qty,
      unit_amount: product.price_cents
    });
    amountTotal += product.price_cents * qty;
  }

  return { orderItems, amountTotal };
}

module.exports = function createOrdersRouter({ stripe, clientUrl, checkoutLimiter }) {
  const router = express.Router();
  const limiter = checkoutLimiter || ((req, res, next) => next());
  const itemsStmt = db.prepare("SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC");
  const insertItemStmt = db.prepare(
    `INSERT INTO order_items (order_id, product_id, product_name, size, qty, unit_amount)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  // The check ("is there enough?") and the write ("take it") happen in the
  // same statement via the WHERE clause — that's what makes this safe
  // against two concurrent orders both succeeding against the same last
  // unit. changes === 0 means either the row doesn't exist or stock was
  // insufficient at the moment this ran; either way, not enough to fulfill.
  const decrementStockStmt = db.prepare(
    "UPDATE product_stock SET stock = stock - ? WHERE product_id = ? AND size = ? AND stock >= ?"
  );

  function insertOrderItems(orderId, orderItems) {
    for (const oi of orderItems) {
      insertItemStmt.run(orderId, oi.product_id, oi.product_name, oi.size, oi.qty, oi.unit_amount);
    }
  }

  // Atomically checks-and-decrements stock for every line, then creates the
  // order — all in one transaction, so a shortfall on any single item rolls
  // back everything (no partial decrements) and never leaves the order
  // created without the stock to back it. BEGIN IMMEDIATE takes the write
  // lock up front rather than lazily on first write. Products with no size
  // (none exist in the current catalog, but the schema doesn't forbid it)
  // aren't stock-tracked — there's no per-size row to check.
  function createCodOrder({ orderTotal, userId, email, shippingJson, confirmationToken, orderItems }) {
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const item of orderItems) {
        if (!item.size) continue;
        const result = decrementStockStmt.run(item.qty, item.product_id, item.size, item.qty);
        if (result.changes !== 1) {
          const err = new Error(`${item.product_name} is no longer available in that quantity.`);
          err.isStockError = true;
          throw err;
        }
      }

      const orderId = db
        .prepare(
          `INSERT INTO orders (status, payment_method, amount_total, user_id, email, shipping_address, confirmation_token)
           VALUES ('placed', 'cod', ?, ?, ?, ?, ?)`
        )
        .run(orderTotal, userId, email, shippingJson, confirmationToken).lastInsertRowid;

      insertOrderItems(orderId, orderItems);

      db.exec("COMMIT");
      return orderId;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  // --- Order lifecycle (COD fulfillment states) ---
  //
  // Dormant Stripe states ('pending', 'paid') are untouched by any of this —
  // they're not admin-actionable here and none of the statements below can
  // ever match a row in either state.
  //
  //   placed    -> confirmed, cancelled
  //   confirmed -> preparing, cancelled
  //   preparing -> shipped, cancelled
  //   shipped   -> delivered
  //   delivered -> (terminal)
  //   cancelled -> (terminal)
  //
  // Every transition is a single "UPDATE ... WHERE status = <expected>"
  // (or, for cancel, "WHERE status IN (...)") — the same guarded-update
  // pattern already used for stock decrement. changes !== 1 means the order
  // wasn't in the state this action requires (already moved on, moved by a
  // concurrent request, or never valid for this action) — that's a 409, not
  // a 500, and no further writes happen.
  const confirmStmt = db.prepare(
    "UPDATE orders SET status = 'confirmed', updated_at = datetime('now') WHERE id = ? AND status = 'placed'"
  );
  const prepareStmt = db.prepare(
    "UPDATE orders SET status = 'preparing', updated_at = datetime('now') WHERE id = ? AND status = 'confirmed'"
  );
  const shipStmt = db.prepare(
    "UPDATE orders SET status = 'shipped', updated_at = datetime('now') WHERE id = ? AND status = 'preparing'"
  );
  const deliverStmt = db.prepare(
    "UPDATE orders SET status = 'delivered', updated_at = datetime('now') WHERE id = ? AND status = 'shipped'"
  );
  const cancelStmt = db.prepare(
    `UPDATE orders SET status = 'cancelled', updated_at = datetime('now')
     WHERE id = ? AND status IN ('placed', 'confirmed', 'preparing')`
  );
  // No WHERE stock >= ... guard needed here (unlike the decrement) — adding
  // back can never violate CHECK (stock >= 0). If the product/size row no
  // longer exists (e.g. the product was deleted, cascading away its
  // product_stock rows), this simply matches 0 rows and is a safe no-op —
  // the cancellation itself is still valid and already committed by the
  // time this runs.
  const restockStmt = db.prepare("UPDATE product_stock SET stock = stock + ? WHERE product_id = ? AND size = ?");

  // Cancels an order and restores its items' stock in one transaction. The
  // guarded cancelStmt above is the *only* thing preventing a double
  // restock: if two cancel requests race, only the first UPDATE can match
  // (status is already 'cancelled' by the time the second runs), so the
  // second sees changes !== 1 and does no restocking at all — no separate
  // "restocked" flag is needed. Any failure partway through rolls back both
  // the status change and any restocking already done in this transaction.
  function cancelOrderAndRestock(orderId) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = cancelStmt.run(orderId);
      if (result.changes !== 1) {
        db.exec("ROLLBACK");
        return { ok: false };
      }

      for (const item of itemsStmt.all(orderId)) {
        if (!item.size) continue;
        restockStmt.run(item.qty, item.product_id, item.size);
      }

      db.exec("COMMIT");
      return { ok: true };
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  router.post("/create-checkout-session", limiter, async (req, res) => {
    if (!stripe) {
      // Customer-safe message only — no mention of STRIPE_SECRET_KEY or any
      // other internal configuration detail. Stripe itself stays disabled;
      // this is purely about what a customer sees if this endpoint is ever
      // reached (the current storefront UI no longer offers Card at all).
      return res.status(503).json({
        error: "Card payment isn't available right now. Please choose Cash on Delivery."
      });
    }

    let orderItems, amountTotal;
    try {
      ({ orderItems, amountTotal } = buildOrderItems(req.body.items));
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const line_items = orderItems.map((oi) => ({
      price_data: {
        currency: "egp",
        product_data: { name: oi.product_name },
        unit_amount: oi.unit_amount
      },
      quantity: oi.qty
    }));
    // Flat shipping fee as its own line item, so Stripe's own computed total
    // (session.amount_total, which the webhook later writes back as this
    // order's amount_total) matches what we store here.
    line_items.push({
      price_data: {
        currency: "egp",
        product_data: { name: "Shipping" },
        unit_amount: SHIPPING_FEE_CENTS
      },
      quantity: 1
    });

    const orderTotal = amountTotal + SHIPPING_FEE_CENTS;
    const userId = req.user ? req.user.sub : null;
    const orderId = db
      .prepare("INSERT INTO orders (status, payment_method, amount_total, user_id) VALUES ('pending', 'card', ?, ?)")
      .run(orderTotal, userId).lastInsertRowid;

    insertOrderItems(orderId, orderItems);

    try {
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items,
        shipping_address_collection: { allowed_countries: ALLOWED_COUNTRIES },
        success_url: `${clientUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${clientUrl}/cancel.html`,
        metadata: { order_id: String(orderId) },
        ...(req.user ? { customer_email: req.user.email } : {})
      });

      db.prepare("UPDATE orders SET stripe_session_id = ? WHERE id = ?").run(session.id, orderId);

      res.json({ url: session.url });
    } catch (err) {
      console.error("Stripe checkout session error:", err.message);
      db.prepare("DELETE FROM order_items WHERE order_id = ?").run(orderId);
      db.prepare("DELETE FROM orders WHERE id = ?").run(orderId);
      res.status(500).json({ error: "Unable to start checkout. Please try again." });
    }
  });

  router.post("/orders/cod", limiter, (req, res) => {
    let orderItems, amountTotal;
    try {
      ({ orderItems, amountTotal } = buildOrderItems(req.body.items));
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    // Restricted to a safe character set (letters, digits, . _ % + - in the
    // local part; letters, digits, . - in the domain) rather than the
    // previous "anything but whitespace/@" pattern — that older pattern let
    // HTML-significant characters like < and > through as a valid-looking
    // email, which then reached the admin panel unescaped.
    const { email } = req.body;
    if (!email || !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }

    const shipping = req.body.shipping || {};
    const { name, phone, line1, line2, city, state, postalCode, country } = shipping;
    if (!name || !phone || !line1 || !city || !postalCode || !country) {
      return res.status(400).json({
        error: "Please fill in your name, phone, address, city, postal code, and country."
      });
    }
    if (!ALLOWED_COUNTRIES.includes(country)) {
      return res.status(400).json({ error: "We don't currently deliver to that country." });
    }

    const shippingJson = JSON.stringify({
      name,
      phone,
      address: {
        line1,
        line2: line2 || null,
        city,
        state: state || null,
        postal_code: postalCode,
        country
      }
    });

    // Server-computed: products subtotal (from buildOrderItems, itself
    // recomputed from the DB — never the client) plus the fixed shipping
    // fee. Nothing in req.body influences either number.
    const orderTotal = amountTotal + SHIPPING_FEE_CENTS;

    const userId = req.user ? req.user.sub : null;
    const confirmationToken = crypto.randomBytes(16).toString("hex");

    let orderId;
    try {
      orderId = createCodOrder({ orderTotal, userId, email, shippingJson, confirmationToken, orderItems });
    } catch (err) {
      if (err.isStockError) {
        return res.status(409).json({ error: err.message });
      }
      console.error("COD order creation error:", err.message);
      return res.status(500).json({ error: "Unable to place your order. Please try again." });
    }

    // Fire-and-forget: this response shouldn't wait on (or fail because of) email delivery.
    sendOrderConfirmation({
      email,
      amountTotal: orderTotal,
      paymentMethod: "cod",
      items: orderItems.map((oi) => ({
        productName: oi.product_name,
        qty: oi.qty,
        unitAmount: oi.unit_amount
      }))
    });

    res.status(201).json({ confirmationToken, orderNumber: formatOrderNumber(orderId) });
  });

  router.get("/orders/cod/:token", (req, res) => {
    const order = db.prepare("SELECT * FROM orders WHERE confirmation_token = ?").get(req.params.token);
    if (!order) {
      return res.status(404).json({ error: "Order not found." });
    }
    const items = itemsStmt.all(order.id).map(serializeOrderItem);
    res.json({
      orderNumber: formatOrderNumber(order.id),
      email: order.email,
      status: order.status,
      ...orderBreakdown(order, items),
      amountTotal: order.amount_total,
      paymentMethod: order.payment_method,
      shippingAddress: order.shipping_address ? JSON.parse(order.shipping_address) : null,
      items
    });
  });

  router.get("/orders/session/:sessionId", (req, res) => {
    const order = db
      .prepare("SELECT * FROM orders WHERE stripe_session_id = ? AND status = 'paid'")
      .get(req.params.sessionId);
    if (!order) {
      return res.status(404).json({ error: "Order not found." });
    }
    const items = itemsStmt.all(order.id).map(serializeOrderItem);
    res.json({
      orderNumber: formatOrderNumber(order.id),
      email: order.email,
      status: order.status,
      ...orderBreakdown(order, items),
      amountTotal: order.amount_total,
      paymentMethod: order.payment_method,
      shippingAddress: order.shipping_address ? JSON.parse(order.shipping_address) : null,
      items
    });
  });

  router.get("/orders/me", requireAuth, (req, res) => {
    const orders = db
      .prepare("SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC")
      .all(req.user.sub);
    res.json(
      orders.map((order) => {
        const items = itemsStmt.all(order.id).map(serializeOrderItem);
        return {
          id: order.id,
          orderNumber: formatOrderNumber(order.id),
          status: order.status,
          paymentMethod: order.payment_method,
          ...orderBreakdown(order, items),
          amountTotal: order.amount_total,
          shippingAddress: order.shipping_address ? JSON.parse(order.shipping_address) : null,
          createdAt: order.created_at,
          items
        };
      })
    );
  });

  router.get("/admin/orders", requireAdmin, (req, res) => {
    const orders = db.prepare("SELECT * FROM orders ORDER BY created_at DESC").all();
    res.json(
      orders.map((order) => {
        const items = itemsStmt.all(order.id).map(serializeOrderItem);
        return {
          id: order.id,
          orderNumber: formatOrderNumber(order.id),
          status: order.status,
          paymentMethod: order.payment_method,
          email: order.email,
          ...orderBreakdown(order, items),
          amountTotal: order.amount_total,
          shippingAddress: order.shipping_address ? JSON.parse(order.shipping_address) : null,
          createdAt: order.created_at,
          items
        };
      })
    );
  });

  router.post("/admin/orders/:id/confirm", requireAdmin, (req, res) => {
    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
    if (!order) {
      return res.status(404).json({ error: "Order not found." });
    }
    if (confirmStmt.run(order.id).changes !== 1) {
      return res.status(409).json({ error: "Order is not in a state that allows this action." });
    }
    res.json({ ok: true });

    // Fire-and-forget, after the status change has already committed.
    sendOrderConfirmedEmail({ email: order.email, orderNumber: formatOrderNumber(order.id) });
  });

  router.post("/admin/orders/:id/prepare", requireAdmin, (req, res) => {
    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
    if (!order) {
      return res.status(404).json({ error: "Order not found." });
    }
    if (prepareStmt.run(order.id).changes !== 1) {
      return res.status(409).json({ error: "Order is not in a state that allows this action." });
    }
    res.json({ ok: true });
  });

  router.post("/admin/orders/:id/ship", requireAdmin, (req, res) => {
    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
    if (!order) {
      return res.status(404).json({ error: "Order not found." });
    }
    if (shipStmt.run(order.id).changes !== 1) {
      return res.status(409).json({ error: "Order is not in a state that allows this action." });
    }
    res.json({ ok: true });

    sendOrderShippedEmail({ email: order.email, orderNumber: formatOrderNumber(order.id) });
  });

  // Tightened: previously set status = 'delivered' unconditionally,
  // regardless of the order's current status. Now, like every other
  // transition, it only succeeds from the one state that's actually valid.
  router.post("/admin/orders/:id/deliver", requireAdmin, (req, res) => {
    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
    if (!order) {
      return res.status(404).json({ error: "Order not found." });
    }
    if (deliverStmt.run(order.id).changes !== 1) {
      return res.status(409).json({ error: "Order is not in a state that allows this action." });
    }
    res.json({ ok: true });
  });

  router.post("/admin/orders/:id/cancel", requireAdmin, (req, res) => {
    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
    if (!order) {
      return res.status(404).json({ error: "Order not found." });
    }

    let result;
    try {
      result = cancelOrderAndRestock(order.id);
    } catch (err) {
      console.error("Order cancellation error:", err.message);
      return res.status(500).json({ error: "Unable to cancel this order. Please try again." });
    }

    if (!result.ok) {
      return res.status(409).json({ error: "Order is not in a state that allows this action." });
    }

    res.json({ ok: true });

    // Only after the transaction (status change + restock) has committed.
    sendOrderCancelledEmail({
      email: order.email,
      orderNumber: formatOrderNumber(order.id),
      amountTotal: order.amount_total
    });
  });

  return router;
};
