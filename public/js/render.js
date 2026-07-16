function productCardHTML(product) {
  return `
    <a class="product-card" href="product.html?id=${encodeURIComponent(product.id)}">
      <figure><img src="${product.image}" alt="${product.name}" loading="lazy"></figure>
      <div class="info">
        <div class="category">${product.category}</div>
        <div class="name">${product.name}</div>
        <div class="price">${formatPrice(product.price)}</div>
      </div>
    </a>
  `;
}

function renderProductGrid(container, products) {
  container.innerHTML = products.map(productCardHTML).join("");
}
