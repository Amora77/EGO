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
  const shipping = subtotal > 0 ? 0 : 0;
  summaryContainer.innerHTML = `
    <h2>Order Summary</h2>
    <div class="summary-row"><span>Subtotal</span><span>${formatPrice(subtotal)}</span></div>
    <div class="summary-row"><span>Shipping</span><span>Calculated at checkout</span></div>
    <div class="summary-row total"><span>Total</span><span>${formatPrice(subtotal + shipping)}</span></div>
    <button class="btn" id="checkout-btn" style="width:100%;margin-top:20px;">Checkout</button>
    <div class="add-to-cart-msg" id="checkout-msg"></div>
  `;

  document.getElementById("checkout-btn").addEventListener("click", startCheckout);
}

document.addEventListener("DOMContentLoaded", () => {
  const root = document.getElementById("cart-items");
  if (!root) return;

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
