// backend/utils/polar.js
// Gọi thẳng REST API của Polar (không dùng SDK: SDK mới là ESM và đổi version theo ngày,
// còn backend của bạn là CommonJS). Hai việc cần làm:
//   1) tạo checkout session  -> khách trả tiền trên trang của Polar
//   2) xác thực webhook      -> Polar báo "order.paid" về server
const crypto = require('crypto');

const BASE_URL = () =>
  process.env.POLAR_SERVER === 'production' ? 'https://api.polar.sh' : 'https://sandbox-api.polar.sh';

const WEBHOOK_TOLERANCE_SECONDS = 300;

async function polarFetch(path, options = {}) {
  const res = await fetch(`${BASE_URL()}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.POLAR_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* không phải JSON */ }
  if (!res.ok) {
    const detail = typeof data?.detail === 'string' ? data.detail : JSON.stringify(data?.detail ?? text).slice(0, 300);
    const err = new Error(`Polar API ${res.status}: ${detail}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/**
 * Tạo checkout cho 1 sản phẩm. metadata sẽ được Polar chép sang order nên webhook biết đơn nào.
 * successUrl có thể chứa {CHECKOUT_ID} - Polar tự thay bằng id thật.
 */
async function createCheckout({ productId, successUrl, email, metadata }) {
  const body = { products: [productId], success_url: successUrl, metadata };
  if (email) body.customer_email = email;
  return polarFetch('/v1/checkouts/', { method: 'POST', body: JSON.stringify(body) });
}

async function getCheckout(checkoutId) {
  return polarFetch(`/v1/checkouts/${encodeURIComponent(checkoutId)}`);
}

// Polar ký theo chuẩn Standard Webhooks. SDK chính thức thử 2 kiểu khóa nên ta cũng làm vậy:
//  (1) cả chuỗi secret dùng làm khóa thô  (2) phần sau "whsec_" giải mã base64.
function candidateKeys(secret) {
  const keys = [Buffer.from(secret, 'utf8')];
  const rest = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(rest)) {
    const decoded = Buffer.from(rest, 'base64');
    if (decoded.length > 0 && !decoded.equals(keys[0])) keys.push(decoded);
  }
  return keys;
}

/**
 * Kiểm tra chữ ký webhook. rawBody phải là Buffer/chuỗi GỐC chưa qua JSON.parse.
 * Trả về object sự kiện đã parse, hoặc ném lỗi nếu chữ ký sai / quá hạn.
 */
function verifyWebhook(rawBody, headers, secret, nowSeconds = Date.now() / 1000) {
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody ?? '');
  const id = headers['webhook-id'];
  const timestamp = headers['webhook-timestamp'];
  const signatureHeader = headers['webhook-signature'];
  if (!secret) throw new Error('Thiếu POLAR_WEBHOOK_SECRET');
  if (!id || !timestamp || !signatureHeader) throw new Error('Thiếu header webhook');

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) throw new Error('Timestamp không hợp lệ');
  if (Math.abs(nowSeconds - ts) > WEBHOOK_TOLERANCE_SECONDS) throw new Error('Webhook quá hạn');

  const signedContent = `${id}.${Math.floor(ts)}.${body}`;
  const expected = candidateKeys(secret).map((key) =>
    crypto.createHmac('sha256', key).update(signedContent).digest()
  );

  for (const part of String(signatureHeader).split(' ')) {
    const [version, sig] = part.split(',', 2);
    if (version !== 'v1' || !sig) continue;
    const received = Buffer.from(sig, 'base64');
    if (expected.some((e) => e.length === received.length && crypto.timingSafeEqual(e, received))) {
      return JSON.parse(body);
    }
  }
  throw new Error('Chữ ký webhook không khớp');
}

module.exports = { createCheckout, getCheckout, verifyWebhook, BASE_URL };