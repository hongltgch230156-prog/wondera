// backend/models/Order.js
// Một lần thanh toán mua gói credits. Số tiền và số credits do SERVER ghi, không lấy từ client.
const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    packageId: { type: String, required: true },
    credits: { type: Number, required: true },
    provider: { type: String, enum: ['vnpay', 'polar', 'mock'], required: true },
    currency: { type: String, enum: ['VND', 'USD'], required: true },
    // VND: số đồng. USD: số cent (199 = $1.99)
    amount: { type: Number, required: true },
    status: { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending', index: true },
    // VNPay: vnp_TransactionNo   |   Polar: id của checkout session
    providerRef: { type: String, default: '' },
    failReason: { type: String, default: '' },
    paidAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Order || mongoose.model('Order', orderSchema);