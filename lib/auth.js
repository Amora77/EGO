const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_COOKIE = "ego_token";

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: 7 * 24 * 60 * 60 * 1000
};

function isConfigured() {
  return !!JWT_SECRET;
}

function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, isAdmin: !!user.is_admin },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

// Populates req.user from the auth cookie, if present and valid. Always calls
// next() — routes that require a logged-in user check req.user themselves via
// requireAdmin (or their own check), so a missing/invalid token is not an error.
function attachUser(req, res, next) {
  req.user = null;
  const token = req.cookies && req.cookies[TOKEN_COOKIE];
  if (token && JWT_SECRET) {
    try {
      req.user = jwt.verify(token, JWT_SECRET);
    } catch {
      req.user = null;
    }
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!isConfigured()) {
    return res
      .status(503)
      .json({ error: "Admin auth is not configured. Set JWT_SECRET on the server." });
  }
  if (!req.user || !req.user.isAdmin) {
    return res.status(401).json({ error: "Admin login required." });
  }
  next();
}

function requireAuth(req, res, next) {
  if (!isConfigured()) {
    return res.status(503).json({ error: "Auth is not configured. Set JWT_SECRET on the server." });
  }
  if (!req.user) {
    return res.status(401).json({ error: "Login required." });
  }
  next();
}

module.exports = {
  TOKEN_COOKIE,
  COOKIE_OPTS,
  isConfigured,
  hashPassword,
  verifyPassword,
  signToken,
  attachUser,
  requireAdmin,
  requireAuth
};
