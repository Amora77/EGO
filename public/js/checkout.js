async function startCheckout() {
  const btn = document.getElementById("checkout-btn");
  const msg = document.getElementById("checkout-msg");
  const lines = cartLines();

  if (!lines.length) return;

  btn.disabled = true;
  btn.textContent = "Redirecting to checkout...";
  msg.textContent = "";

  try {
    const response = await fetch("/create-checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: lines.map((l) => ({
          productId: l.productId,
          size: l.size,
          qty: l.qty
        }))
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Unable to start checkout.");
    }

    window.location.href = data.url;
  } catch (err) {
    msg.textContent = err.message || "Something went wrong. Please try again.";
    btn.disabled = false;
    btn.textContent = "Checkout";
  }
}
