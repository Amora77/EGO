document.addEventListener("DOMContentLoaded", async () => {
  const grid = document.getElementById("featured-grid");
  if (!grid) return;
  await loadProducts();
  renderProductGrid(grid, PRODUCTS.slice(0, 8));
});
