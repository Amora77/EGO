const crypto = require("crypto");
const express = require("express");
const db = require("../db");
const {
  hashPassword,
  verifyPassword,
  signToken,
  TOKEN_COOKIE,
  COOKIE_OPTS,
  isConfigured,
  requireAuth
} = require("../lib/auth");
const { sendVerificationEmail, sendPasswordResetEmail } = require("../lib/email");

const VERIFY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

function createToken(userId, purpose, ttlMs) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  db.prepare("INSERT INTO auth_tokens (user_id, token, purpose, expires_at) VALUES (?, ?, ?, ?)").run(
    userId,
    token,
    purpose,
    expiresAt
  );
  return token;
}

// Marks the token used on a successful lookup so it can't be replayed.
function consumeToken(token, purpose) {
  const row = db
    .prepare("SELECT * FROM auth_tokens WHERE token = ? AND purpose = ? AND used_at IS NULL")
    .get(token, purpose);
  if (!row || new Date(row.expires_at).getTime() < Date.now()) {
    return null;
  }
  db.prepare("UPDATE auth_tokens SET used_at = datetime('now') WHERE id = ?").run(row.id);
  return row;
}

module.exports = function createAuthRouter({ clientUrl }) {
  const router = express.Router();

  router.post("/signup", async (req, res) => {
    if (!isConfigured()) {
      return res.status(503).json({ error: "Auth is not configured. Set JWT_SECRET on the server." });
    }

    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }

    const normalizedEmail = String(email).toLowerCase();
    if (db.prepare("SELECT id FROM users WHERE email = ?").get(normalizedEmail)) {
      return res.status(409).json({ error: "An account with that email already exists." });
    }

    const passwordHash = await hashPassword(password);
    const userId = db
      .prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)")
      .run(normalizedEmail, passwordHash).lastInsertRowid;

    const verifyToken = createToken(userId, "verify_email", VERIFY_TTL_MS);
    sendVerificationEmail(normalizedEmail, `${clientUrl}/verify-email.html?token=${verifyToken}`);

    const token = signToken({ id: userId, email: normalizedEmail, is_admin: 0 });
    res.cookie(TOKEN_COOKIE, token, COOKIE_OPTS);
    res.status(201).json({ email: normalizedEmail, isAdmin: false, emailVerified: false });
  });

  router.post("/login", async (req, res) => {
    if (!isConfigured()) {
      return res.status(503).json({ error: "Auth is not configured. Set JWT_SECRET on the server." });
    }

    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(String(email).toLowerCase());
    const ok = user ? await verifyPassword(password, user.password_hash) : false;
    if (!ok) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const token = signToken(user);
    res.cookie(TOKEN_COOKIE, token, COOKIE_OPTS);
    res.json({ email: user.email, isAdmin: !!user.is_admin, emailVerified: !!user.email_verified });
  });

  router.post("/logout", (req, res) => {
    res.clearCookie(TOKEN_COOKIE, COOKIE_OPTS);
    res.json({ ok: true });
  });

  router.get("/me", (req, res) => {
    if (!req.user) {
      return res.status(401).json({ error: "Not logged in." });
    }
    const user = db
      .prepare("SELECT email, is_admin, email_verified FROM users WHERE id = ?")
      .get(req.user.sub);
    if (!user) {
      return res.status(401).json({ error: "Not logged in." });
    }
    res.json({ email: user.email, isAdmin: !!user.is_admin, emailVerified: !!user.email_verified });
  });

  router.post("/verify-email", (req, res) => {
    const { token } = req.body || {};
    if (!token) {
      return res.status(400).json({ error: "Missing token." });
    }
    const row = consumeToken(token, "verify_email");
    if (!row) {
      return res.status(400).json({ error: "This verification link is invalid or has expired." });
    }
    db.prepare("UPDATE users SET email_verified = 1 WHERE id = ?").run(row.user_id);
    res.json({ ok: true });
  });

  router.post("/resend-verification", requireAuth, (req, res) => {
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.sub);
    if (!user) {
      return res.status(401).json({ error: "Not logged in." });
    }
    if (user.email_verified) {
      return res.json({ ok: true, alreadyVerified: true });
    }
    const verifyToken = createToken(user.id, "verify_email", VERIFY_TTL_MS);
    sendVerificationEmail(user.email, `${clientUrl}/verify-email.html?token=${verifyToken}`);
    res.json({ ok: true });
  });

  router.post("/forgot-password", (req, res) => {
    const { email } = req.body || {};
    if (email) {
      const user = db.prepare("SELECT * FROM users WHERE email = ?").get(String(email).toLowerCase());
      if (user) {
        const resetToken = createToken(user.id, "reset_password", RESET_TTL_MS);
        sendPasswordResetEmail(user.email, `${clientUrl}/reset-password.html?token=${resetToken}`);
      }
    }
    // Always return the same response so this endpoint can't be used to test
    // which emails have an account.
    res.json({ ok: true, message: "If that email has an account, a reset link is on its way." });
  });

  router.post("/reset-password", async (req, res) => {
    const { token, password } = req.body || {};
    if (!token || !password) {
      return res.status(400).json({ error: "Missing token or password." });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }
    const row = consumeToken(token, "reset_password");
    if (!row) {
      return res.status(400).json({ error: "This reset link is invalid or has expired." });
    }
    const passwordHash = await hashPassword(password);
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, row.user_id);
    res.json({ ok: true });
  });

  return router;
};
