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
// Same multer instance/limits as the single-cover upload above (same
// ALLOWED_MIME + 5MB-per-file enforcement) — "image" is the existing
// primary/cover field, unchanged; "images" is the new gallery batch, capped
// at 8 files per create/edit submission as a reasonable per-request limit.
const uploadWithGallery = upload.fields([
  { name: "image", maxCount: 1 },
  { name: "images", maxCount: 8 }
]);

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

// Gallery images: additional photos beyond the primary/cover `products.image`.
// Always read/written ordered by sort_order (then id as a stable tiebreaker
// for images uploaded in the same batch) so "return images in sort_order" is
// simply what the query already does — nothing extra needed at the call sites.
const imagesStmt = db.prepare(
  "SELECT id, image, sort_order FROM product_images WHERE product_id = ? ORDER BY sort_order ASC, id ASC"
);
const maxSortOrderStmt = db.prepare(
  "SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM product_images WHERE product_id = ?"
);
const insertImageStmt = db.prepare("INSERT INTO product_images (product_id, image, sort_order) VALUES (?, ?, ?)");
const deleteImageStmt = db.prepare("DELETE FROM product_images WHERE id = ? AND product_id = ?");
// Scoped by product_id (not just the image's own id) so a request can never
// touch a gallery row belonging to a different product.
const getImageStmt = db.prepare("SELECT * FROM product_images WHERE id = ? AND product_id = ?");

function getGalleryImages(productId) {
  return imagesStmt.all(productId).map((row) => ({ id: row.id, image: row.image, sortOrder: row.sort_order }));
}

// Appends newly uploaded gallery files, continuing the sort_order sequence
// rather than restarting it — repeated edits keep adding to the end of the
// gallery instead of ever reordering/clobbering existing images.
function addGalleryImages(productId, files) {
  if (!files || !files.length) return;
  let nextOrder = maxSortOrderStmt.get(productId).maxOrder + 1;
  for (const file of files) {
    insertImageStmt.run(productId, `images/products/${file.filename}`, nextOrder);
    nextOrder += 1;
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
  res.json(rows.map((row) => ({ ...serializeProduct(row), stock: getStockMap(row.id), images: getGalleryImages(row.id) })));
});

router.get("/products/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM products WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Product not found." });
  res.json({ ...serializeProduct(row), stock: getStockMap(row.id), images: getGalleryImages(row.id) });
});

router.post("/admin/products", requireAdmin, uploadWithGallery, (req, res) => {
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

  const coverFile = req.files && req.files.image ? req.files.image[0] : null;
  const image = coverFile ? `images/products/${coverFile.filename}` : null;
  const sizesList = parseSizes(req.body.sizes);
  const sizes = JSON.stringify(sizesList);

  db.prepare(
    `INSERT INTO products (id, name, category, price_cents, compare_at_price_cents, image, description, sizes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, name, category, priceCents, compareAtPriceCents, image, req.body.description || "", sizes);

  syncProductStock(id, sizesList, parseStockInput(req.body.stock));
  addGalleryImages(id, req.files && req.files.images);

  const row = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
  res.status(201).json({ ...serializeProduct(row), stock: getStockMap(id), images: getGalleryImages(id) });
});

router.put("/admin/products/:id", requireAdmin, uploadWithGallery, (req, res) => {
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
  const coverFile = req.files && req.files.image ? req.files.image[0] : null;
  if (coverFile) {
    image = `images/products/${coverFile.filename}`;
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

  addGalleryImages(req.params.id, req.files && req.files.images);

  const row = db.prepare("SELECT * FROM products WHERE id = ?").get(req.params.id);
  res.json({ ...serializeProduct(row), stock: getStockMap(req.params.id), images: getGalleryImages(req.params.id) });
});

// Removes one gallery image (DB row + file). Scoped to :id via getImageStmt's
// own WHERE clause, so an imageId that belongs to a different product 404s
// instead of silently deleting the wrong thing.
router.delete("/admin/products/:id/images/:imageId", requireAdmin, (req, res) => {
  const image = getImageStmt.get(req.params.imageId, req.params.id);
  if (!image) return res.status(404).json({ error: "Image not found." });

  deleteImageStmt.run(req.params.imageId, req.params.id);
  removeUploadedImage(image.image);

  res.json({ ok: true });
});

// Promotes an existing gallery image to be the product's primary/cover
// image. The current cover (if any) moves INTO the gallery rather than
// being discarded, so swapping the primary never loses an image — wrapped
// in one transaction so a failure partway through can't leave the product
// with no cover at all, or the same image counted twice.
router.post("/admin/products/:id/images/:imageId/primary", requireAdmin, (req, res) => {
  const product = db.prepare("SELECT * FROM products WHERE id = ?").get(req.params.id);
  if (!product) return res.status(404).json({ error: "Product not found." });

  const target = getImageStmt.get(req.params.imageId, req.params.id);
  if (!target) return res.status(404).json({ error: "Image not found." });

  db.exec("BEGIN IMMEDIATE");
  try {
    if (product.image) {
      const nextOrder = maxSortOrderStmt.get(req.params.id).maxOrder + 1;
      insertImageStmt.run(req.params.id, product.image, nextOrder);
    }
    db.prepare("UPDATE products SET image = ?, updated_at = datetime('now') WHERE id = ?").run(
      target.image,
      req.params.id
    );
    deleteImageStmt.run(req.params.imageId, req.params.id);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  const row = db.prepare("SELECT * FROM products WHERE id = ?").get(req.params.id);
  res.json({ ...serializeProduct(row), stock: getStockMap(req.params.id), images: getGalleryImages(req.params.id) });
});

router.delete("/admin/products/:id", requireAdmin, (req, res) => {
  const existing = db.prepare("SELECT * FROM products WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Product not found." });

  // Fetched before the delete below — ON DELETE CASCADE removes these rows
  // from the DB as part of that single statement, so the gallery's files
  // still need to be unlinked explicitly afterward from this snapshot.
  const galleryRows = imagesStmt.all(req.params.id);

  db.prepare("DELETE FROM products WHERE id = ?").run(req.params.id);
  removeUploadedImage(existing.image);
  for (const row of galleryRows) {
    removeUploadedImage(row.image);
  }

  res.json({ ok: true });
});

module.exports = router;
// Exposed so server.js can serve this directory at the same "/images/products"
// URL the frontend already expects, even when it points outside public/.
module.exports.UPLOAD_DIR = UPLOAD_DIR;
