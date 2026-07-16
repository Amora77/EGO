document.addEventListener("DOMContentLoaded", () => {
  const grid = document.getElementById("shop-grid");
  const filterBar = document.getElementById("filter-bar");
  if (!grid || !filterBar) return;

  const categories = ["All", ...new Set(PRODUCTS.map((p) => p.category))];

  filterBar.innerHTML = categories
    .map(
      (cat, i) =>
        `<button class="filter-chip${i === 0 ? " active" : ""}" data-category="${cat}">${cat}</button>`
    )
    .join("");

  function applyFilter(category) {
    const filtered =
      category === "All" ? PRODUCTS : PRODUCTS.filter((p) => p.category === category);
    renderProductGrid(grid, filtered);
  }

  filterBar.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-chip");
    if (!btn) return;
    filterBar.querySelectorAll(".filter-chip").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    applyFilter(btn.dataset.category);
  });

  const params = new URLSearchParams(window.location.search);
  const initialCategory = params.get("category");
  if (initialCategory && categories.includes(initialCategory)) {
    filterBar.querySelectorAll(".filter-chip").forEach((c) => {
      c.classList.toggle("active", c.dataset.category === initialCategory);
    });
    applyFilter(initialCategory);
  } else {
    applyFilter("All");
  }
});
