// Sổ cái credits: tặng ví, trừ tiền nguyên tử, hoàn tiền đúng 1 lần, xử lý đơn hàng idempotent
const mongoose = require('mongoose');
const credits = require('../../utils/credits');
const User = require('../../models/User');
const Order = require('../../models/Order');
const Transaction = require('../../models/Transaction');
const { FREE_CREDITS, LEGACY_FREE_CREDITS, NEW_FREE_CREDITS_FROM } = require('../../config/pricing');
const { connectDb, clearDb, disconnectDb, makeUser, oid } = require('../helpers/db');

beforeAll(connectDb);
afterAll(disconnectDb);
beforeEach(clearDb);

const userWithIdTime = (date) =>
  User.create({ _id: mongoose.Types.ObjectId.createFromTime(Math.floor(date.getTime() / 1000)), email: `old${Math.random()}@t.dev` });

const makeOrder = (user, over = {}) =>
  Order.create({ user: user._id, packageId: 'pack5', credits: 5, provider: 'vnpay', currency: 'VND', amount: 49000, ...over });

describe('ensureWallet / getBalance', () => {
  test('tài khoản mới nhận FREE_CREDITS', async () => {
    const { user } = await makeUser();
    expect(await credits.getBalance(user._id)).toBe(FREE_CREDITS);
  });
  test('ghi 1 dòng sổ "bonus" với key bonus:<userId>', async () => {
    const { user } = await makeUser();
    await credits.ensureWallet(user._id);
    const rows = await Transaction.find({ user: user._id });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: `bonus:${user._id}`, type: 'bonus', delta: FREE_CREDITS, balanceAfter: FREE_CREDITS });
  });
  test('tài khoản tạo TRƯỚC mốc 16/11/2026 chỉ nhận LEGACY_FREE_CREDITS', async () => {
    const u = await userWithIdTime(new Date(NEW_FREE_CREDITS_FROM.getTime() - 24 * 3600 * 1000));
    expect(await credits.getBalance(u._id)).toBe(LEGACY_FREE_CREDITS);
  });
  test('tạo trước mốc 1 giây vẫn là tài khoản cũ', async () => {
    const u = await userWithIdTime(new Date(NEW_FREE_CREDITS_FROM.getTime() - 1000));
    expect(await credits.getBalance(u._id)).toBe(LEGACY_FREE_CREDITS);
  });
  test('tạo đúng mốc là tài khoản mới', async () => {
    const u = await userWithIdTime(NEW_FREE_CREDITS_FROM);
    expect(await credits.getBalance(u._id)).toBe(FREE_CREDITS);
  });
  test('gọi nhiều lần không tặng thêm', async () => {
    const { user } = await makeUser();
    await credits.ensureWallet(user._id);
    await credits.ensureWallet(user._id);
    expect(await credits.getBalance(user._id)).toBe(FREE_CREDITS);
    expect(await Transaction.countDocuments({ user: user._id })).toBe(1);
  });
  test('10 request đồng thời chỉ tặng đúng 1 lần', async () => {
    const { user } = await makeUser();
    await Promise.all(Array.from({ length: 10 }, () => credits.ensureWallet(user._id)));
    expect((await User.findById(user._id)).credits).toBe(FREE_CREDITS);
    expect(await Transaction.countDocuments({ user: user._id, type: 'bonus' })).toBe(1);
  });
  test('user đã có ví (credits=10) không bị ghi đè và không có bonus', async () => {
    const { user } = await makeUser({ credits: 10 });
    expect(await credits.getBalance(user._id)).toBe(10);
    expect(await Transaction.countDocuments({ user: user._id })).toBe(0);
  });
  test('user không tồn tại -> số dư 0, không ném lỗi', async () => {
    expect(await credits.getBalance(oid())).toBe(0);
  });
});

describe('debit', () => {
  test('trừ thành công: trả về ok, balance mới và key usage', async () => {
    const { user } = await makeUser();
    const r = await credits.debit(user._id, 1, { note: 'Single object', meta: { a: 1 } });
    expect(r.ok).toBe(true);
    expect(r.balance).toBe(FREE_CREDITS - 1);
    expect(r.key).toMatch(/^usage:[0-9a-f]{24}$/);
  });
  test('ghi sổ usage với delta âm, balanceAfter, note, meta', async () => {
    const { user } = await makeUser();
    const r = await credits.debit(user._id, 1, { note: 'n', meta: { a: 1 } });
    const t = await Transaction.findOne({ key: r.key });
    expect(t).toMatchObject({ type: 'usage', delta: -1, balanceAfter: FREE_CREDITS - 1, note: 'n' });
    expect(t.meta).toEqual({ a: 1 });
  });
  test('không đủ credits -> ok=false, số dư giữ nguyên, không ghi usage', async () => {
    const { user } = await makeUser({ credits: 1 });
    const r = await credits.debit(user._id, 2);
    expect(r).toEqual({ ok: false, balance: 1 });
    expect(await Transaction.countDocuments({ user: user._id, type: 'usage' })).toBe(0);
  });
  test('trừ đúng bằng số dư -> về 0, lần sau thất bại (không bao giờ âm)', async () => {
    const { user } = await makeUser({ credits: 2 });
    expect((await credits.debit(user._id, 2)).balance).toBe(0);
    expect((await credits.debit(user._id, 1)).ok).toBe(false);
    expect((await User.findById(user._id)).credits).toBe(0);
  });
  test('ví mới được khởi tạo tự động trước khi trừ', async () => {
    const { user } = await makeUser();
    const r = await credits.debit(user._id, 1);
    expect(r.balance).toBe(FREE_CREDITS - 1);
    expect(await Transaction.countDocuments({ user: user._id, type: 'bonus' })).toBe(1);
  });
  test('10 request trừ đồng thời khi còn 4 credits: đúng 4 thành công, 6 thất bại, số dư = 0', async () => {
    const { user } = await makeUser();
    const results = await Promise.all(Array.from({ length: 10 }, () => credits.debit(user._id, 1)));
    expect(results.filter((r) => r.ok)).toHaveLength(FREE_CREDITS);
    expect(results.filter((r) => !r.ok)).toHaveLength(10 - FREE_CREDITS);
    expect((await User.findById(user._id)).credits).toBe(0);
    expect(new Set(results.filter((r) => r.ok).map((r) => r.key)).size).toBe(FREE_CREDITS);
  });
  test('user không tồn tại -> ok=false', async () => {
    expect((await credits.debit(oid(), 1)).ok).toBe(false);
  });
});

describe('attachTask / refundUsage / refundByTask', () => {
  test('attachTask gắn taskId vào meta của dòng usage', async () => {
    const { user } = await makeUser();
    const { key } = await credits.debit(user._id, 1);
    await credits.attachTask(key, 'task-1');
    expect((await Transaction.findOne({ key })).meta.taskId).toBe('task-1');
  });
  test('refundUsage hoàn đúng số credits và ghi dòng refund', async () => {
    const { user } = await makeUser();
    const { key } = await credits.debit(user._id, 1);
    const r = await credits.refundUsage(key, 'boom');
    expect(r).toEqual({ refunded: true, balance: FREE_CREDITS });
    expect(await Transaction.findOne({ key: `refund:${key}` })).toMatchObject({ type: 'refund', delta: 1, note: 'Refund: boom' });
    expect((await Transaction.findOne({ key })).refunded).toBe(true);
  });
  test('refundUsage không có lý do -> ghi chú "Refund"', async () => {
    const { user } = await makeUser();
    const { key } = await credits.debit(user._id, 1);
    await credits.refundUsage(key);
    expect((await Transaction.findOne({ key: `refund:${key}` })).note).toBe('Refund');
  });
  test('hoàn lần 2 không có tác dụng', async () => {
    const { user } = await makeUser();
    const { key } = await credits.debit(user._id, 1);
    await credits.refundUsage(key);
    expect(await credits.refundUsage(key)).toEqual({ refunded: false });
    expect((await User.findById(user._id)).credits).toBe(FREE_CREDITS);
  });
  test('5 lần hoàn đồng thời chỉ hoàn đúng 1 lần', async () => {
    const { user } = await makeUser();
    const { key } = await credits.debit(user._id, 1);
    const rs = await Promise.all(Array.from({ length: 5 }, () => credits.refundUsage(key)));
    expect(rs.filter((r) => r.refunded)).toHaveLength(1);
    expect((await User.findById(user._id)).credits).toBe(FREE_CREDITS);
    expect(await Transaction.countDocuments({ type: 'refund' })).toBe(1);
  });
  test('key không tồn tại -> không hoàn', async () => {
    expect(await credits.refundUsage('usage:doesnotexist')).toEqual({ refunded: false });
  });
  test('không thể "hoàn" một dòng bonus để kiếm credits', async () => {
    const { user } = await makeUser();
    await credits.ensureWallet(user._id);
    expect(await credits.refundUsage(`bonus:${user._id}`)).toEqual({ refunded: false });
    expect((await User.findById(user._id)).credits).toBe(FREE_CREDITS);
  });
  test('refundByTask hoàn đúng theo taskId của đúng chủ', async () => {
    const { user } = await makeUser();
    const { key } = await credits.debit(user._id, 1);
    await credits.attachTask(key, 'T1');
    expect((await credits.refundByTask(user._id, 'T1')).refunded).toBe(true);
    expect((await User.findById(user._id)).credits).toBe(FREE_CREDITS);
  });
  test('refundByTask của người khác -> không hoàn', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const { key } = await credits.debit(a.user._id, 1);
    await credits.attachTask(key, 'T2');
    expect(await credits.refundByTask(b.user._id, 'T2')).toEqual({ refunded: false });
    expect((await User.findById(a.user._id)).credits).toBe(FREE_CREDITS - 1);
  });
  test('refundByTask với taskId không tồn tại -> không hoàn', async () => {
    const { user } = await makeUser();
    expect(await credits.refundByTask(user._id, 'nope')).toEqual({ refunded: false });
  });
});

describe('markOrderPaid / markOrderFailed', () => {
  test('đơn pending -> paid, cộng credits, lưu providerRef và paidAt', async () => {
    const { user } = await makeUser();
    const order = await makeOrder(user);
    const r = await credits.markOrderPaid(order._id, 'TXN-1');
    expect(r.applied).toBe(true);
    expect(r.balance).toBe(FREE_CREDITS + 5);
    const o = await Order.findById(order._id);
    expect(o).toMatchObject({ status: 'paid', providerRef: 'TXN-1' });
    expect(o.paidAt).toBeInstanceOf(Date);
  });
  test('ghi sổ purchase với key purchase:<orderId> và meta', async () => {
    const { user } = await makeUser();
    const order = await makeOrder(user);
    await credits.markOrderPaid(order._id);
    const t = await Transaction.findOne({ key: `purchase:${order._id}` });
    expect(t).toMatchObject({ type: 'purchase', delta: 5, note: 'Bought 5 credits' });
    expect(t.meta).toMatchObject({ orderId: String(order._id), provider: 'vnpay', packageId: 'pack5' });
  });
  test('gọi lại lần 2 không cộng thêm', async () => {
    const { user } = await makeUser();
    const order = await makeOrder(user);
    await credits.markOrderPaid(order._id);
    expect(await credits.markOrderPaid(order._id)).toEqual({ applied: false });
    expect((await User.findById(user._id)).credits).toBe(FREE_CREDITS + 5);
  });
  test('5 webhook đồng thời chỉ cộng đúng 1 lần', async () => {
    const { user } = await makeUser();
    const order = await makeOrder(user);
    const rs = await Promise.all(Array.from({ length: 5 }, () => credits.markOrderPaid(order._id)));
    expect(rs.filter((r) => r.applied)).toHaveLength(1);
    expect((await User.findById(user._id)).credits).toBe(FREE_CREDITS + 5);
    expect(await Transaction.countDocuments({ type: 'purchase' })).toBe(1);
  });
  test('user chưa từng mở ví vẫn nhận đủ credits tặng + credits đã mua', async () => {
    const { user } = await makeUser();
    expect((await User.findById(user._id)).credits).toBeUndefined();
    const order = await makeOrder(user, { credits: 20, packageId: 'pack20' });
    const r = await credits.markOrderPaid(order._id);
    expect(r.balance).toBe(FREE_CREDITS + 20);
  });
  test('đơn đã failed thì không thể thành paid', async () => {
    const { user } = await makeUser();
    const order = await makeOrder(user);
    await credits.markOrderFailed(order._id, 'declined');
    expect(await credits.markOrderPaid(order._id)).toEqual({ applied: false });
    expect((await Order.findById(order._id)).status).toBe('failed');
  });
  test('orderId không tồn tại -> applied=false', async () => {
    expect(await credits.markOrderPaid(oid())).toEqual({ applied: false });
  });
  test('markOrderFailed: pending -> failed và lưu lý do', async () => {
    const { user } = await makeUser();
    const order = await makeOrder(user);
    const r = await credits.markOrderFailed(order._id, 'VNPay code 24');
    expect(r.applied).toBe(true);
    expect(await Order.findById(order._id)).toMatchObject({ status: 'failed', failReason: 'VNPay code 24' });
  });
  test('markOrderFailed cắt lý do còn 200 ký tự', async () => {
    const { user } = await makeUser();
    const order = await makeOrder(user);
    await credits.markOrderFailed(order._id, 'x'.repeat(500));
    expect((await Order.findById(order._id)).failReason).toHaveLength(200);
  });
  test('đơn đã paid thì không thể bị đánh dấu failed', async () => {
    const { user } = await makeUser();
    const order = await makeOrder(user);
    await credits.markOrderPaid(order._id);
    expect((await credits.markOrderFailed(order._id, 'late')).applied).toBe(false);
    expect((await Order.findById(order._id)).status).toBe('paid');
  });
});

describe('history', () => {
  test('sắp xếp mới nhất trước và chỉ lấy của đúng user', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const base = Date.now();
    await Transaction.collection.insertMany([
      { user: a.user._id, key: 'k1', type: 'usage', delta: -1, createdAt: new Date(base - 3000), updatedAt: new Date() },
      { user: a.user._id, key: 'k2', type: 'usage', delta: -1, createdAt: new Date(base - 1000), updatedAt: new Date() },
      { user: a.user._id, key: 'k3', type: 'usage', delta: -1, createdAt: new Date(base - 2000), updatedAt: new Date() },
      { user: b.user._id, key: 'k4', type: 'usage', delta: -1, createdAt: new Date(base), updatedAt: new Date() },
    ]);
    const h = await credits.history(a.user._id);
    expect(h).toHaveLength(3);
  });
  test('trả về đúng các trường công khai, không lộ key/meta', async () => {
    const { user } = await makeUser();
    await credits.debit(user._id, 1, { note: 'x', meta: { secret: 1 } });
    const [row] = await credits.history(user._id);
    expect(Object.keys(row).sort()).toEqual(['balanceAfter', 'createdAt', 'delta', 'id', 'note', 'type']);
  });
  test('tôn trọng tham số limit', async () => {
    const { user } = await makeUser();
    await credits.debit(user._id, 1);
    await credits.debit(user._id, 1);
    await credits.debit(user._id, 1);
    expect(await credits.history(user._id, 2)).toHaveLength(2);
  });
  test('mặc định tối đa 20 dòng', async () => {
    const { user } = await makeUser();
    const docs = Array.from({ length: 25 }, (_, i) => ({ user: user._id, key: `k${i}`, type: 'usage', delta: -1, createdAt: new Date(Date.now() - i * 1000), updatedAt: new Date() }));
    await Transaction.collection.insertMany(docs);
    expect(await credits.history(user._id)).toHaveLength(20);
  });
});

describe('ràng buộc dữ liệu', () => {
  test('Transaction.key là duy nhất', async () => {
    const { user } = await makeUser();
    await Transaction.create({ user: user._id, key: 'dup', type: 'bonus', delta: 1 });
    await expect(Transaction.create({ user: user._id, key: 'dup', type: 'bonus', delta: 1 })).rejects.toMatchObject({ code: 11000 });
  });
  test('User.credits không thể âm (min: 0)', async () => {
    await expect(makeUser({ credits: -1 })).rejects.toThrow();
  });
});
