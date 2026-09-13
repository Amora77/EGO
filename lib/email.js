const nodemailer = require("nodemailer");

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM } = process.env;

const transporter = SMTP_HOST
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT) || 587,
      secure: Number(SMTP_PORT) === 465,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined
    })
  : null;

function formatPrice(cents) {
  return "EGP " + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Shared send path: no-op if SMTP isn't configured, and a failed send is
// only ever logged, never thrown — callers (webhook, signup, password reset)
// must not have their own response derailed by an email provider hiccup.
async function send(to, subject, text) {
  if (!transporter || !to) return;
  try {
    await transporter.sendMail({ from: EMAIL_FROM || SMTP_USER, to, subject, text });
  } catch (err) {
    console.error(`Failed to send "${subject}" email:`, err.message);
  }
}

async function sendOrderConfirmation(order) {
  const itemLines = order.items
    .map((i) => `${i.qty} x ${i.productName} — ${formatPrice(i.unitAmount * i.qty)}`)
    .join("\n");
  // order.amountTotal already includes the shipping fee (set by the caller);
  // the subtotal/shipping split shown here is derived from it rather than
  // passed in separately, so this function's signature doesn't need to
  // change and the fee can't drift from what was actually charged.
  const itemsSubtotal = order.items.reduce((sum, i) => sum + i.unitAmount * i.qty, 0);
  const shippingFee = order.amountTotal - itemsSubtotal;
  const paymentNote =
    order.paymentMethod === "cod" ? "\n\nPay in cash when your order is delivered." : "";
  await send(
    order.email,
    "Your EGO order is confirmed",
    `Thanks for your order!\n\n${itemLines}\n\nSubtotal: ${formatPrice(itemsSubtotal)}\nShipping: ${formatPrice(shippingFee)}\nTotal: ${formatPrice(order.amountTotal)}${paymentNote}\n\n— EGO`
  );
}

async function sendVerificationEmail(email, verifyUrl) {
  await send(
    email,
    "Verify your EGO account",
    `Welcome to EGO! Confirm your email address by opening this link:\n\n${verifyUrl}\n\nThis link expires in 7 days.`
  );
}

async function sendPasswordResetEmail(email, resetUrl) {
  await send(
    email,
    "Reset your EGO password",
    `We received a request to reset your EGO password. Open this link to choose a new one:\n\n${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, you can ignore this email.`
  );
}

module.exports = { sendOrderConfirmation, sendVerificationEmail, sendPasswordResetEmail };
