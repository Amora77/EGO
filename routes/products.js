const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const db = require("../db");
const { requireAdmin } = require("../lib/auth");

const router = express.Router();

// Configurable so a host with a persistent disk (e.g. Render) can point this
// at a mounted volume instead of local app storage. Falls back to the
// original "public/images/products" directory when UPLOADS_DIR isn't set,
// so local development is unaffected. The URL path stays "images/products/..."
// either way (see the static mount in server.js) — only the physical
// on-disk location changes.
const UPLOAD_DIR = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(__dirname, "..", "public", "images", "products");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/svg+xml", "image/gif"]);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error("Unsupported image type."));
    }
    cb(null, true);
  }
});

function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function parseSizes(raw) {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const stockStmt = db.prepare("SELECT size, stock FROM product_stock WHERE product_id = ?");
const upsertStockStmt = db.prepare(
  `INSERT INTO product_stock (product_id, size, stock) VALUES (?, ?, ?)
   ON CONFLICT (product_id, size) DO UPDATE SET stock = excluded.stock`
);

function getStockMap(productId) {
  const map = {};
  for (const row of stockStmt.all(productId)) {
    map[row.size] = row.stock;
  }
  return map;
}

// Parses the admin form's stock field — a JSON object of size -> quantity —
// tolerating missing/malformed input rather than throwing, since a bad stock
// value shouldn't block saving the rest of the product.
function parseStockInput(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Keeps product_stock in sync with a product's current size list: every size
// still offered gets an upserted row (missing/invalid quantities default to
// 0 — a brand new size starts with nothing to sell until an admin sets a
// real number), and rows for sizes no longer offered are removed so stock
// data never goes stale/orphaned.
function syncProductStock(productId, sizesList, stockInput) {
  if (sizesList.length) {
    const placeholders = sizesList.map(() => "?").join(",");
    db.prepare(`DELETE FROM product_stock WHERE product_id = ? AND size NOT IN (${placeholders})`).run(
      productId,
      ...sizesList
    );
  } else {
    db.prepare("DELETE FROM product_stock WHERE product_id = ?").run(productId);
  }

  for (const size of sizesList) {
    const qty = Number.parseInt(stockInput[size], 10);
    upsertStockStmt.run(productId, size, Number.isInteger(qty) && qty >= 0 ? qty : 0);
  }
}

function serializeProduct(row) {
  const price = row.price_cents;
  const rawCompareAt = row.compare_at_price_cents;
  // A stale compare-at price left over from editing (e.g. the price was
  // lowered below it) is treated as "not on sale" here rather than showing
  // a nonsensical discount.
  const onSale = rawCompareAt != null && rawCompareAt > price;

  return {
    id: row.id,
    name: row.name,
    category: row.category,
    price,
    compareAtPrice: onSale ? rawCompareAt : null,
    discountPercent: onSale ? Math.round(((rawCompareAt - price) / rawCompareAt) * 100) : null,
    image: row.image,
    description: row.description,
    sizes: JSON.parse(row.sizes || "[]")
  };
}

function removeUploadedImage(imagePath) {
  // The DB stores "images/products/<filename>" regardless of where the file
  // physically lives (see UPLOAD_DIR above) — reconstruct the real path from
  // UPLOAD_DIR rather than assuming it's still under public/.
  if (imagePath && imagePath.startsWith("images/products/")) {
    fs.unlink(path.join(UPLOAD_DIR, path.basename(imagePath)), () => {});
  }
}

router.get("/products", (req, res) => {
  const rows = db.prepare("SELECT * FROM products ORDER BY created_at ASC").all();
  res.json(rows.map((row) => ({ ...serializeProduct(row), stock: getStockMap(row.id) })));
});

router.get("/products/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM products WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Product not found." });
  res.json({ ...serializeProduct(row), stock: getStockMap(row.id) });
});

router.post("/admin/products", requireAdmin, upload.single("image"), (req, res) => {
  const { name, category, price } = req.body;

  if (!name || !category || !price) {
    return res.status(400).json({ error: "name, category and price are required." });
  }

  const priceCents = Number.parseInt(price, 10);
  if (!Number.isInteger(priceCents) || priceCents <= 0) {
    return res.status(400).json({ error: "price must be a positive whole number of cents." });
  }

  let compareAtPriceCents = null;
  if (req.body.compareAtPrice !== undefined && req.body.compareAtPrice !== "") {
    compareAtPriceCents = Number.parseInt(req.body.compareAtPrice, 10);
    if (!Number.isInteger(compareAtPriceCents) || compareAtPriceCents <= 0) {
      return res.status(400).json({ error: "Compare-at price must be a positive whole number." });
    }
    if (compareAtPriceCents <= priceCents) {
      return res.status(400).json({ error: "Compare-at price must be higher than the price to represent a sale." });
    }
  }

  let id = slugify(name);
  if (!id) return res.status(400).json({ error: "Invalid product name." });
  if (db.prepare("SELECT id FROM products WHERE id = ?").get(id)) {
    id = `${id}-${crypto.randomBytes(3).toString("hex")}`;
  }

  const image = req.file ? `images/products/${req.file.filename}` : null;
  const sizesList = parseSizes(req.body.sizes);
  const sizes = JSON.stringify(sizesList);

  db.prepare(
    `INSERT INTO products (id, name, category, price_cents, compare_at_price_cents, image, description, sizes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, name, category, priceCents, compareAtPriceCents, image, req.body.description || "", sizes);

  syncProductStock(id, sizesList, parseStockInput(req.body.stock));

  const row = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
  res.status(201).json({ ...serializeProduct(row), stock: getStockMap(id) });
});

router.put("/admin/products/:id", requireAdmin, upload.single("image"), (req, res) => {
  const existing = db.prepare("SELECT * FROM products WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Product not found." });

  const name = req.body.name || existing.name;
  const category = req.body.category || existing.category;
  const description = req.body.description !== undefined ? req.body.description : existing.description;

  let priceCents = existing.price_cents;
  if (req.body.price !== undefined && req.body.price !== "") {
    priceCents = Number.parseInt(req.body.price, 10);
    if (!Number.isInteger(priceCents) || priceCents <= 0) {
      return res.status(400).json({ error: "price must be a positive whole number of cents." });
    }
  }

  let compareAtPriceCents = existing.compare_at_price_cents;
  if (req.body.compareAtPrice !== undefined) {
    if (req.body.compareAtPrice === "") {
      compareAtPriceCents = null;
    } else {
      compareAtPriceCents = Number.parseInt(req.body.compareAtPrice, 10);
      if (!Number.isInteger(compareAtPriceCents) || compareAtPriceCents <= 0) {
        return res.status(400).json({ error: "Compare-at price must be a positive whole number." });
      }
    }
  }
  if (compareAtPriceCents !== null && compareAtPriceCents <= priceCents) {
    return res.status(400).json({ error: "Compare-at price must be higher than the price to represent a sale." });
  }

  const sizesList = req.body.sizes !== undefined ? parseSizes(req.body.sizes) : JSON.parse(existing.sizes || "[]");
  const sizes = JSON.stringify(sizesList);

  let image = existing.image;
  if (req.file) {
    image = `images/products/${req.file.filename}`;
    removeUploadedImage(existing.image);
  }

  db.prepare(
    `UPDATE products SET name = ?, category = ?, price_cents = ?, compare_at_price_cents = ?, image = ?,
       description = ?, sizes = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(name, category, priceCents, compareAtPriceCents, image, description, sizes, req.params.id);

  // Only touch stock when the caller actually sent it — the admin Sale page,
  // for instance, PUTs just price/compareAtPrice and must never reset stock
  // to 0 as a side effect of an unrelated price change.
  if (req.body.stock !== undefined) {
    syncProductStock(req.params.id, sizesList, parseStockInput(req.body.stock));
  }

  const row = db.prepare("SELECT * FROM products WHERE id = ?").get(req.params.id);
  res.json({ ...serializeProduct(row), stock: getStockMap(req.params.id) });
});

router.delete("/admin/products/:id", requireAdmin, (req, res) => {
  const existing = db.prepare("SELECT * FROM products WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Product not found." });

  db.prepare("DELETE FROM products WHERE id = ?").run(req.params.id);
  removeUploadedImage(existing.image);

  res.json({ ok: true });
});

module.exports = router;
// Exposed so server.js can serve this directory at the same "/images/products"
// URL the frontend already expects, even when it points outside public/.
module.exports.UPLOAD_DIR = UPLOAD_DIR;
