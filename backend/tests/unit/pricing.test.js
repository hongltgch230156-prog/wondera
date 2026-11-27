// Bảng giá, gói credits, chi phí hành động và công tắc cổng thanh toán
const pricing = require('../../config/pricing');

const {
  FREE_CREDITS, LEGACY_FREE_CREDITS, NEW_FREE_CREDITS_FROM,
  PACKAGES, COSTS, getPackage, providerStatus, publicPackages,
} = pricing;

describe('hằng số credits tặng', () => {
  test('tài khoản mới nhận 4 credits', () => expect(FREE_CREDITS).toBe(4));
  test('tài khoản cũ vẫn nhận 2 credits', () => expect(LEGACY_FREE_CREDITS).toBe(2));
  test('mốc phân biệt cũ/mới là 16/11/2026 00:00 giờ Việt Nam', () => {
    expect(NEW_FREE_CREDITS_FROM).toBeInstanceOf(Date);
    expect(NEW_FREE_CREDITS_FROM.toISOString()).toBe('2026-11-15T17:00:00.000Z');
  });
  test('tài khoản mới tặng nhiều hơn tài khoản cũ', () => expect(FREE_CREDITS).toBeGreaterThan(LEGACY_FREE_CREDITS));
});

describe('PACKAGES', () => {
  test('có đúng 3 gói', () => expect(PACKAGES).toHaveLength(3));
  test('id là pack5, pack20, pack50', () => expect(PACKAGES.map((p) => p.id)).toEqual(['pack5', 'pack20', 'pack50']));
  test('id không trùng nhau', () => expect(new Set(PACKAGES.map((p) => p.id)).size).toBe(PACKAGES.length));
  test.each([['pack5', 5, 49000, 1.99], ['pack20', 20, 149000, 5.99], ['pack50', 50, 299000, 11.99]])(
    'gói %s: %i credits, %i VND, %f USD', (id, credits, vnd, usd) => {
      const p = getPackage(id);
      expect(p.credits).toBe(credits);
      expect(p.vnd).toBe(vnd);
      expect(p.usd).toBe(usd);
    });
  test('credits tăng dần theo gói', () => {
    const c = PACKAGES.map((p) => p.credits);
    expect([...c].sort((a, b) => a - b)).toEqual(c);
  });
  test('gói càng lớn giá mỗi credit càng rẻ (VND)', () => {
    const per = PACKAGES.map((p) => p.vnd / p.credits);
    expect(per[0]).toBeGreaterThan(per[1]);
    expect(per[1]).toBeGreaterThan(per[2]);
  });
  test('gói càng lớn giá mỗi credit càng rẻ (USD)', () => {
    const per = PACKAGES.map((p) => p.usd / p.credits);
    expect(per[0]).toBeGreaterThan(per[1]);
    expect(per[1]).toBeGreaterThan(per[2]);
  });
  test('chỉ có đúng 1 gói "popular" là pack20', () => {
    const popular = PACKAGES.filter((p) => p.popular);
    expect(popular).toHaveLength(1);
    expect(popular[0].id).toBe('pack20');
  });
  test('mỗi gói đều khai báo tên biến môi trường Polar', () => {
    PACKAGES.forEach((p) => expect(p.polarProductEnv).toMatch(/^POLAR_PRODUCT_PACK\d+$/));
  });
  test('giá VND là số nguyên dương', () => {
    PACKAGES.forEach((p) => {
      expect(Number.isInteger(p.vnd)).toBe(true);
      expect(p.vnd).toBeGreaterThan(0);
    });
  });
  test('giá USD quy ra cent là số nguyên (không bị lệch khi nhân 100)', () => {
    PACKAGES.forEach((p) => expect(Number.isInteger(Math.round(p.usd * 100))).toBe(true));
  });
});

describe('getPackage', () => {
  test.each([['pack5'], ['pack20'], ['pack50']])('tìm thấy %s', (id) => expect(getPackage(id).id).toBe(id));
  test.each([['pack1'], ['PACK5'], [''], ['pack5 '], [undefined], [null], [5]])('trả về null với %p', (id) => {
    expect(getPackage(id)).toBeNull();
  });
});

describe('COSTS', () => {
  test.each([['single'], ['multiple'], ['magicWandObject']])('chi phí %s là 1 credit', (k) => expect(COSTS[k]).toBe(1));
  test('mọi chi phí là số nguyên dương', () => {
    Object.values(COSTS).forEach((v) => { expect(Number.isInteger(v)).toBe(true); expect(v).toBeGreaterThan(0); });
  });
});

describe('providerStatus', () => {
  const KEYS = ['VNPAY_TMN_CODE', 'VNPAY_HASH_SECRET', 'POLAR_ACCESS_TOKEN', 'POLAR_WEBHOOK_SECRET'];
  let saved;
  beforeEach(() => { saved = {}; KEYS.forEach((k) => { saved[k] = process.env[k]; delete process.env[k]; }); });
  afterEach(() => { KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); });

  test('thiếu hết khoá -> cả hai cổng tắt', () => expect(providerStatus()).toEqual({ vnpay: false, polar: false }));
  test('chỉ có TMN code -> VNPay vẫn tắt', () => {
    process.env.VNPAY_TMN_CODE = 'x';
    expect(providerStatus().vnpay).toBe(false);
  });
  test('chỉ có hash secret -> VNPay vẫn tắt', () => {
    process.env.VNPAY_HASH_SECRET = 'x';
    expect(providerStatus().vnpay).toBe(false);
  });
  test('đủ TMN code + hash secret -> VNPay bật', () => {
    process.env.VNPAY_TMN_CODE = 'x'; process.env.VNPAY_HASH_SECRET = 'y';
    expect(providerStatus()).toEqual({ vnpay: true, polar: false });
  });
  test('chỉ có access token -> Polar tắt', () => {
    process.env.POLAR_ACCESS_TOKEN = 'x';
    expect(providerStatus().polar).toBe(false);
  });
  test('đủ access token + webhook secret -> Polar bật', () => {
    process.env.POLAR_ACCESS_TOKEN = 'x'; process.env.POLAR_WEBHOOK_SECRET = 'y';
    expect(providerStatus()).toEqual({ vnpay: false, polar: true });
  });
  test('chuỗi rỗng được coi là chưa cấu hình', () => {
    process.env.VNPAY_TMN_CODE = ''; process.env.VNPAY_HASH_SECRET = '';
    expect(providerStatus().vnpay).toBe(false);
  });
  test('kết quả luôn là boolean thật', () => {
    process.env.VNPAY_TMN_CODE = 'x'; process.env.VNPAY_HASH_SECRET = 'y';
    expect(typeof providerStatus().vnpay).toBe('boolean');
    expect(typeof providerStatus().polar).toBe('boolean');
  });
});

describe('publicPackages', () => {
  test('không lộ tên biến môi trường Polar ra ngoài', () => {
    publicPackages().forEach((p) => expect(p).not.toHaveProperty('polarProductEnv'));
  });
  test('giữ lại id, label, credits, vnd, usd', () => {
    publicPackages().forEach((p) => {
      ['id', 'label', 'credits', 'vnd', 'usd'].forEach((k) => expect(p).toHaveProperty(k));
    });
  });
  test('giữ cờ popular của gói pack20', () => {
    expect(publicPackages().find((p) => p.id === 'pack20').popular).toBe(true);
  });
  test('không làm hỏng mảng PACKAGES gốc', () => {
    publicPackages();
    PACKAGES.forEach((p) => expect(p.polarProductEnv).toBeDefined());
  });
});
