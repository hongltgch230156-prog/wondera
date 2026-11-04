// backend/models/Transaction.js
// Sổ cái credits: mỗi lần cộng/trừ là MỘT dòng, không bao giờ sửa số cũ.
// `key` là khóa duy nhất -> cùng một sự kiện (webhook gọi lại, bấm đúp...) không thể ghi 2 lần.
const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    key: { type: String, required: true, unique: true }, // bonus:<userId> | purchase:<orderId> | usage:<id> | refund:<usageKey>
    type: { type: String, enum: ['bonus', 'purchase', 'usage', 'refund'], required: true },
    delta: { type: Number, required: true },              // +5, -1 ...
    balanceAfter: { type: Number },
    note: { type: String, default: '' },
    refunded: { type: Boolean, default: false },          // chỉ dùng cho type 'usage': đã hoàn credit chưa
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

transactionSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.models.Transaction || mongoose.model('Transaction', transactionSchema);