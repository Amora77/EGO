document.addEventListener("DOMContentLoaded", async () => {
  const root = document.getElementById("product-detail");
  if (!root) return;

  await loadProducts();

  const params = new URLSearchParams(window.location.search);
  const product = getProductById(params.get("id"));

  if (!product) {
    root.innerHTML = `
      <div class="empty-cart">
        <h1>Product not found</h1>
        <p>The item you're looking for doesn't exist or was removed.</p>
        <a class="btn" href="shop.html">Back to Shop</a>
      </div>
    `;
    return;
  }

  document.title = `${product.name} — EGO`;

  let selectedSize = product.sizes[0];
  let qty = 1;

  const onSale = product.discountPercent != null;

  root.innerHTML = `
    <div class="gallery">
      <img src="${product.image}" alt="${product.name}">
      ${onSale ? `<span class="badge-sale">-${product.discountPercent}%</span>` : ""}
    </div>
    <div class="details">
      <div class="category">${product.category}</div>
      <h1>${product.name}</h1>
      <div class="price">
        ${onSale ? `<span class="price-old">${formatPrice(product.compareAtPrice)}</span>` : ""}
        <span class="${onSale ? "price-sale" : ""}">${formatPrice(product.price)}</span>
      </div>
      <p class="description">${product.description}</p>

      <div class="size-picker">
        <div class="label">Size</div>
        <div class="size-options">
          ${product.sizes
            .map(
              (s, i) =>
                `<div class="size-option${i === 0 ? " selected" : ""}" data-size="${s}">${s}</div>`
            )
            .join("")}
        </div>
      </div>

      <div class="quantity-row">
        <div class="label">Qty</div>
        <div class="qty-control">
          <button type="button" data-action="decrease">&minus;</button>
          <span id="qty-value">1</span>
          <button type="button" data-action="increase">+</button>
        </div>
      </div>

      <button class="btn" id="add-to-cart-btn">Add to Cart</button>
      <div class="add-to-cart-msg" id="add-to-cart-msg"></div>
    </div>
  `;

  root.querySelectorAll(".size-option").forEach((el) => {
    el.addEventListener("click", () => {
      root.querySelectorAll(".size-option").forEach((s) => s.classList.remove("selected"));
      el.classList.add("selected");
      selectedSize = el.dataset.size;
    });
  });

  root.querySelector('[data-action="increase"]').addEventListener("click", () => {
    qty += 1;
    root.querySelector("#qty-value").textContent = qty;
  });

  root.querySelector('[data-action="decrease"]').addEventListener("click", () => {
    qty = Math.max(1, qty - 1);
    root.querySelector("#qty-value").textContent = qty;
  });

  root.querySelector("#add-to-cart-btn").addEventListener("click", () => {
    addToCart(product.id, selectedSize, qty);
    document.getElementById("add-to-cart-msg").textContent = `Added ${qty} × ${product.name} (${selectedSize}) to your cart.`;
  });

  const related = PRODUCTS.filter(
    (p) => p.category === product.category && p.id !== product.id
  ).slice(0, 4);
  const relatedGrid = document.getElementById("related-grid");
  const relatedSection = document.getElementById("related-section");
  if (related.length && relatedGrid) {
    renderProductGrid(relatedGrid, related);
  } else if (relatedSection) {
    relatedSection.style.display = "none";
  }
});
