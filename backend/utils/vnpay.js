// backend/utils/vnpay.js
// Tích hợp VNPay (phiên bản 2.1.0) viết tay, không cần thư viện ngoài.
// Cách ký theo đúng code mẫu NodeJS của VNPay: sắp xếp tham số theo tên, mã hóa URL,
// rồi HMAC-SHA512 bằng vnp_HashSecret.
const crypto = require('crypto');

const PAY_URL = () => process.env.VNPAY_URL || 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';

const pad = (n) => String(n).padStart(2, '0');

/** yyyyMMddHHmmss theo giờ Việt Nam (GMT+7), đúng định dạng VNPay yêu cầu. */
function vnpDate(date = new Date()) {
  const t = new Date(date.getTime() + 7 * 3600 * 1000);
  return (
    `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}` +
    `${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}${pad(t.getUTCSeconds())}`
  );
}

/** Sắp xếp theo tên tham số, mã hóa key + value (khoảng trắng -> '+'), nối thành "a=1&b=2". */
function toSignedQuery(params) {
  return Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .map((k) => [encodeURIComponent(k), encodeURIComponent(String(params[k])).replace(/%20/g, '+')])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

function hmac(query, secret) {
  return crypto.createHmac('sha512', secret).update(Buffer.from(query, 'utf-8')).digest('hex');
}

/** "::1" / "::ffff:1.2.3.4" -> IPv4 dạng "127.0.0.1" / "1.2.3.4" */
function normalizeIp(raw) {
  let ip = String(raw || '').split(',')[0].trim();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '::1' || ip === '') ip = '127.0.0.1';
  return ip;
}

/**
 * Tạo URL chuyển khách sang trang thanh toán VNPay.
 * amountVnd là số đồng bình thường (49000); VNPay yêu cầu nhân 100 nên hàm này tự nhân.
 */
function buildPaymentUrl({ amountVnd, txnRef, orderInfo, ipAddr, returnUrl, locale = 'vn', expireMinutes = 15, now = new Date() }) {
  const params = {
    vnp_Version: '2.1.0',
    vnp_Command: 'pay',
    vnp_TmnCode: process.env.VNPAY_TMN_CODE,
    vnp_Amount: Math.round(amountVnd) * 100,
    vnp_CurrCode: 'VND',
    vnp_TxnRef: txnRef,
    vnp_OrderInfo: orderInfo,
    vnp_OrderType: 'other',
    vnp_Locale: locale === 'en' ? 'en' : 'vn',
    vnp_ReturnUrl: returnUrl,
    vnp_IpAddr: normalizeIp(ipAddr),
    vnp_CreateDate: vnpDate(now),
    vnp_ExpireDate: vnpDate(new Date(now.getTime() + expireMinutes * 60 * 1000)),
  };
  const query = toSignedQuery(params);
  const secureHash = hmac(query, process.env.VNPAY_HASH_SECRET);
  return `${PAY_URL()}?${query}&vnp_SecureHash=${secureHash}`;
}

/**
 * Kiểm tra chữ ký của dữ liệu VNPay gửi về (trang quay lại hoặc IPN).
 * Trả về { valid, params } - params là các vnp_* đã bỏ phần chữ ký.
 */
function verifyQuery(query) {
  const params = {};
  for (const [k, v] of Object.entries(query || {})) {
    if (k.startsWith('vnp_') && typeof v === 'string') params[k] = v;
  }
  const received = params.vnp_SecureHash;
  delete params.vnp_SecureHash;
  delete params.vnp_SecureHashType;
  if (!received || !process.env.VNPAY_HASH_SECRET) return { valid: false, params };

  const expected = hmac(toSignedQuery(params), process.env.VNPAY_HASH_SECRET);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(received).toLowerCase(), 'utf8');
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  return { valid, params };
}

/** Giao dịch thành công khi cả mã phản hồi và mã trạng thái giao dịch đều là "00". */
const isSuccess = (params) => params.vnp_ResponseCode === '00' && params.vnp_TransactionStatus === '00';

module.exports = { buildPaymentUrl, verifyQuery, isSuccess, vnpDate, normalizeIp };