// Product catalog now lives in the database — call loadProducts() before
// reading PRODUCTS or calling getProductById() on any page that needs it.
let PRODUCTS = [];

function formatPrice(cents) {
  return "EGP " + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getProductById(id) {
  return PRODUCTS.find((p) => p.id === id);
}

async function loadProducts() {
  const response = await fetch("/api/products");
  if (!response.ok) {
    throw new Error("Unable to load products.");
  }
  PRODUCTS = await response.json();
  return PRODUCTS;
}
