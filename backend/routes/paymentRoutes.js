// backend/routes/paymentRoutes.js
// Mount SAU `app.use('/api', requireAuth)`:   app.use('/api/payments', paymentRoutes);
//   GET  /api/payments/wallet            số dư + lịch sử + danh sách gói + cổng đang bật
//   POST /api/payments/checkout          { packageId, provider } -> { url, orderId }  (chuyển khách sang url)
//   POST /api/payments/orders/:id/refresh  hỏi lại kết quả đơn (dùng khi khách quay về từ cổng thanh toán)
const express = require('express');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const credits = require('../utils/credits');
const vnpay = require('../utils/vnpay');
const polar = require('../utils/polar');
const { frontendUrl, backendUrl } = require('../utils/paymentHelpers');
const { FREE_CREDITS, COSTS, getPackage, publicPackages, providerStatus } = require('../config/pricing');

const router = express.Router();

const MAX_PENDING_PER_HOUR = 20; // chặn spam tạo đơn

const orderJson = (o) => ({
  id: o._id, status: o.status, provider: o.provider, packageId: o.packageId, credits: o.credits,
  currency: o.currency, amount: o.amount,
});

router.get('/wallet', async (req, res) => {
  try {
    const [balance, history] = await Promise.all([
      credits.getBalance(req.user._id),
      credits.history(req.user._id, 20),
    ]);
    res.json({
      credits: balance,
      freeCredits: FREE_CREDITS,
      costs: COSTS,
      history,
      packages: publicPackages(),
      providers: providerStatus(),
      // Hiện gợi ý thẻ test trong giao diện khi chưa chuyển sang môi trường thật
      testMode: process.env.PAYMENT_LIVE !== 'true',
    });
  } catch (err) {
    console.error('[payments/wallet]', err);
    res.status(500).json({ error: 'Failed to fetch wallet information.' });
  }
});

router.post('/checkout', async (req, res) => {
  const provider = String(req.body?.provider || '');
  const pkg = getPackage(String(req.body?.packageId || ''));
  if (!pkg) return res.status(400).json({ error: 'Invalid package.' });
  if (!providerStatus()[provider]) return res.status(400).json({ error: 'This payment provider is not available.' });

  try {
    const recent = await Order.countDocuments({
      user: req.user._id, createdAt: { $gt: new Date(Date.now() - 3600 * 1000) },
    });
    if (recent >= MAX_PENDING_PER_HOUR) {
      return res.status(429).json({ error: 'You have created too many orders, please try again later.' });
    }

    // Số tiền + số credits do SERVER quyết định từ bảng giá, không nhận từ client
    const currency = provider === 'polar' ? 'USD' : 'VND';
    const amount = provider === 'polar' ? Math.round(pkg.usd * 100) : pkg.vnd;
    const order = await Order.create({
      user: req.user._id, packageId: pkg.id, credits: pkg.credits, provider, currency, amount,
    });

    let url;
    try {
      if (provider === 'vnpay') {
        url = vnpay.buildPaymentUrl({
          amountVnd: pkg.vnd,
          txnRef: String(order._id),
          orderInfo: `Thanh toan goi ${pkg.credits} credits`,
          ipAddr: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
          returnUrl: `${backendUrl()}/webhooks/vnpay/return`,
        });
      } else if (provider === 'polar') {
        const productId = process.env[pkg.polarProductEnv];
        if (!productId) throw new Error(`Thiếu biến môi trường ${pkg.polarProductEnv}`);
        const checkout = await polar.createCheckout({
          productId,
          email: req.user.email,
          successUrl: `${frontendUrl()}/?payment=polar&order=${order._id}&checkout_id={CHECKOUT_ID}`,
          metadata: { orderId: String(order._id), userId: String(req.user._id), packageId: pkg.id },
        });
        order.providerRef = checkout.id;
        await order.save();
        url = checkout.url;
      } else {
        throw new Error('This payment provider is not supported'); // không xảy ra: provider đã được kiểm tra ở trên
      }
    } catch (err) {
      console.error(`[payments/checkout:${provider}]`, err.message);
      await credits.markOrderFailed(order._id, err.message);
      return res.status(502).json({ error: 'Failed to create payment session, please try again later.' });
    }
    res.json({ url, orderId: order._id });
  } catch (err) {
    console.error('[payments/checkout]', err);
    res.status(500).json({ error: 'Failed to create payment session, please try again later.' });
  }
});

router.post('/orders/:id/refresh', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Order not found.' });
    let order = await Order.findOne({ _id: req.params.id, user: req.user._id });
    if (!order) return res.status(404).json({ error: 'Order not found.' });

    // Polar: không phụ thuộc webhook (localhost không nhận được webhook) -> tự hỏi Polar kết quả
    if (order.status === 'pending' && order.provider === 'polar' && order.providerRef) {
      try {
        const checkout = await polar.getCheckout(order.providerRef);
        if (checkout.metadata?.orderId === String(order._id)) {
          if (checkout.status === 'succeeded') await credits.markOrderPaid(order._id, checkout.id);
          else if (checkout.status === 'failed' || checkout.status === 'expired') {
            await credits.markOrderFailed(order._id, `Polar checkout ${checkout.status}`);
          }
        }
      } catch (err) {
        console.error('[payments/refresh:polar]', err.message);
      }
      order = await Order.findById(order._id);
    }
    res.json({ order: orderJson(order), credits: await credits.getBalance(req.user._id) });
  } catch (err) {
    console.error('[payments/refresh]', err);
    res.status(500).json({ error: 'Failed to refresh order status, please try again later.' });
  }
});

module.exports = router;