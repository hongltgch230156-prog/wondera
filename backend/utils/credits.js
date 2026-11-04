// backend/utils/credits.js
// Toàn bộ logic số dư credits. Nguyên tắc:
//  - Số dư nằm ở User.credits, chỉ đổi bằng toán tử nguyên tử của MongoDB ($inc kèm điều kiện),
//    nên hai request cùng lúc không thể trừ lố hay trừ trùng.
//  - Mọi thay đổi đều ghi thêm 1 dòng vào sổ cái Transaction (khóa duy nhất -> không ghi trùng).
//  - "Claim rồi mới áp dụng": thao tác chỉ chạy được MỘT lần nhờ cập nhật có điều kiện
//    (đơn hàng pending -> paid, giao dịch usage chưa refunded -> refunded).
const crypto = require('crypto');
const User = require('../models/User');
const Order = require('../models/Order');
const Transaction = require('../models/Transaction');
const { FREE_CREDITS } = require('../config/pricing');

const AFTER = { returnDocument: 'after' }; // trả về tài liệu sau khi cập nhật

/** Khởi tạo ví lần đầu: tặng FREE_CREDITS. Chạy an toàn nhiều lần (chỉ lần đầu có tác dụng). */
async function ensureWallet(userId) {
  const res = await User.updateOne(
    { _id: userId, credits: { $exists: false } },
    { $set: { credits: FREE_CREDITS } }
  );
  if (res.modifiedCount === 1) {
    try {
      await Transaction.create({
        user: userId,
        key: `bonus:${userId}`,
        type: 'bonus',
        delta: FREE_CREDITS,
        balanceAfter: FREE_CREDITS,
        note: 'Welcome bonus',
      });
    } catch (e) {
      if (e.code !== 11000) console.error('[credits] ghi bonus:', e.message);
    }
  }
}

async function getBalance(userId) {
  await ensureWallet(userId);
  const u = await User.findById(userId).select('credits').lean();
  return u?.credits ?? 0;
}

/**
 * Trừ `amount` credits. Trả về { ok:true, balance, key } hoặc { ok:false, balance }.
 * Điều kiện credits >= amount nằm NGAY TRONG câu lệnh cập nhật => không thể âm.
 */
async function debit(userId, amount, { note = '', meta = {} } = {}) {
  await ensureWallet(userId);
  const user = await User.findOneAndUpdate(
    { _id: userId, credits: { $gte: amount } },
    { $inc: { credits: -amount } },
    AFTER
  );
  if (!user) return { ok: false, balance: await getBalance(userId) };

  const key = `usage:${crypto.randomBytes(12).toString('hex')}`;
  try {
    await Transaction.create({
      user: userId, key, type: 'usage', delta: -amount, balanceAfter: user.credits, note, meta,
    });
  } catch (e) {
    console.error('[credits] ghi usage:', e.message); // số dư đã đúng, chỉ thiếu dòng lịch sử
  }
  return { ok: true, balance: user.credits, key };
}

/** Gắn taskId của fal vào dòng usage để sau này biết task nào cần hoàn credit khi lỗi. */
async function attachTask(usageKey, taskId) {
  await Transaction.updateOne({ key: usageKey }, { $set: { 'meta.taskId': taskId } });
}

/** Cộng credits cho user và ghi sổ. Dùng nội bộ sau khi đã "claim" thành công. */
async function credit(userId, amount, { key, type, note = '', meta = {} }) {
  // Khởi tạo ví TRƯỚC: nếu $inc chạy trước, nó tự tạo trường credits và user sẽ mất 2 credits tặng
  await ensureWallet(userId);
  const user = await User.findOneAndUpdate({ _id: userId }, { $inc: { credits: amount } }, AFTER);
  try {
    await Transaction.create({ user: userId, key, type, delta: amount, balanceAfter: user?.credits, note, meta });
  } catch (e) {
    if (e.code !== 11000) console.error('[credits] ghi sổ:', e.message);
  }
  return user?.credits ?? 0;
}

/** Hoàn lại credit của một lần dùng. Chỉ hoàn được MỘT lần dù được gọi nhiều lần. */
async function refundUsage(usageKey, reason = '') {
  const usage = await Transaction.findOneAndUpdate(
    { key: usageKey, type: 'usage', refunded: { $ne: true } },
    { $set: { refunded: true } },
    { returnDocument: 'after' }
  );
  if (!usage) return { refunded: false };
  const balance = await credit(usage.user, -usage.delta, {
    key: `refund:${usageKey}`,
    type: 'refund',
    note: reason ? `Refund: ${reason}` : 'Refund',
    meta: { usageKey },
  });
  return { refunded: true, balance };
}

/** Hoàn credit theo taskId (khi task fal báo FAILED). Chỉ hoàn cho đúng chủ của task. */
async function refundByTask(userId, taskId, reason = 'generation failed') {
  const usage = await Transaction.findOne({ user: userId, type: 'usage', 'meta.taskId': taskId }).lean();
  if (!usage) return { refunded: false };
  return refundUsage(usage.key, reason);
}

/**
 * Đánh dấu đơn đã thanh toán và cộng credits. An toàn khi webhook/IPN/return gọi nhiều lần:
 * chỉ lần đầu "claim" được đơn pending -> paid mới cộng credits.
 */
async function markOrderPaid(orderId, providerRef = '') {
  const order = await Order.findOneAndUpdate(
    { _id: orderId, status: 'pending' },
    { $set: { status: 'paid', paidAt: new Date(), providerRef } },
    { returnDocument: 'after' }
  );
  if (!order) return { applied: false };
  const balance = await credit(order.user, order.credits, {
    key: `purchase:${order._id}`,
    type: 'purchase',
    note: `Bought ${order.credits} credits`,
    meta: { orderId: String(order._id), provider: order.provider, packageId: order.packageId },
  });
  return { applied: true, order, balance };
}

async function markOrderFailed(orderId, reason = '') {
  const order = await Order.findOneAndUpdate(
    { _id: orderId, status: 'pending' },
    { $set: { status: 'failed', failReason: String(reason).slice(0, 200) } },
    { returnDocument: 'after' }
  );
  return { applied: !!order, order };
}

async function history(userId, limit = 20) {
  const rows = await Transaction.find({ user: userId }).sort({ createdAt: -1 }).limit(limit).lean();
  return rows.map((t) => ({
    id: t._id, type: t.type, delta: t.delta, balanceAfter: t.balanceAfter, note: t.note, createdAt: t.createdAt,
  }));
}

module.exports = {
  ensureWallet, getBalance, debit, attachTask, refundUsage, refundByTask,
  markOrderPaid, markOrderFailed, history,
};