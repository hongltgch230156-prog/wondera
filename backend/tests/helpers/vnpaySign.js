// Tự ký dữ liệu giả lập "VNPay gọi về" theo đúng thuật toán của VNPay (độc lập với code dự án)
const crypto = require('crypto');

function signVnpay(params, secret = process.env.VNPAY_HASH_SECRET) {
  const q = Object.keys(params)
    .filter((k) => params[k] !== '' && params[k] != null)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k])).replace(/%20/g, '+')}`)
    .join('&');
  return { ...params, vnp_SecureHash: crypto.createHmac('sha512', secret).update(q, 'utf8').digest('hex') };
}

/** Dữ liệu một giao dịch VNPay thành công cho đơn {_id, amount} */
const vnpayCallback = (order, over = {}) => signVnpay({
  vnp_Amount: String(order.amount * 100),
  vnp_ResponseCode: '00',
  vnp_TransactionStatus: '00',
  vnp_TransactionNo: '14000001',
  vnp_TxnRef: String(order._id),
  vnp_TmnCode: process.env.VNPAY_TMN_CODE,
  ...over,
});

module.exports = { signVnpay, vnpayCallback };
