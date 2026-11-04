let ctx = { apiBase: "", getToken: () => null };

const state = {
  loaded: false,
  credits: null,          // null = chưa biết
  freeCredits: 2,
  costs: {},
  history: [],
  packages: [],           // [{ id, label, credits, vnd, usd, popular }]
  providers: {},          // { vnpay, polar }
  testMode: true,
};
const listeners = new Set();
const emit = () => listeners.forEach((cb) => { try { cb(state); } catch (e) { console.error(e); } });

export function configureBilling({ apiBase = "", getToken = () => null } = {}) {
  ctx = { apiBase, getToken };
}

async function call(path, options = {}) {
  const res = await fetch(`${ctx.apiBase}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ctx.getToken() || ""}`,
      ...(options.headers || {}),
    },
  });
  let data = null;
  try { data = await res.json(); } catch { /* không có body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ------------------------------------------------------------------ */
/*  Trạng thái ví                                                      */
/* ------------------------------------------------------------------ */
export const getWallet = () => state;

/** Tải số dư + lịch sử + bảng giá từ server rồi báo cho mọi nơi đang lắng nghe. */
export async function fetchWallet() {
  if (!ctx.getToken()) return state; // chưa đăng nhập: không gọi API (tránh bị 401 -> tự đăng xuất)
  try {
    const data = await call("/api/payments/wallet");
    Object.assign(state, data, { loaded: true });
    emit();
  } catch (err) {
    console.warn("[Billing] Could not load wallet:", err.message);
  }
  return state;
}

/** Đăng ký nhận thông báo khi ví đổi. Gọi ngay 1 lần nếu đã có dữ liệu. Trả về hàm hủy đăng ký. */
export function onWalletChange(cb) {
  listeners.add(cb);
  if (state.loaded) cb(state);
  return () => listeners.delete(cb);
}

/* ------------------------------------------------------------------ */
/*  Tiện ích                                                           */
/* ------------------------------------------------------------------ */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtVnd = (v) => `${new Intl.NumberFormat("vi-VN").format(v)} ₫`;
const fmtUsd = (v) => `$${Number(v).toFixed(2)}`;

let toastTimer = 0;
export function toast(message, type = "info", duration = 4500) {
  let el = document.querySelector(".bill-toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "bill-toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.dataset.type = type;
  el.classList.add("is-show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-show"), duration);
}

const ICON = {
  close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>`,
  coin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5c0-1 1.1-1.7 2.5-1.7s2.5.7 2.5 1.7-1.1 1.6-2.5 1.9-2.5.9-2.5 2 1.1 1.7 2.5 1.7 2.5-.7 2.5-1.7"/></svg>`,
};

/** Hết credits: chỉ báo cho người dùng, việc mua thêm làm ở nút Account (góc phải trên). */
export function notifyOutOfCredits() {
  toast("You’ve run out of credits. Buy more from the Account button (top right) to keep creating.", "error", 6500);
}

/* ------------------------------------------------------------------ */
/*  Hộp thoại mua credits                                              */
/* ------------------------------------------------------------------ */
const PROVIDER_META = {
  vnpay: { label: "VNPay", sub: "VND · ATM / QR", currency: "vnd" },
  polar: { label: "Card", sub: "USD · Visa / Mastercard", currency: "usd" },
};

const TEST_HINTS = {
  vnpay: `Test mode: choose bank <b>NCB</b> · card <b>9704198526191432198</b> · name <b>NGUYEN VAN A</b> · issued <b>07/15</b> · OTP <b>123456</b>. No real money is charged.`,
  polar: `Test mode: card <b>4242 4242 4242 4242</b> · any future expiry · any CVC. No real money is charged.`,
};

let modal = null;
const sel = { provider: null, pkg: null };

function ensureModal() {
  if (modal) return modal;
  const root = document.createElement("div");
  root.className = "bill-root";
  root.innerHTML = `
    <div class="bill-backdrop"></div>
    <section class="bill-card" role="dialog" aria-modal="true" aria-labelledby="bill-title">
      <header class="bill-head">
        <div>
          <h2 id="bill-title">Buy credits</h2>
          <p class="bill-balance"></p>
        </div>
        <button class="account-close bill-close" type="button" aria-label="Close">${ICON.close}</button>
      </header>
      <p class="bill-banner" hidden></p>
      <div class="bill-providers" role="tablist"></div>
      <div class="bill-packages"></div>
      <p class="bill-hint"></p>
      <p class="bill-error" role="alert" hidden></p>
      <button class="bill-pay" type="button" disabled>Pay</button>
      <p class="bill-foot">1 credit = 1 Magic Wand 3D object. Credits never expire. If a generation fails, your credit is refunded automatically.</p>
    </section>`;
  document.body.appendChild(root);

  const close = () => closeBuyCredits();
  root.querySelector(".bill-backdrop").addEventListener("click", close);
  root.querySelector(".bill-close").addEventListener("click", close);
  root.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
  root.querySelector(".bill-providers").addEventListener("click", (e) => {
    const b = e.target.closest("[data-provider]");
    if (b) { sel.provider = b.dataset.provider; render(); }
  });
  root.querySelector(".bill-packages").addEventListener("click", (e) => {
    const b = e.target.closest("[data-pkg]");
    if (b) { sel.pkg = b.dataset.pkg; render(); }
  });
  root.querySelector(".bill-pay").addEventListener("click", startCheckout);
  modal = root;
  onWalletChange(() => { if (root.classList.contains("is-open")) render(); });
  return root;
}

function render() {
  const root = modal;
  const enabled = Object.keys(PROVIDER_META).filter((p) => state.providers[p]);
  if (!enabled.includes(sel.provider)) sel.provider = enabled[0] || null;
  if (!state.packages.some((p) => p.id === sel.pkg)) sel.pkg = (state.packages.find((p) => p.popular) || state.packages[0] || {}).id || null;

  root.querySelector(".bill-balance").innerHTML =
    state.credits === null ? "" : `You have <b>${state.credits}</b> credit${state.credits === 1 ? "" : "s"}`;

  root.querySelector(".bill-providers").innerHTML = !state.loaded
    ? `<p class="bill-hint">Loading…</p>`
    : enabled.length
    ? enabled.map((p) => `
        <button type="button" class="bill-provider${p === sel.provider ? " is-active" : ""}" data-provider="${p}" role="tab" aria-selected="${p === sel.provider}">
          <strong>${PROVIDER_META[p].label}</strong><span>${PROVIDER_META[p].sub}</span>
        </button>`).join("")
    : `<p class="bill-error">No payment method is available right now.</p>`;

  const cur = sel.provider ? PROVIDER_META[sel.provider].currency : "vnd";
  const price = (p) => (cur === "usd" ? fmtUsd(p.usd) : fmtVnd(p.vnd));
  root.querySelector(".bill-packages").innerHTML = state.packages.map((p) => `
    <button type="button" class="bill-pkg${p.id === sel.pkg ? " is-active" : ""}" data-pkg="${esc(p.id)}">
      ${p.popular ? `<em class="bill-pop">Popular</em>` : ""}
      <span class="bill-pkg-credits">${p.credits}</span>
      <span class="bill-pkg-unit">credits</span>
      <span class="bill-pkg-name">${esc(p.label)}</span>
      <span class="bill-pkg-price">${price(p)}</span>
    </button>`).join("");

  const hint = root.querySelector(".bill-hint");
  hint.innerHTML = state.testMode && sel.provider ? TEST_HINTS[sel.provider] || "" : "";
  hint.hidden = !hint.innerHTML;

  const pkg = state.packages.find((p) => p.id === sel.pkg);
  const pay = root.querySelector(".bill-pay");
  pay.disabled = !(pkg && sel.provider) || pay.dataset.busy === "1";
  pay.textContent = pay.dataset.busy === "1"
    ? "Redirecting…"
    : pkg && sel.provider ? `Pay ${price(pkg)} with ${PROVIDER_META[sel.provider].label}` : "Pay";
}

async function startCheckout() {
  const pay = modal.querySelector(".bill-pay");
  const err = modal.querySelector(".bill-error");
  err.hidden = true;
  pay.dataset.busy = "1";
  render();
  try {
    const data = await call("/api/payments/checkout", {
      method: "POST",
      body: JSON.stringify({ packageId: sel.pkg, provider: sel.provider }),
    });
    window.location.assign(data.url); // sang trang thanh toán của cổng
  } catch (e) {
    pay.dataset.busy = "0";
    err.textContent = e.message || "Could not start the payment.";
    err.hidden = false;
    render();
  }
}

/** Mở hộp thoại mua credits. reason: "out-of-credits" hiện thêm dòng giải thích. */
export async function openBuyCredits({ reason } = {}) {
  const root = ensureModal();
  const banner = root.querySelector(".bill-banner");
  banner.hidden = reason !== "out-of-credits";
  banner.textContent = "You’ve run out of Magic Wand credits. Top up to keep creating.";
  root.querySelector(".bill-error").hidden = true;
  root.querySelector(".bill-pay").dataset.busy = "0";
  root.classList.remove("is-closing");
  root.classList.add("is-open");
  render();
  root.querySelector(".bill-close").focus({ preventScroll: true });
  if (!state.loaded || !state.packages.length) { await fetchWallet(); if (root.classList.contains("is-open")) render(); }
  else fetchWallet();
}

export function closeBuyCredits() {
  if (!modal || !modal.classList.contains("is-open")) return;
  modal.classList.add("is-closing");
  setTimeout(() => modal.classList.remove("is-open", "is-closing"), 180);
}

/* ------------------------------------------------------------------ */
/*  Khách quay về từ cổng thanh toán:  /?payment=vnpay&order=...&status=success  */
/* ------------------------------------------------------------------ */
export async function handlePaymentReturn() {
  const url = new URL(window.location.href);
  const provider = url.searchParams.get("payment");
  const orderId = url.searchParams.get("order");
  const status = url.searchParams.get("status");
  if (!provider) return;

  // dọn thanh địa chỉ để F5 không xử lý lại
  ["payment", "order", "status", "checkout_id"].forEach((k) => url.searchParams.delete(k));
  window.history.replaceState({}, "", url.pathname + (url.search || "") + url.hash);

  if (status === "cancelled") { toast("Payment cancelled. No credits were charged.", "info"); return; }
  if (status === "invalid") { toast("We couldn’t verify that payment. If you were charged, contact support.", "error"); return; }
  if (!orderId) return;

  // Hỏi server kết quả thật của đơn (Polar có thể cần vài giây; VNPay đã xong sẵn)
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const data = await call(`/api/payments/orders/${encodeURIComponent(orderId)}/refresh`, { method: "POST" });
      if (data.order.status === "paid") {
        await fetchWallet();
        toast(`Payment successful! +${data.order.credits} credits added.`, "success");
        return;
      }
      if (data.order.status === "failed") {
        await fetchWallet();
        toast("Payment was not completed. No credits were charged.", "error");
        return;
      }
    } catch (err) {
      console.warn("[Billing] refresh failed:", err.message);
    }
    if (attempt === 0) toast("Confirming your payment…", "info");
    await new Promise((r) => setTimeout(r, 2500));
  }
  await fetchWallet();
  toast("Your payment is still being processed. Credits will appear shortly.", "info");
}

export { ICON as BILLING_ICONS };