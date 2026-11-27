// /api/payments/* (ví, tạo đơn, refresh) và /webhooks/* (VNPay IPN/return, Polar)
jest.mock('express-rate-limit', () => () => (req, res, next) => next());

const request = require('supertest');
const app = require('../../server');
const Order = require('../../models/Order');
const User = require('../../models/User');
const Transaction = require('../../models/Transaction');
const vnpay = require('../../utils/vnpay');
const { FREE_CREDITS } = require('../../config/pricing');
const { connectDb, clearDb, disconnectDb, makeUser } = require('../helpers/db');
const { vnpayCallback, signVnpay } = require('../helpers/vnpaySign');
const { polarHeaders } = require('../helpers/polarSign');

beforeAll(connectDb);
afterAll(disconnectDb);
beforeEach(clearDb);

const json = (body, ok = true, status = 200) => ({ ok, status, text: async () => JSON.stringify(body) });
const mkOrder = (user, over = {}) => Order.create({ user: user._id, packageId: 'pack5', credits: 5, provider: 'vnpay', currency: 'VND', amount: 49000, ...over });
const credits = async (u) => (await User.findById(u._id)).credits;

describe('GET /api/payments/wallet', () => {
  test('cần đăng nhập', async () => expect((await request(app).get('/api/payments/wallet')).status).toBe(401));
  test('user mới: credits = FREE_CREDITS, có lịch sử bonus', async () => {
    const { auth } = await makeUser();
    const r = await request(app).get('/api/payments/wallet').set(auth);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ credits: FREE_CREDITS, freeCredits: FREE_CREDITS, costs: { single: 1, multiple: 1, magicWandObject: 1 } });
    expect(r.body.history[0]).toMatchObject({ type: 'bonus', delta: FREE_CREDITS });
  });
  test('trả về 3 gói và không lộ polarProductEnv', async () => {
    const { auth } = await makeUser();
    const r = await request(app).get('/api/payments/wallet').set(auth);
    expect(r.body.packages.map((p) => p.id)).toEqual(['pack5', 'pack20', 'pack50']);
    expect(JSON.stringify(r.body)).not.toContain('polarProductEnv');
  });
  test('providers phản ánh cấu hình env', async () => {
    const { auth } = await makeUser();
    expect((await request(app).get('/api/payments/wallet').set(auth)).body.providers).toEqual({ vnpay: true, polar: true });
  });
  test('testMode=true khi chưa PAYMENT_LIVE', async () => {
    const { auth } = await makeUser();
    expect((await request(app).get('/api/payments/wallet').set(auth)).body.testMode).toBe(true);
  });
  test('PAYMENT_LIVE=true -> testMode=false', async () => {
    const { auth } = await makeUser();
    process.env.PAYMENT_LIVE = 'true';
    try { expect((await request(app).get('/api/payments/wallet').set(auth)).body.testMode).toBe(false); } finally { delete process.env.PAYMENT_LIVE; }
  });
  test('không lộ lịch sử của user khác', async () => {
    const a = await makeUser(); const b = await makeUser();
    await request(app).get('/api/payments/wallet').set(a.auth);
    const r = await request(app).get('/api/payments/wallet').set(b.auth);
    expect(r.body.history).toHaveLength(1);
  });
});

describe('POST /api/payments/checkout', () => {
  const checkout = (auth, body) => request(app).post('/api/payments/checkout').set(auth).send(body);

  test('cần đăng nhập', async () => expect((await request(app).post('/api/payments/checkout').send({})).status).toBe(401));
  test.each([[{ packageId: 'nope', provider: 'vnpay' }], [{ provider: 'vnpay' }], [{ packageId: 'PACK5', provider: 'vnpay' }]])('gói sai %p -> 400', async (b) => {
    const { auth } = await makeUser();
    expect((await checkout(auth, b)).status).toBe(400);
  });
  test.each([[{ packageId: 'pack5', provider: 'paypal' }], [{ packageId: 'pack5', provider: 'mock' }], [{ packageId: 'pack5' }]])('cổng sai %p -> 400', async (b) => {
    const { auth } = await makeUser();
    expect((await checkout(auth, b)).status).toBe(400);
  });
  test('cổng tắt do thiếu khoá -> 400', async () => {
    const { auth } = await makeUser();
    const s = process.env.VNPAY_TMN_CODE; delete process.env.VNPAY_TMN_CODE;
    try { expect((await checkout(auth, { packageId: 'pack5', provider: 'vnpay' })).status).toBe(400); } finally { process.env.VNPAY_TMN_CODE = s; }
  });

  describe('VNPay', () => {
    test('trả về url + orderId và tạo đơn pending với số tiền do SERVER quyết định', async () => {
      const { user, auth } = await makeUser();
      const r = await checkout(auth, { packageId: 'pack20', provider: 'vnpay', amount: 1, credits: 9999 });
      expect(r.status).toBe(200);
      const o = await Order.findById(r.body.orderId);
      expect(o).toMatchObject({ status: 'pending', provider: 'vnpay', packageId: 'pack20', credits: 20, currency: 'VND', amount: 149000 });
      expect(String(o.user)).toBe(String(user._id));
    });
    test('URL trỏ tới VNPAY_URL, có chữ ký hợp lệ, TxnRef = orderId, số tiền × 100', async () => {
      const { auth } = await makeUser();
      const r = await checkout(auth, { packageId: 'pack5', provider: 'vnpay' });
      expect(r.body.url.startsWith('https://vnpay.test/vpcpay.html?')).toBe(true);
      const q = Object.fromEntries(new URL(r.body.url).searchParams);
      expect(vnpay.verifyQuery(q).valid).toBe(true);
      expect(q.vnp_TxnRef).toBe(r.body.orderId);
      expect(q.vnp_Amount).toBe('4900000');
      expect(q.vnp_ReturnUrl).toBe('http://backend.test/webhooks/vnpay/return');
    });
    test('đọc IP từ X-Forwarded-For', async () => {
      const { auth } = await makeUser();
      const r = await checkout(auth, { packageId: 'pack5', provider: 'vnpay' }).set('X-Forwarded-For', '203.0.113.9');
      expect(new URL(r.body.url).searchParams.get('vnp_IpAddr')).toBe('203.0.113.9');
    });
    test('mua credits chưa cộng ngay: số dư giữ nguyên tới khi thanh toán xong', async () => {
      const { user, auth } = await makeUser();
      await checkout(auth, { packageId: 'pack5', provider: 'vnpay' });
      expect(await credits(user)).toBeUndefined(); // ví chưa mở, chưa có giao dịch purchase
      expect(await Transaction.countDocuments({ type: 'purchase' })).toBe(0);
    });
  });

  describe('Polar', () => {
    const polarOk = () => global.fetch.mockResolvedValueOnce(json({ id: 'chk_1', url: 'https://polar.test/c/1' }, true, 201));

    test('tạo checkout, lưu providerRef, đơn USD tính bằng cent', async () => {
      const { auth } = await makeUser();
      polarOk();
      const r = await checkout(auth, { packageId: 'pack5', provider: 'polar' });
      expect(r.body.url).toBe('https://polar.test/c/1');
      expect(await Order.findById(r.body.orderId)).toMatchObject({ provider: 'polar', currency: 'USD', amount: 199, providerRef: 'chk_1', status: 'pending' });
    });
    test('gửi đúng product id, email, metadata, success_url có {CHECKOUT_ID}', async () => {
      const { user, auth } = await makeUser();
      polarOk();
      const r = await checkout(auth, { packageId: 'pack20', provider: 'polar' });
      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.products).toEqual(['prod_pack20']);
      expect(body.customer_email).toBe(user.email);
      expect(body.metadata).toEqual({ orderId: r.body.orderId, userId: String(user._id), packageId: 'pack20' });
      expect(body.success_url).toBe(`http://frontend.test/?payment=polar&order=${r.body.orderId}&checkout_id={CHECKOUT_ID}`);
    });
    test('Polar trả lỗi -> 502 và đơn bị đánh dấu failed', async () => {
      const { auth } = await makeUser();
      jest.spyOn(console, 'error').mockImplementation(() => {});
      global.fetch.mockResolvedValueOnce(json({ detail: 'nope' }, false, 500));
      const r = await checkout(auth, { packageId: 'pack5', provider: 'polar' });
      expect(r.status).toBe(502);
      expect((await Order.findOne()).status).toBe('failed');
      console.error.mockRestore();
    });
    test('thiếu biến POLAR_PRODUCT_* -> 502 và đơn failed', async () => {
      const { auth } = await makeUser();
      jest.spyOn(console, 'error').mockImplementation(() => {});
      const s = process.env.POLAR_PRODUCT_PACK5; delete process.env.POLAR_PRODUCT_PACK5;
      try {
        expect((await checkout(auth, { packageId: 'pack5', provider: 'polar' })).status).toBe(502);
        expect((await Order.findOne()).status).toBe('failed');
      } finally { process.env.POLAR_PRODUCT_PACK5 = s; console.error.mockRestore(); }
    });
  });

  test('tạo quá 20 đơn trong 1 giờ -> 429', async () => {
    const { user, auth } = await makeUser();
    await Order.insertMany(Array.from({ length: 20 }, () => ({ user: user._id, packageId: 'pack5', credits: 5, provider: 'vnpay', currency: 'VND', amount: 49000 })));
    expect((await checkout(auth, { packageId: 'pack5', provider: 'vnpay' })).status).toBe(429);
  });
  test('đơn cũ hơn 1 giờ không bị tính vào hạn mức', async () => {
    const { user, auth } = await makeUser();
    const old = new Date(Date.now() - 2 * 3600 * 1000);
    await Order.collection.insertMany(Array.from({ length: 20 }, () => ({ user: user._id, packageId: 'pack5', credits: 5, provider: 'vnpay', currency: 'VND', amount: 49000, status: 'pending', createdAt: old, updatedAt: old })));
    expect((await checkout(auth, { packageId: 'pack5', provider: 'vnpay' })).status).toBe(200);
  });
  test('hạn mức 20 đơn tính riêng cho từng user', async () => {
    const a = await makeUser(); const b = await makeUser();
    await Order.insertMany(Array.from({ length: 20 }, () => ({ user: a.user._id, packageId: 'pack5', credits: 5, provider: 'vnpay', currency: 'VND', amount: 49000 })));
    expect((await checkout(b.auth, { packageId: 'pack5', provider: 'vnpay' })).status).toBe(200);
  });
});

describe('POST /api/payments/orders/:id/refresh', () => {
  const refresh = (auth, id) => request(app).post(`/api/payments/orders/${id}/refresh`).set(auth);
  const polarOrder = (user, over = {}) => mkOrder(user, { provider: 'polar', currency: 'USD', amount: 199, providerRef: 'chk_1', ...over });

  test('id không hợp lệ -> 404', async () => { const { auth } = await makeUser(); expect((await refresh(auth, 'abc')).status).toBe(404); });
  test('đơn không tồn tại -> 404', async () => { const { auth } = await makeUser(); expect((await refresh(auth, '665f1c2e9b1e8a0012345678')).status).toBe(404); });
  test('không xem được đơn của người khác -> 404', async () => {
    const a = await makeUser(); const b = await makeUser();
    const o = await mkOrder(a.user);
    expect((await refresh(b.auth, o._id)).status).toBe(404);
  });
  test('đơn VNPay pending: trả về trạng thái hiện tại, không gọi mạng', async () => {
    const { user, auth } = await makeUser();
    const o = await mkOrder(user);
    const r = await refresh(auth, o._id);
    expect(r.body.order).toMatchObject({ status: 'pending', provider: 'vnpay', credits: 5 });
    expect(global.fetch).not.toHaveBeenCalled();
  });
  test('Polar succeeded + metadata khớp -> paid và cộng credits', async () => {
    const { user, auth } = await makeUser();
    const o = await polarOrder(user);
    global.fetch.mockResolvedValueOnce(json({ id: 'chk_1', status: 'succeeded', metadata: { orderId: String(o._id) } }));
    const r = await refresh(auth, o._id);
    expect(r.body.order.status).toBe('paid');
    expect(r.body.credits).toBe(FREE_CREDITS + 5);
  });
  test.each([['failed'], ['expired']])('Polar %s -> đơn failed', async (st) => {
    const { user, auth } = await makeUser();
    const o = await polarOrder(user);
    global.fetch.mockResolvedValueOnce(json({ status: st, metadata: { orderId: String(o._id) } }));
    expect((await refresh(auth, o._id)).body.order.status).toBe('failed');
  });
  test('Polar open (chưa trả tiền) -> vẫn pending', async () => {
    const { user, auth } = await makeUser();
    const o = await polarOrder(user);
    global.fetch.mockResolvedValueOnce(json({ status: 'open', metadata: { orderId: String(o._id) } }));
    expect((await refresh(auth, o._id)).body.order.status).toBe('pending');
  });
  test('metadata KHÔNG khớp đơn -> không được đánh dấu paid (chống dùng checkout của đơn khác)', async () => {
    const { user, auth } = await makeUser();
    const o = await polarOrder(user);
    global.fetch.mockResolvedValueOnce(json({ status: 'succeeded', metadata: { orderId: 'someone-elses-order' } }));
    const r = await refresh(auth, o._id);
    expect(r.body.order.status).toBe('pending');
    expect(await Transaction.countDocuments({ type: 'purchase' })).toBe(0);
  });
  test('Polar API lỗi -> 200 và đơn vẫn pending', async () => {
    const { user, auth } = await makeUser();
    const o = await polarOrder(user);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch.mockRejectedValueOnce(new Error('timeout'));
    const r = await refresh(auth, o._id);
    expect(r.status).toBe(200);
    expect(r.body.order.status).toBe('pending');
    console.error.mockRestore();
  });
  test('refresh nhiều lần không cộng credits trùng', async () => {
    const { user, auth } = await makeUser();
    const o = await polarOrder(user);
    global.fetch.mockResolvedValue(json({ status: 'succeeded', metadata: { orderId: String(o._id) } }));
    await refresh(auth, o._id); await refresh(auth, o._id); await refresh(auth, o._id);
    expect(await credits(user)).toBe(FREE_CREDITS + 5);
  });
  test('đơn đã paid: không gọi Polar nữa', async () => {
    const { user, auth } = await makeUser();
    const o = await polarOrder(user, { status: 'paid' });
    await refresh(auth, o._id);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('VNPay IPN  GET /webhooks/vnpay/ipn', () => {
  const ipn = (q) => request(app).get('/webhooks/vnpay/ipn').query(q);

  test('thanh toán thành công -> RspCode 00, đơn paid, cộng credits, lưu mã giao dịch', async () => {
    const { user } = await makeUser();
    const o = await mkOrder(user);
    const r = await ipn(vnpayCallback(o));
    expect(r.body).toEqual({ RspCode: '00', Message: 'Confirm Success' });
    expect(await Order.findById(o._id)).toMatchObject({ status: 'paid', providerRef: '14000001' });
    expect(await credits(user)).toBe(FREE_CREDITS + 5);
  });
  test('VNPay gọi lại (replay) -> 02, không cộng trùng', async () => {
    const { user } = await makeUser();
    const o = await mkOrder(user);
    await ipn(vnpayCallback(o));
    expect((await ipn(vnpayCallback(o))).body.RspCode).toBe('02');
    expect(await credits(user)).toBe(FREE_CREDITS + 5);
  });
  test('chữ ký sai -> 97 và không đổi gì', async () => {
    const { user } = await makeUser();
    const o = await mkOrder(user);
    const q = vnpayCallback(o); q.vnp_SecureHash = 'a'.repeat(128);
    expect((await ipn(q)).body.RspCode).toBe('97');
    expect((await Order.findById(o._id)).status).toBe('pending');
  });
  test('sửa số tiền sau khi ký -> 97', async () => {
    const { user } = await makeUser();
    const o = await mkOrder(user);
    expect((await ipn({ ...vnpayCallback(o), vnp_Amount: '100' })).body.RspCode).toBe('97');
  });
  test('thiếu chữ ký -> 97', async () => {
    expect((await ipn({ vnp_TxnRef: 'x' })).body.RspCode).toBe('97');
  });
  test('TxnRef không phải ObjectId -> 01', async () => {
    expect((await ipn(signVnpay({ vnp_TxnRef: 'abc', vnp_Amount: '100' }))).body.RspCode).toBe('01');
  });
  test('đơn không tồn tại -> 01', async () => {
    expect((await ipn(signVnpay({ vnp_TxnRef: '665f1c2e9b1e8a0012345678', vnp_Amount: '100' }))).body.RspCode).toBe('01');
  });
  test('đơn của cổng khác (polar) -> 01', async () => {
    const { user } = await makeUser();
    const o = await mkOrder(user, { provider: 'polar', currency: 'USD', amount: 199 });
    expect((await ipn(vnpayCallback(o))).body.RspCode).toBe('01');
  });
  test('số tiền ký đúng nhưng KHÁC số tiền của đơn -> 04, không cộng credits', async () => {
    const { user } = await makeUser();
    const o = await mkOrder(user);
    expect((await ipn(vnpayCallback(o, { vnp_Amount: '100' }))).body.RspCode).toBe('04');
    expect((await Order.findById(o._id)).status).toBe('pending');
    expect(await credits(user)).toBeUndefined();
  });
  test('khách huỷ (mã 24) -> 00, đơn failed, không cộng credits', async () => {
    const { user } = await makeUser();
    const o = await mkOrder(user);
    const r = await ipn(vnpayCallback(o, { vnp_ResponseCode: '24', vnp_TransactionStatus: '02' }));
    expect(r.body.RspCode).toBe('00');
    expect(await Order.findById(o._id)).toMatchObject({ status: 'failed', failReason: 'VNPay code 24' });
    expect(await credits(user)).toBeUndefined();
  });
  test('ResponseCode 00 nhưng TransactionStatus khác 00 -> coi là thất bại', async () => {
    const { user } = await makeUser();
    const o = await mkOrder(user);
    await ipn(vnpayCallback(o, { vnp_TransactionStatus: '02' }));
    expect((await Order.findById(o._id)).status).toBe('failed');
  });
  test('đơn đã failed rồi mới có IPN thành công -> 02, không cộng credits', async () => {
    const { user } = await makeUser();
    const o = await mkOrder(user, { status: 'failed' });
    expect((await ipn(vnpayCallback(o))).body.RspCode).toBe('02');
    expect(await credits(user)).toBeUndefined();
  });
  test('5 IPN đồng thời chỉ cộng 1 lần', async () => {
    const { user } = await makeUser();
    const o = await mkOrder(user);
    await Promise.all(Array.from({ length: 5 }, () => ipn(vnpayCallback(o))));
    expect(await credits(user)).toBe(FREE_CREDITS + 5);
    expect(await Transaction.countDocuments({ type: 'purchase' })).toBe(1);
  });
});

describe('VNPay return  GET /webhooks/vnpay/return', () => {
  const ret = (q) => request(app).get('/webhooks/vnpay/return').query(q).redirects(0);
  const loc = (r) => r.headers.location;

  test('thành công -> 302 về frontend với status=success và cộng credits', async () => {
    const { user } = await makeUser();
    const o = await mkOrder(user);
    const r = await ret(vnpayCallback(o));
    expect(r.status).toBe(302);
    expect(loc(r)).toBe(`http://frontend.test/?payment=vnpay&order=${o._id}&status=success`);
    expect(await credits(user)).toBe(FREE_CREDITS + 5);
  });
  test('quay lại nhiều lần vẫn chỉ cộng 1 lần', async () => {
    const { user } = await makeUser();
    const o = await mkOrder(user);
    await ret(vnpayCallback(o)); await ret(vnpayCallback(o));
    expect(await credits(user)).toBe(FREE_CREDITS + 5);
  });
  test('khách bấm huỷ (24) -> status=cancelled, đơn failed', async () => {
    const { user } = await makeUser();
    const o = await mkOrder(user);
    const r = await ret(vnpayCallback(o, { vnp_ResponseCode: '24', vnp_TransactionStatus: '02' }));
    expect(loc(r)).toContain('status=cancelled');
    expect((await Order.findById(o._id)).status).toBe('failed');
  });
  test('thất bại khác -> status=failed', async () => {
    const { user } = await makeUser();
    const o = await mkOrder(user);
    expect(loc(await ret(vnpayCallback(o, { vnp_ResponseCode: '51', vnp_TransactionStatus: '02' })))).toContain('status=failed');
  });
  test('chữ ký sai -> status=invalid và không cộng credits', async () => {
    const { user } = await makeUser();
    const o = await mkOrder(user);
    const r = await ret({ ...vnpayCallback(o), vnp_Amount: '1' });
    expect(loc(r)).toContain('status=invalid');
    expect((await Order.findById(o._id)).status).toBe('pending');
  });
  test('số tiền không khớp đơn -> status=invalid', async () => {
    const { user } = await makeUser();
    const o = await mkOrder(user);
    expect(loc(await ret(vnpayCallback(o, { vnp_Amount: '100' })))).toContain('status=invalid');
    expect((await Order.findById(o._id)).status).toBe('pending');
  });
  test('đơn không tồn tại -> status=invalid, không crash', async () => {
    const r = await ret(signVnpay({ vnp_TxnRef: '665f1c2e9b1e8a0012345678', vnp_Amount: '100' }));
    expect(r.status).toBe(302);
    expect(loc(r)).toContain('status=invalid');
  });
  test('không có query nào -> vẫn redirect (status=invalid)', async () => {
    const r = await ret({});
    expect(r.status).toBe(302);
    expect(loc(r)).toContain('status=invalid');
  });
});

describe('Polar webhook  POST /webhooks/polar', () => {
  const hook = (event, hdrOver) => {
    const raw = typeof event === 'string' ? event : JSON.stringify(event);
    return request(app).post('/webhooks/polar').set({ ...polarHeaders(raw), ...hdrOver }).send(raw);
  };
  const paidEvent = (o, data = {}) => ({ type: 'order.paid', data: { id: 'po_1', checkout_id: 'chk_9', product_id: 'prod_pack5', metadata: { orderId: String(o._id) }, ...data } });
  const polarOrder = (user, over = {}) => mkOrder(user, { provider: 'polar', currency: 'USD', amount: 199, ...over });

  test('order.paid hợp lệ -> 200, đơn paid, cộng credits, providerRef = checkout_id', async () => {
    const { user } = await makeUser();
    const o = await polarOrder(user);
    const r = await hook(paidEvent(o));
    expect(r.body).toEqual({ received: true });
    expect(await Order.findById(o._id)).toMatchObject({ status: 'paid', providerRef: 'chk_9' });
    expect(await credits(user)).toBe(FREE_CREDITS + 5);
  });
  test('Polar gửi lại cùng sự kiện -> không cộng trùng', async () => {
    const { user } = await makeUser();
    const o = await polarOrder(user);
    await hook(paidEvent(o)); await hook(paidEvent(o));
    expect(await credits(user)).toBe(FREE_CREDITS + 5);
  });
  test('chữ ký sai -> 400', async () => {
    const { user } = await makeUser();
    const o = await polarOrder(user);
    expect((await hook(paidEvent(o), { 'webhook-signature': 'v1,AAAA' })).status).toBe(400);
    expect((await Order.findById(o._id)).status).toBe('pending');
  });
  test('body bị sửa sau khi ký -> 400', async () => {
    const { user } = await makeUser();
    const o = await polarOrder(user);
    const raw = JSON.stringify(paidEvent(o));
    const r = await request(app).post('/webhooks/polar').set(polarHeaders(raw)).send(raw.replace('prod_pack5', 'prod_pack50'));
    expect(r.status).toBe(400);
  });
  test('thiếu header webhook -> 400', async () => {
    expect((await request(app).post('/webhooks/polar').send({ type: 'order.paid' })).status).toBe(400);
  });
  test('timestamp quá cũ (replay) -> 400', async () => {
    const { user } = await makeUser();
    const o = await polarOrder(user);
    const raw = JSON.stringify(paidEvent(o));
    const r = await request(app).post('/webhooks/polar').set(polarHeaders(raw, { ts: Math.floor(Date.now() / 1000) - 3600 })).send(raw);
    expect(r.status).toBe(400);
  });
  test('body ký đúng nhưng không phải JSON -> 400', async () => {
    expect((await hook('not json')).status).toBe(400);
  });
  test('product_id không khớp gói của đơn -> bỏ qua, vẫn 200, KHÔNG cộng credits', async () => {
    const { user } = await makeUser();
    const o = await polarOrder(user);
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await hook(paidEvent(o, { product_id: 'prod_pack50' }))).status).toBe(200);
    expect((await Order.findById(o._id)).status).toBe('pending');
    console.warn.mockRestore();
  });
  test('event không có product_id vẫn được xử lý', async () => {
    const { user } = await makeUser();
    const o = await polarOrder(user);
    await hook(paidEvent(o, { product_id: undefined }));
    expect((await Order.findById(o._id)).status).toBe('paid');
  });
  test('loại sự kiện khác (checkout.created) -> 200 và bỏ qua', async () => {
    const { user } = await makeUser();
    const o = await polarOrder(user);
    expect((await hook({ type: 'checkout.created', data: { metadata: { orderId: String(o._id) } } })).status).toBe(200);
    expect((await Order.findById(o._id)).status).toBe('pending');
  });
  test.each([['abc'], [undefined], [''], ['665f1c2e9b1e8a0012345678']])('orderId %p không hợp lệ/không tồn tại -> 200, không crash', async (id) => {
    expect((await hook({ type: 'order.paid', data: { metadata: { orderId: id } } })).status).toBe(200);
  });
  test('đơn của cổng VNPay không thể bị Polar đánh dấu paid', async () => {
    const { user } = await makeUser();
    const o = await mkOrder(user);
    await hook(paidEvent(o));
    expect((await Order.findById(o._id)).status).toBe('pending');
  });
});
