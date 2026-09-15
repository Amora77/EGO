function formatPrice(cents) {
  return "EGP " + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Escapes a value for safe insertion into HTML via innerHTML. Must be applied
// to every customer-controlled string (order email, shipping name/phone/
// address, etc.) before it's interpolated into a template — those values
// come from anonymous, unauthenticated checkout requests and are rendered
// here in the admin's own authenticated session.
function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]
  );
}

async function requireAdminSession() {
  const res = await fetch("/api/auth/me");
  if (!res.ok) {
    window.location.href = "login.html";
    return null;
  }
  const me = await res.json();
  if (!me.isAdmin) {
    window.location.href = "login.html";
    return null;
  }
  return me;
}

function wireLogout() {
  const btn = document.getElementById("logout-btn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "login.html";
  });
}

// --- Login page ---
function initLoginPage() {
  const form = document.getElementById("admin-login-form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = document.getElementById("login-msg");
    msg.textContent = "";

    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed.");
      if (!data.isAdmin) throw new Error("This account does not have admin access.");
      window.location.href = "products.html";
    } catch (err) {
      msg.textContent = err.message;
    }
  });
}

// --- Products page ---
function initProductsPage() {
  const table = document.getElementById("products-tbody");
  const form = document.getElementById("product-form");
  if (!table || !form) return;

  requireAdminSession().then((me) => {
    if (me) loadProductsTable();
  });
  wireLogout();

  const idField = document.getElementById("product-id");
  const nameField = document.getElementById("name");
  const categoryField = document.getElementById("category");
  const priceField = document.getElementById("price");
  const compareAtPriceField = document.getElementById("compare-at-price");
  const sizesField = document.getElementById("sizes");
  const stockFieldsContainer = document.getElementById("stock-fields");
  const descriptionField = document.getElementById("description");
  const imageField = document.getElementById("image");
  const coverPreviewContainer = document.getElementById("cover-image-preview");
  const galleryImagesField = document.getElementById("gallery-images");
  const galleryListContainer = document.getElementById("gallery-images-list");
  const heading = document.getElementById("form-heading");
  const submitBtn = document.getElementById("product-submit-btn");
  const cancelBtn = document.getElementById("product-cancel-btn");
  const formMsg = document.getElementById("product-form-msg");

  function parseSizesInput(raw) {
    return String(raw || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // One number input per size, regenerated whenever the sizes field changes.
  // Preserves whatever's currently typed for sizes that remain (so adding
  // one more size doesn't wipe out stock already entered for the others);
  // seedMap only fills in values the first time a product is loaded for editing.
  function renderStockInputs(sizesList, seedMap = {}) {
    const existing = {};
    stockFieldsContainer.querySelectorAll(".stock-input").forEach((input) => {
      existing[input.dataset.size] = input.value;
    });
    stockFieldsContainer.innerHTML = sizesList
      .map((size) => {
        const value = existing[size] !== undefined ? existing[size] : seedMap[size] != null ? seedMap[size] : 0;
        return `
          <div style="display:flex; flex-direction:column; gap:4px;">
            <span style="font-size:12px; font-weight:600;">${escapeHtml(size)}</span>
            <input type="number" min="0" step="1" class="stock-input" data-size="${escapeHtml(size)}" value="${value}" style="width:70px;">
          </div>
        `;
      })
      .join("");
  }

  sizesField.addEventListener("input", () => {
    renderStockInputs(parseSizesInput(sizesField.value));
  });

  function renderCoverPreview(imagePath) {
    coverPreviewContainer.innerHTML = imagePath
      ? `<img src="../${imagePath}" alt="" style="width:64px;height:64px;object-fit:cover;">`
      : "";
  }

  // Existing gallery images for the product currently being edited — only
  // populated once a product has an id (a brand-new, unsaved product has no
  // gallery yet). Remove/Set Cover act immediately against the server
  // rather than waiting for the main form to be submitted, so the admin
  // sees the result right away and never loses track of pending changes.
  function renderGalleryList(productId, images) {
    galleryListContainer.innerHTML = (images || [])
      .map(
        (img) => `
        <div class="gallery-admin-thumb" data-image-id="${img.id}" style="text-align:center;">
          <img src="../${img.image}" alt="" style="width:64px;height:64px;object-fit:cover;display:block;">
          <div style="display:flex; gap:4px; margin-top:4px;">
            <button type="button" class="btn btn-outline admin-row-btn" data-action="set-primary" style="padding:4px 8px; font-size:10px; margin:0;">Set Cover</button>
            <button type="button" class="btn btn-outline admin-row-btn" data-action="remove-image" style="padding:4px 8px; font-size:10px; margin:0;">Remove</button>
          </div>
        </div>
      `
      )
      .join("");
  }

  galleryListContainer.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const wrap = btn.closest("[data-image-id]");
    const imageId = wrap.dataset.imageId;
    const productId = idField.value;
    if (!productId) return;

    if (btn.dataset.action === "remove-image") {
      if (!confirm("Remove this gallery image?")) return;
      await fetch(`/api/admin/products/${encodeURIComponent(productId)}/images/${encodeURIComponent(imageId)}`, {
        method: "DELETE"
      });
    } else if (btn.dataset.action === "set-primary") {
      await fetch(
        `/api/admin/products/${encodeURIComponent(productId)}/images/${encodeURIComponent(imageId)}/primary`,
        { method: "POST" }
      );
    }

    const res = await fetch(`/api/products/${encodeURIComponent(productId)}`);
    const product = await res.json();
    renderCoverPreview(product.image);
    renderGalleryList(product.id, product.images);
  });

  function resetForm() {
    form.reset();
    idField.value = "";
    stockFieldsContainer.innerHTML = "";
    coverPreviewContainer.innerHTML = "";
    galleryListContainer.innerHTML = "";
    heading.textContent = "Add Product";
    submitBtn.textContent = "Add Product";
    cancelBtn.style.display = "none";
  }

  cancelBtn.addEventListener("click", resetForm);

  async function loadProductsTable() {
    const res = await fetch("/api/products");
    const products = await res.json();
    table.innerHTML = products
      .map(
        (p) => `
        <tr data-id="${p.id}">
          <td>${p.image ? `<img src="../${p.image}" alt="" style="width:48px;height:48px;object-fit:cover;">` : ""}</td>
          <td>${p.name}</td>
          <td>${p.category}</td>
          <td>${formatPrice(p.price)}</td>
          <td>${p.discountPercent != null ? `-${p.discountPercent}%` : "—"}</td>
          <td>${p.sizes.join(", ")}</td>
          <td>${Object.entries(p.stock || {})
            .map(([size, qty]) => `${escapeHtml(size)}:${qty}`)
            .join(" ") || "—"}</td>
          <td>
            <button type="button" class="btn btn-outline admin-row-btn" data-action="edit">Edit</button>
            <button type="button" class="btn btn-outline admin-row-btn" data-action="delete">Delete</button>
          </td>
        </tr>
      `
      )
      .join("");
  }

  table.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const row = btn.closest("tr");
    const id = row.dataset.id;

    if (btn.dataset.action === "delete") {
      if (!confirm("Delete this product?")) return;
      await fetch(`/api/admin/products/${encodeURIComponent(id)}`, { method: "DELETE" });
      loadProductsTable();
      return;
    }

    if (btn.dataset.action === "edit") {
      const res = await fetch(`/api/products/${encodeURIComponent(id)}`);
      const product = await res.json();
      idField.value = product.id;
      nameField.value = product.name;
      categoryField.value = product.category;
      priceField.value = (product.price / 100).toFixed(2);
      compareAtPriceField.value = product.compareAtPrice != null ? (product.compareAtPrice / 100).toFixed(2) : "";
      sizesField.value = product.sizes.join(", ");
      renderStockInputs(product.sizes, product.stock || {});
      descriptionField.value = product.description || "";
      renderCoverPreview(product.image);
      renderGalleryList(product.id, product.images);
      heading.textContent = `Edit: ${product.name}`;
      submitBtn.textContent = "Save Changes";
      cancelBtn.style.display = "inline-block";
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    formMsg.textContent = "";

    const id = idField.value;
    const formData = new FormData();
    formData.set("name", nameField.value);
    formData.set("category", categoryField.value);
    formData.set("price", String(Math.round(Number.parseFloat(priceField.value) * 100)));
    formData.set(
      "compareAtPrice",
      compareAtPriceField.value ? String(Math.round(Number.parseFloat(compareAtPriceField.value) * 100)) : ""
    );
    formData.set("sizes", sizesField.value);
    const stockObj = {};
    stockFieldsContainer.querySelectorAll(".stock-input").forEach((input) => {
      stockObj[input.dataset.size] = input.value;
    });
    formData.set("stock", JSON.stringify(stockObj));
    formData.set("description", descriptionField.value);
    if (imageField.files[0]) {
      formData.set("image", imageField.files[0]);
    }
    // Multiple files under the same field name — appended to the existing
    // gallery (never replaces it); removing individual images happens
    // immediately via their own Remove button, not through this submit.
    Array.from(galleryImagesField.files).forEach((file) => formData.append("images", file));

    const url = id ? `/api/admin/products/${encodeURIComponent(id)}` : "/api/admin/products";
    const method = id ? "PUT" : "POST";

    try {
      const res = await fetch(url, { method, body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to save product.");
      resetForm();
      loadProductsTable();
    } catch (err) {
      formMsg.textContent = err.message;
    }
  });
}

// --- Orders page ---

// Friendly labels for every status an order can be in, including the
// dormant Stripe ones ('pending', 'paid') so an old/disabled-payment order
// still renders sensibly instead of showing a raw internal string.
const ORDER_STATUS_LABELS = {
  pending: "Pending",
  paid: "Paid",
  placed: "Placed",
  confirmed: "Confirmed",
  preparing: "Preparing",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled"
};

// Exactly mirrors the server-side transition matrix in routes/orders.js —
// this only decides which buttons are *offered*; the server independently
// re-validates every transition regardless of what's clicked here. Statuses
// with no entry (delivered, cancelled, and the dormant pending/paid) render
// no action buttons at all.
const ORDER_NEXT_ACTIONS = {
  placed: [
    { action: "confirm", label: "Confirm" },
    { action: "cancel", label: "Cancel" }
  ],
  confirmed: [
    { action: "prepare", label: "Prepare" },
    { action: "cancel", label: "Cancel" }
  ],
  preparing: [
    { action: "ship", label: "Ship" },
    { action: "cancel", label: "Cancel" }
  ],
  shipped: [{ action: "deliver", label: "Deliver" }]
};

function orderStatusBadge(status) {
  const label = ORDER_STATUS_LABELS[status] || status;
  return `<span class="status-badge status-${escapeHtml(status)}">${escapeHtml(label)}</span>`;
}

function initOrdersPage() {
  const table = document.getElementById("orders-tbody");
  if (!table) return;

  requireAdminSession().then((me) => {
    if (me) loadOrdersTable();
  });
  wireLogout();

  function formatAddress(shippingAddress) {
    if (!shippingAddress) return "—";
    const a = shippingAddress.address || {};
    return [
      escapeHtml(shippingAddress.name),
      escapeHtml(shippingAddress.phone),
      [escapeHtml(a.line1), escapeHtml(a.line2)].filter(Boolean).join(", "),
      [escapeHtml(a.city), escapeHtml(a.state), escapeHtml(a.postal_code)].filter(Boolean).join(", "),
      escapeHtml(a.country)
    ]
      .filter(Boolean)
      .join("<br>");
  }

  async function loadOrdersTable() {
    const res = await fetch("/api/admin/orders");
    const orders = await res.json();
    table.innerHTML = orders
      .map(
        (o) => `
        <tr data-id="${o.id}">
          <td>${o.orderNumber}</td>
          <td>${new Date(o.createdAt).toLocaleString()}</td>
          <td>${orderStatusBadge(o.status)}</td>
          <td>${o.paymentMethod === "cod" ? "Cash on Delivery" : "Card"}</td>
          <td>${o.email ? escapeHtml(o.email) : "—"}</td>
          <td>${formatPrice(o.amountTotal || 0)}</td>
          <td>${o.items.map((i) => `${i.qty}&times; ${escapeHtml(i.productName)}`).join("<br>")}</td>
          <td>${formatAddress(o.shippingAddress)}</td>
          <td>${(ORDER_NEXT_ACTIONS[o.status] || [])
            .map(
              (a) =>
                `<button type="button" class="btn btn-outline admin-row-btn" data-action="${a.action}">${a.label}</button>`
            )
            .join("")}</td>
        </tr>
      `
      )
      .join("");
  }

  const VALID_ACTIONS = ["confirm", "prepare", "ship", "deliver", "cancel"];

  table.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn || !VALID_ACTIONS.includes(btn.dataset.action)) return;
    const action = btn.dataset.action;
    const id = btn.closest("tr").dataset.id;

    if (action === "cancel") {
      const confirmed = confirm(
        "Are you sure you want to cancel this order? The reserved stock will be returned to inventory."
      );
      if (!confirmed) return;
    }

    btn.disabled = true;
    try {
      const res = await fetch(`/api/admin/orders/${encodeURIComponent(id)}/${action}`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Unable to update this order. It may have already changed status.");
      }
    } finally {
      loadOrdersTable();
    }
  });
}

// --- Sale page ---
function initSalePage() {
  const table = document.getElementById("sale-tbody");
  if (!table) return;

  requireAdminSession().then((me) => {
    if (me) loadSaleTable();
  });
  wireLogout();

  const onSaleOnlyToggle = document.getElementById("on-sale-only");
  const msg = document.getElementById("sale-msg");
  let allProducts = [];

  function renderRows() {
    const products = onSaleOnlyToggle.checked ? allProducts.filter((p) => p.discountPercent != null) : allProducts;
    table.innerHTML = products
      .map(
        (p) => `
        <tr data-id="${p.id}">
          <td>${p.image ? `<img src="../${p.image}" alt="" style="width:48px;height:48px;object-fit:cover;">` : ""}</td>
          <td>${p.name}</td>
          <td><input type="number" min="0.01" step="0.01" class="sale-price" value="${(p.price / 100).toFixed(2)}" style="width:100px;"></td>
          <td><input type="number" min="0.01" step="0.01" class="sale-compare" placeholder="&mdash;" value="${p.compareAtPrice != null ? (p.compareAtPrice / 100).toFixed(2) : ""}" style="width:100px;"></td>
          <td class="sale-discount">${p.discountPercent != null ? `-${p.discountPercent}%` : "—"}</td>
          <td><button type="button" class="btn btn-outline admin-row-btn" data-action="save-sale">Save</button></td>
        </tr>
      `
      )
      .join("");
  }

  async function loadSaleTable() {
    const res = await fetch("/api/products");
    allProducts = await res.json();
    renderRows();
  }

  onSaleOnlyToggle.addEventListener("change", renderRows);

  table.addEventListener("input", (e) => {
    const row = e.target.closest("tr");
    if (!row || !e.target.matches(".sale-price, .sale-compare")) return;
    const price = Number.parseFloat(row.querySelector(".sale-price").value);
    const compareAt = Number.parseFloat(row.querySelector(".sale-compare").value);
    const discountCell = row.querySelector(".sale-discount");
    discountCell.textContent =
      Number.isFinite(price) && Number.isFinite(compareAt) && compareAt > price
        ? `-${Math.round(((compareAt - price) / compareAt) * 100)}%`
        : "—";
  });

  table.addEventListener("click", async (e) => {
    const btn = e.target.closest('button[data-action="save-sale"]');
    if (!btn) return;
    msg.textContent = "";

    const row = btn.closest("tr");
    const id = row.dataset.id;
    const priceValue = row.querySelector(".sale-price").value;
    const compareValue = row.querySelector(".sale-compare").value;

    const formData = new FormData();
    formData.set("price", String(Math.round(Number.parseFloat(priceValue) * 100)));
    formData.set("compareAtPrice", compareValue ? String(Math.round(Number.parseFloat(compareValue) * 100)) : "");

    btn.disabled = true;
    btn.textContent = "Saving...";
    try {
      const res = await fetch(`/api/admin/products/${encodeURIComponent(id)}`, { method: "PUT", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to save.");
      await loadSaleTable();
      msg.style.color = "#111111";
      msg.textContent = `Saved ${data.name}.`;
      setTimeout(() => {
        if (msg.textContent === `Saved ${data.name}.`) msg.textContent = "";
      }, 3000);
    } catch (err) {
      msg.style.color = "#c8102e";
      msg.textContent = err.message;
      btn.disabled = false;
      btn.textContent = "Save";
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initLoginPage();
  initProductsPage();
  initOrdersPage();
  initSalePage();
});
