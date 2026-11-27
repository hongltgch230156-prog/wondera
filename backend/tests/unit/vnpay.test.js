// Tích hợp VNPay: tạo URL thanh toán có chữ ký, kiểm tra chữ ký trả về, định dạng ngày, chuẩn hoá IP
const crypto = require('crypto');
const vnpay = require('../../utils/vnpay');

const SECRET = 'TEST_HASH_SECRET';
const TMN = 'TESTTMN1';
const ENV_KEYS = ['VNPAY_TMN_CODE', 'VNPAY_HASH_SECRET', 'VNPAY_URL'];

let saved;
beforeEach(() => {
  saved = {};
  ENV_KEYS.forEach((k) => { saved[k] = process.env[k]; });
  process.env.VNPAY_TMN_CODE = TMN;
  process.env.VNPAY_HASH_SECRET = SECRET;
  delete process.env.VNPAY_URL;
});
afterEach(() => {
  ENV_KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
});

// Tự tính lại chữ ký bằng cách độc lập (không dùng code của dự án) để đối chiếu
const signIndependently = (params, secret = SECRET) => {
  const q = Object.keys(params)
    .filter((k) => params[k] !== '' && params[k] != null)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k])).replace(/%20/g, '+')}`)
    .join('&');
  return crypto.createHmac('sha512', secret).update(q, 'utf8').digest('hex');
};

const NOW = new Date('2026-11-26T00:00:00Z'); // = 07:00:00 giờ Việt Nam
const build = (over = {}) => vnpay.buildPaymentUrl({
  amountVnd: 49000, txnRef: '665f1c2e9b1e8a0012345678', orderInfo: 'Thanh toan goi 5 credits',
  ipAddr: '1.2.3.4', returnUrl: 'http://backend.test/webhooks/vnpay/return', now: NOW, ...over,
});
const parse = (url) => new URL(url);
const queryObject = (url) => Object.fromEntries(parse(url).searchParams);

describe('vnpDate', () => {
  test('đổi UTC sang giờ Việt Nam (GMT+7)', () => expect(vnpay.vnpDate(NOW)).toBe('20261126070000'));
  test('qua nửa đêm UTC thì sang ngày mới theo giờ VN', () => {
    expect(vnpay.vnpDate(new Date('2026-12-31T20:00:00Z'))).toBe('20270101030000');
  });
  test('thêm số 0 cho tháng/ngày/giờ/phút/giây một chữ số', () => {
    expect(vnpay.vnpDate(new Date('2026-01-02T03:04:05Z'))).toBe('20260102100405');
  });
  test('không truyền tham số vẫn ra chuỗi 14 chữ số', () => expect(vnpay.vnpDate()).toMatch(/^\d{14}$/));
  test('đúng 17:00 UTC là 00:00 ngày hôm sau', () => {
    expect(vnpay.vnpDate(new Date('2026-11-15T17:00:00Z'))).toBe('20261116000000');
  });
  test('năm nhuận 29/02', () => expect(vnpay.vnpDate(new Date('2028-02-29T01:02:03Z'))).toBe('20280229080203'));
});

describe('normalizeIp', () => {
  test.each([
    ['::1', '127.0.0.1'],
    ['', '127.0.0.1'],
    [undefined, '127.0.0.1'],
    [null, '127.0.0.1'],
    ['::ffff:1.2.3.4', '1.2.3.4'],
    ['1.2.3.4, 5.6.7.8', '1.2.3.4'],
    ['  9.9.9.9 ', '9.9.9.9'],
    ['::ffff:10.0.0.1, 8.8.8.8', '10.0.0.1'],
    ['192.168.1.1', '192.168.1.1'],
  ])('%p -> %p', (input, expected) => expect(vnpay.normalizeIp(input)).toBe(expected));
});

describe('buildPaymentUrl', () => {
  test('mặc định trỏ về sandbox của VNPay', () => {
    expect(build().startsWith('https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?')).toBe(true);
  });
  test('dùng VNPAY_URL nếu có cấu hình', () => {
    process.env.VNPAY_URL = 'https://pay.example.com/vpc';
    expect(build().startsWith('https://pay.example.com/vpc?')).toBe(true);
  });
  test('vnp_Amount = số tiền VND × 100', () => expect(queryObject(build()).vnp_Amount).toBe('4900000'));
  test('làm tròn số tiền lẻ trước khi nhân 100', () => {
    expect(queryObject(build({ amountVnd: 49000.6 })).vnp_Amount).toBe('4900100');
  });
  test('các tham số cố định đúng chuẩn VNPay 2.1.0', () => {
    const q = queryObject(build());
    expect(q).toMatchObject({
      vnp_Version: '2.1.0', vnp_Command: 'pay', vnp_CurrCode: 'VND', vnp_OrderType: 'other', vnp_TmnCode: TMN,
    });
  });
  test('truyền đúng mã đơn, thông tin đơn và return URL', () => {
    const q = queryObject(build());
    expect(q.vnp_TxnRef).toBe('665f1c2e9b1e8a0012345678');
    expect(q.vnp_OrderInfo).toBe('Thanh toan goi 5 credits');
    expect(q.vnp_ReturnUrl).toBe('http://backend.test/webhooks/vnpay/return');
  });
  test('locale mặc định là vn', () => expect(queryObject(build()).vnp_Locale).toBe('vn'));
  test('locale en được giữ nguyên', () => expect(queryObject(build({ locale: 'en' })).vnp_Locale).toBe('en'));
  test('locale lạ rơi về vn', () => expect(queryObject(build({ locale: 'fr' })).vnp_Locale).toBe('vn'));
  test('ngày tạo và ngày hết hạn (mặc định +15 phút) theo giờ VN', () => {
    const q = queryObject(build());
    expect(q.vnp_CreateDate).toBe('20261126070000');
    expect(q.vnp_ExpireDate).toBe('20261126071500');
  });
  test('expireMinutes tuỳ chỉnh', () => expect(queryObject(build({ expireMinutes: 60 })).vnp_ExpireDate).toBe('20261126080000'));
  test('IP được chuẩn hoá', () => expect(queryObject(build({ ipAddr: '::ffff:7.7.7.7' })).vnp_IpAddr).toBe('7.7.7.7'));
  test('thiếu IP thì dùng 127.0.0.1', () => expect(queryObject(build({ ipAddr: undefined })).vnp_IpAddr).toBe('127.0.0.1'));
  test('khoảng trắng trong orderInfo được mã hoá thành "+" (không phải %20)', () => {
    const url = build();
    expect(url).toContain('vnp_OrderInfo=Thanh+toan+goi+5+credits');
    expect(url).not.toContain('%20');
  });
  test('các tham số được sắp xếp theo thứ tự chữ cái', () => {
    const keys = [...parse(build()).searchParams.keys()].filter((k) => k !== 'vnp_SecureHash');
    expect(keys).toEqual([...keys].sort());
  });
  test('vnp_SecureHash nằm cuối và dài 128 ký tự hex (HMAC-SHA512)', () => {
    const url = build();
    expect(url).toMatch(/&vnp_SecureHash=[0-9a-f]{128}$/);
  });
  test('chữ ký khớp với phép tính độc lập', () => {
    const q = queryObject(build());
    const hash = q.vnp_SecureHash;
    delete q.vnp_SecureHash;
    expect(hash).toBe(signIndependently(q));
  });
  test('đổi hash secret thì chữ ký đổi', () => {
    const a = queryObject(build()).vnp_SecureHash;
    process.env.VNPAY_HASH_SECRET = 'OTHER';
    expect(queryObject(build()).vnp_SecureHash).not.toBe(a);
  });
  test('cùng đầu vào cho cùng URL (xác định, không ngẫu nhiên)', () => expect(build()).toBe(build()));
  test('orderInfo có ký tự đặc biệt vẫn ký đúng và đọc lại được', () => {
    const info = 'Gói & "đặc biệt" 100%?';
    const url = build({ orderInfo: info });
    const q = queryObject(url);
    expect(q.vnp_OrderInfo).toBe(info);
    expect(vnpay.verifyQuery(q).valid).toBe(true);
  });
});

describe('verifyQuery', () => {
  const signed = (over = {}) => ({ ...queryObject(build()), ...over });

  test('URL do chính buildPaymentUrl tạo ra thì hợp lệ (vòng khứ hồi)', () => {
    const r = vnpay.verifyQuery(queryObject(build()));
    expect(r.valid).toBe(true);
    expect(r.params.vnp_TxnRef).toBe('665f1c2e9b1e8a0012345678');
  });
  test('params trả về không chứa vnp_SecureHash', () => {
    expect(vnpay.verifyQuery(queryObject(build())).params).not.toHaveProperty('vnp_SecureHash');
  });
  test('sửa số tiền -> không hợp lệ', () => expect(vnpay.verifyQuery(signed({ vnp_Amount: '100' })).valid).toBe(false));
  test('sửa mã đơn -> không hợp lệ', () => expect(vnpay.verifyQuery(signed({ vnp_TxnRef: 'abc' })).valid).toBe(false));
  test('thêm một tham số vnp_ lạ -> không hợp lệ', () => expect(vnpay.verifyQuery(signed({ vnp_Hack: '1' })).valid).toBe(false));
  test('thiếu chữ ký -> không hợp lệ', () => {
    const q = signed(); delete q.vnp_SecureHash;
    expect(vnpay.verifyQuery(q).valid).toBe(false);
  });
  test('chữ ký rỗng -> không hợp lệ', () => expect(vnpay.verifyQuery(signed({ vnp_SecureHash: '' })).valid).toBe(false));
  test('chữ ký sai độ dài -> false, không ném lỗi', () => {
    expect(() => vnpay.verifyQuery(signed({ vnp_SecureHash: 'abc' }))).not.toThrow();
    expect(vnpay.verifyQuery(signed({ vnp_SecureHash: 'abc' })).valid).toBe(false);
  });
  test('chữ ký viết HOA vẫn được chấp nhận', () => {
    const q = signed(); q.vnp_SecureHash = q.vnp_SecureHash.toUpperCase();
    expect(vnpay.verifyQuery(q).valid).toBe(true);
  });
  test('thiếu VNPAY_HASH_SECRET -> không hợp lệ', () => {
    const q = queryObject(build());
    delete process.env.VNPAY_HASH_SECRET;
    expect(vnpay.verifyQuery(q).valid).toBe(false);
  });
  test('ký bằng secret khác -> không hợp lệ', () => {
    const q = queryObject(build());
    process.env.VNPAY_HASH_SECRET = 'ANOTHER';
    expect(vnpay.verifyQuery(q).valid).toBe(false);
  });
  test('tham số không bắt đầu bằng vnp_ bị bỏ qua, không ảnh hưởng chữ ký', () => {
    expect(vnpay.verifyQuery(signed({ utm_source: 'x', foo: 'bar' })).valid).toBe(true);
  });
  test('vnp_SecureHashType bị loại khỏi phần được ký', () => {
    expect(vnpay.verifyQuery(signed({ vnp_SecureHashType: 'HmacSHA512' })).valid).toBe(true);
  });
  test('giá trị không phải chuỗi (mảng) bị bỏ qua', () => {
    const r = vnpay.verifyQuery(signed({ vnp_Extra: ['a', 'b'] }));
    expect(r.valid).toBe(true);
    expect(r.params).not.toHaveProperty('vnp_Extra');
  });
  test.each([[undefined], [null], [{}]])('query %p -> không hợp lệ và params rỗng', (q) => {
    const r = vnpay.verifyQuery(q);
    expect(r.valid).toBe(false);
    expect(r.params).toEqual({});
  });
  test('giá trị rỗng không được tính vào chữ ký', () => {
    const base = { vnp_TmnCode: TMN, vnp_Amount: '100' };
    const hash = signIndependently(base);
    expect(vnpay.verifyQuery({ ...base, vnp_BankCode: '', vnp_SecureHash: hash }).valid).toBe(true);
  });
  test('chữ ký tự tính độc lập cũng được chấp nhận (kiểm tra thuật toán)', () => {
    const p = { vnp_Amount: '4900000', vnp_ResponseCode: '00', vnp_TransactionStatus: '00', vnp_TxnRef: 'abc', vnp_OrderInfo: 'a b' };
    expect(vnpay.verifyQuery({ ...p, vnp_SecureHash: signIndependently(p) }).valid).toBe(true);
  });
});

describe('isSuccess', () => {
  test('cả hai mã đều "00" -> thành công', () => {
    expect(vnpay.isSuccess({ vnp_ResponseCode: '00', vnp_TransactionStatus: '00' })).toBe(true);
  });
  test.each([
    [{ vnp_ResponseCode: '24', vnp_TransactionStatus: '02' }],
    [{ vnp_ResponseCode: '00', vnp_TransactionStatus: '02' }],
    [{ vnp_ResponseCode: '07', vnp_TransactionStatus: '00' }],
    [{ vnp_ResponseCode: '00' }],
    [{ vnp_TransactionStatus: '00' }],
    [{}],
    [{ vnp_ResponseCode: 0, vnp_TransactionStatus: 0 }],
  ])('%p -> thất bại', (params) => expect(vnpay.isSuccess(params)).toBe(false));
});
