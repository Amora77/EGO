// Escapes a value for safe insertion into HTML via innerHTML. Must be
// applied to every customer-controlled string (shipping name/address, item
// names) before it's interpolated into a template — this page renders the
// account owner's own order data, which originated from a checkout request.
function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]
  );
}

document.addEventListener("DOMContentLoaded", () => {
  const guestView = document.getElementById("guest-view");
  const accountView = document.getElementById("account-view");
  if (!guestView || !accountView) return;

  const loginForm = document.getElementById("login-form");
  const signupForm = document.getElementById("signup-form");
  const forgotForm = document.getElementById("forgot-form");
  const authHeading = document.getElementById("auth-heading");
  const showSignup = document.getElementById("show-signup");
  const showLogin = document.getElementById("show-login");
  const showForgot = document.getElementById("show-forgot");
  const showLoginFromForgot = document.getElementById("show-login-from-forgot");
  const showSignupWrap = document.getElementById("show-signup-wrap");
  const showLoginWrap = document.getElementById("show-login-wrap");
  const showLoginFromForgotWrap = document.getElementById("show-login-from-forgot-wrap");

  function showOnly(formToShow, heading) {
    [loginForm, signupForm, forgotForm].forEach((f) => (f.style.display = "none"));
    [showSignupWrap, showLoginWrap, showLoginFromForgotWrap].forEach((w) => (w.style.display = "none"));
    formToShow.style.display = "block";
    authHeading.textContent = heading;
  }

  showSignup.addEventListener("click", (e) => {
    e.preventDefault();
    showOnly(signupForm, "Create Account");
    showLoginWrap.style.display = "block";
  });

  showLogin.addEventListener("click", (e) => {
    e.preventDefault();
    showOnly(loginForm, "Log In");
    showSignupWrap.style.display = "block";
  });

  showForgot.addEventListener("click", (e) => {
    e.preventDefault();
    showOnly(forgotForm, "Reset Password");
    showLoginFromForgotWrap.style.display = "block";
  });

  showLoginFromForgot.addEventListener("click", (e) => {
    e.preventDefault();
    showOnly(loginForm, "Log In");
    showSignupWrap.style.display = "block";
  });

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = document.getElementById("login-msg");
    msg.textContent = "";
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: document.getElementById("login-email").value,
          password: document.getElementById("login-password").value
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed.");
      await showAccountView();
    } catch (err) {
      msg.textContent = err.message;
    }
  });

  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = document.getElementById("signup-msg");
    msg.textContent = "";
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: document.getElementById("signup-email").value,
          password: document.getElementById("signup-password").value
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to create account.");
      await showAccountView();
    } catch (err) {
      msg.textContent = err.message;
    }
  });

  forgotForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = document.getElementById("forgot-msg");
    msg.style.color = "#111111";
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: document.getElementById("forgot-email").value })
      });
      const data = await res.json();
      msg.textContent = data.message || "If that email has an account, a reset link is on its way.";
    } catch {
      msg.style.color = "#c8102e";
      msg.textContent = "Something went wrong. Please try again.";
    }
  });

  document.getElementById("logout-btn").addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    guestView.style.display = "block";
    accountView.style.display = "none";
  });

  document.getElementById("resend-verification-btn").addEventListener("click", async (e) => {
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = "Sending...";
    try {
      await fetch("/api/auth/resend-verification", { method: "POST" });
      btn.textContent = "Sent!";
    } catch {
      btn.textContent = "Resend Email";
      btn.disabled = false;
    }
  });

  async function showAccountView() {
    const meRes = await fetch("/api/auth/me");
    if (!meRes.ok) {
      guestView.style.display = "block";
      accountView.style.display = "none";
      return;
    }

    const me = await meRes.json();
    guestView.style.display = "none";
    accountView.style.display = "block";
    document.getElementById("account-email").textContent = me.email;

    const verifyBanner = document.getElementById("verify-banner");
    verifyBanner.style.display = me.emailVerified ? "none" : "flex";

    const ordersRes = await fetch("/api/orders/me");
    const orders = await ordersRes.json();
    const list = document.getElementById("orders-list");

    if (!orders.length) {
      list.innerHTML = `<p style="color:#6b6b6b;">No orders yet.</p>`;
      return;
    }

    list.innerHTML = orders
      .map((o) => {
        const addr = o.shippingAddress;
        return `
        <div class="summary-box" style="margin-bottom:20px;">
          <h2 style="display:flex; justify-content:space-between; align-items:baseline;">
            <span>${o.orderNumber} &middot; ${new Date(o.createdAt).toLocaleDateString()}</span>
            <span style="font-size:12px; text-transform:uppercase; color:${o.status === "paid" || o.status === "delivered" ? "#111111" : "#6b6b6b"};">${o.status}</span>
          </h2>
          <div class="summary-row"><span>Payment</span><span>${o.paymentMethod === "cod" ? "Cash on Delivery" : "Card"}</span></div>
          ${o.items
            .map(
              (i) => `
            <div class="summary-row">
              <span>${i.qty} &times; ${escapeHtml(i.productName)}</span>
              <span>${formatPrice(i.unitAmount * i.qty)}</span>
            </div>
          `
            )
            .join("")}
          <div class="summary-row"><span>Subtotal</span><span>${formatPrice(o.subtotal || 0)}</span></div>
          <div class="summary-row"><span>Shipping</span><span>${formatPrice(o.shippingFee || 0)}</span></div>
          <div class="summary-row total"><span>Total</span><span>${formatPrice(o.amountTotal || 0)}</span></div>
          ${
            addr
              ? `<p style="font-size:13px; color:#6b6b6b; margin:12px 0 0;">
                  Delivering to: ${escapeHtml(addr.name)}, ${escapeHtml(addr.address.line1)}${addr.address.line2 ? ", " + escapeHtml(addr.address.line2) : ""}, ${escapeHtml(addr.address.city)}${addr.address.state ? ", " + escapeHtml(addr.address.state) : ""} ${escapeHtml(addr.address.postal_code)}, ${escapeHtml(addr.address.country)}
                </p>`
              : ""
          }
        </div>
      `;
      })
      .join("");
  }

  showAccountView();
});
