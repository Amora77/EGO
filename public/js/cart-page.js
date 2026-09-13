// Flat shipping fee, display only — the server (routes/orders.js'
// SHIPPING_FEE_CENTS) is what actually gets charged and is the source of
// truth; this just mirrors it so the cart shows the real total before checkout.
const SHIPPING_FEE_CENTS = 7500; // EGP 75.00

function renderCartPage() {
  const container = document.getElementById("cart-items");
  const summaryContainer = document.getElementById("cart-summary");
  if (!container || !summaryContainer) return;

  const lines = cartLines();

  if (!lines.length) {
    container.innerHTML = "";
    summaryContainer.innerHTML = "";
    document.getElementById("cart-empty").style.display = "block";
    document.getElementById("cart-layout").style.display = "none";
    return;
  }

  document.getElementById("cart-empty").style.display = "none";
  document.getElementById("cart-layout").style.display = "grid";

  container.innerHTML = lines
    .map(
      (line) => `
      <div class="cart-item" data-product-id="${line.productId}" data-size="${line.size}">
        <div class="thumb"><img src="${line.product.image}" alt="${line.product.name}"></div>
        <div class="meta">
          <div class="name">${line.product.name}</div>
          <div class="variant">Size ${line.size}</div>
          <button class="remove-btn" data-action="remove">Remove</button>
        </div>
        <div class="qty-price">
          <div class="qty-control">
            <button type="button" data-action="decrease">&minus;</button>
            <span>${line.qty}</span>
            <button type="button" data-action="increase">+</button>
          </div>
          <div>${formatPrice(line.lineTotal)}</div>
        </div>
      </div>
    `
    )
    .join("");

  const subtotal = cartSubtotal();
  summaryContainer.innerHTML = `
    <h2>Order Summary</h2>
    <div class="summary-row"><span>Subtotal</span><span>${formatPrice(subtotal)}</span></div>
    <div class="summary-row"><span>Shipping</span><span>${formatPrice(SHIPPING_FEE_CENTS)}</span></div>
    <div class="summary-row total"><span>Total</span><span>${formatPrice(subtotal + SHIPPING_FEE_CENTS)}</span></div>

    <div style="margin:20px 0 4px;">
      <div class="label" style="font-size:12px; letter-spacing:1.5px; text-transform:uppercase; font-weight:600; margin-bottom:10px;">Payment Method</div>
      <label style="display:flex; align-items:center; gap:8px; margin-bottom:8px; font-size:14px; font-weight:400; text-transform:none; letter-spacing:normal;">
        <input type="radio" name="payment-method" value="card" checked> Card
      </label>
      <label style="display:flex; align-items:center; gap:8px; font-size:14px; font-weight:400; text-transform:none; letter-spacing:normal;">
        <input type="radio" name="payment-method" value="cod"> Cash on Delivery
      </label>
    </div>

    <div class="contact-form" id="cod-fields" style="display:none; margin-top:16px;">
      <label for="cod-name">Full Name</label>
      <input type="text" id="cod-name">

      <label for="cod-phone">Phone</label>
      <input type="tel" id="cod-phone">

      <label for="cod-email">Email</label>
      <input type="email" id="cod-email">

      <label for="cod-line1">Address Line 1</label>
      <input type="text" id="cod-line1">

      <label for="cod-line2">Address Line 2 (optional)</label>
      <input type="text" id="cod-line2">

      <label for="cod-city">City</label>
      <input type="text" id="cod-city">

      <label for="cod-state">State / Region (optional)</label>
      <input type="text" id="cod-state">

      <label for="cod-postal">Postal Code</label>
      <input type="text" id="cod-postal">

      <label for="cod-country">Country</label>
      <select id="cod-country">
        <option value="EG">Egypt</option>
      </select>
    </div>

    <button class="btn" id="checkout-btn" style="width:100%;margin-top:20px;">Checkout</button>
    <div class="add-to-cart-msg" id="checkout-msg"></div>
  `;

  const codFields = document.getElementById("cod-fields");
  summaryContainer.querySelectorAll('input[name="payment-method"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      codFields.style.display = radio.checked && radio.value === "cod" ? "block" : "none";
    });
  });

  document.getElementById("checkout-btn").addEventListener("click", startCheckout);
}

document.addEventListener("DOMContentLoaded", async () => {
  const root = document.getElementById("cart-items");
  if (!root) return;

  await loadProducts();
  renderCartPage();

  root.addEventListener("click", (e) => {
    const item = e.target.closest(".cart-item");
    if (!item) return;
    const productId = item.dataset.productId;
    const size = item.dataset.size;
    const action = e.target.dataset.action;

    if (action === "remove") {
      removeFromCart(productId, size);
      renderCartPage();
    } else if (action === "increase" || action === "decrease") {
      const cart = getCart();
      const line = cart.find((i) => i.productId === productId && i.size === size);
      if (line) {
        const newQty = action === "increase" ? line.qty + 1 : line.qty - 1;
        if (newQty <= 0) {
          removeFromCart(productId, size);
        } else {
          updateCartItemQty(productId, size, newQty);
        }
        renderCartPage();
      }
    }
  });
});
