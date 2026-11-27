// Polar: xác thực webhook (Standard Webhooks) + gọi API tạo/đọc checkout
const crypto = require('crypto');
const polar = require('../../utils/polar');

const SECRET = 'plain-test-secret';
const NOW = 1_800_000_000; // giây, cố định để test xác định
const BODY = JSON.stringify({ type: 'order.paid', data: { id: 'ord_1' } });

const sign = (id, ts, body, keyBuf) =>
  crypto.createHmac('sha256', keyBuf).update(`${id}.${ts}.${body}`).digest('base64');

const headers = (over = {}, { id = 'msg_1', ts = NOW, body = BODY, key = Buffer.from(SECRET, 'utf8') } = {}) => ({
  'webhook-id': id,
  'webhook-timestamp': String(ts),
  'webhook-signature': `v1,${sign(id, Math.floor(ts), body, key)}`,
  ...over,
});

describe('BASE_URL', () => {
  let saved;
  beforeEach(() => { saved = process.env.POLAR_SERVER; });
  afterEach(() => { if (saved === undefined) delete process.env.POLAR_SERVER; else process.env.POLAR_SERVER = saved; });

  test('mặc định là sandbox', () => { delete process.env.POLAR_SERVER; expect(polar.BASE_URL()).toBe('https://sandbox-api.polar.sh'); });
  test('POLAR_SERVER=sandbox -> sandbox', () => { process.env.POLAR_SERVER = 'sandbox'; expect(polar.BASE_URL()).toBe('https://sandbox-api.polar.sh'); });
  test('POLAR_SERVER=production -> API thật', () => { process.env.POLAR_SERVER = 'production'; expect(polar.BASE_URL()).toBe('https://api.polar.sh'); });
  test('giá trị lạ vẫn an toàn: dùng sandbox', () => { process.env.POLAR_SERVER = 'prod'; expect(polar.BASE_URL()).toBe('https://sandbox-api.polar.sh'); });
});

describe('verifyWebhook', () => {
  test('chữ ký hợp lệ -> trả về sự kiện đã parse', () => {
    expect(polar.verifyWebhook(BODY, headers(), SECRET, NOW)).toEqual({ type: 'order.paid', data: { id: 'ord_1' } });
  });
  test('body dạng Buffer cũng được', () => {
    expect(polar.verifyWebhook(Buffer.from(BODY), headers(), SECRET, NOW).type).toBe('order.paid');
  });
  test('secret dạng "whsec_<base64>" dùng khoá đã giải mã base64', () => {
    const raw = Buffer.from('super-secret-bytes');
    const secret = `whsec_${raw.toString('base64')}`;
    const h = headers({}, { key: raw });
    expect(polar.verifyWebhook(BODY, h, secret, NOW).type).toBe('order.paid');
  });
  test('secret là base64 không có tiền tố whsec_ cũng thử giải mã', () => {
    const raw = Buffer.from('secret'); // base64 = c2VjcmV0
    const h = headers({}, { key: raw });
    expect(polar.verifyWebhook(BODY, h, raw.toString('base64'), NOW).type).toBe('order.paid');
  });
  test('secret dạng whsec_ vẫn chấp nhận chữ ký ký bằng cả chuỗi thô', () => {
    const secret = 'whsec_AAAA';
    const h = headers({}, { key: Buffer.from(secret, 'utf8') });
    expect(polar.verifyWebhook(BODY, h, secret, NOW).type).toBe('order.paid');
  });
  test('header có nhiều chữ ký, chỉ cần một cái đúng', () => {
    const good = headers()['webhook-signature'];
    const h = headers({ 'webhook-signature': `v1,AAAAAAAA ${good}` });
    expect(polar.verifyWebhook(BODY, h, SECRET, NOW).type).toBe('order.paid');
  });
  test('thiếu secret -> lỗi', () => expect(() => polar.verifyWebhook(BODY, headers(), '', NOW)).toThrow('POLAR_WEBHOOK_SECRET'));
  test('secret undefined -> lỗi', () => expect(() => polar.verifyWebhook(BODY, headers(), undefined, NOW)).toThrow('POLAR_WEBHOOK_SECRET'));
  test.each([['webhook-id'], ['webhook-timestamp'], ['webhook-signature']])('thiếu header %s -> lỗi', (name) => {
    const h = headers(); delete h[name];
    expect(() => polar.verifyWebhook(BODY, h, SECRET, NOW)).toThrow('header webhook');
  });
  test.each([['abc'], ['NaN'], ['Infinity']])('timestamp "%s" không hợp lệ -> lỗi', (ts) => {
    expect(() => polar.verifyWebhook(BODY, headers({ 'webhook-timestamp': ts }), SECRET, NOW)).toThrow('Timestamp');
  });
  test('quá hạn 301 giây -> lỗi', () => {
    expect(() => polar.verifyWebhook(BODY, headers({}, { ts: NOW - 301 }), SECRET, NOW)).toThrow('quá hạn');
  });
  test('đúng biên 300 giây vẫn hợp lệ', () => {
    expect(polar.verifyWebhook(BODY, headers({}, { ts: NOW - 300 }), SECRET, NOW).type).toBe('order.paid');
  });
  test('timestamp ở tương lai quá 300 giây cũng bị từ chối (chống replay)', () => {
    expect(() => polar.verifyWebhook(BODY, headers({}, { ts: NOW + 301 }), SECRET, NOW)).toThrow('quá hạn');
  });
  test('sửa body sau khi ký -> không khớp', () => {
    expect(() => polar.verifyWebhook(BODY.replace('ord_1', 'ord_2'), headers(), SECRET, NOW)).toThrow('không khớp');
  });
  test('ký bằng secret khác -> không khớp', () => {
    expect(() => polar.verifyWebhook(BODY, headers(), 'another-secret', NOW)).toThrow('không khớp');
  });
  test('đổi webhook-id sau khi ký -> không khớp', () => {
    expect(() => polar.verifyWebhook(BODY, headers({ 'webhook-id': 'msg_other' }), SECRET, NOW)).toThrow('không khớp');
  });
  test('phiên bản chữ ký khác v1 bị bỏ qua', () => {
    const sig = headers()['webhook-signature'].replace('v1,', 'v2,');
    expect(() => polar.verifyWebhook(BODY, headers({ 'webhook-signature': sig }), SECRET, NOW)).toThrow('không khớp');
  });
  test('chữ ký thiếu dấu phẩy -> không khớp, không crash', () => {
    expect(() => polar.verifyWebhook(BODY, headers({ 'webhook-signature': 'garbage' }), SECRET, NOW)).toThrow('không khớp');
  });
  test('timestamp có phần thập phân: chữ ký tính trên phần nguyên', () => {
    const h = headers({ 'webhook-timestamp': `${NOW}.7` }, { ts: NOW });
    expect(polar.verifyWebhook(BODY, h, SECRET, NOW).type).toBe('order.paid');
  });
  test('chữ ký đúng nhưng body không phải JSON -> ném lỗi parse', () => {
    const bad = 'not json';
    expect(() => polar.verifyWebhook(bad, headers({}, { body: bad }), SECRET, NOW)).toThrow();
  });
  test('body rỗng + chữ ký đúng -> lỗi parse chứ không trả về sự kiện', () => {
    expect(() => polar.verifyWebhook('', headers({}, { body: '' }), SECRET, NOW)).toThrow();
  });
  test('body null -> không khớp (không crash)', () => {
    expect(() => polar.verifyWebhook(null, headers(), SECRET, NOW)).toThrow();
  });
});

describe('createCheckout / getCheckout (fetch được giả lập)', () => {
  let savedFetch; let saved;
  const respond = (status, body) => ({
    ok: status >= 200 && status < 300, status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  beforeEach(() => {
    savedFetch = global.fetch;
    saved = { s: process.env.POLAR_SERVER, t: process.env.POLAR_ACCESS_TOKEN };
    delete process.env.POLAR_SERVER;
    process.env.POLAR_ACCESS_TOKEN = 'tok_123';
    global.fetch = jest.fn();
  });
  afterEach(() => {
    global.fetch = savedFetch;
    if (saved.s === undefined) delete process.env.POLAR_SERVER; else process.env.POLAR_SERVER = saved.s;
    if (saved.t === undefined) delete process.env.POLAR_ACCESS_TOKEN; else process.env.POLAR_ACCESS_TOKEN = saved.t;
  });

  test('createCheckout gửi POST tới /v1/checkouts/ với Bearer token', async () => {
    global.fetch.mockResolvedValue(respond(201, { id: 'chk_1', url: 'https://polar.test/c' }));
    const out = await polar.createCheckout({ productId: 'prod_1', successUrl: 'https://x/ok', metadata: { orderId: 'o1' } });
    expect(out).toEqual({ id: 'chk_1', url: 'https://polar.test/c' });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://sandbox-api.polar.sh/v1/checkouts/');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe('Bearer tok_123');
    expect(opts.headers['Content-Type']).toBe('application/json');
  });
  test('body chứa products, success_url, metadata', async () => {
    global.fetch.mockResolvedValue(respond(201, { id: 'c' }));
    await polar.createCheckout({ productId: 'prod_1', successUrl: 'https://x/ok?c={CHECKOUT_ID}', metadata: { orderId: 'o1', userId: 'u1' } });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({
      products: ['prod_1'], success_url: 'https://x/ok?c={CHECKOUT_ID}', metadata: { orderId: 'o1', userId: 'u1' },
    });
  });
  test('có email thì thêm customer_email', async () => {
    global.fetch.mockResolvedValue(respond(201, { id: 'c' }));
    await polar.createCheckout({ productId: 'p', successUrl: 's', email: 'a@b.co', metadata: {} });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).customer_email).toBe('a@b.co');
  });
  test('không có email thì không gửi customer_email', async () => {
    global.fetch.mockResolvedValue(respond(201, { id: 'c' }));
    await polar.createCheckout({ productId: 'p', successUrl: 's', metadata: {} });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).not.toHaveProperty('customer_email');
  });
  test('POLAR_SERVER=production -> gọi api.polar.sh', async () => {
    process.env.POLAR_SERVER = 'production';
    global.fetch.mockResolvedValue(respond(200, { id: 'c' }));
    await polar.getCheckout('chk_9');
    expect(global.fetch.mock.calls[0][0]).toBe('https://api.polar.sh/v1/checkouts/chk_9');
  });
  test('getCheckout mã hoá id trong đường dẫn', async () => {
    global.fetch.mockResolvedValue(respond(200, { id: 'c' }));
    await polar.getCheckout('a/b c');
    expect(global.fetch.mock.calls[0][0]).toBe('https://sandbox-api.polar.sh/v1/checkouts/a%2Fb%20c');
  });
  test('getCheckout dùng GET (không có method tuỳ chỉnh)', async () => {
    global.fetch.mockResolvedValue(respond(200, { id: 'c', status: 'succeeded' }));
    const out = await polar.getCheckout('c');
    expect(out.status).toBe('succeeded');
    expect(global.fetch.mock.calls[0][1].method).toBeUndefined();
  });
  test('API trả lỗi với detail dạng chuỗi -> Error có status và nội dung', async () => {
    global.fetch.mockResolvedValue(respond(422, { detail: 'Product not found' }));
    await expect(polar.getCheckout('x')).rejects.toThrow('Polar API 422: Product not found');
    global.fetch.mockResolvedValue(respond(422, { detail: 'Product not found' }));
    await polar.getCheckout('x').catch((e) => expect(e.status).toBe(422));
  });
  test('detail dạng object được chuyển thành JSON', async () => {
    global.fetch.mockResolvedValue(respond(400, { detail: [{ loc: ['body'], msg: 'bad' }] }));
    await expect(polar.getCheckout('x')).rejects.toThrow('"msg":"bad"');
  });
  test('detail quá dài bị cắt còn 300 ký tự', async () => {
    global.fetch.mockResolvedValue(respond(400, { detail: [{ msg: 'x'.repeat(1000) }] }));
    const err = await polar.getCheckout('x').catch((e) => e);
    expect(err.message.length).toBeLessThanOrEqual('Polar API 400: '.length + 300);
  });
  test('lỗi mà body không phải JSON -> thông báo chứa nội dung văn bản gốc', async () => {
    global.fetch.mockResolvedValue(respond(502, 'Bad gateway'));
    await expect(polar.getCheckout('x')).rejects.toThrow('Polar API 502:');
    global.fetch.mockResolvedValue(respond(502, 'Bad gateway'));
    await expect(polar.getCheckout('x')).rejects.toThrow('Bad gateway');
  });
  test('phản hồi thành công nhưng body rỗng -> null', async () => {
    global.fetch.mockResolvedValue(respond(200, ''));
    await expect(polar.getCheckout('x')).resolves.toBeNull();
  });
  test('phản hồi thành công nhưng không phải JSON -> null (không ném lỗi)', async () => {
    global.fetch.mockResolvedValue(respond(200, '<html>'));
    await expect(polar.getCheckout('x')).resolves.toBeNull();
  });
  test('lỗi mạng được ném ra nguyên vẹn', async () => {
    global.fetch.mockRejectedValue(new Error('ECONNRESET'));
    await expect(polar.getCheckout('x')).rejects.toThrow('ECONNRESET');
  });
});
