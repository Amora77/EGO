// Usage: node scripts/make-admin.js <email> <password>
// Creates the user if it doesn't exist yet, or promotes/resets an existing one.
require("dotenv").config();
const db = require("../db");
const { hashPassword } = require("../lib/auth");

async function main() {
  const [, , email, password] = process.argv;
  if (!email || !password) {
    console.error("Usage: node scripts/make-admin.js <email> <password>");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  const normalizedEmail = email.toLowerCase();
  const passwordHash = await hashPassword(password);
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(normalizedEmail);

  if (existing) {
    db.prepare("UPDATE users SET password_hash = ?, is_admin = 1 WHERE id = ?").run(passwordHash, existing.id);
    console.log(`Updated existing user ${normalizedEmail} to admin.`);
  } else {
    db.prepare("INSERT INTO users (email, password_hash, is_admin) VALUES (?, ?, 1)").run(
      normalizedEmail,
      passwordHash
    );
    console.log(`Created admin user ${normalizedEmail}.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
