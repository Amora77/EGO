const express = require("express");
const { sendContactMessage } = require("../lib/email");

const MAX_NAME_LENGTH = 100;
const MAX_MESSAGE_LENGTH = 2000;

// Same tightened pattern used for COD email validation in routes/orders.js —
// keeps HTML-significant characters from passing as a valid-looking address.
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

module.exports = function createContactRouter({ limiter } = {}) {
  const router = express.Router();
  const rateLimiter = limiter || ((req, res, next) => next());

  router.post("/contact", rateLimiter, async (req, res) => {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim();
    const message = String(req.body.message || "").trim();

    if (!name || !email || !message) {
      return res.status(400).json({ error: "Please fill in your name, email, and message." });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }
    if (name.length > MAX_NAME_LENGTH || message.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ error: "Your name or message is too long." });
    }

    const result = await sendContactMessage({ name, email, message });

    if (result.sent) {
      return res.json({ ok: true });
    }

    if (result.reason === "not_configured") {
      // Truthful fallback: never tell the customer their message was sent
      // when there's no email transport actually configured to send it.
      // No SMTP/env details reach this response — just a plain alternative.
      return res.status(503).json({
        error: "We can't accept messages through this form right now. Please email us directly at hello@wearego.com."
      });
    }

    // A real send was attempted and failed (e.g. the SMTP provider rejected
    // it) — logged server-side in sendContactMessage; the customer only
    // ever sees a generic, safe message, never the underlying error.
    return res.status(500).json({ error: "Something went wrong sending your message. Please try again." });
  });

  return router;
};
