const CART_KEY = "ego_cart";

function getCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY)) || [];
  } catch {
    return [];
  }
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartBadge();
}

function addToCart(productId, size, qty) {
  const cart = getCart();
  const existing = cart.find((i) => i.productId === productId && i.size === size);
  if (existing) {
    existing.qty += qty;
  } else {
    cart.push({ productId, size, qty });
  }
  saveCart(cart);
}

function removeFromCart(productId, size) {
  const cart = getCart().filter((i) => !(i.productId === productId && i.size === size));
  saveCart(cart);
}

function updateCartItemQty(productId, size, qty) {
  const cart = getCart();
  const item = cart.find((i) => i.productId === productId && i.size === size);
  if (item) {
    item.qty = Math.max(1, qty);
  }
  saveCart(cart);
}

function cartCount() {
  return getCart().reduce((sum, i) => sum + i.qty, 0);
}

function cartLines() {
  return getCart()
    .map((item) => {
      const product = getProductById(item.productId);
      if (!product) return null;
      return { ...item, product, lineTotal: product.price * item.qty };
    })
    .filter(Boolean);
}

function cartSubtotal() {
  return cartLines().reduce((sum, l) => sum + l.lineTotal, 0);
}

function updateCartBadge() {
  document.querySelectorAll(".cart-count").forEach((el) => {
    el.textContent = cartCount();
  });
}

document.addEventListener("DOMContentLoaded", updateCartBadge);
