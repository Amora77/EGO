// Cash on Delivery is the only payment method the storefront currently
// offers (see cart-page.js) — Stripe/card stays implemented and dormant
// server-side for a future phase, so startCardCheckout below is kept but no
// longer called from here.
async function startCheckout() {
  const btn = document.getElementById("checkout-btn");
  const msg = document.getElementById("checkout-msg");
  const lines = cartLines();

  if (!lines.length) return;

  msg.textContent = "";
  await startCodCheckout(lines, btn, msg);
}

async function startCardCheckout(lines, btn, msg) {
  btn.disabled = true;
  btn.textContent = "Redirecting to checkout...";

  try {
    const response = await fetch("/api/create-checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: lines.map((l) => ({
          productId: l.productId,
          size: l.size,
          qty: l.qty
        }))
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Unable to start checkout.");
    }

    window.location.href = data.url;
  } catch (err) {
    msg.textContent = err.message || "Something went wrong. Please try again.";
    btn.disabled = false;
    btn.textContent = "Checkout";
  }
}

function readCodForm() {
  const val = (id) => document.getElementById(id).value.trim();
  const email = val("cod-email");
  const shipping = {
    name: val("cod-name"),
    phone: val("cod-phone"),
    line1: val("cod-line1"),
    line2: val("cod-line2"),
    city: val("cod-city"),
    state: val("cod-state"),
    postalCode: val("cod-postal"),
    country: document.getElementById("cod-country").value
  };

  if (!email || !shipping.name || !shipping.phone || !shipping.line1 || !shipping.city || !shipping.postalCode) {
    return { error: "Please fill in your name, email, phone, address, city, and postal code." };
  }

  return { email, shipping };
}

async function startCodCheckout(lines, btn, msg) {
  const parsed = readCodForm();
  if (parsed.error) {
    msg.textContent = parsed.error;
    return;
  }

  btn.disabled = true;
  btn.textContent = "Placing order...";

  try {
    const response = await fetch("/api/orders/cod", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: lines.map((l) => ({
          productId: l.productId,
          size: l.size,
          qty: l.qty
        })),
        email: parsed.email,
        shipping: parsed.shipping
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Unable to place your order.");
    }

    window.location.href = `success.html?order=${encodeURIComponent(data.confirmationToken)}`;
  } catch (err) {
    msg.textContent = err.message || "Something went wrong. Please try again.";
    btn.disabled = false;
    btn.textContent = "Checkout";
  }
}
