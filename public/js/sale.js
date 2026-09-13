document.addEventListener("DOMContentLoaded", async () => {
  const grid = document.getElementById("sale-grid");
  if (!grid) return;

  await loadProducts();

  const onSale = PRODUCTS.filter((p) => p.discountPercent != null);

  if (!onSale.length) {
    grid.style.display = "none";
    document.getElementById("sale-empty").style.display = "block";
    return;
  }

  renderProductGrid(grid, onSale);
});
