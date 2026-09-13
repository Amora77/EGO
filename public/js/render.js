function productCardHTML(product) {
  const onSale = product.discountPercent != null;
  return `
    <a class="product-card" href="product.html?id=${encodeURIComponent(product.id)}">
      <figure>
        <img src="${product.image}" alt="${product.name}" loading="lazy">
        ${onSale ? `<span class="badge-sale">-${product.discountPercent}%</span>` : ""}
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
