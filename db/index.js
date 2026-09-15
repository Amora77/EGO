const path = require("path");
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");

// Configurable so a host with a persistent disk (e.g. Render) can point this
// at a mounted volume instead of local app storage. Falls back to the
// original relative "data/" directory when DATA_DIR isn't set, so local
// development is unaffected.
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, "ego.db"));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    email_verified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price_cents INTEGER NOT NULL,
    image TEXT,
    description TEXT,
    sizes TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stripe_session_id TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending',
    user_id INTEGER REFERENCES users(id),
    email TEXT,
    amount_total INTEGER,
    shipping_address TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    size TEXT,
    qty INTEGER NOT NULL,
    unit_amount INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS auth_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    token TEXT NOT NULL UNIQUE,
    purpose TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Per-size stock. Separate from products.sizes (which remains just the
  -- list of size labels a product offers) so a decrement can be a single
  -- atomic "UPDATE ... WHERE stock >= ?" on a plain integer column — the
  -- guard that actually prevents overselling under concurrent requests.
  -- ON DELETE CASCADE relies on PRAGMA foreign_keys = ON above.
  CREATE TABLE IF NOT EXISTS product_stock (
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    size TEXT NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
    PRIMARY KEY (product_id, size)
  );
`);

// CREATE TABLE IF NOT EXISTS doesn't retroactively add columns to a table
// that already existed (e.g. a `users` table created before email_verified
// was introduced), so patch it in for databases from earlier runs.
function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("users", "email_verified", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("orders", "payment_method", "TEXT NOT NULL DEFAULT 'card'");
ensureColumn("orders", "confirmation_token", "TEXT");
ensureColumn("products", "compare_at_price_cents", "INTEGER");

// Tracks when an order's status last changed (order lifecycle feature).
// Added as a plain nullable column rather than a non-constant ALTER TABLE
// default, then backfilled once — every status-transition endpoint sets it
// explicitly going forward (see routes/orders.js). No separate history
// table: this single timestamp is all the current requirements call for.
ensureColumn("orders", "updated_at", "TEXT");
db.exec("UPDATE orders SET updated_at = created_at WHERE updated_at IS NULL");

// SQLite's ALTER TABLE ADD COLUMN can't attach a UNIQUE constraint directly,
// so enforce it with an index instead (NULLs — i.e. card orders — don't
// conflict with each other under SQLite's uniqueness rules).
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_confirmation_token ON orders(confirmation_token)");

// One-time backfill: give every size of every existing product a starting
// stock row. 10 is a deliberate placeholder for the current catalog (not 0,
// so nothing on the live site shows as sold out the moment this ships; not
// 100, per the explicit product decision) — it's meant to be replaced with
// real inventory numbers via the admin UI before/after launch. INSERT OR
// IGNORE keyed on the (product_id, size) primary key makes this safe to run
// on every boot: existing stock rows (including ones an admin has already
// edited) are never touched, only missing ones are created.
const BACKFILL_STOCK = 10;
const backfillStockStmt = db.prepare(
  "INSERT OR IGNORE INTO product_stock (product_id, size, stock) VALUES (?, ?, ?)"
);
for (const product of db.prepare("SELECT id, sizes FROM products").all()) {
  let sizes;
  try {
    sizes = JSON.parse(product.sizes || "[]");
  } catch {
    sizes = [];
  }
  for (const size of sizes) {
    backfillStockStmt.run(product.id, size, BACKFILL_STOCK);
  }
}

module.exports = db;
