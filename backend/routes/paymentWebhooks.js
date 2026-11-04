// backend/routes/paymentWebhooks.js
// Các địa chỉ CÔNG KHAI do VNPay / Polar gọi vào (không có token đăng nhập).
// Mount TRƯỚC express.json():   app.use('/webhooks', paymentWebhooks);
// (Polar cần BODY GỐC để kiểm tra chữ ký, nên route của Polar tự đọc body dạng raw.)
//
// An toàn nhờ 3 lớp: kiểm tra chữ ký, đối chiếu số tiền với đơn trong database, và chỉ cộng credits
// đúng MỘT lần cho mỗi đơn (credits.markOrderPaid), dù cổng gọi lại bao nhiêu lần.
const express = require('express');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const credits = require('../utils/credits');
const vnpay = require('../utils/vnpay');
const polar = require('../utils/polar');
const { getPackage } = require('../config/pricing');
const { frontendUrl } = require('../utils/paymentHelpers');

const router = express.Router();
const isId = (v) => mongoose.isValidObjectId(v);
const backToApp = (res, provider, orderId, status) =>
  res.redirect(`${frontendUrl()}/?payment=${provider}&order=${encodeURIComponent(orderId || '')}&status=${status}`);

/* ================================ VNPay ================================ */

// IPN: VNPay (máy chủ) gọi để báo kết quả. Đây là nguồn đáng tin cậy nhất.
router.get('/vnpay/ipn', async (req, res) => {
  try {
    const { valid, params } = vnpay.verifyQuery(req.query);
    if (!valid) return res.json({ RspCode: '97', Message: 'Invalid signature' });
    if (!isId(params.vnp_TxnRef)) return res.json({ RspCode: '01', Message: 'Order not found' });

    const order = await Order.findOne({ _id: params.vnp_TxnRef, provider: 'vnpay' });
    if (!order) return res.json({ RspCode: '01', Message: 'Order not found' });
    if (Number(params.vnp_Amount) !== order.amount * 100) return res.json({ RspCode: '04', Message: 'Invalid amount' });
    if (order.status !== 'pending') return res.json({ RspCode: '02', Message: 'Order already confirmed' });

    if (vnpay.isSuccess(params)) await credits.markOrderPaid(order._id, params.vnp_TransactionNo || '');
    else await credits.markOrderFailed(order._id, `VNPay code ${params.vnp_ResponseCode}`);
    res.json({ RspCode: '00', Message: 'Confirm Success' });
  } catch (err) {
    console.error('[webhooks/vnpay/ipn]', err);
    res.json({ RspCode: '99', Message: 'Unknown error' });
  }
});

// Return URL: trình duyệt của khách được VNPay đưa về đây, rồi ta đưa tiếp về trang web.
// Khi chạy localhost, IPN không tới được nên ta cũng xử lý kết quả ở đây (an toàn vì đã kiểm tra chữ ký
// và cập nhật đơn một lần duy nhất).
router.get('/vnpay/return', async (req, res) => {
  let status = 'invalid';
  let orderId = '';
  try {
    const { valid, params } = vnpay.verifyQuery(req.query);
    orderId = params.vnp_TxnRef || '';
    if (valid && isId(orderId)) {
      const order = await Order.findOne({ _id: orderId, provider: 'vnpay' });
      if (order && Number(params.vnp_Amount) === order.amount * 100) {
        if (vnpay.isSuccess(params)) {
          await credits.markOrderPaid(order._id, params.vnp_TransactionNo || '');
          status = 'success';
        } else {
          await credits.markOrderFailed(order._id, `VNPay code ${params.vnp_ResponseCode}`);
          status = params.vnp_ResponseCode === '24' ? 'cancelled' : 'failed'; // 24 = khách hủy giao dịch
        }
      }
    }
  } catch (err) {
    console.error('[webhooks/vnpay/return]', err);
  }
  backToApp(res, 'vnpay', orderId, status);
});

/* ================================ Polar ================================ */

router.post('/polar', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  let event;
  try {
    event = polar.verifyWebhook(req.body, req.headers, process.env.POLAR_WEBHOOK_SECRET);
  } catch (err) {
    console.warn('[webhooks/polar] từ chối:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  try {
    if (event.type === 'order.paid') {
      const data = event.data || {};
      const orderId = data.metadata?.orderId;
      if (isId(orderId)) {
        const order = await Order.findOne({ _id: orderId, provider: 'polar' });
        if (order) {
          // đối chiếu sản phẩm đã mua với gói của đơn (phòng cấu hình nhầm product)
          const expected = process.env[getPackage(order.packageId)?.polarProductEnv];
          if (expected && data.product_id && data.product_id !== expected) {
            console.warn('[webhooks/polar] product không khớp đơn', orderId);
          } else {
            await credits.markOrderPaid(order._id, data.checkout_id || data.id || '');
          }
        }
      }
    }
    res.json({ received: true }); // các loại sự kiện khác: ghi nhận và bỏ qua
  } catch (err) {
    console.error('[webhooks/polar]', err);
    res.status(500).json({ error: 'Processing error' }); // 5xx -> Polar sẽ thử gửi lại
  }
});

module.exports = router;