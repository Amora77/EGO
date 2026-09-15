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

  // Missing stock data for a size is treated as sold out (0), not
  // "unlimited" — the safe default when the backend hasn't reported a
  // quantity for it.
  const stockFor = (size) => (product.stock && product.stock[size] != null ? product.stock[size] : 0);

  let selectedSize = product.sizes.find((s) => stockFor(s) > 0) || product.sizes[0];
  let qty = 1;

  const onSale = product.discountPercent != null;

  // Primary/cover image first, then the gallery in sort_order — a product
  // with no gallery yet (every existing product today) simply collapses to
  // this one-item list, which is exactly today's single-image behavior.
  const allImages = [product.image, ...(product.images || []).map((i) => i.image)].filter(Boolean);
  let currentImageIndex = 0;

  root.innerHTML = `
    <div class="gallery">
      <div class="gallery-main" id="gallery-main">
        ${allImages.length ? `<img src="${allImages[0]}" alt="${product.name}" id="gallery-main-img">` : ""}
        ${onSale ? `<span class="badge-sale">-${product.discountPercent}%</span>` : ""}
      </div>
      ${
        allImages.length > 1
          ? `<div class="gallery-thumbs" id="gallery-thumbs">
              ${allImages
                .map(
                  (src, i) =>
                    `<button type="button" class="gallery-thumb${i === 0 ? " active" : ""}" data-index="${i}"><img src="${src}" alt="${product.name} view ${i + 1}"></button>`
                )
                .join("")}
            </div>`
          : ""
      }
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
        <div class="label">Size &middot; <a href="size-guide.html" style="text-transform:none; letter-spacing:normal; font-weight:400; text-decoration:underline;">Size Guide</a></div>
        <div class="size-options">
          ${product.sizes
            .map((s) => {
              const soldOut = stockFor(s) <= 0;
              return `<div class="size-option${s === selectedSize ? " selected" : ""}${soldOut ? " sold-out" : ""}" data-size="${s}">${s}${soldOut ? '<span class="sold-out-label">Sold Out</span>' : ""}</div>`;
            })
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

  // --- Gallery: thumbnail navigation + a minimal full-screen lightbox,
  // built with plain DOM/CSS (no external library). Degrades to exactly
  // today's single-image behavior when there's only one image: no
  // thumbnail row is rendered, and the lightbox just shows that one image
  // full-screen (a bonus "zoom" for the existing catalog, not a change to
  // the default layout).
  const galleryMain = root.querySelector("#gallery-main");
  const galleryMainImg = root.querySelector("#gallery-main-img");
  const galleryThumbs = root.querySelectorAll(".gallery-thumb");
  let lightboxOpen = false;
  let lightbox = null;
  let lightboxImg = null;

  function showImage(index) {
    if (!allImages.length) return;
    currentImageIndex = ((index % allImages.length) + allImages.length) % allImages.length;
    if (galleryMainImg) galleryMainImg.src = allImages[currentImageIndex];
    galleryThumbs.forEach((t) => t.classList.toggle("active", Number(t.dataset.index) === currentImageIndex));
    if (lightboxOpen && lightboxImg) lightboxImg.src = allImages[currentImageIndex];
  }

  galleryThumbs.forEach((thumb) => {
    thumb.addEventListener("click", () => showImage(Number(thumb.dataset.index)));
  });

  if (allImages.length) {
    lightbox = document.createElement("div");
    lightbox.className = "lightbox-overlay";
    lightbox.innerHTML = `
      <button type="button" class="lightbox-close" aria-label="Close">&times;</button>
      ${allImages.length > 1 ? `<button type="button" class="lightbox-nav lightbox-prev" aria-label="Previous image">&lsaquo;</button>` : ""}
      <img class="lightbox-img" alt="${product.name}">
      ${allImages.length > 1 ? `<button type="button" class="lightbox-nav lightbox-next" aria-label="Next image">&rsaquo;</button>` : ""}
    `;
    document.body.appendChild(lightbox);
    lightboxImg = lightbox.querySelector(".lightbox-img");

    function openLightbox() {
      lightboxImg.src = allImages[currentImageIndex];
      lightbox.style.display = "flex";
      lightboxOpen = true;
    }
    function closeLightbox() {
      lightbox.style.display = "none";
      lightboxOpen = false;
    }

    galleryMain.addEventListener("click", openLightbox);
    lightbox.querySelector(".lightbox-close").addEventListener("click", closeLightbox);
    lightbox.addEventListener("click", (e) => {
      if (e.target === lightbox) closeLightbox();
    });
    document.addEventListener("keydown", (e) => {
      if (!lightboxOpen) return;
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft") showImage(currentImageIndex - 1);
      if (e.key === "ArrowRight") showImage(currentImageIndex + 1);
    });
    const prevBtn = lightbox.querySelector(".lightbox-prev");
    const nextBtn = lightbox.querySelector(".lightbox-next");
    if (prevBtn) prevBtn.addEventListener("click", () => showImage(currentImageIndex - 1));
    if (nextBtn) nextBtn.addEventListener("click", () => showImage(currentImageIndex + 1));

    // Minimal touch-swipe (no library): a >40px horizontal drag advances to
    // the next/previous image. Works the same on the main image and inside
    // the lightbox, so mobile users always have swipe on top of tapping
    // thumbnails.
    if (allImages.length > 1) {
      function addSwipe(el) {
        let startX = null;
        el.addEventListener(
          "touchstart",
          (e) => {
            startX = e.touches[0].clientX;
          },
          { passive: true }
        );
        el.addEventListener(
          "touchend",
          (e) => {
            if (startX == null) return;
            const dx = e.changedTouches[0].clientX - startX;
            if (Math.abs(dx) > 40) showImage(currentImageIndex + (dx < 0 ? 1 : -1));
            startX = null;
          },
          { passive: true }
        );
      }
      addSwipe(galleryMain);
      addSwipe(lightbox);
    }
  }

  const addToCartBtn = root.querySelector("#add-to-cart-btn");
  const increaseBtn = root.querySelector('[data-action="increase"]');

  function updateAddToCartState() {
    const soldOut = stockFor(selectedSize) <= 0;
    addToCartBtn.disabled = soldOut;
    addToCartBtn.textContent = soldOut ? "Sold Out" : "Add to Cart";
  }

  // "+" must never let qty exceed the SELECTED size's stock — recalculated
  // every time the size changes, since different sizes can have completely
  // different stock levels. This is a UX guard only; the server independently
  // re-validates and decrements stock at checkout regardless of what qty the
  // client sends.
  function syncQtyToStock() {
    const max = Math.max(0, stockFor(selectedSize));
    if (max > 0 && qty > max) {
      qty = max;
    }
    root.querySelector("#qty-value").textContent = qty;
    increaseBtn.disabled = qty >= max;
  }

  root.querySelectorAll(".size-option").forEach((el) => {
    el.addEventListener("click", () => {
      if (el.classList.contains("sold-out")) return;
      root.querySelectorAll(".size-option").forEach((s) => s.classList.remove("selected"));
      el.classList.add("selected");
      selectedSize = el.dataset.size;
      updateAddToCartState();
      syncQtyToStock();
    });
  });

  updateAddToCartState();
  syncQtyToStock();

  increaseBtn.addEventListener("click", () => {
    const max = Math.max(0, stockFor(selectedSize));
    if (qty >= max) return;
    qty += 1;
    syncQtyToStock();
  });

  root.querySelector('[data-action="decrease"]').addEventListener("click", () => {
    qty = Math.max(1, qty - 1);
    syncQtyToStock();
  });

  addToCartBtn.addEventListener("click", () => {
    if (stockFor(selectedSize) <= 0) return;
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
