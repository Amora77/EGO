document.addEventListener("DOMContentLoaded", () => {
  const grid = document.getElementById("featured-grid");
  if (grid) {
    renderProductGrid(grid, PRODUCTS.slice(0, 8));
  }
});
