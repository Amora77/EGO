// A product only counts as sold out if it actually has sizes to track stock
// against AND every one of them is at 0 — a product with no sizes at all
// isn't stock-tracked (same convention as buildOrderItems/decrementStockStmt
// on the server), so it must never be labeled sold out just because its
// (nonexistent) stock map is empty.
function isSoldOut(product) {
  if (!Array.isArray(product.sizes) || product.sizes.length === 0) return false;
  return product.sizes.every((size) => !(product.stock && product.stock[size] > 0));
}

function productCardHTML(product) {
  const onSale = product.discountPercent != null;
  const soldOut = isSoldOut(product);
  return `
    <a class="product-card" href="product.html?id=${encodeURIComponent(product.id)}">
      <figure>
        <img src="${product.image}" alt="${product.name}" loading="lazy">
        ${onSale ? `<span class="badge-sale">-${product.discountPercent}%</span>` : ""}
        ${soldOut ? `<span class="badge-sold-out">Sold Out</span>` : ""}
      </figure>
      <div class="info">
        <div class="category">${product.category}</div>
        <div class="name">${product.name}</div>
        <div class="price">
          ${onSale ? `<span class="price-old">${formatPrice(product.compareAtPrice)}</span>` : ""}
          <span class="${onSale ? "price-sale" : ""}">${formatPrice(product.price)}</span>
        </div>
      </div>
    </a>
  `;
}

function renderProductGrid(container, products) {
  container.innerHTML = products.map(productCardHTML).join("");
}
